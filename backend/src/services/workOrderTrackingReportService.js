/**
 * Work Order Tracking Report — flow-aware operational report.
 *
 * REGULAR: existing SO-qty pipeline (ordered / production / QC / WO-FIFO dispatch pending).
 * NO_QTY: RS/cycle/execution/recovery-aware; never mixes with Regular in one result set.
 *
 * SSOT reuse:
 * - getEffectiveProductionPendingQty (productionExecutionService)
 * - resolveWorkOrderOperationalStatus (workOrderOperationalStatus)
 * - assessNoQtyCycleDispatchCapMet formula via netDispatchedByItemId (cycle FG cap)
 * - enrichSalesOrdersWithRecoveryClosure (recovery outcome)
 * - resolveWoTrackingOrderedQty / Regular pending helpers (reportMetrics)
 */

const {
  REPORT_QUEUE_EPS,
  DISPATCH_ALLOC_MODE,
  METRIC_DEFINITIONS,
  METRIC_CONTEXT,
  resolveWoTrackingOrderedQty,
  allocateDispatchFifoAcrossWorkOrderLines,
  getWoTrackingProductionPendingQty,
  getWoTrackingQcPendingQty,
  getWoTrackingDispatchPendingQty,
  deriveWoTrackingOperationalStatus,
  computeWorkOrderTrackingSummaryFromRows,
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
} = require("./reportMetrics");
const { netDispatchedByItemId } = require("./salesOrderDispatchAllocation");
const { getEffectiveProductionPendingQty } = require("./productionExecutionService");
const {
  resolveWorkOrderOperationalStatus,
  isWorkOrderProductionOperationallyClosed,
} = require("./workOrderOperationalStatus");
const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");

const EPS = REPORT_QUEUE_EPS;

const FLOW = Object.freeze({
  REGULAR: "REGULAR",
  NO_QTY: "NO_QTY",
});

const CLOSED_SO_STATUSES = new Set(["COMPLETED", "CLOSED", "MANUALLY_CLOSED", "CLOSED_WITH_WAIVER"]);

const WO_TERMINAL = new Set(["COMPLETED", "REJECTED", "CLOSED_WITH_SHORTFALL"]);

/**
 * @param {Record<string, unknown>} query
 * @returns {{ flow: "REGULAR" | "NO_QTY", includeClosed: boolean }}
 */
function parseWorkOrderTrackingQuery(query = {}) {
  const flowRaw = String(query.flow ?? "").trim().toUpperCase();
  if (flowRaw !== FLOW.REGULAR && flowRaw !== FLOW.NO_QTY) {
    const err = new Error('Query parameter "flow" is required: REGULAR or NO_QTY.');
    err.statusCode = 400;
    err.code = "VALIDATION";
    throw err;
  }
  const closedRaw = query.includeClosed;
  const includeClosed =
    closedRaw === true ||
    closedRaw === 1 ||
    String(closedRaw ?? "")
      .trim()
      .toLowerCase() === "true" ||
    String(closedRaw ?? "").trim() === "1";
  return { flow: flowRaw, includeClosed };
}

function isNoQtySalesOrderClosed(internalStatus) {
  return CLOSED_SO_STATUSES.has(String(internalStatus || "").toUpperCase());
}

function isCycleClosed(cycle) {
  if (!cycle) return false;
  return String(cycle.status || "").toUpperCase() === "CLOSED";
}

/**
 * Customer demand for NO_QTY (locked RS baseDemandQty / requirementQty).
 * @returns {number | null}
 */
function resolveNoQtyCustomerDemand(requirementSheet, fgItemId) {
  return resolveWoTrackingOrderedQty({
    orderType: "NO_QTY",
    soLines: [],
    fgItemId,
    requirementSheet,
  });
}

/**
 * Active Production Pending for NO_QTY — never Planned−Produced after closure/shortfall.
 */
function computeNoQtyActiveProductionPending({
  soClosed,
  cycleClosed,
  workOrderStatus,
  executionStatus,
  plannedQty,
  producedQty,
}) {
  if (soClosed || cycleClosed) return 0;
  if (WO_TERMINAL.has(String(workOrderStatus || "").toUpperCase())) return 0;
  const exec = String(executionStatus || "").toUpperCase();
  if (exec === "COMPLETED" || exec === "SHORTFALL_PENDING") return 0;
  return getEffectiveProductionPendingQty(Number(plannedQty) || 0, Number(producedQty) || 0, exec || "NOT_STARTED");
}

/**
 * Active Dispatch Pending is SO+FG (cycle-scoped), never WO FIFO accepted−dispatch.
 */
function computeNoQtyActiveDispatchPending({ soClosed, cycleClosed, cycleFgDispatchPendingQty }) {
  if (soClosed || cycleClosed) return 0;
  return Math.max(0, Number(cycleFgDispatchPendingQty) || 0);
}

/**
 * Pure: per-FG pending from locked RS caps and cycle LOCKED dispatch (same cap rule as assessNoQtyCycleDispatchCapMet).
 * @param {Map<number, number>} capByItemId
 * @param {Array<{ itemId: number, dispatchedQty: unknown, reversalOfId?: number | null, workflowStatus?: string }>} cycleDispatch
 * @returns {Map<number, number>}
 */
function computeNoQtyCycleFgDispatchPendingByItem(capByItemId, cycleDispatch) {
  /** @type {Map<number, number>} */
  const out = new Map();
  const locked = (cycleDispatch || []).filter((d) => String(d.workflowStatus || "") === "LOCKED");
  const net = netDispatchedByItemId(locked, DISPATCH_ALLOC_MODE.CONFIRMED);
  for (const [itemId, cap] of capByItemId.entries()) {
    const disp = Number(net.get(itemId) ?? 0);
    out.set(itemId, Math.max(0, Number(cap) - disp));
  }
  return out;
}

/**
 * Cap map from locked RS lines: max(suggestedWoQtySnapshot, requirementQty) — matches cycle dispatch gate.
 */
function buildNoQtyCycleCapByItemId(requirementSheet) {
  /** @type {Map<number, number>} */
  const capByItemId = new Map();
  if (!requirementSheet || String(requirementSheet.status || "") !== "LOCKED") return capByItemId;
  for (const ln of requirementSheet.lines || []) {
    const itemId = Number(ln.itemId ?? ln.fgItemId);
    if (!(itemId > 0)) continue;
    const cap = Math.max(Number(ln.suggestedWoQtySnapshot ?? 0), Number(ln.requirementQty ?? 0));
    if (!(cap > EPS)) continue;
    capByItemId.set(itemId, (capByItemId.get(itemId) || 0) + cap);
  }
  return capByItemId;
}

function deriveNoQtyTrackingStatus({
  soClosed,
  cycleClosed,
  workOrderStatus,
  executionStatus,
  activeProductionPending,
  qcPendingQty,
  activeDispatchPending,
  producedQty,
  acceptedQty,
  rejectedQty,
  dispatchedQty,
}) {
  if (soClosed) return "COMPLETED";
  if (String(workOrderStatus || "").toUpperCase() === "REJECTED") return "COMPLETED";
  if (String(workOrderStatus || "").toUpperCase() === "CLOSED_WITH_SHORTFALL") return "COMPLETED";
  if (cycleClosed && activeProductionPending <= EPS && qcPendingQty <= EPS && activeDispatchPending <= EPS) {
    return "COMPLETED";
  }
  const exec = String(executionStatus || "").toUpperCase();
  if (exec === "SHORTFALL_PENDING") return "SHORTFALL_PENDING";

  if (activeProductionPending > EPS) {
    if (producedQty <= EPS) return "PENDING_PRODUCTION";
    return "IN_PRODUCTION";
  }
  if (qcPendingQty > EPS) {
    if (acceptedQty + rejectedQty <= EPS) return "PENDING_QC";
    return "PARTIAL_QC";
  }
  if (activeDispatchPending > EPS) {
    if (dispatchedQty <= EPS) return "READY_TO_DISPATCH";
    return "PARTIAL_DISPATCH";
  }
  if (exec === "COMPLETED" || String(workOrderStatus || "").toUpperCase() === "COMPLETED") return "COMPLETED";
  return "COMPLETED";
}

/**
 * @param {object | null | undefined} recovery — from enrichSalesOrdersWithRecoveryClosure
 * @param {number} itemId
 */
function formatRecoveryCarryForwardOutcome(recovery, itemId) {
  if (!recovery) return "NONE";
  const sources = (recovery.recoverySummary?.sources || []).filter((s) => Number(s.itemId) === Number(itemId));
  if (!sources.length) {
    if (recovery.closureMode === "CLOSED_WITH_WAIVER" || recovery.closureStatus === "CLOSED_WITH_WAIVER") {
      return "WAIVED (SO closed with waiver)";
    }
    return "NONE";
  }
  const parts = [];
  for (const s of sources) {
    const status = String(s.recoveryStatus || "").toUpperCase();
    const type = String(s.recoveryType || "").replace(/_/g, " ");
    const kept = Number(s.activeAllocatedQty || 0);
    const waived = Number(s.waivedQty || 0);
    const available = Number(s.availableQty ?? s.sourceQty ?? 0);
    if (status === "WAIVED" || waived > EPS) {
      parts.push(`${type}: WAIVE${waived > EPS ? ` (${waived})` : ""}`);
    } else if (kept > EPS || status === "ALLOCATED" || status === "PARTIALLY_ALLOCATED") {
      parts.push(`${type}: KEEP / carry-forward${kept > EPS ? ` (${kept})` : ""}`);
    } else if (status === "OPEN" || available > EPS) {
      parts.push(`${type}: OPEN (${available})`);
    } else {
      parts.push(`${type}: ${status || "NONE"}`);
    }
  }
  return parts.length ? parts.join("; ") : "NONE";
}

function rollupLineProductionQc(wol) {
  let producedQty = 0;
  let acceptedQty = 0;
  let rejectedQty = 0;
  for (const pe of wol.productions || []) {
    if (pe.workflowStatus !== "APPROVED") continue;
    producedQty += Number(pe.producedQty);
    acceptedQty += sumActiveQcAcceptedQty(pe.qcEntries || []);
    rejectedQty += sumActiveQcRejectedQty(pe.qcEntries || []);
  }
  return { producedQty, acceptedQty, rejectedQty };
}

function customerNameForSalesOrder(so) {
  const direct = so.customer?.name?.trim();
  if (direct) return direct;
  const fromPo = so.po?.customer?.name?.trim();
  if (fromPo) return fromPo;
  return "Unknown Customer";
}

function displayDocNo(docNo, prefix, id) {
  const s = docNo != null && String(docNo).trim() !== "" ? String(docNo).trim() : "";
  if (s) return s;
  return `${prefix}-${id}`;
}

/**
 * Build Regular flow rows from preloaded WO lines (all must be non-NO_QTY).
 */
function buildRegularTrackingRows(lines) {
  /** @type {Map<string, Array<{ lineId: number, acceptedQty: number }>>} */
  const groupBuckets = new Map();
  /** @type {Map<number, { producedQty: number, acceptedQty: number, rejectedQty: number }>} */
  const metricsByLineId = new Map();

  for (const wol of lines) {
    const m = rollupLineProductionQc(wol);
    metricsByLineId.set(wol.id, m);
    const so = wol.workOrder.salesOrder;
    const key = `${so.id}-${wol.fgItemId}`;
    if (!groupBuckets.has(key)) groupBuckets.set(key, []);
    groupBuckets.get(key).push({ lineId: wol.id, acceptedQty: m.acceptedQty });
  }

  /** @type {Map<number, number>} */
  const dispatchedByLineId = new Map();
  for (const [key, bucket] of groupBuckets.entries()) {
    const [soIdStr, fgItemIdStr] = key.split("-");
    const soId = Number(soIdStr);
    const fgItemId = Number(fgItemIdStr);
    const sample = lines.find((l) => l.workOrder.salesOrderId === soId && l.fgItemId === fgItemId);
    if (!sample) continue;
    const so = sample.workOrder.salesOrder;
    const net = netDispatchedByItemId(so.dispatch || [], DISPATCH_ALLOC_MODE.CONFIRMED).get(fgItemId) ?? 0;
    const allocMap = allocateDispatchFifoAcrossWorkOrderLines(bucket, net);
    for (const [lid, qty] of allocMap) dispatchedByLineId.set(lid, qty);
  }

  const rows = [];
  for (const wol of lines) {
    const wo = wol.workOrder;
    const so = wo.salesOrder;
    const m = metricsByLineId.get(wol.id);
    const requiredQty = Number(wol.qty);
    const plannedQty = Number(wol.plannedQty ?? wol.qty);
    const orderedQty = resolveWoTrackingOrderedQty({
      orderType: so.orderType,
      soLines: so.lines || [],
      fgItemId: wol.fgItemId,
      requirementSheet: null,
    });
    const dispatchedQty = dispatchedByLineId.get(wol.id) ?? 0;
    const productionPendingQty = getWoTrackingProductionPendingQty(requiredQty, m.producedQty);
    const qcPendingQty = getWoTrackingQcPendingQty(m.producedQty, m.acceptedQty, m.rejectedQty);
    const dispatchPendingQty = getWoTrackingDispatchPendingQty(m.acceptedQty, dispatchedQty);
    const status = deriveWoTrackingOperationalStatus(
      {
        productionPendingQty,
        qcPendingQty,
        dispatchPendingQty,
        producedQty: m.producedQty,
        acceptedQty: m.acceptedQty,
        rejectedQty: m.rejectedQty,
        dispatchedQty,
      },
      EPS,
    );

    rows.push({
      flow: FLOW.REGULAR,
      workOrderLineId: wol.id,
      salesOrderId: so.id,
      salesOrderNo: displayDocNo(so.docNo, "SO", so.id),
      salesOrderDate: so.createdAt.toISOString(),
      customerName: customerNameForSalesOrder(so),
      workOrderId: wo.id,
      workOrderNo: displayDocNo(wo.docNo, "WO", wo.id),
      workOrderDate: wo.createdAt.toISOString(),
      workOrderStatus: wo.status,
      orderType: so.orderType ?? null,
      itemId: wol.fgItemId,
      itemName: wol.fgItem?.itemName ?? `Item #${wol.fgItemId}`,
      orderedQty,
      orderedQtyBasis: "SO_LINE_QTY",
      workOrderQty: requiredQty,
      requiredQty,
      plannedQty,
      producedQty: m.producedQty,
      acceptedQty: m.acceptedQty,
      rejectedQty: m.rejectedQty,
      dispatchedQty,
      productionPendingQty,
      qcPendingQty,
      dispatchPendingQty,
      status,
      quantityContexts: {
        so: { orderedTotalForFgOnSalesOrder: orderedQty, metricContext: METRIC_CONTEXT.SO_ITEM_TOTAL },
        wo: {
          requiredQty,
          plannedQty,
          producedQty: m.producedQty,
          acceptedQty: m.acceptedQty,
          rejectedQty: m.rejectedQty,
          attributedDispatchedQty: dispatchedQty,
          productionPendingQty,
          qcPendingQty,
          dispatchPendingQty,
          metricContext: METRIC_CONTEXT.WO_LINE,
        },
        dispatchAllocation: METRIC_CONTEXT.WO_FIFO,
      },
    });
  }
  return rows;
}

/**
 * Build NO_QTY rows. `cycleFgPendingByKey` maps `${soId}:${cycleId}:${fgItemId}` → pending.
 * `cycleFgDispatchedByKey` maps same → net cycle dispatched for display.
 */
function buildNoQtyTrackingRows(lines, { recoveryBySo = new Map(), cycleFgPendingByKey = new Map(), cycleFgDispatchedByKey = new Map() } = {}) {
  const rows = [];
  for (const wol of lines) {
    const wo = wol.workOrder;
    const so = wo.salesOrder;
    const cycle = wo.cycle || null;
    const rs = wo.requirementSheet || null;
    const m = rollupLineProductionQc(wol);
    const requiredQty = Number(wol.qty);
    const plannedQty = Number(wol.plannedQty ?? wol.qty);
    const customerDemandQty = resolveNoQtyCustomerDemand(rs, wol.fgItemId);
    const soClosed = isNoQtySalesOrderClosed(so.internalStatus);
    const cycleClosed = isCycleClosed(cycle);
    const op = resolveWorkOrderOperationalStatus(wo, so);
    const cycleId = cycle?.id ?? wo.cycleId ?? null;
    const fgKey = cycleId != null ? `${so.id}:${cycleId}:${wol.fgItemId}` : null;
    const cycleFgPending = fgKey != null ? Number(cycleFgPendingByKey.get(fgKey) ?? 0) : 0;
    const cycleFgDispatched = fgKey != null ? Number(cycleFgDispatchedByKey.get(fgKey) ?? 0) : 0;

    const activeProductionPending = computeNoQtyActiveProductionPending({
      soClosed,
      cycleClosed,
      workOrderStatus: wo.status,
      executionStatus: op.executionStatus ?? wo.productionExecution?.executionStatus,
      plannedQty,
      producedQty: m.producedQty,
    });
    const qcPendingQty =
      soClosed || cycleClosed
        ? 0
        : getWoTrackingQcPendingQty(m.producedQty, m.acceptedQty, m.rejectedQty);
    const activeDispatchPending = computeNoQtyActiveDispatchPending({
      soClosed,
      cycleClosed,
      cycleFgDispatchPendingQty: cycleFgPending,
    });

    const status = deriveNoQtyTrackingStatus({
      soClosed,
      cycleClosed,
      workOrderStatus: wo.status,
      executionStatus: op.executionStatus ?? wo.productionExecution?.executionStatus,
      activeProductionPending,
      qcPendingQty,
      activeDispatchPending,
      producedQty: m.producedQty,
      acceptedQty: m.acceptedQty,
      rejectedQty: m.rejectedQty,
      dispatchedQty: cycleFgDispatched,
    });

    const recovery = recoveryBySo.get(Number(so.id));
    const recoveryCarryForwardOutcome = formatRecoveryCarryForwardOutcome(recovery, wol.fgItemId);

    rows.push({
      flow: FLOW.NO_QTY,
      workOrderLineId: wol.id,
      salesOrderId: so.id,
      salesOrderNo: displayDocNo(so.docNo, "SO", so.id),
      salesOrderDate: so.createdAt.toISOString(),
      salesOrderInternalStatus: so.internalStatus ?? null,
      customerName: customerNameForSalesOrder(so),
      workOrderId: wo.id,
      workOrderNo: displayDocNo(wo.docNo, "WO", wo.id),
      workOrderDate: wo.createdAt.toISOString(),
      workOrderStatus: wo.status,
      orderType: "NO_QTY",
      itemId: wol.fgItemId,
      itemName: wol.fgItem?.itemName ?? `Item #${wol.fgItemId}`,
      requirementSheetId: rs?.id ?? null,
      requirementSheetNo: rs ? displayDocNo(rs.docNo, "RS", rs.id) : null,
      requirementSheetStatus: rs?.status ?? null,
      cycleId: cycleId,
      cycleNo: cycle?.cycleNo ?? null,
      cycleStatus: cycle?.status ?? null,
      customerDemandQty,
      orderedQty: null,
      orderedQtyBasis: customerDemandQty == null ? "NA" : "RS_CUSTOMER_DEMAND",
      workOrderQty: requiredQty,
      requiredQty,
      plannedQty,
      producedQty: m.producedQty,
      acceptedQty: m.acceptedQty,
      rejectedQty: m.rejectedQty,
      /** Cycle-scoped SO+FG net confirmed dispatch (not WO FIFO). */
      dispatchedQty: cycleFgDispatched,
      activeProductionPendingQty: activeProductionPending,
      /** Alias for summary/sort compatibility — Active Production Pending */
      productionPendingQty: activeProductionPending,
      qcPendingQty,
      activeDispatchPendingQty: activeDispatchPending,
      /** Alias — Active Dispatch Pending (SO+FG cycle), never WO FIFO */
      dispatchPendingQty: activeDispatchPending,
      recoveryCarryForwardOutcome,
      productionShortfallSourceQty: recovery
        ? Number(recovery.productionShortfallSourceQty || 0)
        : null,
      recoverySourceStatus: (() => {
        const src = (recovery?.recoverySummary?.sources || []).find(
          (s) => Number(s.itemId) === Number(wol.fgItemId) && s.recoveryType === "PRODUCTION_SHORTFALL",
        );
        return src?.recoveryStatus ?? null;
      })(),
      recoveryAllocatedQty: recovery ? Number(recovery.recoveryAllocatedQty || 0) : null,
      executionStatus: op.executionStatus,
      status,
      quantityContexts: {
        so: {
          customerDemandQty,
          metricContext: "RS_CUSTOMER_DEMAND",
        },
        wo: {
          requiredQty,
          plannedQty,
          producedQty: m.producedQty,
          activeProductionPendingQty: activeProductionPending,
          qcPendingQty,
          activeDispatchPendingQty: activeDispatchPending,
          metricContext: "NO_QTY_CYCLE_AWARE",
        },
        dispatchAllocation: "SO_FG_CYCLE_CAP",
      },
    });
  }
  return rows;
}

function filterLinesForFlow(lines, flow) {
  return (lines || []).filter((wol) => {
    const ot = String(wol.workOrder?.salesOrder?.orderType || "");
    if (flow === FLOW.NO_QTY) return ot === "NO_QTY";
    return ot !== "NO_QTY";
  });
}

function filterActiveOnly(lines, flow, includeClosed) {
  if (includeClosed) return lines;
  return lines.filter((wol) => {
    const wo = wol.workOrder;
    const so = wo.salesOrder;
    if (flow === FLOW.NO_QTY) {
      if (isNoQtySalesOrderClosed(so.internalStatus)) return false;
      if (isCycleClosed(wo.cycle)) return false;
      if (isWorkOrderProductionOperationallyClosed(wo, so)) return false;
      return true;
    }
    return !isWorkOrderProductionOperationallyClosed(wo, so);
  });
}

/**
 * @param {import("@prisma/client").PrismaClient} db
 * @param {{ flow: "REGULAR" | "NO_QTY", includeClosed?: boolean }} opts
 */
async function buildWorkOrderTrackingReport(db, opts) {
  const flow = opts.flow;
  const includeClosed = Boolean(opts.includeClosed);

  const lines = await db.workOrderLine.findMany({
    orderBy: [
      { workOrder: { salesOrder: { createdAt: "asc" } } },
      { workOrder: { createdAt: "asc" } },
      { id: "asc" },
    ],
    include: {
      fgItem: true,
      workOrder: {
        include: {
          productionExecution: true,
          cycle: true,
          requirementSheet: {
            include: { lines: true },
          },
          salesOrder: {
            include: {
              lines: { include: { item: true }, orderBy: { id: "asc" } },
              customer: true,
              po: { include: { customer: true } },
              dispatch: true,
            },
          },
        },
      },
      productions: {
        include: {
          qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
        },
      },
    },
  });

  let scoped = filterLinesForFlow(lines, flow);
  scoped = filterActiveOnly(scoped, flow, includeClosed);

  let rows;
  if (flow === FLOW.REGULAR) {
    rows = buildRegularTrackingRows(scoped);
  } else {
    const soIds = [...new Set(scoped.map((l) => Number(l.workOrder.salesOrderId)).filter((id) => id > 0))];
    const { enrichSalesOrdersWithRecoveryClosure } = require("./noQtyRecoveryAnalyticsService");
    const recoveryBySo = soIds.length ? await enrichSalesOrdersWithRecoveryClosure(db, soIds) : new Map();

    /** @type {Map<number, Map<number, number>>} soId -> itemId -> pending (computed per cycle below) */
    const cycleFgPendingByKey = new Map();
    const cycleFgDispatchedByKey = new Map();

    /** Unique so+cycle pairs */
    const pairKeys = new Set();
    for (const wol of scoped) {
      const soId = Number(wol.workOrder.salesOrderId);
      const cycleId = wol.workOrder.cycle?.id ?? wol.workOrder.cycleId;
      if (soId > 0 && cycleId != null) pairKeys.add(`${soId}:${cycleId}`);
    }

    for (const pair of pairKeys) {
      const [soIdStr, cycleIdStr] = pair.split(":");
      const soId = Number(soIdStr);
      const cycleId = Number(cycleIdStr);
      const sample = scoped.find(
        (l) => Number(l.workOrder.salesOrderId) === soId && Number(l.workOrder.cycle?.id ?? l.workOrder.cycleId) === cycleId,
      );
      const rs = sample?.workOrder?.requirementSheet;
      const capByItemId = buildNoQtyCycleCapByItemId(rs);
      const cycleDispatch = (sample?.workOrder?.salesOrder?.dispatch || []).filter(
        (d) => Number(d.cycleId) === cycleId,
      );
      const pendingByItem = computeNoQtyCycleFgDispatchPendingByItem(capByItemId, cycleDispatch);
      const locked = cycleDispatch.filter((d) => String(d.workflowStatus || "") === "LOCKED");
      const net = netDispatchedByItemId(locked, DISPATCH_ALLOC_MODE.CONFIRMED);
      for (const [itemId, pending] of pendingByItem.entries()) {
        cycleFgPendingByKey.set(`${soId}:${cycleId}:${itemId}`, pending);
      }
      for (const [itemId, disp] of net.entries()) {
        cycleFgDispatchedByKey.set(`${soId}:${cycleId}:${itemId}`, disp);
      }
      // Also seed zeros for FG items on WOs even if cap empty
      for (const wol of scoped) {
        if (Number(wol.workOrder.salesOrderId) !== soId) continue;
        if (Number(wol.workOrder.cycle?.id ?? wol.workOrder.cycleId) !== cycleId) continue;
        const k = `${soId}:${cycleId}:${wol.fgItemId}`;
        if (!cycleFgPendingByKey.has(k)) cycleFgPendingByKey.set(k, 0);
        if (!cycleFgDispatchedByKey.has(k)) cycleFgDispatchedByKey.set(k, Number(net.get(wol.fgItemId) ?? 0));
      }
    }

    rows = buildNoQtyTrackingRows(scoped, {
      recoveryBySo,
      cycleFgPendingByKey,
      cycleFgDispatchedByKey,
    });
  }

  const summary = computeWorkOrderTrackingSummaryFromRows(rows);
  return {
    flow,
    includeClosed,
    rows,
    summary,
    emptyMessage:
      flow === FLOW.REGULAR
        ? "No Regular Sales Order work orders found for the selected filters."
        : includeClosed
          ? "No NO_QTY work orders found for the selected filters."
          : "No active NO_QTY work orders found for the selected filters.",
    reportMetricHints:
      flow === FLOW.REGULAR
        ? {
            flow: FLOW.REGULAR,
            orderedQty: "Sum of SalesOrderLine.qty for this FG on the SO.",
            requiredQty: "Work order line qty committed to the sales order",
            plannedQty: "Work order line planned production qty",
            productionPendingQty: METRIC_DEFINITIONS.productionBalanceQty,
            dispatchPendingQty: METRIC_DEFINITIONS.woDispatchPendingQty,
            dispatchAllocation: METRIC_CONTEXT.WO_FIFO,
          }
        : {
            flow: FLOW.NO_QTY,
            customerDemandQty:
              "Locked RS baseDemandQty (fallback requirementQty). Never WO/planned/recovery/carry-forward/produced.",
            activeProductionPendingQty:
              "0 when SO closed, cycle closed, WO terminal, or execution COMPLETED/SHORTFALL_PENDING; else getEffectiveProductionPendingQty",
            activeDispatchPendingQty:
              "SO+FG cycle dispatch remaining vs locked RS cap; 0 when SO/cycle closed. Never WO FIFO accepted−dispatch.",
            recoveryCarryForwardOutcome: "KEEP / WAIVE / OPEN recovery outcome from recovery analytics",
            dispatchAllocation: "SO_FG_CYCLE_CAP",
          },
  };
}

module.exports = {
  FLOW,
  CLOSED_SO_STATUSES,
  parseWorkOrderTrackingQuery,
  isNoQtySalesOrderClosed,
  isCycleClosed,
  resolveNoQtyCustomerDemand,
  computeNoQtyActiveProductionPending,
  computeNoQtyActiveDispatchPending,
  computeNoQtyCycleFgDispatchPendingByItem,
  buildNoQtyCycleCapByItemId,
  deriveNoQtyTrackingStatus,
  formatRecoveryCarryForwardOutcome,
  buildRegularTrackingRows,
  buildNoQtyTrackingRows,
  filterLinesForFlow,
  filterActiveOnly,
  buildWorkOrderTrackingReport,
};
