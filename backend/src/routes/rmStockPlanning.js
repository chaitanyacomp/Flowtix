const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { prisma } = require("../utils/prisma");
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("../services/docNoService");
const { loadStockByItemIdUsableMap, usableStockDisplayQty } = require("../services/stockService");
const { QUEUE_EPS, qtyToNumber, sumReceivedByRmPoLineFromGrns } = require("../services/rmPurchaseHelpers");
const auditLog = require("../services/auditLog");
const { blockProcurementDemandWhenPlanningDriven } = require("../middleware/planningDrivenProcurementGuard");

const rmStockPlanningRouter = express.Router();
const ACCESS_ROLES = ["ADMIN", "STORE"];
const STOCK_REPLENISHMENT_SOURCE = "STOCK_REPLENISHMENT";

function round3(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function actorUserId(req) {
  const userId = Number(req.user?.userId ?? req.user?.id);
  return Number.isFinite(userId) && userId > 0 ? userId : null;
}

function prLineReceivedQty(prLine) {
  let total = 0;
  for (const poLink of prLine.poLinks || []) {
    const poLine = poLink.rmPoLine;
    if (!poLine || poLine.rmPo?.status === "CANCELLED") continue;
    const allocated = qtyToNumber(poLink.allocatedQty);
    if (allocated <= QUEUE_EPS) continue;
    const receivedByLine = sumReceivedByRmPoLineFromGrns(poLine.rmPo?.grns || []);
    const received = receivedByLine.get(poLine.id) || 0;
    total += Math.min(allocated, received);
  }
  return total;
}

function receivedQtyForSourceLink(sourceLink) {
  const prLine = sourceLink.purchaseRequestLine;
  if (!prLine || prLine.purchaseRequest?.status === "CANCELLED") return 0;
  const netRequired = qtyToNumber(prLine.netRequiredQty);
  const sourceQty = qtyToNumber(sourceLink.allocatedQty);
  if (netRequired <= QUEUE_EPS || sourceQty <= QUEUE_EPS) return 0;
  return prLineReceivedQty(prLine) * Math.min(1, sourceQty / netRequired);
}

async function loadPendingReplenishmentByItemId(db = prisma) {
  const lines = await db.materialRequirementLine.findMany({
    where: {
      materialRequirement: {
        sourceType: STOCK_REPLENISHMENT_SOURCE,
        status: { not: "CANCELLED" },
      },
    },
    include: {
      purchaseRequestSourceLinks: {
        include: {
          purchaseRequestLine: {
            include: {
              purchaseRequest: { select: { status: true } },
              poLinks: {
                include: {
                  rmPoLine: {
                    include: {
                      rmPo: {
                        include: {
                          grns: { include: { lines: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const byItem = new Map();
  const openMrIds = new Set();
  for (const line of lines) {
    const targetQty = qtyToNumber(line.shortageQty) || qtyToNumber(line.requiredQty);
    if (targetQty <= QUEUE_EPS) continue;
    const receivedQty = (line.purchaseRequestSourceLinks || []).reduce(
      (sum, sourceLink) => sum + receivedQtyForSourceLink(sourceLink),
      0,
    );
    const pendingQty = Math.max(0, targetQty - receivedQty);
    if (pendingQty <= QUEUE_EPS) continue;
    openMrIds.add(line.materialRequirementId);
    byItem.set(line.rmItemId, (byItem.get(line.rmItemId) || 0) + pendingQty);
  }
  return { byItem, openMrCount: openMrIds.size };
}

async function listOpenReplenishmentMrs(db = prisma) {
  const mrs = await db.materialRequirement.findMany({
    where: {
      sourceType: STOCK_REPLENISHMENT_SOURCE,
      status: { not: "CANCELLED" },
    },
    include: {
      lines: {
        include: {
          rmItem: { select: { id: true, itemName: true, unit: true } },
          purchaseRequestSourceLinks: {
            select: {
              id: true,
              purchaseRequestLine: {
                select: {
                  id: true,
                  purchaseRequest: { select: { id: true, docNo: true, status: true } },
                },
              },
            },
          },
        },
        orderBy: { id: "asc" },
      },
      createdBy: { select: { name: true, email: true } },
      reversedBy: { select: { name: true, email: true } },
    },
    orderBy: { id: "desc" },
    take: 50,
  });

  return mrs.map((mr) => {
    const prRefs = new Map();
    for (const line of mr.lines || []) {
      for (const link of line.purchaseRequestSourceLinks || []) {
        const pr = link.purchaseRequestLine?.purchaseRequest;
        if (pr) prRefs.set(pr.id, pr.docNo || `PR-${pr.id}`);
      }
    }
    const hasPurchaseRequest = prRefs.size > 0;
    return {
      id: mr.id,
      docNo: mr.docNo,
      status: mr.status,
      createdAt: mr.createdAt,
      createdByName: mr.createdBy?.name ?? mr.createdBy?.email ?? null,
      reversedAt: mr.reversedAt,
      reversedByName: mr.reversedBy?.name ?? mr.reversedBy?.email ?? null,
      reversalReason: mr.reversalReason,
      lineCount: mr.lines.length,
      totalQty: round3(mr.lines.reduce((sum, line) => sum + qtyToNumber(line.shortageQty), 0)),
      hasPurchaseRequest,
      purchaseRequestRefs: [...prRefs.values()],
      canCancel: mr.status === "DRAFT" && !hasPurchaseRequest,
      cancelBlockReason: hasPurchaseRequest
        ? `Purchase request already exists (${[...prRefs.values()].join(", ")}). Cancel/reverse the PR first.`
        : mr.status !== "DRAFT"
          ? "Only open replenishment MRs can be cancelled here."
          : null,
      lines: mr.lines.map((line) => ({
        id: line.id,
        itemId: line.rmItemId,
        itemName: line.rmItem?.itemName ?? "",
        unit: line.unitSnapshot || line.rmItem?.unit || "",
        qty: qtyToNumber(line.shortageQty),
      })),
    };
  });
}

async function buildRmStockPlanningRows(db = prisma) {
  const [items, stockMap, pending, openReplenishmentMrs] = await Promise.all([
    db.item.findMany({
      where: { itemType: "RM" },
      select: { id: true, itemName: true, unit: true, minimumStockQty: true },
      orderBy: { itemName: "asc" },
    }),
    loadStockByItemIdUsableMap(db),
    loadPendingReplenishmentByItemId(db),
    listOpenReplenishmentMrs(db),
  ]);

  const rows = items.map((item) => {
    const usableStock = round3(usableStockDisplayQty(stockMap.get(item.id) ?? 0));
    const minimumStockQty = round3(item.minimumStockQty ?? 0);
    const pendingReplenishmentQty = round3(pending.byItem.get(item.id) || 0);
    const netAvailableQty = round3(usableStock + pendingReplenishmentQty);
    const shortageQty = round3(Math.max(0, minimumStockQty - netAvailableQty));
    return {
      itemId: item.id,
      itemName: item.itemName,
      generatedDisplayCode: `RM-${item.id}`,
      unit: item.unit,
      usableStock,
      minimumStockQty,
      pendingReplenishmentQty,
      netAvailableQty,
      shortageQty,
      suggestedOrderQty: shortageQty,
    };
  });

  return {
    rows,
    summary: {
      rmItemsBelowMinimum: rows.filter((r) => r.shortageQty > QUEUE_EPS).length,
      totalShortageQty: round3(rows.reduce((sum, r) => sum + r.shortageQty, 0)),
      openReplenishmentMrs: pending.openMrCount,
    },
    openReplenishmentMrs,
  };
}

rmStockPlanningRouter.get("/", requireAuth, requireRole(ACCESS_ROLES), async (_req, res, next) => {
  try {
    const data = await buildRmStockPlanningRows();
    return res.json(data);
  } catch (e) {
    return next(e);
  }
});

const createSchema = z.object({
  remarks: z.string().max(4000).optional().nullable(),
  lines: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        qty: z.number().positive(),
      }),
    )
    .min(1, "Select at least one RM item."),
});

rmStockPlanningRouter.post(
  "/replenishment-mrs",
  requireAuth,
  requireRole(ACCESS_ROLES),
  blockProcurementDemandWhenPlanningDriven,
  async (req, res, next) => {
    try {
      const body = createSchema.parse(req.body);
      const normalized = body.lines
        .map((line) => ({ itemId: line.itemId, qty: round3(line.qty) }))
        .filter((line) => line.qty > QUEUE_EPS);

      if (!normalized.length) {
        const err = new Error("Select at least one RM item with order qty greater than zero.");
        err.statusCode = 400;
        throw err;
      }

      const itemIds = [...new Set(normalized.map((line) => line.itemId))];
      const items = await prisma.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, itemName: true, itemType: true, unit: true },
      });
      const itemById = new Map(items.map((item) => [item.id, item]));
      const invalid = itemIds.filter((id) => itemById.get(id)?.itemType !== "RM");
      if (invalid.length || items.length !== itemIds.length) {
        const err = new Error("Only RM items can be added to a replenishment MR.");
        err.statusCode = 400;
        throw err;
      }

      const qtyByItemId = new Map();
      for (const line of normalized) {
        qtyByItemId.set(line.itemId, round3((qtyByItemId.get(line.itemId) || 0) + line.qty));
      }

      const userId = actorUserId(req);
      const result = await prisma.$transaction(async (tx) => {
        const docNo = await allocateDocNo(tx, { docType: DocType.MATERIAL_REQUIREMENT, date: new Date() });
        const materialRequirement = await tx.materialRequirement.create({
          data: {
            docNo,
            status: "DRAFT",
            sourceType: STOCK_REPLENISHMENT_SOURCE,
            quotationId: null,
            salesOrderId: null,
            workOrderId: null,
            createdByUserId: userId,
            remarks: body.remarks?.trim() || "RM stock replenishment",
            lines: {
              create: [...qtyByItemId.entries()].map(([itemId, qty]) => {
                const item = itemById.get(itemId);
                return {
                  rmItemId: itemId,
                  requiredQty: String(qty),
                  shortageQty: String(qty),
                  availableQtySnapshot: "0",
                  unitSnapshot: item?.unit || null,
                };
              }),
            },
          },
          include: {
            lines: {
              include: {
                rmItem: { select: { id: true, itemName: true, unit: true } },
              },
              orderBy: { id: "asc" },
            },
          },
        });

        return { materialRequirement };
      });

      return res.status(201).json(result);
    } catch (e) {
      return next(e);
    }
  },
);

const cancelSchema = z.object({
  reason: z.string().trim().min(3, "Reversal reason is required.").max(4000),
});

rmStockPlanningRouter.post(
  "/replenishment-mrs/:id/cancel",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        const err = new Error("Invalid replenishment MR id.");
        err.statusCode = 400;
        throw err;
      }
      const body = cancelSchema.parse(req.body);
      const userId = actorUserId(req);

      const result = await prisma.$transaction(async (tx) => {
        const mr = await tx.materialRequirement.findUnique({
          where: { id },
          include: {
            lines: {
              include: {
                purchaseRequestSourceLinks: {
                  include: {
                    purchaseRequestLine: {
                      include: {
                        purchaseRequest: { select: { id: true, docNo: true, status: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        });
        if (!mr || mr.sourceType !== STOCK_REPLENISHMENT_SOURCE) {
          const err = new Error("Replenishment MR not found.");
          err.statusCode = 404;
          throw err;
        }
        if (mr.status === "CANCELLED") {
          const err = new Error("Replenishment MR is already cancelled.");
          err.statusCode = 400;
          throw err;
        }

        const prRefs = new Map();
        for (const line of mr.lines || []) {
          for (const link of line.purchaseRequestSourceLinks || []) {
            const pr = link.purchaseRequestLine?.purchaseRequest;
            if (pr) prRefs.set(pr.id, pr.docNo || `PR-${pr.id}`);
          }
        }
        if (prRefs.size > 0) {
          const err = new Error(
            `Purchase request already exists (${[...prRefs.values()].join(", ")}). Cancel/reverse the PR first.`,
          );
          err.statusCode = 409;
          err.code = "REPLENISHMENT_MR_HAS_PR";
          throw err;
        }

        const updated = await tx.materialRequirement.update({
          where: { id },
          data: {
            status: "CANCELLED",
            reversedAt: new Date(),
            reversedByUserId: userId,
            reversalReason: body.reason,
          },
          include: { lines: { include: { rmItem: { select: { id: true, itemName: true, unit: true } } } } },
        });

        if (userId) {
          await auditLog.write(tx, {
            action: auditLog.AuditAction.UPDATE,
            entityType: auditLog.AuditEntityType.SETTINGS,
            entityId: `MATERIAL_REQUIREMENT:${id}`,
            actorUserId: userId,
            actorRole: req.user?.role,
            summary: `Replenishment MR ${updated.docNo || id} cancelled`,
            payload: {
              module: "RM_STOCK_PLANNING",
              actionLabel: "CANCEL_REPLENISHMENT_MR",
              ref: { type: "MATERIAL_REQUIREMENT", id: String(id), no: updated.docNo },
              reason: body.reason,
              status: { from: mr.status, to: updated.status },
            },
          });
        }

        return { materialRequirement: updated };
      });

      return res.json(result);
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = {
  rmStockPlanningRouter,
  buildRmStockPlanningRows,
  loadPendingReplenishmentByItemId,
};
