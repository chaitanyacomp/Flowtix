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
    const lineInputs = mapSoLinesToDispatchFifoInputs(so.lines, so.orderType);
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

    for (const line of so.lines) {
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
        itemName: line.item.itemName,
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

async function getProductionQueueRows() {
  const workOrders = await prisma.workOrder.findMany({
    where: { status: { notIn: ["COMPLETED", "REJECTED"] } },
    orderBy: { createdAt: "asc" },
    include: {
      lines: { include: { fgItem: true }, orderBy: { id: "asc" } },
    },
  });

  const lineIds = workOrders.flatMap((w) => w.lines.map((l) => l.id));
  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(prisma, lineIds);

  const rows = [];
  for (const wo of workOrders) {
    for (const line of wo.lines) {
      const requiredQty = Number(line.qty);
      const approvedProduced = producedByLineId.get(line.id) ?? 0;
      const balanceQty = getWoLineRemainingProductionQty(requiredQty, approvedProduced);
      if (balanceQty <= QUEUE_EPS) continue;
      rows.push({
        workOrderId: wo.id,
        workOrderNo: `WO-${wo.id}`,
        salesOrderId: wo.salesOrderId,
        salesOrderNo: `SO-${wo.salesOrderId}`,
        itemId: line.fgItemId,
        itemName: line.fgItem.itemName,
        requiredQty,
        producedQty: approvedProduced,
        balanceQty,
        status: wo.status,
        workOrderDate: wo.createdAt.toISOString(),
        quantityMetricContext: QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.productionQueue,
      });
    }
  }
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
    const wo = wol.workOrder;

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
      itemName: wol.fgItem.itemName,
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
 * One actionable row per (sales order, FG item): earliest incomplete pipeline stage wins.
 * Stages: production balance → QC pending → dispatch backlog → draft finalize.
 */
async function getContinueWorkingRows(options = {}) {
  const limit = Math.min(20, Math.max(5, Number(options.limit) || 10));

  const [prodRows, qcRows, dispRows] = await Promise.all([
    getProductionQueueRows(),
    getQcQueueRows(),
    getDispatchBacklogRows(),
  ]);

  const prodEligible = prodRows.filter((r) => r.status === "PENDING" || r.status === "IN_PROGRESS");

  const soIds = new Set();
  for (const r of prodEligible) soIds.add(r.salesOrderId);
  for (const r of qcRows) soIds.add(r.salesOrderId);
  for (const r of dispRows) soIds.add(r.salesOrderId);

  const sos =
    soIds.size === 0
      ? []
      : await prisma.salesOrder.findMany({
          where: { id: { in: [...soIds] } },
          include: { customer: true, po: { include: { customer: true } }, currentCycle: true, dispatch: true, lines: { include: { item: true } } },
        });
  const soById = new Map(sos.map((s) => [s.id, s]));

  // NO_QTY dispatchable now (dashboard): what can ship now = min(current RS qty, usable FG stock).
  const noQtySos = sos.filter((so) => so.orderType === "NO_QTY" && normalizePositiveCycleId(so.currentCycleId) != null);
  const noQtySoIds = noQtySos.map((so) => so.id);
  const noQtyCycleIds = [...new Set(noQtySos.map((so) => normalizePositiveCycleId(so.currentCycleId)).filter((x) => x != null))];

  const stockAgg = await prisma.stockTransaction.groupBy({
    by: ["itemId"],
    // Stock math must include reversed originals; reversal rows offset them.
    where: { stockBucket: "USABLE" },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const stockByItemId = new Map(stockAgg.map((r) => [r.itemId, Number(r._sum.qtyIn ?? 0) - Number(r._sum.qtyOut ?? 0)]));

  /** @type {Map<string, Map<number, number>>} soId:cycleId -> itemId -> cycleCapQty */
  const capsBySoCycleKey = new Map();
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
      if (capsBySoCycleKey.has(k)) continue; // already took latest
      const m = new Map();
      for (const ln of sh.lines || []) {
        const cap = Math.max(Number(ln.suggestedWoQtySnapshot ?? 0), Number(ln.requirementQty ?? 0));
        if (!(cap > QUEUE_EPS)) continue;
        m.set(ln.itemId, cap);
      }
      capsBySoCycleKey.set(k, m);
    }
  }

  /** @type {Map<number, { itemId: number; itemName: string; dispatchableNow: number }>} */
  const noQtyDispBySo = new Map();
  for (const so of noQtySos) {
    const cycleId = normalizePositiveCycleId(so.currentCycleId);
    if (cycleId == null) continue;
    const caps = capsBySoCycleKey.get(`${so.id}:${cycleId}`);
    if (!caps) continue;
    const dispatchInCycle = (so.dispatch || []).filter((d) => normalizePositiveCycleId(d.cycleId) === cycleId);
    const alreadyByItem = netDispatchedByItemId(dispatchInCycle, SO_DISPATCH_ALLOC_MODE.OPERATIONAL);
    for (const [itemId, cap] of caps.entries()) {
      const already = Number(alreadyByItem.get(itemId) ?? 0);
      const usable = Math.max(0, Number(stockByItemId.get(itemId) ?? 0));
      const dispNow = Math.max(0, Math.min(Number(cap) || 0, usable));
      if (!(dispNow > QUEUE_EPS)) continue;
      const itemName = (so.lines || []).find((l) => l.itemId === itemId)?.item?.itemName ?? `Item #${itemId}`;
      const prev = noQtyDispBySo.get(so.id);
      if (!prev || dispNow > prev.dispatchableNow + QUEUE_EPS) {
        noQtyDispBySo.set(so.id, { itemId, itemName, dispatchableNow: dispNow });
      }
    }
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

  const prodBySo = new Map();
  for (const r of prodEligible) {
    const prev = prodBySo.get(r.salesOrderId);
    const rem = Number(r.balanceQty) || 0;
    if (!prev || rem > prev.balanceQty) prodBySo.set(r.salesOrderId, r);
  }

  const out = [];
  for (const soId of soIds) {
    const so = soById.get(soId);
    if (!so || !["APPROVED", "IN_PROCESS"].includes(so.internalStatus)) continue;

    const qc = qcBySo.get(soId) ?? null;
    const disp = so.orderType === "NO_QTY" ? noQtyDispBySo.get(soId) ?? null : dispBySo.get(soId) ?? null;
    const prod = prodBySo.get(soId) ?? null;

    const awaitingQcQty = qc ? Number(qc.pendingQcQty) || 0 : 0;
    const dispatchableNow = disp ? Number(disp.dispatchableNow) || 0 : 0;
    const productionRemaining = prod ? Number(prod.balanceQty) || 0 : 0;

    let nextStep = "Completed / Waiting";
    let route = "";
    let stageKey = "DONE";
    let metricLabel = "";
    let metricQty = 0;
    let itemName = qc?.itemName || disp?.itemName || prod?.itemName || "—";

    if (awaitingQcQty > QUEUE_EPS) {
      nextStep = "Continue QC";
      route = `/qc-entry?salesOrderId=${encodeURIComponent(String(soId))}`;
      stageKey = "QC";
      metricLabel = "Awaiting QC";
      metricQty = awaitingQcQty;
      itemName = qc.itemName;
    } else if (dispatchableNow > QUEUE_EPS) {
      nextStep = "Go to Dispatch";
      route = `/dispatch?salesOrderId=${encodeURIComponent(String(soId))}`;
      stageKey = "DISPATCH";
      metricLabel = "Dispatchable now";
      metricQty = dispatchableNow;
      itemName = disp.itemName;
    } else if (productionRemaining > QUEUE_EPS) {
      nextStep = "Continue Production";
      route = `/production?salesOrderId=${encodeURIComponent(String(soId))}`;
      stageKey = "PRODUCTION";
      metricLabel = "Remaining qty";
      metricQty = productionRemaining;
      itemName = prod.itemName;
    }

    out.push({
      key: `so-${soId}`,
      salesOrderId: soId,
      salesOrderDocNo: so.docNo ?? null,
      customerName: customerNameForSalesOrder(so),
      itemName,
      orderType: so.orderType,
      cycleNo: so.orderType === "NO_QTY" ? (so.currentCycle?.cycleNo ?? null) : null,
      stageKey,
      awaitingQcQty,
      dispatchableNow,
      productionRemaining,
      metricLabel,
      metricQty,
      nextStep,
      href: route,
    });
  }

  return out
    .sort((a, b) => {
      const pri = (x) => (x.stageKey === "QC" ? 0 : x.stageKey === "DISPATCH" ? 1 : x.stageKey === "PRODUCTION" ? 2 : 3);
      const da = pri(a);
      const db = pri(b);
      if (da !== db) return da - db;
      return String(a.salesOrderId).localeCompare(String(b.salesOrderId));
    })
    .slice(0, limit);
}

async function getRmRiskRows() {
  const workOrders = await prisma.workOrder.findMany({
    where: { status: { notIn: ["COMPLETED", "REJECTED"] } },
    orderBy: { createdAt: "asc" },
    include: {
      lines: { include: { fgItem: true }, orderBy: { id: "asc" } },
    },
  });

  const lineIds = workOrders.flatMap((w) => w.lines.map((l) => l.id));
  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(prisma, lineIds);

  const fgIdsWithBalance = new Set();
  for (const wo of workOrders) {
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
  for (const wo of workOrders) {
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

module.exports = {
  QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT,
  DISPATCH_BACKLOG_EPS,
  QUEUE_EPS,
  customerNameForSalesOrder,
  getDispatchBacklogRows,
  getProductionQueueRows,
  getQcQueueRows,
  getContinueWorkingRows,
  getRmRiskRows,
  getPurchaseSummaryRows,
};
