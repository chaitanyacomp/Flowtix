const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { prisma } = require("../utils/prisma");
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("../services/docNoService");
const { loadStockByItemIdUsableMap, usableStockDisplayQty } = require("../services/stockService");
const { QUEUE_EPS, qtyToNumber, sumReceivedByRmPoLineFromGrns } = require("../services/rmPurchaseHelpers");
const auditLog = require("../services/auditLog");
const {
  STOCK_REPLENISHMENT_SOURCE,
  suggestedRmReplenishmentQty,
  classifyRmStockMonitorStatus,
  rmStockMonitorStatusLabel,
  isEligibleForReplenishmentRequest,
  loadPendingReplenishmentByItemId,
  raiseRmStockReplenishmentPurchaseRequest,
  round3,
} = require("../services/rmStockReplenishmentService");

const rmStockPlanningRouter = express.Router();
const ACCESS_ROLES = ["ADMIN", "STORE"];

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

function resolveProcurementStatusLabel({ mrStatus, hasPurchaseRequest, prStatuses, poStatuses, pendingQty }) {
  if (mrStatus === "CANCELLED") return "Cancelled";
  if (pendingQty <= QUEUE_EPS && hasPurchaseRequest) return "Fully received";
  if (poStatuses.some((s) => s && s !== "CANCELLED")) return "PO in progress";
  if (hasPurchaseRequest) return "Purchase request open";
  if (mrStatus === "APPROVED" || mrStatus === "SENT_TO_PURCHASE") return "Awaiting purchase";
  if (mrStatus === "DRAFT") return "Draft";
  return mrStatus || "Open";
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
            include: {
              purchaseRequestLine: {
                include: {
                  purchaseRequest: { select: { id: true, docNo: true, status: true } },
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
    const poRefs = new Map();
    const prStatuses = [];
    const poStatuses = [];
    let pendingQty = 0;
    let requestedQty = 0;

    for (const line of mr.lines || []) {
      const lineReq = qtyToNumber(line.shortageQty) || qtyToNumber(line.requiredQty);
      requestedQty += lineReq;
      let lineReceived = 0;
      for (const link of line.purchaseRequestSourceLinks || []) {
        const prLine = link.purchaseRequestLine;
        const pr = prLine?.purchaseRequest;
        if (pr) {
          prRefs.set(pr.id, pr.docNo || `PR-${pr.id}`);
          prStatuses.push(pr.status);
        }
        if (prLine) {
          for (const poLink of prLine.poLinks || []) {
            const po = poLink.rmPoLine?.rmPo;
            if (po && po.status !== "CANCELLED") {
              poRefs.set(po.id, po.docNo || `PO-${po.id}`);
              poStatuses.push(po.status);
            }
          }
          // Scale received by source allocation share (same as open-qty loader).
          const netRequired = qtyToNumber(prLine.netRequiredQty);
          const sourceQty = qtyToNumber(link.allocatedQty);
          if (netRequired > QUEUE_EPS && sourceQty > QUEUE_EPS && pr?.status !== "CANCELLED") {
            lineReceived += prLineReceivedQty(prLine) * Math.min(1, sourceQty / netRequired);
          }
        }
      }
      pendingQty += Math.max(0, lineReq - lineReceived);
    }

    pendingQty = round3(pendingQty);
    requestedQty = round3(requestedQty);
    const hasPurchaseRequest = prRefs.size > 0;
    const procurementStatus = resolveProcurementStatusLabel({
      mrStatus: mr.status,
      hasPurchaseRequest,
      prStatuses,
      poStatuses,
      pendingQty,
    });

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
      itemCount: mr.lines.length,
      totalQty: requestedQty,
      requestedQty,
      pendingQty,
      hasPurchaseRequest,
      purchaseRequestRefs: [...prRefs.values()],
      purchaseRequestNos: [...prRefs.values()],
      poRefs: [...poRefs.values()],
      poNos: [...poRefs.values()],
      procurementStatus,
      canCancel: mr.status === "DRAFT" && !hasPurchaseRequest,
      cancelBlockReason: hasPurchaseRequest
        ? `Purchase request already exists (${[...prRefs.values()].join(", ")}). Cancel/reverse the PR first.`
        : mr.status !== "DRAFT"
          ? "Only draft replenishment requests can be cancelled here."
          : null,
      lines: mr.lines.map((line) => ({
        id: line.id,
        itemId: line.rmItemId,
        itemName: line.rmItem?.itemName ?? "",
        unit: line.unitSnapshot || line.rmItem?.unit || "",
        qty: qtyToNumber(line.shortageQty),
      })),
    };
  }).filter((mr) => mr.pendingQty > QUEUE_EPS);
}

async function buildRmStockPlanningRows(db = prisma) {
  const [items, stockMap, pending, openReplenishmentMrs] = await Promise.all([
    db.item.findMany({
      where: { itemType: "RM" },
      select: { id: true, itemName: true, unit: true, minimumStockQty: true, reorderQty: true },
      orderBy: { itemName: "asc" },
    }),
    loadStockByItemIdUsableMap(db),
    loadPendingReplenishmentByItemId(db),
    listOpenReplenishmentMrs(db),
  ]);

  const rows = items.map((item) => {
    const usableStock = round3(usableStockDisplayQty(stockMap.get(item.id) ?? 0));
    const minimumStockQty = round3(item.minimumStockQty ?? 0);
    const targetStockQty =
      item.reorderQty != null && String(item.reorderQty).trim() !== "" ? round3(item.reorderQty) : null;
    const pendingReplenishmentQty = round3(pending.byItem.get(item.id) || 0);
    const netAvailableQty = round3(usableStock + pendingReplenishmentQty);
    const shortageQty = round3(Math.max(0, minimumStockQty - netAvailableQty));
    const monitorStatus = classifyRmStockMonitorStatus({
      currentQty: usableStock,
      minimumStockQty,
    });
    const suggestedPurchaseQty = suggestedRmReplenishmentQty({
      currentQty: usableStock,
      minimumStockQty,
      targetStockQty,
      openStockReplenishmentQty: pendingReplenishmentQty,
    });
    const canRaisePurchaseRequest = isEligibleForReplenishmentRequest({
      currentQty: usableStock,
      minimumStockQty,
      targetStockQty,
      openStockReplenishmentQty: pendingReplenishmentQty,
    });
    let raiseBlockReason = null;
    if (!canRaisePurchaseRequest) {
      if (!(minimumStockQty > QUEUE_EPS)) {
        raiseBlockReason = "Set Minimum Stock on Item Master first.";
      } else if (!(usableStock < minimumStockQty)) {
        raiseBlockReason = "Not required";
      } else if (!(suggestedPurchaseQty > QUEUE_EPS)) {
        raiseBlockReason = "Open replenishment covers the gap";
      } else {
        raiseBlockReason = "—";
      }
    }
    return {
      itemId: item.id,
      itemName: item.itemName,
      generatedDisplayCode: `RM-${item.id}`,
      unit: item.unit,
      usableStock,
      currentStock: usableStock,
      minimumStockQty,
      targetStockQty,
      pendingReplenishmentQty,
      openStockReplenishmentQty: pendingReplenishmentQty,
      netAvailableQty,
      shortageQty,
      suggestedOrderQty: suggestedPurchaseQty,
      suggestedPurchaseQty,
      monitorStatus,
      monitorStatusLabel: rmStockMonitorStatusLabel(monitorStatus),
      canRaisePurchaseRequest,
      eligibleForRequest: canRaisePurchaseRequest,
      raiseBlockReason,
    };
  });

  const eligibleCount = rows.filter((r) => r.canRaisePurchaseRequest).length;

  return {
    rows,
    summary: {
      rmItemsBelowMinimum: rows.filter((r) => r.monitorStatus === "BELOW_MINIMUM").length,
      eligibleForRequest: eligibleCount,
      openReplenishmentMrs: pending.openMrCount,
      openRequests: pending.openMrCount,
      totalShortageQty: round3(rows.reduce((sum, r) => sum + r.shortageQty, 0)),
    },
    openReplenishmentMrs,
    openRequests: openReplenishmentMrs,
    sourceType: STOCK_REPLENISHMENT_SOURCE,
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
  "/raise-purchase-request",
  requireAuth,
  requireRole(ACCESS_ROLES),
  async (req, res, next) => {
    try {
      const body = createSchema.parse(req.body);
      const result = await raiseRmStockReplenishmentPurchaseRequest(
        {
          remarks: body.remarks,
          lines: body.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
        },
        { userId: actorUserId(req), role: req.user?.role ?? null },
      );
      return res.status(201).json(result);
    } catch (e) {
      return next(e);
    }
  },
);

rmStockPlanningRouter.post(
  "/replenishment-mrs",
  requireAuth,
  requireRole(ACCESS_ROLES),
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
        const err = new Error("Only RM items can be added to a replenishment request.");
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
        const err = new Error("Invalid replenishment request id.");
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
          const err = new Error("Replenishment request not found.");
          err.statusCode = 404;
          throw err;
        }
        if (mr.status === "CANCELLED") {
          const err = new Error("Replenishment request is already cancelled.");
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
            summary: `Replenishment request ${updated.docNo || id} cancelled`,
            payload: {
              module: "RM_STOCK_REPLENISHMENT",
              actionLabel: "CANCEL_REPLENISHMENT_REQUEST",
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
  listOpenReplenishmentMrs,
};
