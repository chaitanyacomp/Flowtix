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
  getSoLineDispatchPendingQty,
  buildDispatchableQtyBySalesOrderLineId,
  getWoLineRemainingProductionQty,
  getProductionBatchQcPendingQty,
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
  REPORT_QUEUE_EPS,
} = require("./reportMetrics");
const { mapSoLinesToDispatchFifoInputs, dispatchFifoQtyForSoLine } = require("./regularSoBufferQty");
const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const { buildQcAcceptedMap, buildReplacementReturnQcGrossBySoItemKey } = require("./dispatchQcCap");
const { normalizePositiveCycleId } = require("../utils/cycleIds");
const { filterNoQtyExecutionReleasedWorkOrders } = require("./noQtyExecutionBoundaryService");
const { netDispatchedByItemId, DISPATCH_ALLOC_MODE: SO_DISPATCH_ALLOC_MODE } = require("./salesOrderDispatchAllocation");
const {
  loadNoQtyCycleQcAcceptedMap,
  loadNoQtyDispositionUsableForDispatchPoolMap,
  loadNoQtyPostCycleApprovalMapForInputs,
  computeNoQtyDispatchHeadroom,
  filterNoQtyDispatchRowsForActiveCycle,
  netNoQtyCycleDispatchedByItemId,
  buildNoQtyDispatchLineStatsForAllCycles,
} = require("../routes/dispatch");
const { loadEffectiveNoQtyCarryForwardShortfallByItem } = require("./noQtySoCloseSnapshotService");
const {
  blockReasonLabel,
  getEffectiveProductionPendingQty,
  deriveProductionQueueActionLabel,
} = require("./productionExecutionService");
const {
  plannedNewRequirementAndQcAcceptedByItemForSingleCycle,
  computeNoQtyOperatorCarryForwardQty,
} = require("../routes/requirementSheets");
const { loadNoQtyPendingQcDispositionQtyByItem } = require("./noQtyPostCycleApprovalService");
const { reconcileStaleSupervisorReworkDispositions } = require("./qcDispositionReconcile");
const { attachRmReadinessToProductionQueueRows } = require("./productionRmReadinessService");
const { buildMaterialAvailabilityWorkspace } = require("./materialAvailabilityWorkspaceService");
const { getSalesOrderFgWorkOrderBalances } = require("./workOrderSoValidation");

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
const DASHBOARD_ACTIVE_WORK_ORDER_STATUSES = Object.freeze(["PENDING", "IN_PROGRESS", "HOLD"]);
const DASHBOARD_RUNNING_WORK_ORDER_STATUSES = Object.freeze(["PENDING", "IN_PROGRESS"]);
const DASHBOARD_TERMINAL_WORK_ORDER_STATUSES = Object.freeze([
  "COMPLETED",
  "REJECTED",
  "CLOSED_WITH_SHORTFALL",
]);

function dashboardActiveWorkOrderWhere() {
  return { status: { in: [...DASHBOARD_ACTIVE_WORK_ORDER_STATUSES] } };
}

function dashboardRunningWorkOrderWhere() {
  return { status: { in: [...DASHBOARD_RUNNING_WORK_ORDER_STATUSES] } };
}

function isDashboardHoldWorkOrderStatus(status) {
  return String(status ?? "").toUpperCase() === "HOLD";
}

function isDashboardPausedWorkOrderStatus(status) {
  return String(status ?? "").toUpperCase() === "PAUSED";
}

function isDashboardTerminalWorkOrderStatus(status) {
  return DASHBOARD_TERMINAL_WORK_ORDER_STATUSES.includes(String(status ?? "").toUpperCase());
}

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

/** Set `DASHBOARD_AUDIT_WO147=1` for temporary structured logs for work order id 147 only (runtime audit). */
function auditWo147Enabled() {
  return process.env.DASHBOARD_AUDIT_WO147 === "1";
}

function auditWo147(wo) {
  return auditWo147Enabled() && wo && Number(wo.id) === 147;
}

/** Logs final continue-working rows relevant to PRODUCTION UI when `DASHBOARD_AUDIT_WO147=1`. */
function logAuditWo147ContinueWorkingRows(rows) {
  if (!auditWo147Enabled() || !Array.isArray(rows)) return;
  const workOrderIdFromHref = (href) => {
    if (href == null) return null;
    const m = /[?&]workOrderId=(\d+)/i.exec(String(href));
    return m ? Number(m[1]) : null;
  };
  const productionRelevant = rows.filter(
    (r) =>
      r.stageKey === "PRODUCTION" ||
      r.nextStep === "Continue Production" ||
      workOrderIdFromHref(r.href) === 147,
  );
  console.info("[AUDIT_WO147_CONTINUE_WORKING]", {
    note:
      "Rows tied to PRODUCTION-stage UI (stageKey PRODUCTION, Continue Production, or href workOrderId=147). /continue-working is not role-scoped on the server.",
    rowCount: productionRelevant.length,
    rows: productionRelevant.map((r) => ({
      id: r.key,
      stageKey: r.stageKey,
      nextAction: r.nextAction,
      salesOrderId: r.salesOrderId,
      workOrderId: workOrderIdFromHref(r.href),
      label: r.metricLabel ?? r.itemName ?? null,
      title: r.nextStep ?? null,
    })),
  });
}

async function filterDashboardActionableWorkOrders(workOrders, db = prisma) {
  const noQtyPairs = [];
  const noQtySoIds = new Set();
  const seen = new Set();
  for (const wo of workOrders || []) {
    const so = wo.salesOrder;
    if (!so || so.orderType !== "NO_QTY") continue;
    const soId = Number(wo.salesOrderId ?? so.id);
    if (!Number.isFinite(soId) || soId <= 0) continue;
    noQtySoIds.add(soId);

    const pointerCycleId = normalizePositiveCycleId(so.currentCycleId);
    if (pointerCycleId != null) {
      const key = `${soId}:${pointerCycleId}`;
      if (!seen.has(key)) {
        seen.add(key);
        noQtyPairs.push({ salesOrderId: soId, cycleId: pointerCycleId });
      }
    }

    const woCycleId = normalizePositiveCycleId(wo.cycle?.id) ?? normalizePositiveCycleId(wo.cycleId);
    if (woCycleId != null) {
      const key2 = `${soId}:${woCycleId}`;
      if (!seen.has(key2)) {
        seen.add(key2);
        noQtyPairs.push({ salesOrderId: soId, cycleId: woCycleId });
      }
    }
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
  const ownerSheets =
    noQtySoIds.size > 0
      ? await db.requirementSheet.findMany({
          where: {
            salesOrderId: { in: [...noQtySoIds] },
            status: { in: ["DRAFT", "LOCKED"] },
            cycleId: { not: null },
          },
          select: {
            id: true,
            salesOrderId: true,
            cycleId: true,
            createdAt: true,
            cycle: { select: { id: true, cycleNo: true } },
          },
        })
      : [];
  const ownerCycleBySo = new Map();
  for (const sh of ownerSheets) {
    const soId = Number(sh.salesOrderId);
    const cycleId = normalizePositiveCycleId(sh.cycleId);
    if (!Number.isFinite(soId) || soId <= 0 || cycleId == null) continue;
    const cycleNo = Number(sh.cycle?.cycleNo ?? 0);
    const createdAt = sh.createdAt ? new Date(sh.createdAt).getTime() : 0;
    const cur = ownerCycleBySo.get(soId);
    if (
      !cur ||
      cycleNo > cur.cycleNo ||
      (cycleNo === cur.cycleNo && createdAt > cur.createdAt) ||
      (cycleNo === cur.cycleNo && createdAt === cur.createdAt && Number(sh.id) > cur.sheetId)
    ) {
      ownerCycleBySo.set(soId, { cycleId, cycleNo, createdAt, sheetId: Number(sh.id) });
    }
  }

  const included = (workOrders || []).filter((wo) => {
    const so = wo.salesOrder;
    if (!so || so.orderType !== "NO_QTY") {
      if (auditWo147(wo)) {
        console.info("[AUDIT_WO147_FILTER]", {
          woId: wo.id,
          woDocNo: wo.docNo ?? null,
          soOrderType: so?.orderType ?? null,
          include: true,
          reason: "INCLUDE_NON_NO_QTY_FILTER_BYPASS",
        });
      }
      return true;
    }

    const pointerCycleId = normalizePositiveCycleId(so.currentCycleId);
    const woCycleId = normalizePositiveCycleId(wo.cycle?.id) ?? normalizePositiveCycleId(wo.cycleId);
    const soId = Number(wo.salesOrderId ?? so.id);
    const lockKey = Number.isFinite(soId) && soId > 0 && woCycleId != null ? `${soId}:${woCycleId}` : null;
    const lockedSheetKeyFound = lockKey != null && lockedSheetKeys.has(lockKey);
    const owner = Number.isFinite(soId) && soId > 0 ? ownerCycleBySo.get(soId) : null;
    const woCycleNo = Number(wo.cycle?.cycleNo ?? 0);
    const ownerIsLater =
      owner &&
      woCycleId != null &&
      owner.cycleId !== woCycleId &&
      Number.isFinite(woCycleNo) &&
      woCycleNo > 0 &&
      owner.cycleNo > woCycleNo;

    let include;
    /** @type {string} */
    let reason;

    if (isClosedNoQtySalesOrderStatus(so.internalStatus)) {
      include = false;
      reason = "EXCLUDE_SO_INTERNAL_CLOSED";
    } else if (woCycleId == null) {
      include = false;
      reason = "EXCLUDE_WO_CYCLE_ID_NULL";
    } else if (ownerIsLater) {
      include = false;
      reason = "EXCLUDE_NO_QTY_OWNERSHIP_TRANSFERRED_TO_LATEST_RS_CYCLE";
    } else if (!lockedSheetKeys.has(`${soId}:${woCycleId}`)) {
      include = false;
      reason = "EXCLUDE_NO_LOCKED_RS_FOR_WO_CYCLE";
    } else if (pointerCycleId != null && woCycleId === pointerCycleId) {
      if (so.currentCycle?.status && so.currentCycle.status !== "ACTIVE") {
        include = false;
        reason = "EXCLUDE_POINTER_CYCLE_NOT_ACTIVE";
      } else {
        include = true;
        reason = "INCLUDE_POINTER_ALIGNED";
      }
    } else if (wo.requirementSheetId != null) {
      include = true;
      reason = "INCLUDE_DRIFT_RS_BACKED";
    } else {
      const driftOk = wo.cycle?.status === "ACTIVE";
      include = driftOk;
      reason = driftOk ? "INCLUDE_DRIFT_ACTIVE_WO_CYCLE" : "EXCLUDE_DRIFT_WO_CYCLE_NOT_ACTIVE";
    }

    if (auditWo147(wo)) {
      console.info("[AUDIT_WO147_FILTER]", {
        woId: wo.id,
        woDocNo: wo.docNo ?? null,
        soOrderType: so.orderType,
        woCycleId,
        soCurrentCycleId: so.currentCycleId,
        woRequirementSheetId: wo.requirementSheetId ?? null,
        lockedSheetKeyFound,
        lockKey,
        latestOwnerCycleId: owner?.cycleId ?? null,
        latestOwnerCycleNo: owner?.cycleNo ?? null,
        woCycleStatus: wo.cycle?.status ?? null,
        pointerCycleStatus: so.currentCycle?.status ?? null,
        include,
        reason,
      });
    }
    return include;
  });
  return filterNoQtyExecutionReleasedWorkOrders(db, included);
}

async function getActionableWorkOrderCount(db = prisma) {
  const workOrders = await db.workOrder.findMany({
    where: dashboardActiveWorkOrderWhere(),
    select: {
      id: true,
      docNo: true,
      salesOrderId: true,
      cycleId: true,
      requirementSheetId: true,
      status: true,
      cycle: { select: { id: true, status: true, cycleNo: true } },
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

function numDash(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Dispatch backlog rows for dashboard + operations-exception dispatch section.
 * Backlog means true pending dispatch only: rows must have pendingDispatchQty > 0.
 * Optional NO_QTY usable stock belongs on Dispatch, not in this backlog report.
 */
async function getDispatchBacklogRows() {
  const bucketStockRows = await prisma.stockTransaction.groupBy({
    by: ["itemId", "stockBucket"],
    where: { stockBucket: { in: ["USABLE", "QC_HOLD", "QC_PENDING", "REWORK", "SCRAP"] } },
    _sum: { qtyIn: true, qtyOut: true },
  });
  /** USABLE net by item — same bucket slice as GET /api/dispatch/sales-orders `onHandByItemId`. */
  const onHandByItemId = new Map();
  for (const r of bucketStockRows) {
    if (r.stockBucket !== "USABLE") continue;
    const net = Number(r._sum.qtyIn ?? 0) - Number(r._sum.qtyOut ?? 0);
    onHandByItemId.set(r.itemId, net);
  }

  const orders = await prisma.salesOrder.findMany({
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

  const allNoQtyFromRows = orders.filter((so) => so.orderType === "NO_QTY");
  const noQtySoIds = allNoQtyFromRows.map((so) => so.id);
  const allCyclesForNoQty =
    noQtySoIds.length > 0
      ? await prisma.salesOrderCycle.findMany({
          where: { salesOrderId: { in: noQtySoIds } },
          select: { id: true, salesOrderId: true, cycleNo: true, status: true },
          orderBy: [{ salesOrderId: "asc" }, { cycleNo: "asc" }],
        })
      : [];

  const allCyclesBySoId = new Map();
  for (const c of allCyclesForNoQty) {
    const row = { id: c.id, cycleNo: Number(c.cycleNo), status: String(c.status ?? "") };
    const arrAll = allCyclesBySoId.get(c.salesOrderId) ?? [];
    arrAll.push(row);
    allCyclesBySoId.set(c.salesOrderId, arrAll);
  }

  const noQtySoCycleInputsAll = [];
  const seenSoCycleInput = new Set();
  for (const c of allCyclesForNoQty) {
    const k = `${c.salesOrderId}:${c.id}`;
    if (seenSoCycleInput.has(k)) continue;
    seenSoCycleInput.add(k);
    noQtySoCycleInputsAll.push({ id: c.salesOrderId, currentCycleId: c.id });
  }
  const noQtyCycleIdsAll = [...new Set(allCyclesForNoQty.map((c) => c.id))];

  const noQtyCapBySoCycleKey = new Map();
  const [cycleQcAcceptedMap, cycleRecheckAcceptedMap, postCycleApprovalMapAll] = await Promise.all([
    loadNoQtyCycleQcAcceptedMap(prisma, noQtySoCycleInputsAll),
    loadNoQtyDispositionUsableForDispatchPoolMap(prisma, noQtySoCycleInputsAll),
    loadNoQtyPostCycleApprovalMapForInputs(prisma, noQtySoCycleInputsAll),
  ]);

  if (noQtySoIds.length && noQtyCycleIdsAll.length) {
    const lockedSheets = await prisma.requirementSheet.findMany({
      where: {
        salesOrderId: { in: noQtySoIds },
        cycleId: { in: noQtyCycleIdsAll },
        status: "LOCKED",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { lines: { include: { item: true } } },
    });
    for (const sh of lockedSheets) {
      const k = `${sh.salesOrderId}:${Number(sh.cycleId)}`;
      if (noQtyCapBySoCycleKey.has(k)) continue;
      const capsByItemId = new Map();
      for (const ln of sh.lines || []) {
        const cap = Math.max(numDash(ln.suggestedWoQtySnapshot ?? 0), numDash(ln.requirementQty ?? 0));
        if (!(cap > REPORT_QUEUE_EPS)) continue;
        capsByItemId.set(ln.itemId, {
          cap,
          itemName: ln.item?.itemName ?? `Item #${ln.itemId}`,
          fulfillmentQtySnapshot: numDash(ln.requirementQty ?? 0),
          productionRequiredQtySnapshot: numDash(ln.suggestedWoQtySnapshot ?? 0),
          availableStockQtySnapshot: ln.availableStockQtySnapshot != null ? numDash(ln.availableStockQtySnapshot) : null,
          shortfallQtySnapshot: ln.shortfallQtySnapshot != null ? numDash(ln.shortfallQtySnapshot) : null,
        });
      }
      noQtyCapBySoCycleKey.set(k, { capsByItemId });
    }
  }

  const rows = [];
  for (const so of orders) {
    const customerName = customerNameForSalesOrder(so);
    const soLines = Array.isArray(so?.lines) ? so.lines : [];

    if (so.orderType === "NO_QTY") {
      if (so.internalStatus === "MANUALLY_CLOSED" || so.internalStatus === "CLOSED") continue;

      const { lineStats } = buildNoQtyDispatchLineStatsForAllCycles({
        soId: so.id,
        dispatchRecords: so.dispatch,
        onHandByItemId,
        noQtyCapBySoCycleKey,
        cycleQcAcceptedMap,
        cycleRecheckAcceptedMap,
        postCycleApprovalMap: postCycleApprovalMapAll,
        salesOrderLines: soLines,
        cyclesForSo: allCyclesBySoId.get(so.id) || [],
      });

      for (const ls of lineStats || []) {
        const pend = Number(ls.pendingDispatchQty ?? 0);
        const dbl = Number(ls.dispatchable ?? ls.dispatchableQty ?? 0);
        if (pend <= REPORT_QUEUE_EPS) continue;

        const rowCycleId = ls.noQtyCycleId != null ? Number(ls.noQtyCycleId) : null;

        const itemId = Number(ls.itemId);
        const fgLine = soLines.find((l) => Number(l.itemId) === itemId);
        const rowCycleNo =
          rowCycleId != null
            ? (() => {
                const cy = (allCyclesBySoId.get(so.id) || []).find((c) => Number(c.id) === Number(rowCycleId));
                return cy != null && Number.isFinite(Number(cy.cycleNo)) ? Number(cy.cycleNo) : null;
              })()
            : null;

        rows.push({
          salesOrderId: so.id,
          salesOrderNo: `SO-${so.id}`,
          customerName,
          itemId,
          itemName: String(ls.itemName ?? fgLine?.item?.itemName ?? `Item #${itemId}`),
          salesOrderLineId: fgLine?.id,
          orderType: so.orderType,
          orderedQty: Number(ls.cycleCap ?? 0),
          dispatchedQty: Number(ls.dispatched ?? ls.cycleDispatchedQty ?? 0),
          pendingQty: pend,
          dispatchableNow: dbl,
          cycleId: rowCycleId,
          ...(rowCycleNo != null ? { cycleNo: rowCycleNo } : {}),
          salesOrderDate: so.createdAt.toISOString(),
          status: so.internalStatus,
          quantityMetricContext: QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.dispatchBacklog,
        });
      }
      continue;
    }

    if (so.internalStatus === "COMPLETED") continue;

    const lineInputs = mapSoLinesToDispatchFifoInputs(soLines, so.orderType);
    const { alloc: allocConf } = buildSoLineDispatchAllocation(
      lineInputs,
      so.dispatch,
      DISPATCH_ALLOC_MODE.CONFIRMED,
    );

    const qcAcceptedTotalByItemId = new Map();
    for (const li of lineInputs) {
      const repKey = `${so.id}:${li.itemId}`;
      let qcGross = qcAcceptedMap.get(repKey) ?? 0;
      if (so.orderType === "REPLACEMENT" && replacementQcGrossBySoItem.has(repKey)) {
        qcGross = replacementQcGrossBySoItem.get(repKey) ?? 0;
      }
      qcAcceptedTotalByItemId.set(li.itemId, qcGross);
    }
    const dispatchableByLineId = buildDispatchableQtyBySalesOrderLineId({
      orderLineInputs: lineInputs,
      dispatchRecords: so.dispatch,
      orderType: so.orderType,
      onHandByItemId,
      qcAcceptedTotalByItemId,
    });

    for (const line of soLines) {
      const dispatched = getSoLineAttributedDispatchedQty(allocConf, line.id);
      const fifoCommitment = dispatchFifoQtyForSoLine(line, so.orderType);
      const pendingDispatchQty = getSoLineDispatchPendingQty(fifoCommitment, dispatched);
      const dispatchableNow = Number(dispatchableByLineId.get(line.id) ?? 0);
      if (pendingDispatchQty <= REPORT_QUEUE_EPS) continue;

      const orderedQty = fifoCommitment;
      const pendingQty = getSoLineOrderQtyMinusAttributedDispatch(orderedQty, dispatched);

      rows.push({
        salesOrderId: so.id,
        salesOrderNo: `SO-${so.id}`,
        customerName,
        itemId: line.itemId,
        itemName: line.item?.itemName ?? `Item #${line.itemId}`,
        salesOrderLineId: line.id,
        orderType: so.orderType,
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
  if (nextAction === "ON_HOLD") return 3;
  if (nextAction === "PRODUCTION_EXECUTION_BLOCKED") return 3;
  if (nextAction === "PRODUCTION_SHORTFALL_DECISION") return 2;
  if (nextAction === "PRODUCTION_PENDING") return 4;
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
  if (nextAction === "ON_HOLD") {
    return `/work-orders?from=dashboard&workOrderId=${encodeURIComponent(String(workOrderId ?? ""))}`;
  }
  if (nextAction === "PRODUCTION_EXECUTION_BLOCKED") {
    if (orderType === "NO_QTY") return `/production?${noQtyBase}${wo}${wol}`;
    return `/production?salesOrderId=${encodeURIComponent(String(salesOrderId))}${wo}${wol}`;
  }
  if (nextAction === "PRODUCTION_SHORTFALL_DECISION") {
    if (orderType === "NO_QTY") return `/production?${noQtyBase}${wo}${wol}&from=pending-actions`;
    return `/production?salesOrderId=${encodeURIComponent(String(salesOrderId))}${wo}${wol}&from=pending-actions`;
  }
  if (nextAction === "PRODUCTION_PENDING") {
    if (orderType === "NO_QTY") return `/production?${noQtyBase}${wo}${wol}`;
    return `/production?salesOrderId=${encodeURIComponent(String(salesOrderId))}${wo}${wol}`;
  }
  return `/production?salesOrderId=${encodeURIComponent(String(salesOrderId))}${wo}${wol}`;
}

function buildDashboardActionLabel(nextAction) {
  if (nextAction === "QC_PENDING") return "Complete QA";
  if (nextAction === "DISPATCH_PENDING") return "Go to Dispatch";
  if (nextAction === "SALES_BILL_PENDING") return "Create Sales Bill";
  if (nextAction === "NEXT_RS_REQUIRED") return "Create Next RS";
  if (nextAction === "ON_HOLD") return "Review Hold";
  if (nextAction === "PRODUCTION_EXECUTION_BLOCKED") return "Resume Production";
  if (nextAction === "PRODUCTION_SHORTFALL_DECISION") return "Resolve Production Shortfall";
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
    where: dashboardActiveWorkOrderWhere(),
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      docNo: true,
      salesOrderId: true,
      cycleId: true,
      requirementSheetId: true,
      status: true,
      createdAt: true,
      cycle: true,
      productionExecution: {
        select: {
          executionStatus: true,
          blockReason: true,
          blockRemarks: true,
          blockedAt: true,
        },
      },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          fgItemId: true,
          qty: true,
          plannedQty: true,
          fgItem: true,
        },
      },
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
      wo.productionExecution?.executionStatus === "COMPLETED"
    ) {
      continue;
    }
    if (
      orderType === "NO_QTY" &&
      ["MANUALLY_CLOSED", "CLOSED", "COMPLETED"].includes(String(so?.internalStatus ?? ""))
    ) {
      if (auditWo147(wo)) {
        console.info("[AUDIT_WO147_QUEUE]", {
          woId: wo.id,
          emitted: false,
          skipReason: "SKIP_SO_INTERNAL_CLOSED",
          internalStatus: so?.internalStatus ?? null,
        });
      }
      continue;
    }
    const customerName = so ? customerNameForSalesOrder(so) : "Unknown Customer";

    const woLines = Array.isArray(wo?.lines) ? wo.lines : [];
    for (const line of woLines) {
      const requiredQty = Number(line.qty);
      const plannedQty = Number(line.plannedQty ?? line.qty);
      const approvedProduced = producedByLineId.get(line.id) ?? 0;
      const execStatus = wo.productionExecution?.executionStatus ?? "NOT_STARTED";
      const shortfallDecisionPending = execStatus === "SHORTFALL_PENDING";
      const balanceQty = shortfallDecisionPending
        ? getWoLineRemainingProductionQty(plannedQty, approvedProduced)
        : getEffectiveProductionPendingQty(plannedQty, approvedProduced, execStatus);
      if (auditWo147(wo) && balanceQty <= QUEUE_EPS && !shortfallDecisionPending) {
        console.info("[AUDIT_WO147_QUEUE]", {
          woId: wo.id,
          workOrderLineId: line.id,
          qty: requiredQty,
          plannedQty,
          producedQty: approvedProduced,
          balanceQty,
          initialNextAction: null,
          finalNextAction: null,
          emitted: false,
          skipReason: "SKIP_LINE_ZERO_BALANCE",
        });
      }
      if (balanceQty <= QUEUE_EPS && !shortfallDecisionPending) continue;

      const linePendingQc = pendingQcByLineId.get(line.id) ?? 0;
      const productionIdForQc = firstPendingProdIdByLineId.get(line.id) ?? null;

      let nextAction = "PRODUCTION_PENDING";
      /** Primary classification before NO_QTY CLOSED / RS dashboard overrides. */
      let initialNextAction = null;
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
          if (approvedProduced <= QUEUE_EPS) {
            nextAction = "PRODUCTION_PENDING";
          } else if (lastShortageQty > QUEUE_EPS) {
            nextAction = "NEXT_RS_REQUIRED";
          } else {
            nextAction = "PRODUCTION_PENDING";
          }
        } else {
          nextAction = approvedProduced <= QUEUE_EPS ? "PRODUCTION_PENDING" : "NEXT_RS_REQUIRED";
        }

        initialNextAction = nextAction;

        /**
         * CLOSED cycle + remaining WO balance without an RS-backed WO: treat as Next RS (carry-forward edge).
         * RS-linked WOs (requirementSheetId) stay PRODUCTION_PENDING so operators can finish the locked sheet WO.
         */
        if (
          nextAction === "PRODUCTION_PENDING" &&
          linePendingQc <= QUEUE_EPS &&
          cycleId != null &&
          cycleStatusById.get(cycleId) === "CLOSED" &&
          balanceQty > QUEUE_EPS &&
          wo.requirementSheetId == null
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
        initialNextAction = nextAction;
      }

      if (isDashboardHoldWorkOrderStatus(wo.status)) {
        nextAction = "ON_HOLD";
        hasPendingQc = false;
      } else if (orderType === "NO_QTY" && execStatus === "BLOCKED") {
        nextAction = "PRODUCTION_EXECUTION_BLOCKED";
        hasPendingQc = false;
      } else if (orderType === "NO_QTY" && execStatus === "SHORTFALL_PENDING") {
        nextAction = "PRODUCTION_SHORTFALL_DECISION";
        hasPendingQc = false;
      }

      /** Operator-facing cycle = WO line cycle (document-linked). Do not substitute SO.currentCycleId (planning pointer). */
      const rowDisplayCycleId = cycleId;
      const rowDisplayCycleNo =
        orderType === "NO_QTY" && cycleId != null ? cycleNoById.get(cycleId) ?? null : null;

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
      } else if (nextAction === "PRODUCTION_SHORTFALL_DECISION") {
        qtyLabel = "Shortfall decision";
      } else {
        qtyLabel = undefined;
      }

      if (auditWo147(wo)) {
        console.info("[AUDIT_WO147_QUEUE]", {
          woId: wo.id,
          woDocNo: wo.docNo ?? null,
          orderType,
          workOrderLineId: line.id,
          qty: requiredQty,
          plannedQty,
          producedQty: approvedProduced,
          balanceQty,
          woCycleIdResolved: cycleId,
          cycleRowStatus: cycleId != null ? cycleStatusById.get(cycleId) : null,
          initialNextAction,
          finalNextAction: nextAction,
          emitted: true,
        });
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
        holdReason: wo.holdReason ?? null,
        productionExecutionStatus: execStatus,
        productionBlockReason: wo.productionExecution?.blockReason ?? null,
        productionBlockReasonLabel: wo.productionExecution?.blockReason
          ? blockReasonLabel(wo.productionExecution.blockReason)
          : null,
        productionBlockRemarks: wo.productionExecution?.blockRemarks ?? null,
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
        actionLabel: deriveProductionQueueActionLabel({ nextAction, execStatus }),
      });
    }
  }

  // NO_QTY: do not emit synthetic dispatch-pending-only rows (dispatch optional).

  await attachRmReadinessToProductionQueueRows(prisma, rows);

  return rows;
}

/**
 * Production batches with first-pass QC still pending (APPROVED entries only).
 * @param {{ excludeNoQty?: boolean }} [options]
 * @param {boolean} [options.excludeNoQty] When true, omit NO_QTY cycle batches so this queue stays REGULAR-only
 *   (NORMAL / REPLACEMENT / etc.). Reports and exception payloads should pass false (default) to see all pending QC.
 */
async function getQcQueueRows(options = {}) {
  const excludeNoQty = options.excludeNoQty === true;
  const where = excludeNoQty
    ? {
        workflowStatus: "APPROVED",
        workOrderLine: {
          workOrder: {
            status: { not: "CLOSED_WITH_SHORTFALL" },
            salesOrder: {
              is: { orderType: { not: "NO_QTY" } },
            },
          },
        },
      }
    : {
        workflowStatus: "APPROVED",
        workOrderLine: {
          workOrder: {
            status: { not: "CLOSED_WITH_SHORTFALL" },
          },
        },
      };

  const productions = await prisma.productionEntry.findMany({
    where,
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: {
      id: true,
      producedQty: true,
      date: true,
      workOrderLine: {
        select: {
          id: true,
          fgItemId: true,
          fgItem: true,
          workOrder: {
            select: {
              id: true,
              salesOrderId: true,
              cycleId: true,
              salesOrder: { select: { orderType: true } },
              cycle: { select: { id: true, cycleNo: true } },
            },
          },
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
    const orderType = wo.salesOrder?.orderType ?? null;
    const cycleIdRaw = wo.cycleId != null ? Number(wo.cycleId) : NaN;
    const cycleId = Number.isFinite(cycleIdRaw) && cycleIdRaw > 0 ? cycleIdRaw : null;

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
      ...(orderType != null ? { orderType } : {}),
      ...(cycleId != null ? { cycleId } : {}),
      ...(orderType === "NO_QTY" && wo.cycle?.cycleNo != null && Number.isFinite(Number(wo.cycle.cycleNo))
        ? { cycleNo: Number(wo.cycle.cycleNo) }
        : {}),
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
    /** Same eligibility as `/api/dashboard/qc-queue` and global `withoutQc=1` production entries (includes NO_QTY). */
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

  const qcCycleIdCandidates = [...qcBySo.values()]
    .map((q) => (q.cycleId != null ? Number(q.cycleId) : 0))
    .filter((id) => Number.isFinite(id) && id > 0);
  const pointerCycleIds = [...soById.values()]
    .filter((s) => s.orderType === "NO_QTY" && s.currentCycleId != null)
    .map((s) => Number(s.currentCycleId))
    .filter((id) => Number.isFinite(id) && id > 0);
  const dispCycleIds = [...dispBySo.values()]
    .map((d) => (d.cycleId != null ? Number(d.cycleId) : 0))
    .filter((id) => Number.isFinite(id) && id > 0);
  const prodCycleIds = [...prodBestBySo.values()]
    .map((p) => (p.cycleId != null ? Number(p.cycleId) : 0))
    .filter((id) => Number.isFinite(id) && id > 0);
  const allAggCycleIds = [...new Set([...qcCycleIdCandidates, ...pointerCycleIds, ...dispCycleIds, ...prodCycleIds])];
  const continueWorkingCycleRows =
    allAggCycleIds.length > 0
      ? await prisma.salesOrderCycle.findMany({
          where: { id: { in: allAggCycleIds } },
          select: { id: true, cycleNo: true },
        })
      : [];
  const continueWorkingCycleNoById = new Map(
    continueWorkingCycleRows.map((c) => [c.id, Number.isFinite(Number(c.cycleNo)) ? Number(c.cycleNo) : null]),
  );

  function stageKeyFromNext(nextAction) {
    if (nextAction === "QC_PENDING") return "QC";
    if (nextAction === "DISPATCH_PENDING") return "DISPATCH";
    if (nextAction === "SALES_BILL_PENDING") return "SALES_BILL";
    if (nextAction === "NEXT_RS_REQUIRED") return "NEXT_RS";
    if (nextAction === "ON_HOLD") return "WORK_ORDER";
    if (nextAction === "PRODUCTION_EXECUTION_BLOCKED") return "PRODUCTION";
    if (nextAction === "PRODUCTION_SHORTFALL_DECISION") return "PRODUCTION";
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
      const cycleId =
        so.orderType === "NO_QTY" && qc.cycleId != null && Number.isFinite(Number(qc.cycleId)) && Number(qc.cycleId) > 0
          ? normalizePositiveCycleId(qc.cycleId)
          : normalizePositiveCycleId(so.currentCycleId);
      const cycleNoResolved =
        so.orderType === "NO_QTY"
          ? qc.cycleNo != null && Number.isFinite(Number(qc.cycleNo))
            ? Number(qc.cycleNo)
            : cycleId != null
              ? continueWorkingCycleNoById.get(cycleId) ?? null
              : null
          : null;
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
        cycleNo: cycleNoResolved,
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
          : so.orderType === "NO_QTY" && cycleIdOut != null
            ? continueWorkingCycleNoById.get(cycleIdOut) ?? null
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
      const cycleId =
        so.orderType === "NO_QTY" && disp.cycleId != null && Number.isFinite(Number(disp.cycleId)) && Number(disp.cycleId) > 0
          ? normalizePositiveCycleId(disp.cycleId)
          : normalizePositiveCycleId(so.currentCycleId);
      const cycleNoOut =
        so.orderType === "NO_QTY" && disp.cycleNo != null && Number.isFinite(Number(disp.cycleNo))
          ? Number(disp.cycleNo)
          : so.orderType === "NO_QTY" && cycleId != null
            ? continueWorkingCycleNoById.get(cycleId) ?? null
            : null;
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
        cycleNo: cycleNoOut,
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
 * Operator-facing cycle labels come from **document-linked** state (locked RS / latest sheet cycle),
 * not {@link SalesOrder.currentCycleId} (planning pointer after prepare-next). `planningPointerCycleNo`
 * is exposed separately when the pointer is ahead of operational work (empty next cycle).
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
  if (!soIds.length) return [];

  const anySheetsAll = await prisma.requirementSheet.findMany({
    where: { salesOrderId: { in: soIds } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, docNo: true, status: true, salesOrderId: true, cycleId: true, createdAt: true, cycle: { select: { id: true, cycleNo: true, status: true } } },
  });

  const activeSheetBySo = new Map();
  for (const sh of anySheetsAll) {
    if (!["DRAFT", "LOCKED"].includes(String(sh.status ?? "").toUpperCase())) continue;
    if (String(sh.cycle?.status ?? "").toUpperCase() !== "ACTIVE") continue;
    const sid = sh.salesOrderId;
    const arr = activeSheetBySo.get(sid) ?? [];
    arr.push(sh);
    activeSheetBySo.set(sid, arr);
  }

  const firstAnyBySo = new Map();
  for (const sh of anySheetsAll) {
    if (!firstAnyBySo.has(sh.salesOrderId)) firstAnyBySo.set(sh.salesOrderId, sh);
  }

  /** Pick current operational RS owner: highest DRAFT/LOCKED cycleNo, tie-break latest createdAt. */
  function pickPrimaryActiveSheet(sid) {
    const arr = activeSheetBySo.get(sid) ?? [];
    if (!arr.length) return null;
    let best = arr[0];
    let bestNo = best.cycle?.cycleNo != null ? Number(best.cycle.cycleNo) : -Infinity;
    let bestTs = best.createdAt ? new Date(best.createdAt).getTime() : 0;
    for (let i = 1; i < arr.length; i++) {
      const sh = arr[i];
      const cn = sh.cycle?.cycleNo != null ? Number(sh.cycle.cycleNo) : -Infinity;
      const ts = sh.createdAt ? new Date(sh.createdAt).getTime() : 0;
      if (cn > bestNo || (cn === bestNo && ts > bestTs)) {
        best = sh;
        bestNo = cn;
        bestTs = ts;
      }
    }
    return best;
  }

  return rows.map((so) => {
    const sid = so.id;
    const primaryActiveSheet = pickPrimaryActiveSheet(sid);
    const fallbackSheet = firstAnyBySo.get(sid) ?? null;

    const ptrId = so.currentCycleId != null && Number.isFinite(Number(so.currentCycleId)) && Number(so.currentCycleId) > 0 ? Number(so.currentCycleId) : null;
    const ptrNo =
      so.currentCycle?.cycleNo != null && Number.isFinite(Number(so.currentCycle.cycleNo)) ? Number(so.currentCycle.cycleNo) : null;
    const pointerIsActive = ptrId != null && String(so.currentCycle?.status ?? "").toUpperCase() === "ACTIVE";

    const opCycleId =
      primaryActiveSheet?.cycleId != null && Number.isFinite(Number(primaryActiveSheet.cycleId)) && Number(primaryActiveSheet.cycleId) > 0
        ? Number(primaryActiveSheet.cycleId)
        : pointerIsActive
          ? ptrId
        : null;
    const opCycleNo =
      primaryActiveSheet?.cycle?.cycleNo != null && Number.isFinite(Number(primaryActiveSheet.cycle.cycleNo))
        ? Number(primaryActiveSheet.cycle.cycleNo)
        : pointerIsActive
          ? ptrNo
        : null;

    const planningPointerAhead =
      ptrNo != null && opCycleNo != null && ptrNo > opCycleNo && (primaryActiveSheet != null || fallbackSheet != null);

    const sheetForMetadata = primaryActiveSheet ?? fallbackSheet;

    return {
      salesOrderId: sid,
      salesOrderDocNo: so.docNo ?? null,
      customerName: customerNameForSalesOrder(so),
      internalStatus: so.internalStatus ?? null,
      /** Operator-facing: document-linked cycle when an RS exists; else ACTIVE planning pointer. */
      cycleId: sheetForMetadata?.cycleId ?? opCycleId,
      cycleNo: sheetForMetadata?.cycle?.cycleNo ?? opCycleNo,
      /** SO planning pointer — may point at an empty next cycle; do not merge with RS doc for display. */
      planningPointerCycleId: ptrId,
      planningPointerCycleNo: ptrNo,
      noQtyPlanningPointerAhead: planningPointerAhead,
      latestRequirementSheetId: sheetForMetadata?.id ?? null,
      latestRequirementSheetDocNo: sheetForMetadata?.docNo ?? null,
      latestRequirementSheetStatus: sheetForMetadata?.status ?? null,
      latestRequirementSheetCycleId: sheetForMetadata?.cycleId ?? null,
      latestRequirementSheetCycleNo: sheetForMetadata?.cycle?.cycleNo ?? null,
    };
  });
}

function pickWinningLockedRequirementSheetForHistory(a, b) {
  const pkA = String(a.periodKey ?? "");
  const pkB = String(b.periodKey ?? "");
  if (pkA !== pkB) return pkA > pkB ? a : b;
  const vA = Number(a.version ?? 0);
  const vB = Number(b.version ?? 0);
  if (vA !== vB) return vA >= vB ? a : b;
  const tA = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
  const tB = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
  if (tA !== tB) return tA >= tB ? a : b;
  return Number(a.id) >= Number(b.id) ? a : b;
}

function formatNoQtyHistoryRsLabel(sheet, cycleNo) {
  if (!sheet) {
    return cycleNo != null && Number.isFinite(Number(cycleNo)) ? `Cycle ${Number(cycleNo)} · No RS yet` : "No RS yet";
  }
  const period = sheet.periodKey?.trim() ? sheet.periodKey.trim() : "—";
  const v = String(sheet.version ?? 1);
  const st = sheet.status ?? "—";
  const doc = sheet.docNo?.trim() ? sheet.docNo.trim() : null;
  const cn = cycleNo != null && Number.isFinite(Number(cycleNo)) ? Number(cycleNo) : sheet.cycleNo;
  const head = cn != null && Number.isFinite(cn) && cn > 0 ? `Cycle ${cn}` : "Cycle —";
  const docPart = doc ? ` · ${doc}` : "";
  return `${head}${docPart} · ${period} · v${v} · ${st}`;
}

function roundNoQtyHistoryQty(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

/**
 * Operator-facing cycle status for dashboard history (not generic ACTIVE on every row).
 * @param {{
 *   cycleNo: number;
 *   cycleRowStatus: string;
 *   isCurrentCycle: boolean;
 *   planningPointerAhead: boolean;
 *   planningPointerCycleNo: number | null;
 *   documentCycleNo: number | null;
 *   hasLockedRs: boolean;
 *   hasDraftRs: boolean;
 *   hasProduction: boolean;
 * }} ctx
 */
function resolveNoQtyDashboardCycleHistoryStatus(ctx) {
  const cn = Number(ctx.cycleNo);
  const ptrNo = ctx.planningPointerCycleNo;
  const docNo = ctx.documentCycleNo;
  const rowClosed = String(ctx.cycleRowStatus ?? "").toUpperCase() === "CLOSED";

  if (ctx.planningPointerAhead && ptrNo != null && Number.isFinite(ptrNo) && cn < ptrNo) {
    return rowClosed ? "CLOSED" : "COMPLETED";
  }
  if (!ctx.planningPointerAhead && docNo != null && Number.isFinite(docNo) && cn < docNo) {
    return rowClosed ? "CLOSED" : "COMPLETED";
  }
  if (rowClosed) return "CLOSED";

  if (ctx.isCurrentCycle) {
    if (!ctx.hasLockedRs && !ctx.hasDraftRs) return "PLANNING PENDING";
    if (ctx.hasDraftRs && !ctx.hasLockedRs) return "PLANNING PENDING";
    if (ctx.hasProduction) return "IN PROCESS";
    return "IN PROCESS";
  }

  if (ctx.planningPointerAhead && ptrNo != null && cn === ptrNo) {
    if (!ctx.hasLockedRs && !ctx.hasDraftRs) return "PLANNING PENDING";
    if (ctx.hasDraftRs && !ctx.hasLockedRs) return "PLANNING PENDING";
    return "IN PROCESS";
  }

  return rowClosed ? "CLOSED" : "COMPLETED";
}

/**
 * Per-cycle operational continuity for NO_QTY dashboard history popup.
 * Uses the same planned / approved-produced / shortage basis as RS carry-forward logic.
 */
async function getNoQtyDashboardCycleHistory(soId) {
  const sid = Number(soId);
  if (!Number.isFinite(sid) || sid <= 0) return null;

  const so = await prisma.salesOrder.findUnique({
    where: { id: sid },
    include: { currentCycle: { select: { id: true, cycleNo: true, status: true } } },
  });
  if (!so || so.orderType !== "NO_QTY") return null;

  const cycles = await prisma.salesOrderCycle.findMany({
    where: { salesOrderId: sid },
    orderBy: { cycleNo: "asc" },
    select: { id: true, cycleNo: true, status: true },
  });
  if (!cycles.length) {
    return {
      salesOrderId: sid,
      cycles: [],
      currentCycle: null,
      currentCycleId: null,
      currentCycleNo: null,
      planningPointerCycleId: null,
      planningPointerCycleNo: null,
      documentCycleId: null,
      documentCycleNo: null,
      noQtyPlanningPointerAhead: false,
      rows: [],
    };
  }

  const sheets = await prisma.requirementSheet.findMany({
    where: { salesOrderId: sid },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      docNo: true,
      status: true,
      cycleId: true,
      periodKey: true,
      version: true,
      createdAt: true,
      cycle: { select: { cycleNo: true } },
    },
  });

  const sheetsByCycleId = new Map();
  for (const sh of sheets) {
    const cid = sh.cycleId != null ? Number(sh.cycleId) : 0;
    if (!Number.isFinite(cid) || cid <= 0) continue;
    const arr = sheetsByCycleId.get(cid) ?? [];
    arr.push(sh);
    sheetsByCycleId.set(cid, arr);
  }

  const activeSheetBySo = [];
  for (const sh of sheets) {
    if (!["DRAFT", "LOCKED"].includes(String(sh.status ?? "").toUpperCase())) continue;
    activeSheetBySo.push(sh);
  }
  let primaryActiveSheet = null;
  for (const sh of activeSheetBySo) {
    const cn = sh.cycle?.cycleNo != null ? Number(sh.cycle.cycleNo) : -Infinity;
    const prevCn =
      primaryActiveSheet?.cycle?.cycleNo != null ? Number(primaryActiveSheet.cycle.cycleNo) : -Infinity;
    if (!primaryActiveSheet || cn > prevCn) primaryActiveSheet = sh;
  }

  const ptrId =
    so.currentCycleId != null && Number.isFinite(Number(so.currentCycleId)) && Number(so.currentCycleId) > 0
      ? Number(so.currentCycleId)
      : null;
  const ptrNo =
    so.currentCycle?.cycleNo != null && Number.isFinite(Number(so.currentCycle.cycleNo))
      ? Number(so.currentCycle.cycleNo)
      : null;
  const pointerIsActive = ptrId != null && String(so.currentCycle?.status ?? "").toUpperCase() === "ACTIVE";
  const opCycleId =
    primaryActiveSheet?.cycleId != null && Number.isFinite(Number(primaryActiveSheet.cycleId)) && Number(primaryActiveSheet.cycleId) > 0
      ? Number(primaryActiveSheet.cycleId)
      : pointerIsActive
        ? ptrId
        : null;
  const opCycleNo =
    primaryActiveSheet?.cycle?.cycleNo != null && Number.isFinite(Number(primaryActiveSheet.cycle.cycleNo))
      ? Number(primaryActiveSheet.cycle.cycleNo)
      : pointerIsActive
        ? ptrNo
        : null;
  const planningPointerAhead =
    ptrNo != null && opCycleNo != null && ptrNo > opCycleNo && (primaryActiveSheet != null || sheets.length > 0);
  const currentCycleId = planningPointerAhead ? ptrId : opCycleId;
  const currentCycleNo = planningPointerAhead ? ptrNo : opCycleNo;

  /** @type {Array<{ cycleNo: number; cycleId: number; cycleRowStatus: string; rsLabel: string; plannedQty: number; producedQty: number; shortageQty: number; carryForwardAddedQty: number; statusLabel: string }>} */
  const rows = [];

  for (const c of cycles) {
    const cycleId = Number(c.id);
    const cycleNo = Number(c.cycleNo);
    if (!Number.isFinite(cycleId) || cycleId <= 0 || !Number.isFinite(cycleNo)) continue;

    const cycleSheets = sheetsByCycleId.get(cycleId) ?? [];
    const lockedSheets = cycleSheets.filter((s) => String(s.status).toUpperCase() === "LOCKED");
    let winningLocked = null;
    for (const sh of lockedSheets) {
      winningLocked = winningLocked ? pickWinningLockedRequirementSheetForHistory(winningLocked, sh) : sh;
    }
    const draftSheet = cycleSheets.find((s) => String(s.status).toUpperCase() === "DRAFT") ?? null;
    const displaySheet = draftSheet ?? winningLocked ?? cycleSheets[0] ?? null;

    const perItem = await plannedNewRequirementAndQcAcceptedByItemForSingleCycle(sid, cycleId);
    let plannedQty = 0;
    let producedQty = 0;
    let shortageQty = 0;
    let hasProduction = false;
    for (const [, v] of perItem) {
      const planned = Number(v.planned) || 0;
      const produced = Number(v.qcAccepted) || 0;
      plannedQty += planned;
      producedQty += produced;
      shortageQty += computeNoQtyOperatorCarryForwardQty(planned, produced);
      if (produced > QUEUE_EPS) hasProduction = true;
    }

    let carryForwardAddedQty = 0;
    const sheetForCarry = winningLocked ?? draftSheet;
    if (sheetForCarry) {
      const lines = await prisma.requirementSheetLine.findMany({
        where: { sheetId: sheetForCarry.id },
        select: { shortfallQtySnapshot: true },
      });
      for (const ln of lines) {
        carryForwardAddedQty += numDash(ln.shortfallQtySnapshot);
      }
    } else if (planningPointerAhead && cycleId === ptrId) {
      const { shortfallByItem } = await loadEffectiveNoQtyCarryForwardShortfallByItem(prisma, {
        salesOrderId: sid,
        currentCycleId: cycleId,
      });
      for (const [, v] of shortfallByItem) {
        carryForwardAddedQty += Number(v.rawShortfall ?? 0) || 0;
      }
    }

    const isCurrentCycle =
      currentCycleId != null && Number(currentCycleId) === cycleId;

    const statusLabel = resolveNoQtyDashboardCycleHistoryStatus({
      cycleNo,
      cycleRowStatus: String(c.status ?? ""),
      isCurrentCycle,
      planningPointerAhead,
      planningPointerCycleNo: ptrNo,
      documentCycleNo: opCycleNo,
      hasLockedRs: winningLocked != null,
      hasDraftRs: draftSheet != null,
      hasProduction,
    });

    rows.push({
      cycleNo,
      cycleId,
      cycleRowStatus: String(c.status ?? ""),
      rsLabel: formatNoQtyHistoryRsLabel(displaySheet, cycleNo),
      plannedQty: roundNoQtyHistoryQty(plannedQty),
      producedQty: roundNoQtyHistoryQty(producedQty),
      shortageQty: roundNoQtyHistoryQty(shortageQty),
      carryForwardAddedQty: roundNoQtyHistoryQty(carryForwardAddedQty),
      statusLabel,
    });
  }

  const cycleDtos = cycles.map((c) => ({
    cycleId: Number(c.id),
    cycleNo: Number(c.cycleNo),
    status: String(c.status ?? ""),
  }));
  const currentCycle =
    currentCycleId != null || currentCycleNo != null
      ? {
          cycleId: currentCycleId ?? null,
          cycleNo: currentCycleNo ?? null,
        }
      : null;

  return {
    salesOrderId: sid,
    cycles: cycleDtos,
    currentCycle,
    currentCycleId: currentCycleId ?? null,
    currentCycleNo: currentCycleNo ?? null,
    planningPointerCycleId: ptrId,
    planningPointerCycleNo: ptrNo,
    documentCycleId: opCycleId,
    documentCycleNo: opCycleNo,
    noQtyPlanningPointerAhead: planningPointerAhead,
    rows,
  };
}

async function getRmRiskRows() {
  const workspace = await buildMaterialAvailabilityWorkspace(prisma, { onlyBlocked: true });
  const rows = (workspace.actionQueue || []).map((row) => ({
    itemId: row.rmItemId,
    itemCode: row.rmItemName,
    itemName: row.rmItemName,
    salesOrderId: row.salesOrderId,
    salesOrderNo: row.salesOrderNo,
    workOrderId: row.workOrderId,
    workOrderNo: row.workOrderNo,
    fgItemName: row.fgItemName,
    currentStockQty: row.physicalUsableStockQty,
    physicalUsableStockQty: row.physicalUsableStockQty,
    activeAllocatedQty: row.activeAllocatedQty ?? 0,
    legacyReservedQty: row.legacyReservedQty ?? 0,
    effectiveReservedQty: row.effectiveReservedQty ?? row.legacyReservedQty ?? 0,
    freeStockQty: row.freeStockQty,
    incomingQty: row.incomingQty,
    requiredQty: row.requiredQty,
    freeQty: row.freeStockQty - row.requiredQty,
    shortageQty: row.shortageAfterReservationQty,
    shortageAfterReservationQty: row.shortageAfterReservationQty,
    netShortageAfterIncomingQty: row.netShortageAfterIncomingQty,
    allocationCoverageQty: row.allocationCoverageQty ?? 0,
    allocationShortageQty: row.allocationShortageQty ?? row.shortageAfterReservationQty,
    allocationStatus: row.allocationStatus ?? "NOT_ALLOCATED",
    blockerReason: row.blockerReason,
    recommendedAction: row.recommendedAction,
    materialRequirementId: row.materialRequirementId ?? null,
    sourceType: row.sourceType ?? null,
    prLineCount: row.prLineCount ?? 0,
    poLineCount: row.poLineCount ?? 0,
    pendingGrnQty: row.pendingGrnQty ?? 0,
    operationalKey: row.operationalKey ?? null,
    nextActionKey: row.nextActionKey ?? null,
    procurementDemandPool: row.procurementDemandPool ?? null,
    hasOpenMr: row.hasOpenMr ?? false,
    primaryPoId: row.primaryPoId ?? null,
    procurementCompletedForCase: row.procurementCompletedForCase ?? false,
    mrStatus: row.mrStatus ?? row.requisitionStatus ?? null,
    receivedGrnQty: row.receivedGrnQty ?? 0,
    href:
      row.workOrderId && row.workOrderId > 0
        ? `/reports/rm-shortage?workOrderId=${row.workOrderId}&rmItemId=${row.rmItemId}&onlyBlocked=true&returnTo=dashboard`
        : `/reports/rm-shortage?salesOrderId=${row.salesOrderId || ""}&materialRequirementId=${row.materialRequirementId || ""}&rmItemId=${row.rmItemId}&onlyBlocked=true&returnTo=dashboard`,
    status: row.netShortageAfterIncomingQty > QUEUE_EPS ? "CRITICAL" : "LOW_BUFFER",
    queueType: row.queueType,
    quantityMetricContext: QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.rmRisk,
  }));

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
 * `productionQcPendingCount` matches {@link getQcQueueRows} (all order types with pending first-pass QC).
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function getQcWorkQueueCounts(prisma) {
  await prisma.$transaction(async (tx) => {
    await reconcileStaleSupervisorReworkDispositions(tx);
  });

  const qcRowsAll = await getQcQueueRows();
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
    productionQcPendingCount: qcRowsAll.length,
    reworkQcPendingCount,
    holdDecisionsPendingCount: countPositiveDispositionLines(holdGrouped),
    legacyReworkApprovalCount: countPositiveDispositionLines(legacyHoldGrouped),
  };
}

/**
 * Approved quotations with no linked sales order — commercial workflow continuation for dashboard.
 * REGULAR + NO_QTY; excludes REJECTED and any quotation that already has an SO.
 */
async function getQuotationsPendingSalesOrderRows({ limit = 25 } = {}) {
  const take =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Math.min(50, Math.max(1, Math.floor(Number(limit))))
      : 25;

  const rows = await prisma.quotation.findMany({
    where: {
      workflowStatus: "APPROVED",
      salesOrder: { is: null },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      quotationNo: true,
      flowTypeSnapshot: true,
      enquiry: {
        select: {
          customer: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((q) => {
    const flowType = q.flowTypeSnapshot === "NO_QTY" ? "NO_QTY" : "REGULAR";
    const quotationId = q.id;
    const from = "dashboard";
    const href =
      flowType === "NO_QTY"
        ? `/sales-orders/no-qty/from-quotation?quotationId=${quotationId}&from=${from}`
        : `/sales-orders?quotationId=${quotationId}&from=${from}`;
    const quotationNo =
      q.quotationNo && String(q.quotationNo).trim() ? String(q.quotationNo).trim() : `Q-${quotationId}`;
    const customerName = q.enquiry?.customer?.name?.trim() || "—";
    return {
      key: `quotation-pending-so-${quotationId}`,
      quotationId,
      quotationNo,
      customerName,
      flowType,
      nextStep: "Create Sales Order",
      href,
    };
  });
}

/**
 * REGULAR work orders intentionally paused after partial production / QC.
 * Excluded from production-queue (not running, not RM shortage, not QC pending).
 */
async function getPausedWorkOrderRows() {
  const workOrders = await prisma.workOrder.findMany({
    where: {
      status: "PAUSED",
      requirementSheetId: null,
      cycleId: null,
      salesOrder: { orderType: "NORMAL" },
    },
    orderBy: [{ heldAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      docNo: true,
      salesOrderId: true,
      status: true,
      heldAt: true,
      holdReason: true,
      holdRemarks: true,
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          fgItemId: true,
          qty: true,
          plannedQty: true,
          fgItem: { select: { id: true, itemName: true } },
        },
      },
      salesOrder: {
        select: {
          id: true,
          docNo: true,
          orderType: true,
          customer: { select: { name: true } },
          po: { select: { customer: { select: { name: true } } } },
          dispatch: true,
        },
      },
    },
  });

  const lineIds = workOrders.flatMap((w) => w.lines.map((l) => l.id));
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
  const qcAcceptedByLineId = new Map();
  for (const pe of prodEntries) {
    const ac = sumActiveQcAcceptedQty(pe.qcEntries);
    if (ac > QUEUE_EPS) {
      qcAcceptedByLineId.set(pe.workOrderLineId, (qcAcceptedByLineId.get(pe.workOrderLineId) || 0) + ac);
    }
  }

  /** @type {Map<number, Awaited<ReturnType<typeof getSalesOrderFgWorkOrderBalances>>>} */
  const soBalanceCache = new Map();

  const rows = [];
  for (const wo of workOrders) {
    const so = wo.salesOrder;
    if (!soBalanceCache.has(wo.salesOrderId)) {
      const bal = await getSalesOrderFgWorkOrderBalances(prisma, { salesOrderId: wo.salesOrderId });
      soBalanceCache.set(wo.salesOrderId, bal);
    }
    const bal = soBalanceCache.get(wo.salesOrderId);
    const netByItem = netDispatchedByItemId(so.dispatch || [], SO_DISPATCH_ALLOC_MODE.OPERATIONAL);

    for (const line of wo.lines) {
      const plannedQty = Number(line.plannedQty ?? line.qty);
      const requiredQty = Number(line.qty);
      const producedQty = producedByLineId.get(line.id) ?? 0;
      const qcAcceptedQty = qcAcceptedByLineId.get(line.id) ?? 0;
      const dispatchedQty = Number(netByItem.get(line.fgItemId) ?? 0);
      const remainingProductionQty = getWoLineRemainingProductionQty(requiredQty, producedQty);
      const balItem = bal?.items?.find((i) => Number(i.itemId) === Number(line.fgItemId));

      rows.push({
        workOrderId: wo.id,
        workOrderNo: wo.docNo ?? `WO-${wo.id}`,
        workOrderLineId: line.id,
        salesOrderId: wo.salesOrderId,
        salesOrderNo: so.docNo ?? `SO-${wo.salesOrderId}`,
        customerName: customerNameForSalesOrder(so),
        orderType: "NORMAL",
        fgItemId: line.fgItemId,
        itemName: line.fgItem?.itemName ?? "—",
        plannedQty,
        producedQty,
        qcAcceptedQty,
        dispatchedQty,
        reservedFgQty: Number(balItem?.qcApprovedRemaining ?? 0),
        customerPendingQty: Number(balItem?.pendingSoQty ?? 0),
        remainingProductionQty,
        pausedAt: wo.heldAt,
        holdRemarks: wo.holdRemarks,
        quantityMetricContext: METRIC_CONTEXT.WO_LINE,
        actionHref: `/production?workOrderId=${wo.id}&workOrderLineId=${line.id}&salesOrderId=${wo.salesOrderId}`,
      });
    }
  }

  return rows;
}

/**
 * NO_QTY sales orders needing Store RS planning work (Control Tower / Pending Actions read model).
 *
 * Includes:
 *  - no RS on active cycle → Create RS Cycle 1
 *  - DRAFT RS on active cycle → Lock / open draft
 *
 * Excludes:
 *  - LOCKED RS (monthly planning / WO placement supplemental actions)
 *  - DRAFT on a non-active cycle (orphan pointer / stale cycle)
 *
 * @param {{ limit?: number }} [options]
 */
async function getNoQtyPlanningPendingRows(options = {}) {
  const limitRaw = Number(options.limit);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 50;
  const rows = await getActiveNoQtySalesOrders({ limit });
  return rows.filter((r) => {
    const status = String(r.latestRequirementSheetStatus ?? "").trim().toUpperCase();
    const hasSheet =
      r.latestRequirementSheetId != null &&
      Number.isFinite(Number(r.latestRequirementSheetId)) &&
      Number(r.latestRequirementSheetId) > 0;

    if (status === "LOCKED") return false;

    if (status === "DRAFT" && hasSheet) {
      const draftCycleId =
        r.latestRequirementSheetCycleId != null && Number(r.latestRequirementSheetCycleId) > 0
          ? Number(r.latestRequirementSheetCycleId)
          : null;
      const activeCycleId =
        r.planningPointerCycleId != null && Number(r.planningPointerCycleId) > 0
          ? Number(r.planningPointerCycleId)
          : r.cycleId != null && Number(r.cycleId) > 0
            ? Number(r.cycleId)
            : null;
      if (draftCycleId != null && activeCycleId != null && draftCycleId !== activeCycleId) return false;
      return true;
    }

    /** First-cycle RS creation — no sheet row yet on this OPEN NO_QTY SO. */
    if (!hasSheet && (!status || status === "NO_RS")) return true;

    return false;
  });
}

/**
 * QC rework dispositions ready for final recheck (REWORK_READY_FOR_QC with rework stock).
 * @param {import('@prisma/client').PrismaClient} [db]
 * @param {{ limit?: number }} [options]
 */
async function getQaReworkQueueRows(db = prisma, options = {}) {
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 200));

  await db.$transaction(async (tx) => {
    await reconcileStaleSupervisorReworkDispositions(tx);
  });

  const dispositions = await db.qcRejectedDisposition.findMany({
    where: { voidedAt: null, status: "REWORK_READY_FOR_QC" },
    orderBy: [{ id: "desc" }],
    take: limit,
    include: {
      item: { select: { id: true, itemName: true, unit: true } },
      workOrder: {
        select: {
          id: true,
          docNo: true,
          salesOrderId: true,
          cycleId: true,
          cycle: { select: { cycleNo: true } },
        },
      },
      sourceQcEntry: { select: { id: true, docNo: true, productionId: true } },
    },
  });

  const readyIds = dispositions.map((d) => d.id).filter((id) => typeof id === "number" && id > 0);
  const reworkQcAvailByDispId = new Map();
  if (readyIds.length) {
    const [groupRework, groupLegacyPending] = await Promise.all([
      db.stockTransaction.groupBy({
        by: ["qcRejectedDispositionId"],
        where: { qcRejectedDispositionId: { in: readyIds }, stockBucket: "REWORK", reversedAt: null },
        _sum: { qtyIn: true, qtyOut: true },
      }),
      db.stockTransaction.groupBy({
        by: ["qcRejectedDispositionId"],
        where: { qcRejectedDispositionId: { in: readyIds }, stockBucket: "QC_PENDING", reversedAt: null },
        _sum: { qtyIn: true, qtyOut: true },
      }),
    ]);
    const addNet = (grouped) => {
      for (const g of grouped) {
        const dispId = g.qcRejectedDispositionId;
        if (dispId == null) continue;
        const net = Number(g._sum.qtyIn || 0) - Number(g._sum.qtyOut || 0);
        reworkQcAvailByDispId.set(dispId, (reworkQcAvailByDispId.get(dispId) || 0) + net);
      }
    };
    addNet(groupRework);
    addNet(groupLegacyPending);
  }

  const out = [];
  for (const d of dispositions) {
    const pendingReworkQcQty = Number(reworkQcAvailByDispId.get(d.id) ?? 0);
    if (pendingReworkQcQty <= QUEUE_EPS) continue;
    const wo = d.workOrder;
    out.push({
      dispositionId: d.id,
      status: d.status,
      phase: d.phase,
      pendingReworkQcQty,
      dispositionRemainingQty: Number(d.remainingQty),
      itemId: d.item?.id ?? null,
      itemName: d.item?.itemName ?? null,
      workOrderId: wo?.id ?? null,
      workOrderNo: wo?.docNo ?? null,
      salesOrderId: wo?.salesOrderId ?? null,
      cycleId: wo?.cycleId ?? null,
      cycleNo: wo?.cycle?.cycleNo ?? null,
      sourceQcEntryId: d.sourceQcEntry?.id ?? null,
      sourceQcEntryDocNo: d.sourceQcEntry?.docNo ?? null,
      productionId: d.sourceQcEntry?.productionId ?? null,
      createdAt: d.createdAt?.toISOString?.() ?? d.createdAt ?? null,
      quantityMetricContext: QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.qcQueue,
    });
  }
  return out;
}

module.exports = {
  QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT,
  DISPATCH_BACKLOG_EPS,
  QUEUE_EPS,
  DASHBOARD_ACTIVE_WORK_ORDER_STATUSES,
  DASHBOARD_RUNNING_WORK_ORDER_STATUSES,
  DASHBOARD_TERMINAL_WORK_ORDER_STATUSES,
  dashboardActiveWorkOrderWhere,
  dashboardRunningWorkOrderWhere,
  isDashboardHoldWorkOrderStatus,
  isDashboardPausedWorkOrderStatus,
  isDashboardTerminalWorkOrderStatus,
  customerNameForSalesOrder,
  getActionableWorkOrderCount,
  getDispatchBacklogRows,
  getProductionQueueRows,
  getPausedWorkOrderRows,
  getQcQueueRows,
  getContinueWorkingRows,
  logAuditWo147ContinueWorkingRows,
  getActiveNoQtySalesOrders,
  getNoQtyPlanningPendingRows,
  getQaReworkQueueRows,
  getNoQtyDashboardCycleHistory,
  resolveNoQtyDashboardCycleHistoryStatus,
  getNoQtyDispatchPendingRowsForDashboard,
  getRmRiskRows,
  getPurchaseSummaryRows,
  buildDashboardActionLabel,
  getQcWorkQueueCounts,
  getQuotationsPendingSalesOrderRows,
};
