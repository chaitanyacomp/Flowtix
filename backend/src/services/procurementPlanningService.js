/**
 * Phase 2B — Central procurement planning (RM demand pool).
 * Store consolidates shortages and sends PurchaseRequest to Purchase (not RM PO).
 */

const { prisma } = require("../utils/prisma");
const { usableStockDisplayQty, loadStockByItemIdUsableMap } = require("./stockService");
const { QUEUE_EPS, qtyToNumber, sumReceivedByRmPoLineFromGrns } = require("./rmPurchaseHelpers");
const {
  loadPendingRequestAllocByMrLineId,
  remainingAfterPurchaseRequests,
} = require("./purchaseRequestService");
const { RM_REQUISITION_PURCHASE_VISIBLE_STATUSES } = require("./rmRequisitionLifecycle");
const { buildPlanDisplayLabel } = require("./monthlyPlanningPlanLifecycleService");
const {
  PROCUREMENT_DEMAND_POOL,
  ALL_DEMAND_POOL_KEYS,
  normalizeDemandPoolKey,
  sourceTypesForDemandPool,
  resolveDemandPoolForSourceType,
  demandPoolLabel,
} = require("./procurementDemandPoolService");

function monthlyPlanDocumentLabel(plan) {
  if (!plan) return null;
  if (String(plan.status ?? "") === "APPROVED" || Number(plan.currentRevision ?? 0) === 0) {
    return buildPlanDisplayLabel(plan);
  }
  return null;
}

/**
 * Net procurement qty for MR pool rows.
 * Open PO qty is informational only until explicit PO-to-demand allocation exists.
 */
function computeNetToBuy(totalRequired, _openPoQty) {
  return Math.max(0, totalRequired);
}

function sourceRefForRequirement(mr) {
  if (mr?.sourceType === "MONTHLY_PLAN") {
    const planLabel = monthlyPlanDocumentLabel(mr?.monthlyProductionPlan);
    if (planLabel) return planLabel;
    if (mr?.sourceRevision != null) return `Monthly Plan Rev ${mr.sourceRevision}`;
    if (mr?.monthlyProductionPlan?.periodKey) return mr.monthlyProductionPlan.periodKey;
  }
  if (mr?.sourceType === "STOCK_REPLENISHMENT") return "Stock Replenishment";
  if (!mr) return "—";
  if (mr.salesOrder?.docNo) return mr.salesOrder.docNo;
  if (mr.salesOrderId) return `SO-${mr.salesOrderId}`;
  if (mr.quotation?.quotationNo) return mr.quotation.quotationNo;
  if (mr.quotationId) return `QT-${mr.quotationId}`;
  return mr.docNo || `MR-${mr.id}`;
}

function mapOrigin(line, pendingByMr) {
  const mr = line.materialRequirement;
  const remaining = remainingAfterPurchaseRequests(line, pendingByMr);
  return {
    materialRequirementLineId: line.id,
    materialRequirementId: line.materialRequirementId,
    requirementDocNo: mr?.docNo ?? null,
    sourceType: mr?.sourceType ?? null,
    demandPool: resolveDemandPoolForSourceType(mr?.sourceType),
    sourceRef: sourceRefForRequirement(mr),
    requiredQty: qtyToNumber(line.requiredQty),
    shortageQty: qtyToNumber(line.shortageQty),
    procuredQty: qtyToNumber(line.procuredQty),
    remainingQty: remaining,
  };
}

async function loadOpenPoQtyByItemId(db = prisma) {
  const pos = await db.rmPurchaseOrder.findMany({
    where: { status: { in: ["PENDING", "PARTIAL"] } },
    include: { lines: true, grns: { include: { lines: true } } },
  });
  const byItem = new Map();
  for (const po of pos) {
    const receivedByLine = sumReceivedByRmPoLineFromGrns(po.grns);
    for (const ln of po.lines || []) {
      const ordered = qtyToNumber(ln.qty);
      const received = receivedByLine.get(ln.id) || 0;
      const pending = Math.max(0, ordered - received);
      if (pending <= QUEUE_EPS) continue;
      byItem.set(ln.itemId, (byItem.get(ln.itemId) || 0) + pending);
    }
  }
  return byItem;
}

async function loadOpenMaterialRequirementLines(db = prisma, { demandPool = null, sourceTypes = null } = {}) {
  const poolKey = normalizeDemandPoolKey(demandPool);
  const types = sourceTypes?.length ? sourceTypes : poolKey ? sourceTypesForDemandPool(poolKey) : null;
  return db.materialRequirementLine.findMany({
    where: {
      materialRequirement: {
        status: { in: RM_REQUISITION_PURCHASE_VISIBLE_STATUSES },
        ...(types?.length ? { sourceType: { in: types } } : {}),
      },
      shortageQty: { gt: 0 },
    },
    include: {
      rmItem: { select: { id: true, itemName: true, unit: true } },
      materialRequirement: {
        include: {
          quotation: { select: { id: true, quotationNo: true } },
          salesOrder: { select: { id: true, docNo: true } },
          monthlyProductionPlan: {
            select: {
              id: true,
              periodKey: true,
              status: true,
              planSequenceNo: true,
              planKind: true,
              currentRevision: true,
            },
          },
        },
      },
    },
    orderBy: [{ rmItemId: "asc" }, { id: "asc" }],
  });
}

async function buildProcurementPool(db = prisma, { demandPool = null } = {}) {
  const poolKey = normalizeDemandPoolKey(demandPool);
  const rawLines = await loadOpenMaterialRequirementLines(db, { demandPool: poolKey });
  const pendingByMr = await loadPendingRequestAllocByMrLineId(db);
  const openLines = rawLines.filter((l) => remainingAfterPurchaseRequests(l, pendingByMr) > QUEUE_EPS);
  const stockMap = await loadStockByItemIdUsableMap(db);
  const openPoByItem = await loadOpenPoQtyByItemId(db);

  const byItem = new Map();
  for (const line of openLines) {
    const itemId = line.rmItemId;
    if (!byItem.has(itemId)) {
      byItem.set(itemId, { itemId, item: line.rmItem, origins: [], totalRequired: 0 });
    }
    const bucket = byItem.get(itemId);
    const rem = remainingAfterPurchaseRequests(line, pendingByMr);
    bucket.totalRequired += rem;
    bucket.origins.push(mapOrigin(line, pendingByMr));
  }

  const items = [...byItem.values()]
    .map((b) => {
      const available = usableStockDisplayQty(stockMap.get(b.itemId) ?? 0);
      const openPoQty = openPoByItem.get(b.itemId) || 0;
      const totalRequired = b.totalRequired;
      const netRequiredQty = computeNetToBuy(totalRequired, openPoQty);
      const coveredByStock = Math.min(totalRequired, available);
      return {
        rmItemId: b.itemId,
        itemCode: "",
        itemName: b.item?.itemName ?? "",
        unit: b.item?.unit ?? "",
        requiredQty: totalRequired,
        available,
        openPoQty,
        netRequiredQty,
        netToBuy: netRequiredQty,
        coveredByStock,
        purchaseRequired: netRequiredQty > QUEUE_EPS,
        demandPool: poolKey,
        origins: b.origins.sort((a, c) => String(a.sourceRef).localeCompare(String(c.sourceRef))),
      };
    })
    .sort((a, b) => a.itemName.localeCompare(b.itemName));

  const summary = {
    demandPool: poolKey,
    demandPoolLabel: poolKey ? demandPoolLabel(poolKey) : null,
    itemCount: items.length,
    originCount: openLines.length,
    totalNetRequired: items.reduce((s, i) => s + i.netRequiredQty, 0),
    totalNetToBuy: items.reduce((s, i) => s + i.netRequiredQty, 0),
    itemsNeedingPurchase: items.filter((i) => i.purchaseRequired).length,
  };

  return { demandPool: poolKey, items, summary };
}

async function buildAllProcurementDemandPools(db = prisma) {
  /** @type {Record<string, Awaited<ReturnType<typeof buildProcurementPool>>>} */
  const pools = {};
  for (const key of ALL_DEMAND_POOL_KEYS) {
    pools[key] = await buildProcurementPool(db, { demandPool: key });
  }
  return pools;
}

module.exports = {
  QUEUE_EPS,
  computeNetToBuy,
  buildProcurementPool,
  buildAllProcurementDemandPools,
  loadOpenMaterialRequirementLines,
  loadOpenPoQtyByItemId,
  sourceRefForRequirement,
};
