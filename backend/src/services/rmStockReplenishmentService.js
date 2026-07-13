/**
 * RM Stock Replenishment — independent of REGULAR_SO and MONTHLY_PLAN / MPRS.
 * Canonical MaterialPlanningSourceType remains STOCK_REPLENISHMENT (product name:
 * RM Stock Replenishment). Do not introduce a parallel pool or source type.
 */

const { prisma } = require("../utils/prisma");
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("./docNoService");
const { QUEUE_EPS, qtyToNumber, sumReceivedByRmPoLineFromGrns } = require("./rmPurchaseHelpers");
const { createPurchaseRequestFromPool } = require("./purchaseRequestService");
const auditLog = require("./auditLog");

const STOCK_REPLENISHMENT_SOURCE = "STOCK_REPLENISHMENT";

/** Monitor status — health is Minimum-only (Target does not drive status). */
const RM_STOCK_MONITOR_STATUS = Object.freeze({
  BELOW_MINIMUM: "BELOW_MINIMUM",
  HEALTHY: "HEALTHY",
});

function round3(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
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

/**
 * Open STOCK_REPLENISHMENT qty by item = requested − received on active (non-cancelled) MRs.
 * Fully received lines contribute 0; cancelled MRs are excluded.
 */
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

/**
 * Replenishment Level = Target when configured (> 0), otherwise Minimum.
 */
function resolveReplenishmentLevel({ minimumStockQty, targetStockQty }) {
  const minimum = round3(minimumStockQty);
  const target = targetStockQty != null && Number.isFinite(Number(targetStockQty)) ? round3(targetStockQty) : null;
  if (target != null && target > QUEUE_EPS) return target;
  return minimum;
}

/**
 * Net Replenishment Gap =
 *   Replenishment Level − Current Available − Open STOCK_REPLENISHMENT Qty
 * Suggested Qty = max(0, Net Gap).
 */
function suggestedRmReplenishmentQty({
  currentQty,
  minimumStockQty,
  targetStockQty,
  openStockReplenishmentQty = 0,
}) {
  const current = round3(currentQty);
  const openQty = round3(openStockReplenishmentQty);
  const level = resolveReplenishmentLevel({ minimumStockQty, targetStockQty });
  if (!(level > QUEUE_EPS)) return 0;
  return round3(Math.max(0, level - current - openQty));
}

/**
 * Healthy when Current >= Minimum (or Minimum not configured).
 * Below Minimum when Current < Minimum.
 * Target Stock does not affect status.
 */
function classifyRmStockMonitorStatus({ currentQty, minimumStockQty }) {
  const current = round3(currentQty);
  const minimum = round3(minimumStockQty);
  if (minimum > QUEUE_EPS && current < minimum) return RM_STOCK_MONITOR_STATUS.BELOW_MINIMUM;
  return RM_STOCK_MONITOR_STATUS.HEALTHY;
}

function rmStockMonitorStatusLabel(status) {
  if (status === RM_STOCK_MONITOR_STATUS.BELOW_MINIMUM) return "Below Minimum";
  return "Healthy";
}

/**
 * Eligible to raise a replenishment request:
 * Current < Minimum AND net replenishment gap > 0.
 */
function isEligibleForReplenishmentRequest({
  currentQty,
  minimumStockQty,
  targetStockQty,
  openStockReplenishmentQty = 0,
}) {
  const current = round3(currentQty);
  const minimum = round3(minimumStockQty);
  if (!(minimum > QUEUE_EPS) || !(current < minimum)) return false;
  return (
    suggestedRmReplenishmentQty({
      currentQty: current,
      minimumStockQty: minimum,
      targetStockQty,
      openStockReplenishmentQty,
    }) > QUEUE_EPS
  );
}

/**
 * Store raises a Purchase Request for RM stock replenishment when eligible.
 * Creates an APPROVED STOCK_REPLENISHMENT MR then a Purchase Request via the shared pool writer.
 *
 * @param {{ lines: Array<{ itemId: number, qty: number }>, remarks?: string|null }} input
 * @param {{ userId?: number|null, role?: string|null }} actor
 * @param {import('@prisma/client').PrismaClient} [db]
 * @param {{ openQtyByItemId?: Map<number, number> }} [opts]
 */
async function raiseRmStockReplenishmentPurchaseRequest(input, actor = {}, db = prisma, opts = {}) {
  const linesIn = Array.isArray(input?.lines) ? input.lines : [];
  const normalized = [];
  for (const line of linesIn) {
    const itemId = Number(line.itemId);
    const qty = round3(line.qty);
    if (!Number.isFinite(itemId) || itemId <= 0) continue;
    if (!(qty > QUEUE_EPS)) continue;
    normalized.push({ itemId, qty });
  }
  if (!normalized.length) {
    const err = new Error("Select at least one RM item with purchase qty greater than zero.");
    err.statusCode = 400;
    err.code = "RM_REPLENISHMENT_EMPTY";
    throw err;
  }

  const qtyByItemId = new Map();
  for (const line of normalized) {
    qtyByItemId.set(line.itemId, round3((qtyByItemId.get(line.itemId) || 0) + line.qty));
  }
  const itemIds = [...qtyByItemId.keys()];

  const { loadStockByItemIdUsableMap, usableStockDisplayQty } = require("./stockService");
  const [items, stockMap] = await Promise.all([
    db.item.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true,
        itemName: true,
        itemType: true,
        unit: true,
        minimumStockQty: true,
        reorderQty: true,
      },
    }),
    loadStockByItemIdUsableMap(db),
  ]);
  const itemById = new Map(items.map((i) => [i.id, i]));
  if (items.length !== itemIds.length || items.some((i) => i.itemType !== "RM")) {
    const err = new Error("Only RM items can be replenished.");
    err.statusCode = 400;
    err.code = "RM_REPLENISHMENT_INVALID_ITEM";
    throw err;
  }

  let openQtyByItemId = opts.openQtyByItemId;
  if (!(openQtyByItemId instanceof Map)) {
    const pending = await loadPendingReplenishmentByItemId(db);
    openQtyByItemId = pending.byItem;
  }

  for (const [itemId, qty] of qtyByItemId) {
    const item = itemById.get(itemId);
    const current = round3(usableStockDisplayQty(stockMap.get(itemId) ?? 0));
    const minimum = round3(item.minimumStockQty ?? 0);
    const target =
      item.reorderQty != null && String(item.reorderQty).trim() !== "" ? round3(item.reorderQty) : null;
    const openQty = round3(openQtyByItemId.get(itemId) || 0);
    if (!(minimum > QUEUE_EPS)) {
      const err = new Error(`${item.itemName}: set Minimum Stock on the Item Master before raising a request.`);
      err.statusCode = 400;
      err.code = "RM_REPLENISHMENT_MINIMUM_REQUIRED";
      throw err;
    }
    if (!(current < minimum)) {
      const err = new Error(
        `${item.itemName}: Raise Replenishment Request is only available when Current Stock is below Minimum Stock.`,
      );
      err.statusCode = 400;
      err.code = "RM_REPLENISHMENT_NOT_BELOW_MINIMUM";
      throw err;
    }
    const gap = suggestedRmReplenishmentQty({
      currentQty: current,
      minimumStockQty: minimum,
      targetStockQty: target,
      openStockReplenishmentQty: openQty,
    });
    if (!(gap > QUEUE_EPS)) {
      const err = new Error(
        `${item.itemName}: open replenishment already covers the gap. Duplicate request is not allowed.`,
      );
      err.statusCode = 409;
      err.code = "RM_REPLENISHMENT_GAP_COVERED";
      throw err;
    }
    if (qty > gap + QUEUE_EPS) {
      const err = new Error(
        `${item.itemName}: purchase qty ${qty} exceeds net replenishment gap ${gap}.`,
      );
      err.statusCode = 400;
      err.code = "RM_REPLENISHMENT_QTY_EXCEEDS_GAP";
      throw err;
    }
    if (!(qty > QUEUE_EPS)) {
      const err = new Error(`${item.itemName}: purchase qty must be greater than zero.`);
      err.statusCode = 400;
      err.code = "RM_REPLENISHMENT_QTY_INVALID";
      throw err;
    }
  }

  const materialRequirement = await db.$transaction(async (tx) => {
    const docNo = await allocateDocNo(tx, { docType: DocType.MATERIAL_REQUIREMENT, date: new Date() });
    const mr = await tx.materialRequirement.create({
      data: {
        docNo,
        status: "APPROVED",
        sourceType: STOCK_REPLENISHMENT_SOURCE,
        quotationId: null,
        salesOrderId: null,
        workOrderId: null,
        createdByUserId: actor.userId ?? null,
        remarks: String(input.remarks ?? "").trim() || "RM stock replenishment",
        lines: {
          create: [...qtyByItemId.entries()].map(([itemId, qty]) => {
            const item = itemById.get(itemId);
            const current = round3(usableStockDisplayQty(stockMap.get(itemId) ?? 0));
            return {
              rmItemId: itemId,
              requiredQty: String(qty),
              shortageQty: String(qty),
              availableQtySnapshot: String(current),
              unitSnapshot: item?.unit || null,
            };
          }),
        },
      },
      include: {
        lines: {
          include: { rmItem: { select: { id: true, itemName: true, unit: true } } },
          orderBy: { id: "asc" },
        },
      },
    });

    if (actor.userId) {
      await auditLog.write(tx, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `MATERIAL_REQUIREMENT:${mr.id}`,
        actorUserId: actor.userId,
        actorRole: actor.role,
        summary: `RM stock replenishment request ${mr.docNo || mr.id} created (approved)`,
        payload: {
          module: "RM_STOCK_REPLENISHMENT",
          actionLabel: "RAISE_REPLENISHMENT_REQUEST",
          sourceType: STOCK_REPLENISHMENT_SOURCE,
          ref: { type: "MATERIAL_REQUIREMENT", id: String(mr.id), no: mr.docNo },
          status: { from: null, to: mr.status },
        },
      });
    }

    return mr;
  });

  const prLines = materialRequirement.lines.map((line) => ({
    itemId: line.rmItemId,
    requiredQty: qtyToNumber(line.requiredQty),
    availableQty: qtyToNumber(line.availableQtySnapshot),
    netRequiredQty: qtyToNumber(line.shortageQty) || qtyToNumber(line.requiredQty),
    unit: line.unitSnapshot || line.rmItem?.unit || undefined,
    allocations: [
      {
        materialRequirementLineId: line.id,
        qty: qtyToNumber(line.shortageQty) || qtyToNumber(line.requiredQty),
      },
    ],
  }));

  const prResult = await createPurchaseRequestFromPool(
    {
      remarks:
        String(input.remarks ?? "").trim() ||
        `RM stock replenishment (${materialRequirement.docNo || materialRequirement.id})`,
      lines: prLines,
    },
    { userId: actor.userId ?? null, role: actor.role ?? null },
  );

  return {
    sourceType: STOCK_REPLENISHMENT_SOURCE,
    materialRequirement,
    purchaseRequest: prResult.purchaseRequest,
  };
}

module.exports = {
  STOCK_REPLENISHMENT_SOURCE,
  RM_STOCK_MONITOR_STATUS,
  round3,
  resolveReplenishmentLevel,
  suggestedRmReplenishmentQty,
  classifyRmStockMonitorStatus,
  rmStockMonitorStatusLabel,
  isEligibleForReplenishmentRequest,
  loadPendingReplenishmentByItemId,
  raiseRmStockReplenishmentPurchaseRequest,
};
