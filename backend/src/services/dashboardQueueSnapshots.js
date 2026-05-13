/**
 * Single source for dashboard queue row shapes (same numbers the API has always returned).
 * Used by dashboard routes and operations-exception report so classification stays aligned.
 */

const { prisma } = require("../utils/prisma");
const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");
const { effectiveQtyPerUnit } = require("./bomUtils");
const {
  METRIC_CONTEXT,
  DISPATCH_ALLOC_MODE,
  buildSoLineDispatchAllocation,
  getSoLineAttributedDispatchedQty,
  getSoLineOrderQtyMinusAttributedDispatch,
  buildDispatchableQtyBySalesOrderLineId,
  getWoLineRemainingProductionQty,
  getProductionBatchQcPendingQty,
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
} = require("./reportMetrics");
const { mapSoLinesToDispatchFifoInputs, dispatchFifoQtyForSoLine } = require("./regularSoBufferQty");
const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const { buildQcAcceptedMap, buildReplacementReturnQcGrossBySoItemKey } = require("./dispatchQcCap");
const { normalizePositiveCycleId } = require("../utils/cycleIds");
const { netDispatchedByItemId, DISPATCH_ALLOC_MODE: SO_DISPATCH_ALLOC_MODE } = require("./salesOrderDispatchAllocation");
const {
  loadNoQtyCycleQcAcceptedMap,
  loadNoQtyDispositionUsableForDispatchPoolMap,
  loadNoQtyPostCycleApprovalMapForInputs,
  computeNoQtyDispatchHeadroom,
  filterNoQtyDispatchRowsForActiveCycle,
  netNoQtyCycleDispatchedByItemId,
} = require("../routes/dispatch");
const { loadEffectiveNoQtyCarryForwardShortfallByItem } = require("./noQtySoCloseSnapshotService");
const { loadNoQtyPendingQcDispositionQtyByItem } = require("./noQtyPostCycleApprovalService");
const { reconcileStaleSupervisorReworkDispositions } = require("./qcDispositionReconcile");

/** Single map for tests and docs — each queue row type must set quantityMetricContext from here */
const QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT = {
  dispatchBacklog: METRIC_CONTEXT.SO_FIFO,
  productionQueue: METRIC_CONTEXT.WO_LINE,
  qcQueue: METRIC_CONTEXT.QC_BATCH,
  rmRisk: METRIC_CONTEXT.RM_PLANNING,
  purchaseSummary: METRIC_CONTEXT.RM_PO_LINE,
};

const DISPATCH_BACKLOG_EPS = 1e-6;
const QUEUE_EPS = 1e-6;

function customerNameForSalesOrder(so) {
  const direct = so.customer?.name?.trim();
  if (direct) return direct;
  const fromPo = so.po?.customer?.name?.trim();
  if (fromPo) return fromPo;
  return "Unknown Customer";
}

/** NO_QTY: never use SO current cycle alone when the WO is still tied to an older cycle row (avoids skipping CLOSED). */
function resolveNoQtyWorkOrderCycleId(wo, so) {
  return (
    normalizePositiveCycleId(wo.cycle?.id) ??
    normalizePositiveCycleId(wo.cycleId) ??
    normalizePositiveCycleId(so?.currentCycleId)
  );
}

function isClosedNoQtySalesOrderStatus(status) {
  return ["MANUALLY_CLOSED", "CLOSED", "COMPLETED"].includes(String(status ?? ""));
}

async function filterDashboardActionableWorkOrders(workOrders, db = prisma) {
  const noQtyPairs = [];
  const seen = new Set();
  for (const wo of workOrders || []) {
    const so = wo.salesOrder;
    if (!so || so.orderType !== "NO_QTY") continue;
    const soId = Number(wo.salesOrderId ?? so.id);
    const cycleId = normalizePositiveCycleId(so.currentCycleId);
    if (!Number.isFinite(soId) || soId <= 0 || cycleId == null) continue;
    const key = `${soId}:${cycleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    noQtyPairs.push({ salesOrderId: soId, cycleId });
  }

  const lockedSheets =
    noQtyPairs.length > 0
      ? await db.requirementSheet.findMany({
          where: {
            status: "LOCKED",
            OR: noQtyPairs.map((p) => ({ salesOrderId: p.salesOrderId, cycleId: p.cycleId })),
          },
          select: { salesOrderId: true, cycleId: true },
        })
      : [];
  const lockedSheetKeys = new Set(
    lockedSheets.map((s) => `${Number(s.salesOrderId)}:${Number(s.cycleId)}`),
  );

  return (workOrders || []).filter((wo) => {
    const so = wo.salesOrder;
    if (!so || so.orderType !== "NO_QTY") return true;
    if (isClosedNoQtySalesOrderStatus(so.internalStatus)) return false;

    const currentCycleId = normalizePositiveCycleId(so.currentCycleId);
    const woCycleId = normalizePositiveCycleId(wo.cycle?.id) ?? normalizePositiveCycleId(wo.cycleId);
    if (currentCycleId == null || woCycleId == null || woCycleId !== currentCycleId) return false;
    if (so.currentCycle?.status && so.currentCycle.status !== "ACTIVE") return false;
    return lockedSheetKeys.has(`${Number(wo.salesOrderId ?? so.id)}:${currentCycleId}`);
  });
}

async function getActionableWorkOrderCount(db = prisma) {
  const workOrders = await db.workOrder.findMany({
    where: { status: { notIn: ["COMPLETED", "REJECTED"] } },
    include: {
      cycle: { select: { id: true } },
      salesOrder: {
        select: {
          id: true,
          orderType: true,
          internalStatus: true,
          currentCycleId: true,
          currentCycle: { select: { id: true, status: true } },
        },
      },
    },
  });
  const actionable = await filterDashboardActionableWorkOrders(workOrders, db);
  return actionable.length;
}

async function getDispatchBacklogRows() {
  const stockAgg = await prisma.stockTransaction.groupBy({
    by: ["itemId"],
    // Stock math must include reversed originals; reversal rows offset them.
    where: { stockBucket: "USABLE" },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const stockByItemId = new Map(
    stockAgg.map((r) => [r.itemId, Number(r._sum.qtyIn ?? 0) - Number(r._sum.qtyOut ?? 0)]),
  );

  const orders = await prisma.salesOrder.findMany({
    where: {
      internalStatus: { in: ["APPROVED", "IN_PROCESS"] },
    },
    orderBy: { createdAt: "asc" },
    include: {
      lines: { include: { item: true }, orderBy: { id: "asc" } },
      dispatch: true,
      customer: true,
      po: { include: { customer: true } },
    },
  });

  const qcAcceptedMap = await buildQcAcceptedMap(prisma);
  const replacementQcGrossBySoItem = await buildReplacementReturnQcGrossBySoItemKey(prisma, orders, qcAcceptedMap);

  const rows = [];
  for (const so of orders) {
    const customerName = customerNameForSalesOrder(so);
    const soLines = Array.isArray(so?.lines) ? so.lines : [];
    const lineInputs = mapSoLinesToDispatchFifoInputs(soLines, so.orderType);
    const { alloc } = buildSoLineDispatchAllocation(
      lineInputs,
      so.dispatch,
      DISPATCH_ALLOC_MODE.CONFIRMED,
    );

    const qcAcceptedTotalByItemId = new Map();
    for (const li of lineInputs) {
      const repKey = `${so.id}:${li.itemId}`;
      let qcGross = qcAcceptedMap.get(repKey) ?? 0;
      if (replacementQcGrossBySoItem.has(repKey)) {
        qcGross = replacementQcGrossBySoItem.get(repKey) ?? 0;
      }
      qcAcceptedTotalByItemId.set(li.itemId, qcGross);
    }
    const dispatchableByLineId = buildDispatchableQtyBySalesOrderLineId({
      orderLineInputs: lineInputs,
      dispatchRecords: so.dispatch,
      orderType: so.orderType,
      onHandByItemId: stockByItemId,
      qcAcceptedTotalByItemId,
    });

    for (const line of soLines) {
      const dispatched = getSoLineAttributedDispatchedQty(alloc, line.id);
      const orderedQty = dispatchFifoQtyForSoLine(line, so.orderType);
      const pendingQty = getSoLineOrderQtyMinusAttributedDispatch(orderedQty, dispatched);
      if (pendingQty <= DISPATCH_BACKLOG_EPS) continue;
      const dispatchableNow = Number(dispatchableByLineId.get(line.id) ?? 0);
      rows.push({
        salesOrderId: so.id,
        salesOrderNo: `SO-${so.id}`,
        customerName,
        itemId: line.itemId,
        itemName: line.item?.itemName ?? `Item #${line.itemId}`,
        orderedQty,
        dispatchedQty: dispatched,
        pendingQty,
        dispatchableNow,
        salesOrderDate: so.createdAt.toISOString(),
        status: so.internalStatus,
        quantityMetricContext: QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.dispatchBacklog,
      });
    }
  }
  return rows;
}

/** Priority for continue-working / dashboard pipeline (lower = earlier). */
function dashboardNextActionRank(nextAction) {
  if (nextAction === "QC_PENDING") return 0;
  if (nextAction === "DISPATCH_PENDING") return 1;
  if (nextAction === "SALES_BILL_PENDING") return 2;
  if (nextAction === "PRODUCTION_PENDING") return 3;
  if (nextAction === "NEXT_RS_REQUIRED") return 4;
  return 99;
}

function buildDashboardProductionHref({
  nextAction,
  orderType,
  salesOrderId,
  cycleId,
  workOrderId,
  productionId,
  workOrderLineId,
}) {
  const cyc =
    cycleId != null && Number.isFinite(Number(cycleId)) && Number(cycleId) > 0
      ? `&cycleId=${encodeURIComponent(String(cycleId))}`
      : "";
  const noQtyBase = `source=no_qty_so&salesOrderId=${encodeURIComponent(String(salesOrderId))}${cyc}`;
  const pid =
    productionId != null && Number.isFinite(Number(productionId)) && Number(productionId) > 0
      ? `&productionId=${encodeURIComponent(String(productionId))}`
      : "";
  const wo = workOrderId != null && Number(workOrderId) > 0 ? `&workOrderId=${encodeURIComponent(String(workOrderId))}` : "";
  const wol =
    workOrderLineId != null && Number(workOrderLineId) > 0
      ? `&workOrderLineId=${encodeURIComponent(String(workOrderLineId))}`
      : "";

  if (nextAction === "QC_PENDING") {
    if (orderType === "NO_QTY") return `/qc-entry?${noQtyBase}${pid}`;
    return `/qc-entry?salesOrderId=${encodeURIComponent(String(salesOrderId))}${pid}`;
  }
  if (nextAction === "DISPATCH_PENDING") {
    if (orderType === "NO_QTY") return `/dispatch?${noQtyBase}`;
    return `/dispatch?salesOrderId=${encodeURIComponent(String(salesOrderId))}`;
  }
  if (nextAction === "SALES_BILL_PENDING") {
    if (orderType === "NO_QTY") return `/sales-bills?${noQtyBase}`;
    return `/sales-bills?salesOrderId=${encodeURIComponent(String(salesOrderId))}`;
  }
  if (nextAction === "NEXT_RS_REQUIRED") {
    return `/sales-orders/${encodeURIComponent(String(salesOrderId))}/requirement-sheets?intent=add&${noQtyBase}&from=dashboard_shortage`;
  }
  if (nextAction === "PRODUCTION_PENDING") {
    if (orderType === "NO_QTY") return `/production?${noQtyBase}${wo}${wol}`;
    return `/production?salesOrderId=${encodeURIComponent(String(salesOrderId))}${wo}${wol}`;
  }
  return `/production?salesOrderId=${encodeURIComponent(String(salesOrderId))}${wo}${wol}`;
}

function buildDashboardActionLabel(nextAction) {
  if (nextAction === "QC_PENDING") return "Go to QC";
  if (nextAction === "DISPATCH_PENDING") return "Go to Dispatch";
  if (nextAction === "SALES_BILL_PENDING") return "Create Sales Bill";
  if (nextAction === "NEXT_RS_REQUIRED") return "Create Next RS";
  if (nextAction === "PRODUCTION_PENDING") return "Go to Production";
  return "Open";
}

/**
 * `${salesOrderId}:${cycleId}` → true when the cycle has at least one LOCKED forward dispatch with qty > 0
 * and no FINALIZED (non-cancelled) sales bill — billing still required before treating the cycle as past dispatch.
 */
async function loadNoQtySalesBillPendingBySoCycle(prisma, salesOrderCyclePairs) {
  const pairs = (salesOrderCyclePairs || []).filter((p) => p.salesOrderId != null && p.cycleId != null);
  if (pairs.length === 0) return new Map();

  const dispatches = await prisma.dispatch.findMany({
    where: {
      OR: pairs.map((p) => ({ soId: p.salesOrderId, cycleId: p.cycleId })),
      reversalOfId: null,
      workflowStatus: "LOCKED",
    },
    select: { id: true, soId: true, cycleId: true, dispatchedQty: true },
  });
  const fwd = dispatches.filter((d) => Number(d.dispatchedQty) > QUEUE_EPS);
  if (fwd.length === 0) return new Map();

  const finalized = await prisma.salesBill.findMany({
    where: {
      dispatchId: { in: fwd.map((d) => d.id) },
      status: "FINALIZED",
      cancelledAt: null,
    },
    select: { dispatchId: true },
  });
  const finalizedSet = new Set(finalized.map((x) => x.dispatchId));

  /** @type {Map<string, boolean>} */
  const out = new Map();
  for (const d of fwd) {
    if (finalizedSet.has(d.id)) continue;
    const cyc = normalizePositiveCycleId(d.cycleId);
    if (cyc == null) continue;
    out.set(`${d.soId}:${cyc}`, true);
  }
  return out;
}

/**
 * NO_QTY only: every (sales order × cycle × FG item) where QC-backed dispatch headroom is still positive.
 * Uses the same pool as Dispatch: QC accepted + in-cycle disposition → USABLE + post-cycle approvals − operational net dispatch.
 * Independent of {@link SalesOrder.currentCycleId}, open WO rows, next RS, billing, or export.
 */
// NO_QTY business rule: dispatch is optional; do NOT create “dispatch pending” pressure rows on dashboard.
// Keep this helper returning [] to preserve API contract for callers that still import it.
async function getNoQtyDispatchPendingRowsForDashboard() {
  return [];
}

async function getProductionQueueRows() {
  const workOrders = await prisma.workOrder.findMany({
    where: { status: { notIn: ["COMPLETED", "REJECTED"] } },
    orderBy: { createdAt: "asc" },
    include: {
      cycle: true,
      lines: { include: { fgItem: true }, orderBy: { id: "asc" } },
      salesOrder: {
        include: {
          customer: true,
          po: { include: { customer: true } },
          currentCycle: true,
          dispatch: true,
          lines: { include: { item: true } },
        },
      },
    },
  });
  const actionableWorkOrders = await filterDashboardActionableWorkOrders(workOrders, prisma);

  /** For NO_QTY: resolve cycle lifecycle by id (covers WO + SO current cycle). */
  const noQtyCycleIdSet = new Set();
  for (const wo of actionableWorkOrders) {
    const so = wo.salesOrder;
    if (!so || so.orderType !== "NO_QTY") continue;
    const c = resolveNoQtyWorkOrderCycleId(wo, so);
    if (c != null) noQtyCycleIdSet.add(c);
  }
  const noQtyCycleRows =
    noQtyCycleIdSet.size > 0
      ? await prisma.salesOrderCycle.findMany({
          where: { id: { in: [...noQtyCycleIdSet] } },
          select: { id: true, status: true, cycleNo: true },
        })
      : [];
  const cycleStatusById = new Map(noQtyCycleRows.map((c) => [c.id, c.status]));
  const cycleNoById = new Map(noQtyCycleRows.map((c) => [c.id, Number(c.cycleNo)]));

  const lineIds = actionableWorkOrders.flatMap((w) => w.lines.map((l) => l.id));
  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(prisma, lineIds);

  const prodEntries =
    lineIds.length > 0
      ? await prisma.productionEntry.findMany({
          where: { workOrderLineId: { in: lineIds }, workflowStatus: "APPROVED" },
          include: { qcEntries: { where: QC_ENTRY_ACTIVE_WHERE } },
          orderBy: { id: "asc" },
        })
      : [];

  /** @type {Map<number, number>} */
  const pendingQcByLineId = new Map();
  /** @type {Map<number, number>} */
  const firstPendingProdIdByLineId = new Map();
  for (const pe of prodEntries) {
    const lid = pe.workOrderLineId;
    const producedQty = Number(pe.producedQty);
    const ac = sumActiveQcAcceptedQty(pe.qcEntries);
    const rj = sumActiveQcRejectedQty(pe.qcEntries);
    const pend = getProductionBatchQcPendingQty(producedQty, ac, rj);
    if (pend > QUEUE_EPS) {
      pendingQcByLineId.set(lid, (pendingQcByLineId.get(lid) || 0) + pend);
      if (!firstPendingProdIdByLineId.has(lid)) firstPendingProdIdByLineId.set(lid, pe.id);
    }
  }

  /** Unique NO_QTY { id, currentCycleId } for QC accepted map */
  const noQtySoCycleInputs = [];
  const seenSoCycle = new Set();
  for (const wo of actionableWorkOrders) {
    const so = wo.salesOrder;
    if (!so || so.orderType !== "NO_QTY") continue;
    const cyc = resolveNoQtyWorkOrderCycleId(wo, so);
    if (cyc == null) continue;
    const k = `${wo.salesOrderId}:${cyc}`;
    if (seenSoCycle.has(k)) continue;
    seenSoCycle.add(k);
    noQtySoCycleInputs.push({ id: wo.salesOrderId, currentCycleId: cyc });
  }

  const [qcAcceptedBySoCycleItem, noQtyRecheckBySoCycleItem, noQtyPostBySoCycleItem] =
    noQtySoCycleInputs.length > 0
      ? await Promise.all([
          loadNoQtyCycleQcAcceptedMap(prisma, noQtySoCycleInputs),
          loadNoQtyDispositionUsableForDispatchPoolMap(prisma, noQtySoCycleInputs),
          loadNoQtyPostCycleApprovalMapForInputs(prisma, noQtySoCycleInputs),
        ])
      : [new Map(), new Map(), new Map()];

  /** locked RS caps: `${soId}:${cycleId}` → Map<itemId, cap> */
  const capMapBySoCycle = new Map();
  const noQtySoIds = [...new Set(noQtySoCycleInputs.map((x) => x.id))];
  const noQtyCycleIds = [...new Set(noQtySoCycleInputs.map((x) => x.currentCycleId).filter((x) => x != null))];
  if (noQtySoIds.length && noQtyCycleIds.length) {
    const lockedSheets = await prisma.requirementSheet.findMany({
      where: {
        salesOrderId: { in: noQtySoIds },
        cycleId: { in: noQtyCycleIds },
        status: "LOCKED",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { lines: true },
    });
    for (const sh of lockedSheets) {
      const k = `${sh.salesOrderId}:${Number(sh.cycleId)}`;
      if (capMapBySoCycle.has(k)) continue;
      const m = new Map();
      for (const ln of sh.lines || []) {
        const cap = Math.max(Number(ln.suggestedWoQtySnapshot ?? 0), Number(ln.requirementQty ?? 0));
        if (cap > QUEUE_EPS) m.set(ln.itemId, cap);
      }
      capMapBySoCycle.set(k, m);
    }
  }

  /** Active NO_QTY cycles only — CLOSED cycles never need sales-bill gating from this queue. */
  const salesBillPendingPairs = [];
  const seenSalesBillPair = new Set();
  for (const wo of actionableWorkOrders) {
    const so = wo.salesOrder;
    if (!so || so.orderType !== "NO_QTY") continue;
    const cyc = resolveNoQtyWorkOrderCycleId(wo, so);
    if (cyc == null) continue;
    if (cycleStatusById.get(cyc) === "CLOSED") continue;
    const pk = `${wo.salesOrderId}:${cyc}`;
    if (seenSalesBillPair.has(pk)) continue;
    seenSalesBillPair.add(pk);
    salesBillPendingPairs.push({ salesOrderId: wo.salesOrderId, cycleId: cyc });
  }
  const salesBillPendingBySoCycle = await loadNoQtySalesBillPendingBySoCycle(prisma, salesBillPendingPairs);

  /** Item ids for stock lookup */
  const fgItemIds = new Set();
  for (const wo of actionableWorkOrders) {
    for (const line of wo.lines || []) fgItemIds.add(line.fgItemId);
  }
  const stockAgg =
    fgItemIds.size > 0
      ? await prisma.stockTransaction.groupBy({
          by: ["itemId"],
          where: { stockBucket: "USABLE", itemId: { in: [...fgItemIds] } },
          _sum: { qtyIn: true, qtyOut: true },
        })
      : [];
  const stockByItemId = new Map(
    stockAgg.map((r) => [Number(r.itemId), Number(r._sum.qtyIn ?? 0) - Number(r._sum.qtyOut ?? 0)]),
  );

  /** Carry-forward + pending QC disposition (same `effCarryCycleId` key as RS draft) for NEXT_RS row labels only. */
  /** @type {Map<string, Map<number, { rawShortfall: number; planned: number; produced: number }>>} */
  const noQtyCarryForwardBySoCycle = new Map();
  /** @type {Map<string, Map<number, number>>} */
  const noQtyPendingDispBySoCycle = new Map();
  {
    const pairKeys = new Set();
    for (const wo of actionableWorkOrders) {
      const so = wo.salesOrder;
      if (!so || so.orderType !== "NO_QTY") continue;
      const cidWo = resolveNoQtyWorkOrderCycleId(wo, so);
      const effCarryCycleId =
        normalizePositiveCycleId(so.currentCycleId) ?? (cidWo != null ? normalizePositiveCycleId(cidWo) : null);
      if (effCarryCycleId == null || !Number.isFinite(Number(effCarryCycleId)) || Number(effCarryCycleId) <= 0) continue;
      pairKeys.add(`${wo.salesOrderId}:${effCarryCycleId}`);
    }
    await Promise.all(
      [...pairKeys].map(async (key) => {
        const [sid, cid] = key.split(":").map(Number);
        const [{ shortfallByItem: m }, pendByItem] = await Promise.all([
          loadEffectiveNoQtyCarryForwardShortfallByItem(prisma, {
            salesOrderId: sid,
            currentCycleId: cid,
          }),
          loadNoQtyPendingQcDispositionQtyByItem(prisma, sid, cid),
        ]);
        noQtyCarryForwardBySoCycle.set(key, m);
        noQtyPendingDispBySoCycle.set(key, pendByItem);
      }),
    );
  }

  const rows = [];
  /** @type {Set<string>} */
  const emittedNoQtyDispatchHeadroomKeys = new Set();
  for (const wo of actionableWorkOrders) {
    const so = wo.salesOrder;
    const orderType = so?.orderType ?? "NORMAL";
    if (
      orderType === "NO_QTY" &&
      ["MANUALLY_CLOSED", "CLOSED", "COMPLETED"].includes(String(so?.internalStatus ?? ""))
    ) {
      continue;
    }
    const customerName = so ? customerNameForSalesOrder(so) : "Unknown Customer";

    const woLines = Array.isArray(wo?.lines) ? wo.lines : [];
    for (const line of woLines) {
      const requiredQty = Number(line.qty);
      const approvedProduced = producedByLineId.get(line.id) ?? 0;
      const balanceQty = getWoLineRemainingProductionQty(requiredQty, approvedProduced);
      if (balanceQty <= QUEUE_EPS) continue;

      const linePendingQc = pendingQcByLineId.get(line.id) ?? 0;
      const productionIdForQc = firstPendingProdIdByLineId.get(line.id) ?? null;

      let nextAction = "PRODUCTION_PENDING";
      let hasPendingQc = false;
      let dispatchableQty = 0;
      let lastShortageQty = 0;
      /** @type {number | null} */
      let cycleId = null;
      /** @type {string | null} */
      let noQtyCfKey = null;

      if (orderType === "NO_QTY") {
        cycleId = resolveNoQtyWorkOrderCycleId(wo, so);

        const effCarryCycleId =
          normalizePositiveCycleId(so.currentCycleId) ?? (cycleId != null ? normalizePositiveCycleId(cycleId) : null);
        const cfKey =
          effCarryCycleId != null && Number.isFinite(Number(effCarryCycleId)) && Number(effCarryCycleId) > 0
            ? `${wo.salesOrderId}:${Number(effCarryCycleId)}`
            : null;
        noQtyCfKey = cfKey;
        const cfMap = cfKey ? noQtyCarryForwardBySoCycle.get(cfKey) : undefined;
        lastShortageQty = Number(cfMap?.get(line.fgItemId)?.rawShortfall ?? 0);

        if (linePendingQc > QUEUE_EPS) {
          nextAction = "QC_PENDING";
          hasPendingQc = true;
        } else if (cycleId != null && cycleStatusById.get(cycleId) === "CLOSED") {
          /** Cycle closed: never send remaining WO balance to Production — next step is RS per workflow. */
          nextAction = "NEXT_RS_REQUIRED";
        } else if (cycleId != null) {
          const capKey = `${wo.salesOrderId}:${cycleId}`;
          const caps = capMapBySoCycle.get(capKey);
          const qcKey = `${wo.salesOrderId}:${cycleId}:${line.fgItemId}`;
          const qcAcc = Number(qcAcceptedBySoCycleItem.get(qcKey) ?? 0);
          const recheckAcc = Number(noQtyRecheckBySoCycleItem.get(qcKey) ?? 0);
          const postAcc = Number(noQtyPostBySoCycleItem.get(qcKey) ?? 0);

          const dispatchInCycle = (so.dispatch || []).filter(
            (d) => normalizePositiveCycleId(d.cycleId) === cycleId,
          );
          const netByItem = netDispatchedByItemId(dispatchInCycle, SO_DISPATCH_ALLOC_MODE.OPERATIONAL);
          const netDisp = Number(netByItem.get(line.fgItemId) ?? 0);

          /** Same QC pool as Dispatch page: QC accepted + disposition → USABLE (in window) + post-cycle − operational net dispatch. */
          const remDispatch = computeNoQtyDispatchHeadroom({
            alreadyOpNet: netDisp,
            qcAcceptedThisCycle: qcAcc,
            recheckAcceptedThisCycle: recheckAcc,
            postCycleApprovalQty: postAcc,
          });
          // Keep dashboard NO_QTY dispatchable consistent with Dispatch page:
          // cap QC headroom by physical free USABLE stock (ledger) minus UNLOCKED draft reservations.
          const unlockedDraftReserved = (so.dispatch || [])
            .filter((d) => d.reversalOfId == null && d.workflowStatus === "UNLOCKED" && Number(d.itemId) === Number(line.fgItemId))
            .reduce((s, d) => s + Number(d.dispatchedQty), 0);
          const usableLedger = Number(stockByItemId.get(line.fgItemId) ?? 0);
          const freePhysicalUsable = Math.max(0, usableLedger - unlockedDraftReserved);
          const remDispatchCapped = Math.min(Number(remDispatch) || 0, freePhysicalUsable);

          if (remDispatchCapped > QUEUE_EPS) {
            // NO_QTY dispatch is optional — keep availability informational only.
            dispatchableQty = remDispatchCapped;
            emittedNoQtyDispatchHeadroomKeys.add(qcKey);
          }
          if (salesBillPendingBySoCycle.get(capKey)) {
            nextAction = "SALES_BILL_PENDING";
          } else if (approvedProduced <= QUEUE_EPS) {
            nextAction = "PRODUCTION_PENDING";
          } else if (lastShortageQty > QUEUE_EPS) {
            nextAction = "NEXT_RS_REQUIRED";
          } else {
            nextAction = "PRODUCTION_PENDING";
          }
        } else {
          nextAction = approvedProduced <= QUEUE_EPS ? "PRODUCTION_PENDING" : "NEXT_RS_REQUIRED";
        }

        /** Safety net: carry-forward can be 0 while WO balance remains on a CLOSED cycle — never Production. */
        if (
          nextAction === "PRODUCTION_PENDING" &&
          linePendingQc <= QUEUE_EPS &&
          cycleId != null &&
          cycleStatusById.get(cycleId) === "CLOSED" &&
          balanceQty > QUEUE_EPS
        ) {
          nextAction = "NEXT_RS_REQUIRED";
          dispatchableQty = 0;
        }
      } else {
        if (linePendingQc > QUEUE_EPS) {
          nextAction = "QC_PENDING";
          hasPendingQc = true;
        } else {
          nextAction = "PRODUCTION_PENDING";
        }
      }

      /** NEXT_RS only: row + link cycle = SO current planning cycle (matches carry-forward shortage). WO `cycleId` above stays for dispatch/QC/closed math. */
      let rowDisplayCycleId = cycleId;
      let rowDisplayCycleNo =
        orderType === "NO_QTY" && cycleId != null ? cycleNoById.get(cycleId) ?? null : null;
      if (orderType === "NO_QTY" && nextAction === "NEXT_RS_REQUIRED") {
        const curCid = normalizePositiveCycleId(so.currentCycleId);
        if (curCid != null) {
          rowDisplayCycleId = curCid;
          rowDisplayCycleNo =
            so.currentCycle?.cycleNo != null && Number.isFinite(Number(so.currentCycle.cycleNo))
              ? Number(so.currentCycle.cycleNo)
              : cycleNoById.get(curCid) ?? null;
        }
      }

      const href = buildDashboardProductionHref({
        nextAction,
        orderType,
        salesOrderId: wo.salesOrderId,
        cycleId: rowDisplayCycleId,
        workOrderId: wo.id,
        productionId: productionIdForQc,
        workOrderLineId: line.id,
      });

      const displayQty =
        nextAction === "DISPATCH_PENDING"
          ? dispatchableQty
          : orderType === "NO_QTY" && nextAction === "NEXT_RS_REQUIRED"
            ? lastShortageQty
            : balanceQty;
      let qtyLabel;
      if (nextAction === "DISPATCH_PENDING") {
        qtyLabel = "Dispatch pending";
      } else if (orderType === "NO_QTY" && nextAction === "NEXT_RS_REQUIRED") {
        const pdMap = noQtyCfKey ? noQtyPendingDispBySoCycle.get(noQtyCfKey) : undefined;
        const pendingDispQty = Number(pdMap?.get(line.fgItemId) ?? 0);
        const ls = Number(lastShortageQty) || 0;
        qtyLabel =
          pendingDispQty > QUEUE_EPS && ls > QUEUE_EPS && ls <= pendingDispQty + QUEUE_EPS
            ? "Pending QC Disposition Qty"
            : "Last shortage Qty";
      } else {
        qtyLabel = undefined;
      }

      rows.push({
        workOrderId: wo.id,
        workOrderNo: `WO-${wo.id}`,
        workOrderLineId: line.id,
        salesOrderId: wo.salesOrderId,
        salesOrderNo: `SO-${wo.salesOrderId}`,
        customerName,
        itemId: line.fgItemId,
        itemName: line.fgItem?.itemName ?? `Item #${line.fgItemId}`,
        requiredQty,
        producedQty: approvedProduced,
        balanceQty,
        status: wo.status,
        workOrderDate: wo.createdAt.toISOString(),
        quantityMetricContext: QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.productionQueue,
        orderType,
        cycleId: rowDisplayCycleId,
        cycleNo: rowDisplayCycleNo,
        nextAction,
        lastShortageQty,
        hasPendingQc,
        dispatchableQty,
        productionId: productionIdForQc,
        displayQty,
        qtyLabel,
        actionHref: href,
        actionLabel: buildDashboardActionLabel(nextAction),
      });
    }
  }

  // NO_QTY: do not emit synthetic dispatch-pending-only rows (dispatch optional).

  return rows;
}

async function getQcQueueRows() {
  const productions = await prisma.productionEntry.findMany({
    where: { workflowStatus: "APPROVED" },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    include: {
      workOrderLine: {
        include: {
          fgItem: true,
          workOrder: true,
        },
      },
      qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
    },
  });

  const rows = [];
  for (const prod of productions) {
    const wol = prod.workOrderLine;
    if (!wol) continue;
    const wo = wol.workOrder;
    if (!wo) continue;
    if (!wol.fgItem) continue;

    const producedQty = Number(prod.producedQty);
    const acceptedQty = sumActiveQcAcceptedQty(prod.qcEntries);
    const rejectedQty = sumActiveQcRejectedQty(prod.qcEntries);
    const pendingQcQty = getProductionBatchQcPendingQty(producedQty, acceptedQty, rejectedQty);
    if (pendingQcQty <= QUEUE_EPS) continue;

    const status = prod.qcEntries.length === 0 ? "PENDING_QC" : "PARTIAL_QC";

    rows.push({
      qcRef: `PE-${prod.id}`,
      workOrderId: wo.id,
      workOrderNo: `WO-${wo.id}`,
      salesOrderId: wo.salesOrderId,
      salesOrderNo: `SO-${wo.salesOrderId}`,
      itemId: wol.fgItemId,
      itemName: wol.fgItem?.itemName ?? `Item #${wol.fgItemId}`,
      producedQty,
      acceptedQty,
      rejectedQty,
      pendingQcQty,
      status,
      qcDate: prod.date.toISOString(),
      quantityMetricContext: QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.qcQueue,
    });
  }
  return rows;
}

/**
 * Draft dispatch rows (UNLOCKED, non-reversal) with positive prepared qty — operator should finalize.
 */
async function getDraftFinalizeDispatchCandidates() {
  const rows = await prisma.dispatch.findMany({
    where: {
      reversalOfId: null,
      workflowStatus: "UNLOCKED",
    },
    include: {
      salesOrder: { include: { customer: true, po: { include: { customer: true } } } },
      item: true,
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  const out = [];
  for (const d of rows) {
    const qty = Number(d.dispatchedQty);
    if (!(qty > QUEUE_EPS)) continue;
    const so = d.salesOrder;
    if (!so || !["APPROVED", "IN_PROCESS"].includes(so.internalStatus)) continue;
    out.push({
      salesOrderId: d.soId,
      itemId: d.itemId,
      itemName: d.item?.itemName ?? `Item #${d.itemId}`,
      dispatchId: d.id,
      sortAt: d.date.toISOString(),
      salesOrderDocNo: so.docNo ?? null,
      customerName: customerNameForSalesOrder(so),
    });
  }
  return out;
}

/**
 * Continue-working pipeline rows (may be multiple per NO_QTY SO: QC + per-cycle dispatch + Next RS, etc.).
 */
async function getContinueWorkingRows(options = {}) {
  const limit = Math.min(100, Math.max(5, Number(options.limit) || 50));

  const [prodRows, qcRows, dispRows] = await Promise.all([
    getProductionQueueRows(),
    getQcQueueRows(),
    getDispatchBacklogRows(),
  ]);

  /** Prefer lowest pipeline rank; tie-break by larger urgency qty. */
  const prodBestBySo = new Map();
  /** NO_QTY dispatch-pending rows (may include COMPLETED WOs / older cycles) — all emitted on continue-working. */
  /** @type {Map<number, object[]>} */
  const noQtyDispatchExtrasBySo = new Map();
  function includeProdRowInDashboard(r) {
    if (r.status === "PENDING" || r.status === "IN_PROGRESS") return true;
    return r.orderType === "NO_QTY" && r.nextAction === "DISPATCH_PENDING" && r.status === "COMPLETED";
  }
  for (const r of prodRows) {
    if (!includeProdRowInDashboard(r)) continue;
    if (
      r.orderType === "NO_QTY" &&
      r.nextAction === "DISPATCH_PENDING" &&
      Number(r.dispatchableQty ?? r.displayQty ?? 0) > QUEUE_EPS
    ) {
      const arr = noQtyDispatchExtrasBySo.get(r.salesOrderId) ?? [];
      arr.push(r);
      noQtyDispatchExtrasBySo.set(r.salesOrderId, arr);
    }
    const prev = prodBestBySo.get(r.salesOrderId);
    const rank = dashboardNextActionRank(r.nextAction);
    const prevRank = prev ? dashboardNextActionRank(prev.nextAction) : 999;
    const qty = Number(r.displayQty ?? r.balanceQty ?? 0);
    const prevQty = prev ? Number(prev.displayQty ?? prev.balanceQty ?? 0) : 0;
    if (!prev || rank < prevRank || (rank === prevRank && qty > prevQty)) {
      prodBestBySo.set(r.salesOrderId, r);
    }
  }
  for (const arr of noQtyDispatchExtrasBySo.values()) {
    arr.sort((a, b) => Number(a.cycleNo || 0) - Number(b.cycleNo || 0));
  }

  const qcBySo = new Map();
  for (const r of qcRows) {
    const prev = qcBySo.get(r.salesOrderId);
    const pending = Number(r.pendingQcQty) || 0;
    if (!prev || pending > prev.pendingQcQty) qcBySo.set(r.salesOrderId, r);
  }

  const dispBySo = new Map();
  for (const r of dispRows) {
    const prev = dispBySo.get(r.salesOrderId);
    const dispNow = Number(r.dispatchableNow) || 0;
    if (!prev || dispNow > prev.dispatchableNow) dispBySo.set(r.salesOrderId, r);
  }

  const soIds = new Set([
    ...prodBestBySo.keys(),
    ...qcBySo.keys(),
    ...dispBySo.keys(),
    ...noQtyDispatchExtrasBySo.keys(),
  ]);
  if (soIds.size === 0) return [];

  const sos = await prisma.salesOrder.findMany({
    where: { id: { in: [...soIds] } },
    include: { customer: true, po: { include: { customer: true } }, currentCycle: true, dispatch: true, lines: { include: { item: true } } },
  });
  const soById = new Map(sos.map((s) => [s.id, s]));

  function stageKeyFromNext(nextAction) {
    if (nextAction === "QC_PENDING") return "QC";
    if (nextAction === "DISPATCH_PENDING") return "DISPATCH";
    if (nextAction === "SALES_BILL_PENDING") return "SALES_BILL";
    if (nextAction === "NEXT_RS_REQUIRED") return "NEXT_RS";
    if (nextAction === "PRODUCTION_PENDING") return "PRODUCTION";
    return "DONE";
  }

  const out = [];
  for (const soId of soIds) {
    const so = soById.get(soId);
    if (!so || !["APPROVED", "IN_PROCESS"].includes(so.internalStatus)) continue;

    const qc = qcBySo.get(soId) ?? null;
    const prodPick = prodBestBySo.get(soId) ?? null;
    const disp = dispBySo.get(soId) ?? null;

    const awaitingQcQty = qc ? Number(qc.pendingQcQty) || 0 : 0;

    if (awaitingQcQty > QUEUE_EPS) {
      const cycleId = normalizePositiveCycleId(so.currentCycleId);
      const m = /^PE-(\d+)$/.exec(String(qc.qcRef ?? ""));
      const productionId = m ? Number(m[1]) : null;
      const route = buildDashboardProductionHref({
        nextAction: "QC_PENDING",
        orderType: so.orderType ?? "NORMAL",
        salesOrderId: soId,
        cycleId,
        workOrderId: qc.workOrderId,
        productionId,
        workOrderLineId: null,
      });
      out.push({
        key: `so-${soId}-qc`,
        salesOrderId: soId,
        salesOrderDocNo: so.docNo ?? null,
        customerName: customerNameForSalesOrder(so),
        itemName: qc.itemName,
        orderType: so.orderType,
        cycleNo: so.orderType === "NO_QTY" ? (so.currentCycle?.cycleNo ?? null) : null,
        cycleId,
        stageKey: "QC",
        awaitingQcQty,
        hasPendingQc: true,
        nextAction: "QC_PENDING",
        metricLabel: "Awaiting QC",
        metricQty: awaitingQcQty,
        nextStep: "Continue QC",
        href: route,
      });
      /** NO_QTY: QC must not hide older-cycle dispatch (or Next RS) on the same SO. */
      if (so.orderType !== "NO_QTY") continue;
    }

    const noQtyDispExtras = noQtyDispatchExtrasBySo.get(soId) ?? [];
    for (const d of noQtyDispExtras) {
      const mq = Number(d.dispatchableQty ?? d.displayQty ?? 0);
      if (!(mq > QUEUE_EPS)) continue;
      out.push({
        key: `so-${soId}-nqdp-${d.cycleId}-${d.itemId}`,
        salesOrderId: soId,
        salesOrderDocNo: so.docNo ?? null,
        customerName: customerNameForSalesOrder(so),
        itemName: d.itemName,
        orderType: so.orderType,
        cycleNo: d.cycleNo ?? null,
        cycleId: d.cycleId ?? null,
        stageKey: "DISPATCH",
        dispatchableNow: mq,
        dispatchableQty: mq,
        hasPendingQc: false,
        nextAction: "DISPATCH_PENDING",
        metricLabel: d.qtyLabel ?? "Dispatch pending",
        metricQty: mq,
        nextStep: "Go to Dispatch",
        href: d.actionHref,
      });
    }

    const skipProdPickDupDispatch =
      prodPick &&
      prodPick.orderType === "NO_QTY" &&
      prodPick.nextAction === "DISPATCH_PENDING" &&
      noQtyDispExtras.length > 0;

    /** Global QC row already emitted above — do not duplicate prod-queue QC_PENDING. */
    const skipProdPickDupGlobalQc =
      prodPick && awaitingQcQty > QUEUE_EPS && prodPick.nextAction === "QC_PENDING";

    if (prodPick && !skipProdPickDupDispatch && !skipProdPickDupGlobalQc) {
      const nextStep =
        prodPick.nextAction === "NEXT_RS_REQUIRED"
          ? "Create Next Requirement Sheet"
          : prodPick.nextAction === "DISPATCH_PENDING"
            ? "Go to Dispatch"
            : prodPick.nextAction === "QC_PENDING"
              ? "Continue QC"
              : prodPick.nextAction === "SALES_BILL_PENDING"
                ? "Create Sales Bill"
                : "Continue Production";
      const stageKey = stageKeyFromNext(prodPick.nextAction);
      const metricQty =
        prodPick.orderType === "NO_QTY" && prodPick.nextAction === "NEXT_RS_REQUIRED"
          ? Number(prodPick.lastShortageQty ?? 0)
          : prodPick.nextAction === "DISPATCH_PENDING"
            ? Number(prodPick.dispatchableQty ?? prodPick.displayQty ?? 0)
            : Number(prodPick.balanceQty ?? 0);
      const metricLabel =
        prodPick.orderType === "NO_QTY" && prodPick.nextAction === "NEXT_RS_REQUIRED"
          ? prodPick.qtyLabel ?? "Last shortage Qty"
          : prodPick.nextAction === "DISPATCH_PENDING"
            ? prodPick.qtyLabel ?? "Dispatch pending"
            : prodPick.nextAction === "SALES_BILL_PENDING"
              ? "Sales bill pending"
              : "Remaining Production";
      const cycleIdOut = prodPick.cycleId ?? null;
      const cycleNoOut =
        prodPick.orderType === "NO_QTY" && prodPick.cycleNo != null
          ? Number(prodPick.cycleNo)
          : so.orderType === "NO_QTY"
            ? (so.currentCycle?.cycleNo ?? null)
            : null;
      out.push({
        key: prodPick.nextAction === "NEXT_RS_REQUIRED" ? `so-${soId}-nqrs` : `so-${soId}`,
        salesOrderId: soId,
        salesOrderDocNo: so.docNo ?? null,
        customerName: customerNameForSalesOrder(so),
        itemName: prodPick.itemName,
        orderType: so.orderType,
        cycleNo: cycleNoOut,
        cycleId: cycleIdOut,
        stageKey,
        awaitingQcQty: undefined,
        dispatchableNow: stageKey === "DISPATCH" ? metricQty : undefined,
        productionRemaining: stageKey === "PRODUCTION" ? metricQty : undefined,
        lastShortageQty: prodPick.lastShortageQty != null ? prodPick.lastShortageQty : undefined,
        hasPendingQc: Boolean(prodPick.hasPendingQc),
        dispatchableQty: prodPick.dispatchableQty != null ? prodPick.dispatchableQty : undefined,
        nextAction: prodPick.nextAction,
        metricLabel,
        metricQty,
        nextStep,
        href: prodPick.actionHref,
      });
    } else if (disp && Number(disp.dispatchableNow) > QUEUE_EPS) {
      const cycleId = normalizePositiveCycleId(so.currentCycleId);
      const route =
        so.orderType === "NO_QTY"
          ? buildDashboardProductionHref({
              nextAction: "DISPATCH_PENDING",
              orderType: "NO_QTY",
              salesOrderId: soId,
              cycleId,
              workOrderId: null,
              productionId: null,
              workOrderLineId: null,
            })
          : `/dispatch?salesOrderId=${encodeURIComponent(String(soId))}`;
      const metricQty = Number(disp.dispatchableNow) || 0;
      out.push({
        key: `so-${soId}-fifo`,
        salesOrderId: soId,
        salesOrderDocNo: so.docNo ?? null,
        customerName: customerNameForSalesOrder(so),
        itemName: disp.itemName,
        orderType: so.orderType,
        cycleNo: so.orderType === "NO_QTY" ? (so.currentCycle?.cycleNo ?? null) : null,
        cycleId: so.orderType === "NO_QTY" ? cycleId : null,
        stageKey: "DISPATCH",
        dispatchableNow: metricQty,
        dispatchableQty: metricQty,
        hasPendingQc: false,
        nextAction: "DISPATCH_PENDING",
        metricLabel: "Dispatchable now",
        metricQty,
        nextStep: "Go to Dispatch",
        href: route,
      });
    }
  }

  function continueWorkingRowSort(a, b) {
    const pri = (x) =>
      x.stageKey === "QC"
        ? 0
        : x.stageKey === "DISPATCH"
          ? 1
          : x.stageKey === "SALES_BILL"
            ? 2
            : x.stageKey === "PRODUCTION"
              ? 3
              : x.stageKey === "NEXT_RS"
                ? 4
                : 5;
    const da = pri(a);
    const db = pri(b);
    if (da !== db) return da - db;
    if (da === 1) {
      const ca = Number(a.cycleNo ?? 1e9);
      const cb = Number(b.cycleNo ?? 1e9);
      if (ca !== cb) return ca - cb;
    }
    return String(a.salesOrderId).localeCompare(String(b.salesOrderId));
  }

  const sorted = [...out].sort(continueWorkingRowSort);
  const isNoQtyDispatch = (r) => r.orderType === "NO_QTY" && r.stageKey === "DISPATCH";
  const noQtyDispatchRows = sorted.filter(isNoQtyDispatch);
  const otherRows = sorted.filter((r) => !isNoQtyDispatch(r));
  if (sorted.length <= limit) return sorted;
  const slotsForOther = Math.max(0, limit - noQtyDispatchRows.length);
  return [...noQtyDispatchRows, ...otherRows.slice(0, slotsForOther)].sort(continueWorkingRowSort);
}

/**
 * Minimal ACTIVE NO_QTY Sales Orders list for dashboard continuity UI.
 * Intentionally does NOT compute next-action heuristics; frontend uses /no-qty-flow-state.
 *
 * Important: after a cycle completes, {@link maybeAutoCloseNoQtyCycle} sets SalesOrder.currentCycleId
 * to null while the SO stays open until the next RS creates a new ACTIVE cycle. Dashboard continuation
 * must still list those SOs — do NOT require currentCycleId (between-cycles is exactly when operators
 * need "Create next RS").
 */
async function getActiveNoQtySalesOrders(options = {}) {
  const limitRaw = Number(options.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 10;

  const rows = await prisma.salesOrder.findMany({
    where: {
      orderType: "NO_QTY",
      internalStatus: { notIn: ["COMPLETED", "CLOSED", "MANUALLY_CLOSED"] },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
    include: {
      customer: true,
      po: { include: { customer: true } },
      currentCycle: true,
    },
  });

  const soIds = rows.map((so) => so.id);
  const latestSheets =
    soIds.length > 0
      ? await prisma.requirementSheet.findMany({
          where: { salesOrderId: { in: soIds } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, docNo: true, status: true, salesOrderId: true, cycleId: true },
        })
      : [];
  const latestSheetBySoId = new Map();
  for (const sheet of latestSheets) {
    if (!latestSheetBySoId.has(sheet.salesOrderId)) latestSheetBySoId.set(sheet.salesOrderId, sheet);
  }

  return rows.map((so) => ({
    salesOrderId: so.id,
    salesOrderDocNo: so.docNo ?? null,
    customerName: customerNameForSalesOrder(so),
    cycleId: so.currentCycleId != null ? Number(so.currentCycleId) : null,
    cycleNo: so.currentCycle?.cycleNo != null ? Number(so.currentCycle.cycleNo) : null,
    internalStatus: so.internalStatus ?? null,
    latestRequirementSheetId: latestSheetBySoId.get(so.id)?.id ?? null,
    latestRequirementSheetDocNo: latestSheetBySoId.get(so.id)?.docNo ?? null,
    latestRequirementSheetStatus: latestSheetBySoId.get(so.id)?.status ?? null,
    latestRequirementSheetCycleId:
      latestSheetBySoId.get(so.id)?.cycleId != null ? Number(latestSheetBySoId.get(so.id).cycleId) : null,
  }));
}

async function getRmRiskRows() {
  const workOrders = await prisma.workOrder.findMany({
    where: { status: { notIn: ["COMPLETED", "REJECTED"] } },
    orderBy: { createdAt: "asc" },
    include: {
      cycle: { select: { id: true } },
      lines: { include: { fgItem: true }, orderBy: { id: "asc" } },
      salesOrder: {
        select: {
          id: true,
          orderType: true,
          internalStatus: true,
          currentCycleId: true,
          currentCycle: { select: { id: true, status: true } },
        },
      },
    },
  });
  const actionableWorkOrders = await filterDashboardActionableWorkOrders(workOrders, prisma);

  const lineIds = actionableWorkOrders.flatMap((w) => w.lines.map((l) => l.id));
  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(prisma, lineIds);

  const fgIdsWithBalance = new Set();
  for (const wo of actionableWorkOrders) {
    for (const line of wo.lines) {
      const requiredQty = Number(line.qty);
      const approvedProduced = producedByLineId.get(line.id) ?? 0;
      if (getWoLineRemainingProductionQty(requiredQty, approvedProduced) > QUEUE_EPS) fgIdsWithBalance.add(line.fgItemId);
    }
  }

  const fgIds = [...fgIdsWithBalance];
  const boms =
    fgIds.length === 0
      ? []
      : await prisma.bom.findMany({
          where: { fgItemId: { in: fgIds } },
          include: { lines: true },
        });
  const bomByFgId = new Map(boms.map((b) => [b.fgItemId, b]));

  const rmNeeded = new Map();
  for (const wo of actionableWorkOrders) {
    for (const line of wo.lines) {
      const requiredQty = Number(line.qty);
      const approvedProduced = producedByLineId.get(line.id) ?? 0;
      const balance = getWoLineRemainingProductionQty(requiredQty, approvedProduced);
      if (balance <= QUEUE_EPS) continue;
      const bom = bomByFgId.get(line.fgItemId);
      if (!bom) continue;
      for (const bl of bom.lines) {
        const perUnit = effectiveQtyPerUnit(bl.baseQty, bl.wastagePercent);
        const add = perUnit * balance;
        rmNeeded.set(bl.rmItemId, (rmNeeded.get(bl.rmItemId) || 0) + add);
      }
    }
  }

  const rmIds = [...rmNeeded.keys()];
  if (rmIds.length === 0) {
    return [];
  }

  const [rmItems, stockAgg] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: rmIds }, itemType: "RM" } }),
    prisma.stockTransaction.groupBy({
      by: ["itemId"],
      where: { itemId: { in: rmIds }, reversedAt: null },
      _sum: { qtyIn: true, qtyOut: true },
    }),
  ]);
  const stockByRm = new Map(
    stockAgg.map((r) => [
      r.itemId,
      Number(r._sum.qtyIn ?? 0) - Number(r._sum.qtyOut ?? 0),
    ]),
  );
  const rmItemById = new Map(rmItems.map((i) => [i.id, i]));

  const rows = [];
  for (const rmId of rmIds) {
    const item = rmItemById.get(rmId);
    if (!item) continue;
    const requiredQty = rmNeeded.get(rmId) ?? 0;
    const currentStockQty = stockByRm.get(rmId) ?? 0;
    const freeQty = currentStockQty - requiredQty;
    const shortageQty = Math.max(0, requiredQty - currentStockQty);
    const minStock = Number(item.minStockLevel);

    let status;
    if (shortageQty > QUEUE_EPS) {
      status = "CRITICAL";
    } else if (freeQty <= minStock + QUEUE_EPS) {
      status = "LOW_BUFFER";
    } else {
      status = "SAFE";
    }
    if (status === "SAFE") continue;

    rows.push({
      itemId: rmId,
      itemCode: item.itemName,
      itemName: item.itemName,
      currentStockQty,
      requiredQty,
      freeQty,
      shortageQty,
      status,
      quantityMetricContext: QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.rmRisk,
    });
  }

  rows.sort((a, b) => {
    const ac = a.status === "CRITICAL" ? 0 : 1;
    const bc = b.status === "CRITICAL" ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return b.shortageQty - a.shortageQty;
  });

  return rows;
}

async function getPurchaseSummaryRows() {
  const pos = await prisma.rmPurchaseOrder.findMany({
    where: { status: { in: ["PENDING", "PARTIAL"] } },
    orderBy: { createdAt: "asc" },
    include: {
      supplier: true,
      lines: { include: { item: true }, orderBy: { id: "asc" } },
    },
  });

  const lineIds = pos.flatMap((p) => p.lines.map((l) => l.id));
  const grnLinesWithGrn =
    lineIds.length === 0
      ? []
      : await prisma.grnLine.findMany({
          where: { rmPoLineId: { in: lineIds } },
          include: { grn: true },
        });
  const receivedByLineId = new Map();
  for (const gl of grnLinesWithGrn) {
    if (gl.grn.reversedAt) continue;
    const prev = receivedByLineId.get(gl.rmPoLineId) || 0;
    receivedByLineId.set(gl.rmPoLineId, prev + Number(gl.receivedQty));
  }

  const rows = [];
  for (const po of pos) {
    for (const line of po.lines) {
      if (line.item.itemType !== "RM") continue;
      const orderedQty = Number(line.qty);
      const receivedQty = receivedByLineId.get(line.id) ?? 0;
      const pendingQty = orderedQty - receivedQty;
      if (pendingQty <= QUEUE_EPS) continue;
      rows.push({
        purchaseOrderId: po.id,
        purchaseOrderNo: `PO-${po.id}`,
        supplierName: po.supplier.name,
        itemId: line.itemId,
        itemName: line.item.itemName,
        orderedQty,
        receivedQty,
        pendingQty,
        status: po.status,
        purchaseDate: po.createdAt.toISOString(),
        quantityMetricContext: QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.purchaseSummary,
      });
    }
  }
  return rows;
}

/**
 * Counts for QC work queue summary (production first QC vs disposition rework vs hold).
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function getQcWorkQueueCounts(prisma) {
  await prisma.$transaction(async (tx) => {
    await reconcileStaleSupervisorReworkDispositions(tx);
  });

  const qcRows = await getQcQueueRows();
  const [reworkReady, holdRows, legacySupervisorRows] = await Promise.all([
    prisma.qcRejectedDisposition.findMany({
      where: { voidedAt: null, status: "REWORK_READY_FOR_QC" },
      select: { id: true },
      take: 500,
    }),
    prisma.qcRejectedDisposition.findMany({
      where: { voidedAt: null, status: "HOLD", remainingQty: { gt: 0 } },
      select: { id: true },
      take: 500,
    }),
    prisma.qcRejectedDisposition.findMany({
      where: { voidedAt: null, status: "REWORK_PENDING_SUPERVISOR" },
      select: { id: true },
      take: 500,
    }),
  ]);
  const reworkIds = reworkReady.map((r) => r.id).filter((id) => typeof id === "number" && id > 0);
  const holdIds = holdRows.map((r) => r.id).filter((id) => typeof id === "number" && id > 0);
  const legacyIds = legacySupervisorRows.map((r) => r.id).filter((id) => typeof id === "number" && id > 0);
  const [reworkGroupedRework, reworkGroupedLegacyPending, holdGrouped, legacyHoldGrouped] = await Promise.all([
    reworkIds.length
      ? prisma.stockTransaction.groupBy({
          by: ["qcRejectedDispositionId"],
          where: { qcRejectedDispositionId: { in: reworkIds }, stockBucket: "REWORK", reversedAt: null },
          _sum: { qtyIn: true, qtyOut: true },
        })
      : Promise.resolve([]),
    reworkIds.length
      ? prisma.stockTransaction.groupBy({
          by: ["qcRejectedDispositionId"],
          where: { qcRejectedDispositionId: { in: reworkIds }, stockBucket: "QC_PENDING", reversedAt: null },
          _sum: { qtyIn: true, qtyOut: true },
        })
      : Promise.resolve([]),
    holdIds.length
      ? prisma.stockTransaction.groupBy({
          by: ["qcRejectedDispositionId"],
          where: { qcRejectedDispositionId: { in: holdIds }, stockBucket: "QC_HOLD", reversedAt: null },
          _sum: { qtyIn: true, qtyOut: true },
        })
      : Promise.resolve([]),
    legacyIds.length
      ? prisma.stockTransaction.groupBy({
          by: ["qcRejectedDispositionId"],
          where: { qcRejectedDispositionId: { in: legacyIds }, stockBucket: "QC_HOLD", reversedAt: null },
          _sum: { qtyIn: true, qtyOut: true },
        })
      : Promise.resolve([]),
  ]);
  function countPositiveDispositionLines(grouped) {
    let n = 0;
    for (const g of grouped) {
      if (g.qcRejectedDispositionId == null) continue;
      const net = Number(g._sum.qtyIn || 0) - Number(g._sum.qtyOut || 0);
      if (net > QUEUE_EPS) n += 1;
    }
    return n;
  }
  /** Final rework QC consumes disposition-owned REWORK; legacy rows may still sit in QC_PENDING until rechecked. */
  const reworkAvailByDisp = new Map();
  for (const g of reworkGroupedRework) {
    const id = g.qcRejectedDispositionId;
    if (id == null) continue;
    const net = Number(g._sum.qtyIn || 0) - Number(g._sum.qtyOut || 0);
    reworkAvailByDisp.set(id, (reworkAvailByDisp.get(id) || 0) + net);
  }
  for (const g of reworkGroupedLegacyPending) {
    const id = g.qcRejectedDispositionId;
    if (id == null) continue;
    const net = Number(g._sum.qtyIn || 0) - Number(g._sum.qtyOut || 0);
    reworkAvailByDisp.set(id, (reworkAvailByDisp.get(id) || 0) + net);
  }
  let reworkQcPendingCount = 0;
  for (const net of reworkAvailByDisp.values()) {
    if (net > QUEUE_EPS) reworkQcPendingCount += 1;
  }
  return {
    productionQcPendingCount: qcRows.length,
    reworkQcPendingCount,
    holdDecisionsPendingCount: countPositiveDispositionLines(holdGrouped),
    legacyReworkApprovalCount: countPositiveDispositionLines(legacyHoldGrouped),
  };
}

module.exports = {
  QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT,
  DISPATCH_BACKLOG_EPS,
  QUEUE_EPS,
  customerNameForSalesOrder,
  getActionableWorkOrderCount,
  getDispatchBacklogRows,
  getProductionQueueRows,
  getQcQueueRows,
  getContinueWorkingRows,
  getActiveNoQtySalesOrders,
  getNoQtyDispatchPendingRowsForDashboard,
  getRmRiskRows,
  getPurchaseSummaryRows,
  buildDashboardActionLabel,
  getQcWorkQueueCounts,
};
