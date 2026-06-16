/**
 * Read-only payload builder for the future Material Availability & RM Allocation
 * Control Center. No mutations, no allocations, no workflow replacement.
 */

const { prisma } = require("../utils/prisma");
const { filterNoQtyExecutionReleasedWorkOrders } = require("./noQtyExecutionBoundaryService");
const { aggregateRmDemandForFgLines, round3 } = require("./bomExplosionService");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");
const { qtyToNumber } = require("./rmPurchaseHelpers");
const {
  buildRegularSoPlanningSnapshotView,
  fgShortageDemandInputFromPlanningView,
} = require("./regularSoPlanningSnapshotService");
const { computeFgGapLinesForSalesOrder } = require("./rmCheckService");
const { evaluateWoPrepareReadiness } = require("./materialPlanningService");
const { computeSalesOrderDispatchLineStats } = require("./reportMetrics");
const { summarizeProcurementStageFromTrace } = require("./rmProcurementStageSignals");
const QUEUE_EPS = 1e-6;
const PMR_WAITING_ISSUE_STATUSES = ["REQUESTED", "PARTIALLY_ISSUED"];
const PURCHASE_VISIBLE_MR_STATUSES = [
  "APPROVED",
  "SENT_TO_PURCHASE",
  "PROCUREMENT_IN_PROGRESS",
  "PARTIALLY_PROCURED",
];
/** Post-GRN: procurement complete, awaiting WO before Store issue. */
const PROCURED_MR_STATUSES = ["FULLY_PROCURED"];
const POST_GRN_INELIGIBLE_SO_STATUSES = ["COMPLETED", "CLOSED", "MANUALLY_CLOSED"];
const OPEN_MR_STATUSES = PURCHASE_VISIBLE_MR_STATUSES;
const {
  REGULAR_SO_PROCUREMENT_SOURCE,
  regularSoProcurementSourceTypes,
} = require("./regularSoProcurementSource");
const {
  formatDemandSourceLabel,
} = require("./procurementDemandSourcePresentation");
const { buildPlanDisplayLabel } = require("./monthlyPlanningPlanLifecycleService");
const WO_PLANNING_SOURCE = "WORK_ORDER_PLANNING";
const OPEN_PO_STATUSES = ["PENDING", "PARTIAL"];
/** Include completed PO rows in WO case supply history (read-model only). */
const CASE_SUPPLY_PO_STATUSES = ["PENDING", "PARTIAL", "COMPLETED"];
const MPRS_WO_PROCUREMENT_MR_STATUSES = ["FULLY_PROCURED", "PARTIALLY_PROCURED", "PROCUREMENT_IN_PROGRESS"];

function monthlyPlanLabelFromMr(mr) {
  const plan = mr?.monthlyProductionPlan;
  if (!plan) return null;
  return buildPlanDisplayLabel(plan) || null;
}

function mrProcurementSourceLabel(mr) {
  if (!mr) return null;
  const planLabel = monthlyPlanLabelFromMr(mr);
  return formatDemandSourceLabel({
    demandSourceType: mr.sourceType,
    salesOrder: mr.salesOrder ? { docNo: mr.salesOrder.docNo } : null,
    monthlyPlan: planLabel ? { label: planLabel } : null,
    mr: { docNo: mr.docNo },
    workOrder: mr.workOrder ? { docNo: mr.workOrder.docNo } : null,
  });
}

function n(v) {
  return qtyToNumber(v);
}

function customerNameForSalesOrder(so) {
  return so?.customer?.name ?? so?.customer?.customerName ?? "";
}

function docNoOrId(prefix, row) {
  return row?.docNo || (row?.id ? `${prefix}-${row.id}` : null);
}

function readPositiveId(v) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : null;
}

function parseWorkspaceFilters(filters = {}) {
  return {
    salesOrderId: readPositiveId(filters.salesOrderId),
    workOrderId: readPositiveId(filters.workOrderId),
    materialRequirementId: readPositiveId(filters.materialRequirementId),
    rmItemId: readPositiveId(filters.rmItemId),
    status: filters.status ? String(filters.status).trim().toUpperCase() : null,
    onlyBlocked: filters.onlyBlocked === true || filters.onlyBlocked === "true",
  };
}

function statusMatches(row, status) {
  if (!status) return true;
  if (status === "BLOCKED") return row.netShortageAfterIncomingQty > QUEUE_EPS;
  if (status === "PARTIAL") return row.freeStockQty > QUEUE_EPS && row.shortageAfterReservationQty > QUEUE_EPS;
  if (status === "INCOMING") return row.coveredByIncomingQty > QUEUE_EPS && row.netShortageAfterIncomingQty <= QUEUE_EPS;
  if (status === "PMR_WAITING") return row.queueType === "PMR_WAITING_ISSUE";
  if (status === "APPROVAL_PENDING") return row.queueType === "APPROVAL_PENDING";
  if (status === "WAITING_PURCHASE") return row.queueType === "WAITING_PURCHASE_ACTION";
  if (status === "WAITING_GRN") return row.queueType === "PO_WAITING_GRN" || row.queueType === "SHORTAGE_COVERED_BY_INCOMING";
  if (status === "PARTIAL_RECEIVED") return row.queueType === "PARTIAL_RM_RECEIVED";
  if (status === "READY_ISSUE") return row.queueType === "RM_READY_FOR_ISSUE";
  if (status === "RM_RECEIVED") return row.queueType === "RM_RECEIVED_CREATE_WO";
  if (status === "READY_RELEASE") return row.queueType === "READY_TO_RELEASE_WO";
  return row.queueType === status;
}

function warningCodes(line) {
  return new Set((line?.warnings || []).map((w) => w.code));
}

function hasWaitingPmr(pmrStatus) {
  return (pmrStatus?.openPmrs || []).some((p) => PMR_WAITING_ISSUE_STATUSES.includes(p.status));
}

function hasFullyIssuedPmr(pmrStatus) {
  return (pmrStatus?.openPmrs || []).some((p) => p.status === "FULLY_ISSUED");
}

function pmrIssuedQtyForRm(pmrStatus, rmItemId) {
  for (const pmr of pmrStatus?.openPmrs || []) {
    const ln = (pmr.lines || []).find((l) => l.rmItemId === rmItemId);
    if (ln) return n(ln.issuedQty);
  }
  return 0;
}

function pmrFullyIssuedForRm(pmrStatus, rmItemId) {
  for (const pmr of pmrStatus?.openPmrs || []) {
    if (pmr.status !== "FULLY_ISSUED") continue;
    const ln = (pmr.lines || []).find((l) => l.rmItemId === rmItemId);
    if (ln && n(ln.pendingQty) <= QUEUE_EPS && n(ln.issuedQty) > QUEUE_EPS) return true;
  }
  return false;
}

function resolveActiveWoMr(woMr) {
  if (!woMr?.id) return null;
  if (isPurchaseVisibleMaterialRequirement(woMr) || isProcuredMaterialRequirement(woMr)) return woMr;
  return null;
}

/**
 * Phase A (derived only): allocation-first operational status for a WO case.
 * Does NOT depend on MR/PR/PO/GRN status; uses stock/allocation/issue readiness only.
 * @returns {{ key: 'WAITING_RM'|'PARTIALLY_ALLOCATED'|'READY_FOR_ISSUE'|'READY_FOR_PRODUCTION', label: string, owner: string, nextAction: string }}
 */
function deriveAllocationFirstWoStatus({ rmLines, pmrStatus, procuredAwaitingWo = false, hasWorkOrder = true }) {
  const lines = rmLines || [];

  if (procuredAwaitingWo && !hasWorkOrder) {
    return {
      key: "RM_RECEIVED",
      label: "RM received in Store",
      owner: "Store Department",
      nextAction: "Create Work Order",
    };
  }

  if (hasFullyIssuedPmr(pmrStatus)) {
    return {
      key: "READY_FOR_PRODUCTION",
      label: "Ready for production",
      owner: "Production Department",
      nextAction: "Start production",
    };
  }

  const waitingPmr = hasWaitingPmr(pmrStatus);
  if (waitingPmr && hasWorkOrder) {
    const issueable = lines.some(
      (line) => pmrPendingQtyForRm(pmrStatus, line.rmItemId) > QUEUE_EPS && n(line.freeStockQty) > QUEUE_EPS,
    );
    if (issueable) {
      return {
        key: "READY_FOR_ISSUE",
        label: "Ready for issue",
        owner: "Store Department",
        nextAction: "Issue RM to Production",
      };
    }
  }

  const anyIssueReady =
    hasWorkOrder &&
    lines.some(
      (l) =>
        l.blockerReason === "Ready for material issue" ||
        (n(l.freeStockQty) + QUEUE_EPS >= n(l.requiredQty) && n(l.requiredQty) > QUEUE_EPS),
    );
  if (anyIssueReady) {
    return {
      key: "READY_FOR_ISSUE",
      label: "Ready for issue",
      owner: "Store Department",
      nextAction: "Issue RM to Production",
    };
  }

  const anyAllocatedOrIssued = lines.some((l) => n(l.activeAllocatedQty) > QUEUE_EPS || n(l.issuedToProductionQty) > QUEUE_EPS);
  if (anyAllocatedOrIssued) {
    return {
      key: "PARTIALLY_ALLOCATED",
      label: "Partially allocated",
      owner: "Store Department",
      nextAction: "Allocate / issue RM",
    };
  }

  return {
    key: "WAITING_RM",
    label: "Waiting RM",
    owner: "Store Department",
    nextAction: "Raise RM requirement / allocate when stock arrives",
  };
}

function hasOpenMr(trace) {
  return (trace?.openMrLines || []).length > 0;
}

function isPurchaseVisibleMaterialRequirement(mr) {
  return Boolean(mr?.id && PURCHASE_VISIBLE_MR_STATUSES.includes(String(mr.status || "")));
}

function isProcuredMaterialRequirement(mr) {
  return Boolean(mr?.id && PROCURED_MR_STATUSES.includes(String(mr.status || "")));
}

function caseQueueKey(row) {
  if (row.workOrderId != null && Number(row.workOrderId) > 0) return `wo-${row.workOrderId}`;
  if (row.materialRequirementId != null && Number(row.materialRequirementId) > 0) {
    return `mr-${row.materialRequirementId}`;
  }
  if (row.salesOrderId != null && Number(row.salesOrderId) > 0) return `so-${row.salesOrderId}`;
  return `rm-${row.rmItemId ?? "x"}`;
}

function pushCaseQueueRow(actionQueue, row) {
  const key = caseQueueKey(row);
  if (actionQueue.some((r) => caseQueueKey(r) === key)) return;
  actionQueue.push(row);
}

function pickRepresentativeRmLine(rmLines, pmrStatus = null) {
  if (!rmLines?.length) return null;
  let best = rmLines[0];
  let bestRank = priorityRankForLine(best, best.blockerReason, pmrStatus ?? { openPmrs: [] });
  for (const line of rmLines.slice(1)) {
    const rank = priorityRankForLine(line, line.blockerReason, pmrStatus ?? { openPmrs: [] });
    if (rank < bestRank) {
      best = line;
      bestRank = rank;
    }
  }
  return best;
}

function hasOpenPo(trace) {
  return (trace?.poLines || []).some((p) => p.pendingGrnQty > QUEUE_EPS);
}

function mrStatuses(trace) {
  return [...new Set((trace?.openMrLines || []).map((line) => line.status).filter(Boolean))];
}

function hasMrStatus(trace, statuses) {
  const allowed = new Set(statuses);
  return mrStatuses(trace).some((status) => allowed.has(status));
}

function hasPartialReceipt(trace) {
  return (trace?.poLines || []).some((p) => n(p.receivedGrnQty) > QUEUE_EPS && n(p.pendingGrnQty) > QUEUE_EPS);
}

function deriveLineBlocker(line, { pmrStatus = null, trace = null, bomIssue = false, procuredAwaitingWo = false, hasWorkOrder = true } = {}) {
  const codes = warningCodes(line);
  const rmItemId = line.itemId ?? line.rmItemId;
  if (bomIssue) return "No approved BOM / BOM issue";
  if (procuredAwaitingWo) return "RM received in Store — create Work Order";
  if (
    pmrFullyIssuedForRm(pmrStatus, rmItemId) &&
    pmrIssuedQtyForRm(pmrStatus, rmItemId) + QUEUE_EPS >= n(line.requiredQty)
  ) {
    return "RM issued to production";
  }
  if (line.legacyReservedQty > QUEUE_EPS && line.freeStockQty <= QUEUE_EPS && line.physicalUsableStockQty > QUEUE_EPS) {
    return "Stock exists but reserved for other PMR";
  }
  if (line.activeAllocatedQty > QUEUE_EPS && line.freeStockQty <= QUEUE_EPS) {
    return "Stock reserved by allocation";
  }
  if (n(line.freeStockQty) <= QUEUE_EPS) {
    if (codes.has("STOCK_IN_PRODUCTION_LOCATION")) return "Stock exists in production/WIP, not store";
    if (hasPartialReceipt(trace) && line.shortageAfterReservationQty > QUEUE_EPS) return "Partial RM received";
    if (line.shortageAfterReservationQty > QUEUE_EPS && line.coveredByIncomingQty > QUEUE_EPS) {
      return "Stock available only after incoming PO/GRN";
    }
    if (hasOpenPo(trace) && line.shortageAfterReservationQty > QUEUE_EPS) return "PO created, GRN pending";
    if ((trace?.prLines || []).length > 0 && line.shortageAfterReservationQty > QUEUE_EPS) {
      return "RM Requisition sent, PR/PO pending";
    }
    if (hasMrStatus(trace, ["DRAFT", "PENDING_APPROVAL"])) return "RM Requisition pending Store approval";
    if (hasMrStatus(trace, ["APPROVED", "SENT_TO_PURCHASE"])) return "RM Requisition sent, PR/PO pending";
    if (hasOpenMr(trace) && line.shortageAfterReservationQty > QUEUE_EPS) return "RM Requisition sent, PR/PO pending";
  }
  if (hasWaitingPmr(pmrStatus)) return "PMR waiting for store issue";
  if (
    pmrFullyIssuedForRm(pmrStatus, rmItemId) &&
    pmrIssuedQtyForRm(pmrStatus, rmItemId) + QUEUE_EPS >= n(line.requiredQty)
  ) {
    return "RM issued to production";
  }
  if (codes.has("STOCK_IN_PRODUCTION_LOCATION")) return "Stock exists in production/WIP, not store";
  if (hasPartialReceipt(trace) && line.shortageAfterReservationQty > QUEUE_EPS) return "Partial RM received";
  if (line.shortageAfterReservationQty > QUEUE_EPS && line.coveredByIncomingQty > QUEUE_EPS) {
    return "Stock available only after incoming PO/GRN";
  }
  if (hasOpenPo(trace) && line.shortageAfterReservationQty > QUEUE_EPS) return "PO created, GRN pending";
  if (hasMrStatus(trace, ["DRAFT", "PENDING_APPROVAL"])) return "RM Requisition pending Store approval";
  if (hasMrStatus(trace, ["APPROVED", "SENT_TO_PURCHASE"])) return "RM Requisition sent, PR/PO pending";
  if (hasOpenMr(trace) && line.shortageAfterReservationQty > QUEUE_EPS) return "RM Requisition sent, PR/PO pending";
  if (!hasWorkOrder && line.freeStockQty + QUEUE_EPS >= line.requiredQty && line.requiredQty > QUEUE_EPS) {
    return "RM received in Store — create Work Order";
  }
  if (line.freeStockQty + QUEUE_EPS >= line.requiredQty && line.requiredQty > QUEUE_EPS) return "Ready for material issue";
  if (line.shortageAfterReservationQty > QUEUE_EPS) return "RM not available in store";
  return "No blocker";
}

function deriveRecommendedAction(line, blockerReason, { trace = null, procuredAwaitingWo = false } = {}) {
  if (procuredAwaitingWo || blockerReason === "RM received in Store — create Work Order") {
    return "Create Work Order in Prepare WO";
  }
  if (blockerReason === "Ready for material issue") return "Issue material to production";
  if (blockerReason === "Stock reserved by allocation") return "Review competing allocation";
  if (blockerReason === "Stock exists but reserved for other PMR") return "Review competing PMR reservation";
  if (blockerReason === "Stock available only after incoming PO/GRN") return "Wait for GRN";
  if (blockerReason === "Partial RM received") return "Issue partial RM / wait for balance GRN";
  if (blockerReason === "PO created, GRN pending") return "Wait for GRN";
  if (blockerReason === "PMR waiting for store issue") {
    return line.freeStockQty > QUEUE_EPS ? "Issue material to production" : "Wait for RM in Store";
  }
  if (blockerReason === "RM issued to production") return "Start production";
  if (blockerReason === "Stock exists in production/WIP, not store") return "Review material location";
  if (blockerReason === "No approved BOM / BOM issue") return "Review BOM";
  if (
    blockerReason === "RM Requisition pending Store approval" ||
    blockerReason === "RM Requisition approved, PR/PO pending" ||
    blockerReason === "RM Requisition sent, PR/PO pending"
  ) {
    const hasPr = (trace?.prLines || []).length > 0;
    if (blockerReason === "RM Requisition pending Store approval") return "Approve / send RM Requisition";
    return hasPr ? "Follow up Purchase Order" : "Create Purchase Request";
  }
  if (line.shortageAfterReservationQty > QUEUE_EPS) return "Raise / review RM Requisition";
  return "No action required";
}

function firstOpenMrLine(trace) {
  return (trace?.openMrLines || [])[0] || null;
}

function procurementStatusForLine(line, queueType, trace) {
  if (queueType === "APPROVAL_PENDING") return "Store approval pending";
  if (queueType === "WAITING_PURCHASE_ACTION") return "Waiting for Purchase action";
  if (queueType === "PO_WAITING_GRN" || queueType === "SHORTAGE_COVERED_BY_INCOMING") return "PO created / GRN pending";
  if (queueType === "PARTIAL_RM_RECEIVED") return "Partially received";
  if (queueType === "RM_RECEIVED_CREATE_WO") return "RM received in Store";
  if (queueType === "RM_READY_FOR_ISSUE") return "RM ready in Store";
  if (queueType === "READY_TO_RELEASE_WO") return "Material issued / release ready";
  if ((trace?.prLines || []).length > 0) return "Purchase request created";
  if ((trace?.openMrLines || []).length > 0) return "RM Requisition active";
  if (line.netShortageAfterIncomingQty > QUEUE_EPS) return "Not escalated";
  return "Store tracking";
}

function poStatusForTrace(trace) {
  const poLines = trace?.poLines || [];
  if (!poLines.length) return "No PO";
  if (poLines.some((p) => n(p.pendingGrnQty) > QUEUE_EPS && n(p.receivedGrnQty) > QUEUE_EPS)) return "Partial GRN";
  if (poLines.some((p) => n(p.pendingGrnQty) > QUEUE_EPS)) return "Waiting GRN";
  return "Received";
}

function grnReceivedPercentForTrace(trace) {
  const poLines = trace?.poLines || [];
  const ordered = poLines.reduce((sum, p) => sum + n(p.orderedQty), 0);
  if (ordered <= QUEUE_EPS) return 0;
  const received = poLines.reduce((sum, p) => sum + n(p.receivedGrnQty), 0);
  return Math.max(0, Math.min(100, Math.round((received / ordered) * 100)));
}

function nextOwnerForQueue(queueType) {
  if (queueType === "WAITING_PURCHASE_ACTION") return "Purchase Department";
  if (queueType === "RM_RECEIVED_CREATE_WO") return "Store Department";
  if (
    ["RM_READY_FOR_ISSUE", "PMR_WAITING_ISSUE", "PARTIAL_RM_RECEIVED", "READY_TO_RELEASE_WO"].includes(queueType)
  ) {
    return "Store Department";
  }
  return "Store Department";
}

function lineReadyForStoreIssue(line) {
  return (
    line.blockerReason === "Ready for material issue" ||
    (n(line.freeStockQty) + QUEUE_EPS >= n(line.requiredQty) && n(line.requiredQty) > QUEUE_EPS)
  );
}

function caseHasStockReadyForIssue(rmLines, pmrStatus) {
  if (!rmLines?.length) return false;
  if ((pmrStatus?.openPmrs || []).some((p) => p.status === "FULLY_ISSUED")) return false;
  return rmLines.some((line) => lineReadyForStoreIssue(line));
}

function nextActionForQueue(row) {
  if (row.queueType === "READY_TO_RELEASE_WO") return "Release WO to production";
  return row.recommendedAction;
}

function priorityRankForLine(line, blockerReason, pmrStatus) {
  if (blockerReason === "RM Requisition pending Store approval") return 5;
  if (line.netShortageAfterIncomingQty > QUEUE_EPS) return 10;
  if (blockerReason === "PMR waiting for store issue" || hasWaitingPmr(pmrStatus)) return 20;
  if (blockerReason === "Partial RM received") return 25;
  if (blockerReason === "PO created, GRN pending" || blockerReason === "Stock available only after incoming PO/GRN") return 30;
  if (blockerReason === "RM Requisition sent, PR/PO pending" || blockerReason === "RM Requisition approved, PR/PO pending") return 35;
  if (line.shortageAfterReservationQty > QUEUE_EPS && line.coveredByIncomingQty > QUEUE_EPS) return 30;
  if (line.freeStockQty > QUEUE_EPS && line.shortageAfterReservationQty > QUEUE_EPS) return 40;
  if (blockerReason === "RM received in Store — create Work Order") return 42;
  if (blockerReason === "Ready for material issue") return 45;
  return 90;
}

function queueTypeForLine(line, blockerReason, pmrStatus, { procuredAwaitingWo = false, hasWorkOrder = true } = {}) {
  if (procuredAwaitingWo || blockerReason === "RM received in Store — create Work Order") {
    return "RM_RECEIVED_CREATE_WO";
  }
  if (blockerReason === "RM Requisition pending Store approval") return "APPROVAL_PENDING";
  if (blockerReason === "RM Requisition sent, PR/PO pending" || blockerReason === "RM Requisition approved, PR/PO pending") {
    return "WAITING_PURCHASE_ACTION";
  }
  if (blockerReason === "PO created, GRN pending") return "PO_WAITING_GRN";
  if (blockerReason === "Partial RM received") return "PARTIAL_RM_RECEIVED";
  if (blockerReason === "PMR waiting for store issue" || hasWaitingPmr(pmrStatus)) return "PMR_WAITING_ISSUE";
  if (blockerReason === "RM issued to production" && hasFullyIssuedPmr(pmrStatus)) return "READY_TO_RELEASE_WO";
  if (blockerReason === "Ready for material issue" && hasWorkOrder) return "RM_READY_FOR_ISSUE";
  if (blockerReason === "No blocker" && hasFullyIssuedPmr(pmrStatus)) return "READY_TO_RELEASE_WO";
  if (line.freeStockQty > QUEUE_EPS && line.shortageAfterReservationQty > QUEUE_EPS) return "WO_PARTIALLY_COVERED";
  if (line.shortageAfterReservationQty > QUEUE_EPS && line.coveredByIncomingQty > QUEUE_EPS) return "SHORTAGE_COVERED_BY_INCOMING";
  if (line.netShortageAfterIncomingQty > QUEUE_EPS) return "WO_BLOCKED_RM_SHORTAGE";
  return "INFO";
}

function mapAvailabilityLine(line, itemById, context = {}) {
  const trace = context.traceByRmItemId?.get(line.itemId) || null;
  const procuredAwaitingWo = Boolean(context.procuredAwaitingWo);
  const hasWorkOrder = context.hasWorkOrder !== false;
  const blockerReason = deriveLineBlocker(line, {
    pmrStatus: context.pmrStatus,
    trace,
    bomIssue: context.bomIssue,
    procuredAwaitingWo,
    hasWorkOrder,
  });
  return {
    rmItemId: line.itemId,
    rmItemName: itemById.get(line.itemId)?.itemName ?? `Item #${line.itemId}`,
    unit: itemById.get(line.itemId)?.unit ?? "",
    requiredQty: line.requiredQty,
    physicalUsableStockQty: line.physicalUsableStockQty,
    activeAllocatedQty: line.activeAllocatedQty,
    legacyReservedQty: line.legacyReservedQty,
    effectiveReservedQty: line.effectiveReservedQty,
    freeStockQty: line.freeStockQty,
    incomingQty: line.incomingQty,
    issuedToProductionQty: line.issuedToProductionQty,
    shortageNowQty: line.shortageNowQty,
    shortageAfterReservationQty: line.shortageAfterReservationQty,
    coveredByIncomingQty: line.coveredByIncomingQty,
    netShortageAfterIncomingQty: line.netShortageAfterIncomingQty,
    allocationCoverageQty: line.allocationCoverageQty,
    allocationShortageQty: line.allocationShortageQty,
    allocationStatus: line.allocationStatus,
    reservationBreakdown: line.reservationBreakdown || [],
    warnings: line.warnings,
    blockerReason,
    recommendedAction: deriveRecommendedAction(line, blockerReason, { trace, procuredAwaitingWo }),
    procurementTrace: trace,
  };
}

async function loadCandidateWorkOrders(db, filters) {
  const where = {
    status: { in: ["PENDING", "IN_PROGRESS", "HOLD", "PAUSED"] },
  };
  if (filters.workOrderId) where.id = filters.workOrderId;
  if (filters.salesOrderId) where.salesOrderId = filters.salesOrderId;

  return db.workOrder.findMany({
    where,
    orderBy: { id: "desc" },
    take: 100,
    include: {
      salesOrder: { include: { customer: true } },
      lines: { include: { fgItem: { select: { id: true, itemName: true, unit: true } } } },
    },
  });
}

const SO_PLANNING_MR_INCLUDE = {
  salesOrder: {
    include: {
      customer: true,
      lines: { include: { item: { select: { id: true, itemName: true, itemType: true, unit: true } } } },
    },
  },
  monthlyProductionPlan: true,
  workOrder: { select: { id: true, docNo: true } },
  lines: { include: { rmItem: { select: { id: true, itemName: true, unit: true } } } },
};

async function loadCandidateSoPlanningMrs(db, filters) {
  if (filters.workOrderId) return [];
  const where = {
    sourceType: { in: regularSoProcurementSourceTypes() },
    status: { in: OPEN_MR_STATUSES },
    salesOrderId: { not: null },
  };
  if (filters.materialRequirementId) where.id = filters.materialRequirementId;
  if (filters.salesOrderId) where.salesOrderId = filters.salesOrderId;

  return db.materialRequirement.findMany({
    where,
    orderBy: { id: "desc" },
    take: 100,
    include: SO_PLANNING_MR_INCLUDE,
  });
}

/** Post-GRN SO-level MR: procurement complete, WO not yet created. */
async function assessPostGrnCreateWoEligibility(db, mr, deps = {}) {
  const so = mr?.salesOrder;
  if (!so) return { eligible: false, reason: "NO_SALES_ORDER" };
  if (so.orderType === "NO_QTY" || so.orderType === "REPLACEMENT") {
    return { eligible: false, reason: "ORDER_TYPE_EXCLUDED" };
  }
  if (POST_GRN_INELIGIBLE_SO_STATUSES.includes(String(so.internalStatus ?? ""))) {
    return { eligible: false, reason: "SO_TERMINAL_STATUS" };
  }
  if (!salesOrderHasFgLines(so)) return { eligible: false, reason: "NO_FG_LINES" };
  if (!isProcuredMaterialRequirement(mr)) return { eligible: false, reason: "MR_NOT_FULLY_PROCURED" };

  const existingWo = await db.workOrder.findFirst({
    where: { salesOrderId: so.id, status: { not: "REJECTED" } },
    select: { id: true },
  });
  if (existingWo) return { eligible: false, reason: "WO_ALREADY_EXISTS" };

  const fullSo = await db.salesOrder.findUnique({
    where: { id: so.id },
    include: {
      lines: { include: { item: { select: { id: true, itemName: true, itemType: true, unit: true } } } },
      dispatch: true,
    },
  });
  if (!fullSo) return { eligible: false, reason: "NO_SALES_ORDER" };

  const computeStats = deps.computeSalesOrderDispatchLineStats || computeSalesOrderDispatchLineStats;
  const { dispatchSummary } = computeStats(fullSo.lines || [], fullSo.dispatch || [], fullSo.orderType);
  if (dispatchSummary.fullyDispatched) {
    return { eligible: false, reason: "FULLY_DISPATCHED" };
  }

  const computeFgGap = deps.computeFgGapLinesForSalesOrder || computeFgGapLinesForSalesOrder;
  const { fgLines } = await computeFgGap(fullSo, db);
  const hasProductionNeed = fgLines.some(
    (f) => !f.note && Number(f.rmPlanningQty ?? f.toProduce ?? f.plannedProductionQty ?? 0) > QUEUE_EPS,
  );
  if (!hasProductionNeed) {
    return { eligible: false, reason: "NO_PRODUCTION_NEED" };
  }

  return { eligible: true, reason: null };
}

async function loadProcuredSoPlanningMrs(db, filters, deps = {}) {
  if (filters.workOrderId) return [];
  const where = {
    sourceType: { in: regularSoProcurementSourceTypes() },
    status: { in: PROCURED_MR_STATUSES },
    salesOrderId: { not: null },
    salesOrder: {
      orderType: "NORMAL",
      internalStatus: { notIn: POST_GRN_INELIGIBLE_SO_STATUSES },
    },
  };
  if (filters.materialRequirementId) where.id = filters.materialRequirementId;
  if (filters.salesOrderId) where.salesOrderId = filters.salesOrderId;

  const rows = await db.materialRequirement.findMany({
    where,
    orderBy: { id: "desc" },
    take: 100,
    include: SO_PLANNING_MR_INCLUDE,
  });

  const out = [];
  for (const mr of rows) {
    const assessment = await assessPostGrnCreateWoEligibility(db, mr, deps);
    if (assessment.eligible) out.push(mr);
  }
  return out;
}

const SO_PLANNING_SHORTAGE_INCLUDE = {
  customer: true,
  lines: { include: { item: { select: { id: true, itemName: true, itemType: true, unit: true } } } },
};

function salesOrderHasFgLines(so) {
  return (so?.lines ?? []).some((l) => l.item?.itemType === "FG");
}

async function loadCandidateSoPlanningShortageSalesOrders(db, filters, existingMrSalesOrderIds = new Set(), deps = {}) {
  if (filters.workOrderId || filters.materialRequirementId) return [];

  const buildPlanningView = deps.buildRegularSoPlanningSnapshotView || buildRegularSoPlanningSnapshotView;
  const computeFgGap = deps.computeFgGapLinesForSalesOrder || computeFgGapLinesForSalesOrder;
  const evaluateReadiness = deps.evaluateWoPrepareReadiness || evaluateWoPrepareReadiness;

  if (filters.salesOrderId) {
    if (existingMrSalesOrderIds.has(filters.salesOrderId)) return [];
    return db.salesOrder.findMany({
      where: { id: filters.salesOrderId },
      take: 1,
      include: SO_PLANNING_SHORTAGE_INCLUDE,
    });
  }

  const rows = await db.salesOrder.findMany({
    where: {
      orderType: "NORMAL",
      internalStatus: { notIn: ["DRAFT", "CLOSED", "MANUALLY_CLOSED", "COMPLETED"] },
      workOrders: { none: { status: { not: "REJECTED" } } },
      ...(existingMrSalesOrderIds.size ? { id: { notIn: [...existingMrSalesOrderIds] } } : {}),
    },
    include: SO_PLANNING_SHORTAGE_INCLUDE,
    orderBy: { id: "desc" },
    take: 40,
  });

  const out = [];
  for (const so of rows) {
    if (!salesOrderHasFgLines(so)) continue;
    if (existingMrSalesOrderIds.has(so.id)) continue;
    try {
      const { fgLines } = await computeFgGap(so, db);
      const readiness = await evaluateReadiness(
        so.id,
        { fgLines, planQtyByLineId: {}, planQtyByFgItemId: {} },
        db,
      );
      const pending = readiness.pendingMaterialRequirements || [];
      const shortageRmCount = readiness.materialReadiness?.shortageRmCount ?? readiness.totalShortageLines ?? 0;
      if (shortageRmCount > 0 && pending.length === 0) {
        out.push(so);
      }
    } catch {
      // Skip SOs that fail planning initialization.
    }
  }
  return out;
}

async function loadItemsById(db, itemIds) {
  const ids = [...new Set(itemIds.filter((id) => Number.isFinite(Number(id)) && Number(id) > 0))];
  if (!ids.length) return new Map();
  const rows = await db.item.findMany({
    where: { id: { in: ids } },
    select: { id: true, itemName: true, unit: true, itemType: true },
  });
  return new Map((rows || []).map((row) => [row.id, row]));
}

async function loadPmrStatusByWorkOrder(db, workOrderIds) {
  const ids = [...new Set(workOrderIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await db.productionMaterialRequest.findMany({
    where: { workOrderId: { in: ids }, status: { not: "CANCELLED" } },
    include: { lines: { include: { item: { select: { id: true, itemName: true, unit: true } } } } },
    orderBy: { id: "desc" },
  });
  const out = new Map();
  for (const pmr of rows || []) {
    const bucket = out.get(pmr.workOrderId) || { openPmrs: [], latestStatus: null };
    bucket.openPmrs.push({
      id: pmr.id,
      docNo: pmr.docNo,
      status: pmr.status,
      requestedAt: pmr.requestedAt,
      totalRequiredQty: round3((pmr.lines || []).reduce((sum, l) => sum + n(l.requiredQty), 0)),
      totalIssuedQty: round3((pmr.lines || []).reduce((sum, l) => sum + n(l.issuedQty), 0)),
      lines: (pmr.lines || []).map((l) => ({
        rmItemId: l.itemId,
        rmItemName: l.item?.itemName ?? "",
        requiredQty: n(l.requiredQty),
        issuedQty: n(l.issuedQty),
        pendingQty: Math.max(0, n(l.requiredQty) - n(l.issuedQty)),
      })),
    });
    bucket.latestStatus = bucket.latestStatus || pmr.status;
    out.set(pmr.workOrderId, bucket);
  }
  return out;
}

function receivedQtyForPoLine(line) {
  return (line.grnLines || []).reduce((sum, gl) => {
    if (gl.grn?.reversedAt) return sum;
    return sum + n(gl.receivedQty);
  }, 0);
}

async function buildSupplyPanel(db, rmItemId) {
  if (!rmItemId) {
    return { rmItemId: null, openMrLines: [], prLines: [], poLines: [], summary: emptySupplySummary() };
  }

  const [mrLines, poLines] = await Promise.all([
    db.materialRequirementLine.findMany({
      where: { rmItemId, materialRequirement: { status: { in: OPEN_MR_STATUSES } } },
      include: {
        rmItem: { select: { id: true, itemName: true, unit: true } },
        materialRequirement: {
          include: {
            salesOrder: { select: { id: true, docNo: true } },
            workOrder: { select: { id: true, docNo: true } },
            quotation: { select: { id: true, quotationNo: true } },
          },
        },
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
      orderBy: { id: "desc" },
      take: 80,
    }),
    db.rmPurchaseOrderLine.findMany({
      where: { itemId: rmItemId, rmPo: { status: { in: OPEN_PO_STATUSES } } },
      include: {
        item: { select: { id: true, itemName: true, unit: true } },
        rmPo: { include: { supplier: { select: { id: true, name: true } } } },
        grnLines: { include: { grn: { select: { id: true, date: true, reversedAt: true } } } },
        procurementLinks: {
          include: {
            purchaseRequestLine: { include: { purchaseRequest: { select: { id: true, docNo: true, status: true } } } },
          },
        },
      },
      orderBy: { id: "desc" },
      take: 80,
    }),
  ]);

  const prById = new Map();
  const openMrLines = (mrLines || []).map((line) => {
    for (const lk of line.purchaseRequestSourceLinks || []) {
      const prLine = lk.purchaseRequestLine;
      const pr = prLine?.purchaseRequest;
      if (!prLine || !pr) continue;
      prById.set(prLine.id, {
        purchaseRequestLineId: prLine.id,
        purchaseRequestId: pr.id,
        purchaseRequestDocNo: pr.docNo,
        status: pr.status,
        requiredQty: n(prLine.requiredQty),
        netRequiredQty: n(prLine.netRequiredQty),
        orderedQty: n(prLine.orderedQty),
        pendingPoQty: Math.max(0, n(prLine.netRequiredQty) - n(prLine.orderedQty)),
      });
    }
    return {
      materialRequirementLineId: line.id,
      materialRequirementId: line.materialRequirementId,
      materialRequirementDocNo: line.materialRequirement?.docNo ?? null,
      sourceType: line.materialRequirement?.sourceType ?? null,
      salesOrderId: line.materialRequirement?.salesOrderId ?? null,
      salesOrderNo: line.materialRequirement?.salesOrder?.docNo ?? null,
      workOrderId: line.materialRequirement?.workOrder?.id ?? null,
      workOrderNo: line.materialRequirement?.workOrder?.docNo ?? null,
      requiredQty: n(line.requiredQty),
      shortageQty: n(line.shortageQty),
      procuredQty: n(line.procuredQty),
      status: line.materialRequirement?.status ?? null,
      procurementStatusLabel: line.purchaseRequestSourceLinks?.length ? "PR/PO in progress" : "RM Requisition pending PR",
    };
  });

  const mappedPoLines = (poLines || []).map((line) => {
    const orderedQty = n(line.qty);
    const receivedQty = receivedQtyForPoLine(line);
    const pendingGrnQty = Math.max(0, orderedQty - receivedQty);
    return {
      rmPoLineId: line.id,
      purchaseOrderId: line.rmPoId,
      purchaseOrderNo: docNoOrId("RMPO", line.rmPo),
      supplierName: line.rmPo?.supplier?.name ?? null,
      orderedQty,
      receivedGrnQty: round3(receivedQty),
      pendingGrnQty: round3(pendingGrnQty),
      expectedDate: null,
      status: line.rmPo?.status ?? null,
      procurementStatusLabel: pendingGrnQty > QUEUE_EPS ? "PO created, GRN pending" : "Received",
      purchaseRequestRefs: (line.procurementLinks || [])
        .map((lk) => lk.purchaseRequestLine?.purchaseRequest)
        .filter(Boolean)
        .map((pr) => ({ id: pr.id, docNo: pr.docNo, status: pr.status })),
    };
  });

  const prLines = [...prById.values()];
  const summary = {
    openMrCount: openMrLines.length,
    prLineCount: prLines.length,
    poLineCount: mappedPoLines.length,
    pendingGrnQty: round3(mappedPoLines.reduce((sum, l) => sum + l.pendingGrnQty, 0)),
    receivedGrnQty: round3(mappedPoLines.reduce((sum, l) => sum + l.receivedGrnQty, 0)),
  };

  return { rmItemId, openMrLines, prLines, poLines: mappedPoLines, summary };
}

function emptySupplySummary() {
  return {
    openMrCount: 0,
    prLineCount: 0,
    poLineCount: 0,
    pendingGrnQty: 0,
    receivedGrnQty: 0,
    procurementCompletedForCase: false,
    completedMrCount: 0,
  };
}

const MPRS_MR_INCLUDE = {
  lines: {
    include: {
      rmItem: { select: { id: true, itemName: true, unit: true } },
      purchaseRequestSourceLinks: {
        include: {
          purchaseRequestLine: {
            include: { purchaseRequest: { select: { id: true, docNo: true, status: true } } },
          },
        },
      },
    },
  },
  monthlyProductionPlan: true,
  salesOrder: { select: { id: true, docNo: true } },
  workOrder: { select: { id: true, docNo: true } },
};

function mergeUniqueRows(existingRows, extraRows, keyFn) {
  const map = new Map();
  for (const row of [...(existingRows || []), ...(extraRows || [])]) {
    map.set(keyFn(row), row);
  }
  return [...map.values()];
}

function mapPoLineForSupply(line) {
  const orderedQty = n(line.qty);
  const receivedQty = receivedQtyForPoLine(line);
  const pendingGrnQty = Math.max(0, orderedQty - receivedQty);
  const grnRefs = [];
  for (const gl of line.grnLines || []) {
    if (gl.grn?.reversedAt) continue;
    grnRefs.push({
      id: gl.grnId ?? gl.grn?.id ?? null,
      displayNo: gl.grnId ? `GRN-${gl.grnId}` : null,
      receivedQty: n(gl.receivedQty),
    });
  }
  return {
    rmPoLineId: line.id,
    purchaseOrderId: line.rmPoId,
    purchaseOrderNo: docNoOrId("RMPO", line.rmPo),
    supplierName: line.rmPo?.supplier?.name ?? null,
    orderedQty,
    receivedGrnQty: round3(receivedQty),
    pendingGrnQty: round3(pendingGrnQty),
    expectedDate: null,
    status: line.rmPo?.status ?? null,
    procurementStatusLabel: pendingGrnQty > QUEUE_EPS ? "PO created, GRN pending" : "Received",
    purchaseRequestRefs: (line.procurementLinks || [])
      .map((lk) => lk.purchaseRequestLine?.purchaseRequest)
      .filter(Boolean)
      .map((pr) => ({ id: pr.id, docNo: pr.docNo, status: pr.status })),
    grnRefs,
  };
}

function collectPrLinesFromMr(mr, rmItemIds) {
  const prById = new Map();
  const rmSet = new Set(rmItemIds || []);
  for (const line of mr?.lines || []) {
    if (rmSet.size && !rmSet.has(line.rmItemId)) continue;
    for (const lk of line.purchaseRequestSourceLinks || []) {
      const prLine = lk.purchaseRequestLine;
      const pr = prLine?.purchaseRequest;
      if (!prLine || !pr) continue;
      prById.set(prLine.id, {
        purchaseRequestLineId: prLine.id,
        purchaseRequestId: pr.id,
        purchaseRequestDocNo: pr.docNo,
        status: pr.status,
        requiredQty: n(prLine.requiredQty),
        netRequiredQty: n(prLine.netRequiredQty),
        orderedQty: n(prLine.orderedQty),
        pendingPoQty: Math.max(0, n(prLine.netRequiredQty) - n(prLine.orderedQty)),
      });
    }
  }
  return [...prById.values()];
}

function buildProcurementChainFromSupply({ boundMr, prLines, poLines }) {
  const prDocNos = [...new Set((prLines || []).map((p) => p.purchaseRequestDocNo).filter(Boolean))];
  const poDocNos = [...new Set((poLines || []).map((p) => p.purchaseOrderNo).filter(Boolean))];
  const grnDocNos = [
    ...new Set((poLines || []).flatMap((p) => (p.grnRefs || []).map((g) => g.displayNo).filter(Boolean))),
  ];
  return {
    mrDocNo: boundMr?.docNo ?? null,
    mrId: boundMr?.id ?? null,
    prDocNos,
    poDocNos,
    grnDocNos,
  };
}

function summarizeMergedCaseSupply({ prLines, poLines, boundMr, openMrCount }) {
  const pendingGrnQty = round3((poLines || []).reduce((sum, l) => sum + n(l.pendingGrnQty), 0));
  const receivedGrnQty = round3((poLines || []).reduce((sum, l) => sum + n(l.receivedGrnQty), 0));
  const procurementCompletedForCase = Boolean(
    isProcuredMaterialRequirement(boundMr) && pendingGrnQty <= QUEUE_EPS && receivedGrnQty > QUEUE_EPS,
  );
  return {
    openMrCount,
    prLineCount: (prLines || []).length,
    poLineCount: (poLines || []).length,
    pendingGrnQty,
    receivedGrnQty,
    procurementCompletedForCase,
    completedMrCount: isProcuredMaterialRequirement(boundMr) ? 1 : 0,
    completedMrDocNo: boundMr?.docNo ?? null,
    completedMrId: boundMr?.id ?? null,
  };
}

async function loadCompletedPoLinesForRmItems(db, rmItemIds) {
  if (!rmItemIds?.length) return [];
  const poLines = await db.rmPurchaseOrderLine.findMany({
    where: { itemId: { in: rmItemIds }, rmPo: { status: { in: CASE_SUPPLY_PO_STATUSES } } },
    include: {
      item: { select: { id: true, itemName: true, unit: true } },
      rmPo: { include: { supplier: { select: { id: true, name: true } } } },
      grnLines: { include: { grn: { select: { id: true, date: true, reversedAt: true } } } },
      procurementLinks: {
        include: {
          purchaseRequestLine: { include: { purchaseRequest: { select: { id: true, docNo: true, status: true } } } },
        },
      },
    },
    orderBy: { id: "desc" },
    take: 80,
  });
  return (poLines || []).map(mapPoLineForSupply);
}

async function loadMprsProcurementMrByWorkOrder(db, entries) {
  const rmItemIds = [...new Set((entries || []).flatMap((e) => e.rmItemIds || []))];
  if (!rmItemIds.length) return new Map();

  const mrs = await db.materialRequirement.findMany({
    where: {
      sourceType: "MONTHLY_PLAN",
      status: { in: MPRS_WO_PROCUREMENT_MR_STATUSES },
      lines: { some: { rmItemId: { in: rmItemIds } } },
    },
    include: MPRS_MR_INCLUDE,
    orderBy: { id: "desc" },
    take: 40,
  });

  const candidates = (mrs || []).map((mr) => {
    const matchedRmIds = new Set(
      (mr.lines || []).map((l) => l.rmItemId).filter((id) => rmItemIds.includes(id)),
    );
    const hasPr = (mr.lines || []).some((l) => (l.purchaseRequestSourceLinks || []).length > 0);
    return { mr, matchedRmIds, hasPr };
  });

  const out = new Map();
  for (const entry of entries || []) {
    const woRmSet = new Set(entry.rmItemIds || []);
    let best = null;
    let bestScore = -1;
    for (const cand of candidates) {
      let overlap = 0;
      for (const id of woRmSet) {
        if (cand.matchedRmIds.has(id)) overlap += 1;
      }
      if (overlap === 0) continue;
      let score = overlap;
      if (isProcuredMaterialRequirement(cand.mr)) score += 100;
      if (cand.hasPr) score += 50;
      if (score > bestScore) {
        bestScore = score;
        best = cand.mr;
      }
    }
    if (best) out.set(entry.woId, best);
  }
  return out;
}

function filterPoLinesForBoundMr(poLines, boundMr, rmItemIds) {
  if (!boundMr?.lines?.length) return poLines || [];
  const prIds = new Set();
  const rmSet = new Set(rmItemIds || []);
  for (const line of boundMr.lines || []) {
    if (rmSet.size && !rmSet.has(line.rmItemId)) continue;
    for (const lk of line.purchaseRequestSourceLinks || []) {
      const pr = lk.purchaseRequestLine?.purchaseRequest;
      if (pr?.id) prIds.add(pr.id);
    }
  }
  if (!prIds.size) return poLines || [];
  return (poLines || []).filter((pl) =>
    (pl.purchaseRequestRefs || []).some((pr) => pr?.id && prIds.has(pr.id)),
  );
}

async function buildCompletedProcurementSupply(db, rmItemIds, boundMr = null) {
  if (!rmItemIds?.length && !boundMr) {
    return { prLines: [], poLines: [], boundMr: null, procurementChain: null, summary: emptySupplySummary() };
  }
  const allPoLines = await loadCompletedPoLinesForRmItems(db, rmItemIds);
  const poLines = filterPoLinesForBoundMr(allPoLines, boundMr, rmItemIds);
  const prLines = boundMr ? collectPrLinesFromMr(boundMr, rmItemIds) : [];
  const procurementChain = buildProcurementChainFromSupply({ boundMr, prLines, poLines });
  const summary = summarizeMergedCaseSupply({
    prLines,
    poLines,
    boundMr,
    openMrCount: boundMr ? (boundMr.lines || []).filter((l) => rmItemIds.includes(l.rmItemId)).length : 0,
  });
  return { prLines, poLines, boundMr, procurementChain, summary };
}

function enrichQueueRowFromCaseSupply(row, { woMr, caseSupply, pmrStatus }) {
  const summary = caseSupply?.summary || emptySupplySummary();
  const boundMr = resolveActiveWoMr(woMr);
  if (boundMr?.id) {
    row.materialRequirementId = boundMr.id;
    row.requisitionDocNo = boundMr.docNo ?? row.requisitionDocNo;
    row.requisitionStatus = boundMr.status ?? row.requisitionStatus;
    row.sourceType = boundMr.sourceType ?? row.sourceType;
  }
  row.prLineCount = summary.prLineCount ?? row.prLineCount;
  row.poLineCount = summary.poLineCount ?? row.poLineCount;
  row.pendingGrnQty = summary.pendingGrnQty ?? row.pendingGrnQty;
  row.receivedGrnQty = summary.receivedGrnQty ?? row.receivedGrnQty;
  row.procurementCompletedForCase = Boolean(summary.procurementCompletedForCase);
  row.mrStatus = boundMr?.status ?? row.requisitionStatus ?? null;

  if (summary.procurementCompletedForCase) {
    row.operationalKey = "PROCUREMENT_COMPLETED";
    row.nextActionKey = hasFullyIssuedPmr(pmrStatus) ? "HANDOFF_TO_PRODUCTION" : row.nextActionKey;
    if (hasFullyIssuedPmr(pmrStatus)) {
      row.queueType = "READY_TO_RELEASE_WO";
      row.recommendedAction = "Start production";
      row.nextAction = "Start production";
    } else if (row.queueType === "WO_BLOCKED_RM_SHORTAGE" || row.queueType === "WO_PARTIALLY_COVERED") {
      const issueable =
        (pmrStatus?.openPmrs || []).some((p) => PMR_WAITING_ISSUE_STATUSES.includes(p.status)) &&
        n(row.freeStockQty) > QUEUE_EPS;
      if (issueable) {
        row.queueType = "PMR_WAITING_ISSUE";
        row.recommendedAction = "Issue material to production";
        row.nextAction = "Issue material to production";
      }
    }
  }
  return row;
}

async function loadSoProcurementMrByWorkOrder(db, workOrderIds) {
  const ids = [...new Set(workOrderIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const workOrders = await db.workOrder.findMany({
    where: { id: { in: ids } },
    select: { id: true, salesOrderId: true },
  });
  const soIds = [...new Set(workOrders.map((wo) => wo.salesOrderId).filter(Boolean))];
  if (!soIds.length) return new Map();
  const rows = await db.materialRequirement.findMany({
    where: {
      salesOrderId: { in: soIds },
      sourceType: { in: regularSoProcurementSourceTypes() },
      status: { in: OPEN_MR_STATUSES },
    },
    include: {
      lines: {
        include: { rmItem: { select: { id: true, itemName: true, unit: true } } },
      },
      salesOrder: { select: { id: true, docNo: true } },
      monthlyProductionPlan: true,
      workOrder: { select: { id: true, docNo: true } },
    },
    orderBy: { id: "desc" },
  });
  const mrBySalesOrder = new Map();
  for (const mr of rows || []) {
    if (!mrBySalesOrder.has(mr.salesOrderId)) mrBySalesOrder.set(mr.salesOrderId, mr);
  }
  const out = new Map();
  for (const wo of workOrders) {
    const mr = mrBySalesOrder.get(wo.salesOrderId);
    if (mr) out.set(wo.id, mr);
  }
  return out;
}

async function loadTerminalSoProcurementMrByWorkOrder(db, workOrderIds) {
  const ids = [...new Set(workOrderIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const workOrders = await db.workOrder.findMany({
    where: { id: { in: ids } },
    select: { id: true, salesOrderId: true },
  });
  const soIds = [...new Set(workOrders.map((wo) => wo.salesOrderId).filter(Boolean))];
  if (!soIds.length) return new Map();
  const rows = await db.materialRequirement.findMany({
    where: {
      salesOrderId: { in: soIds },
      sourceType: { in: regularSoProcurementSourceTypes() },
      status: { in: ["CLOSED", "CANCELLED"] },
    },
    select: { id: true, docNo: true, status: true, salesOrderId: true, workOrderId: true, closedAt: true },
    orderBy: { id: "desc" },
  });
  const terminalBySo = new Map();
  for (const mr of rows || []) {
    if (!terminalBySo.has(mr.salesOrderId)) terminalBySo.set(mr.salesOrderId, mr);
  }
  const out = new Map();
  for (const wo of workOrders) {
    const mr = terminalBySo.get(wo.salesOrderId);
    if (mr) out.set(wo.id, mr);
  }
  return out;
}

async function loadTerminalSoPlanningMrBySalesOrder(db, salesOrderIds) {
  const ids = [...new Set(salesOrderIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await db.materialRequirement.findMany({
    where: {
      salesOrderId: { in: ids },
      sourceType: { in: regularSoProcurementSourceTypes() },
      status: { in: ["CLOSED", "CANCELLED"] },
    },
    select: { id: true, docNo: true, status: true, salesOrderId: true, closedAt: true },
    orderBy: { id: "desc" },
  });
  const out = new Map();
  for (const mr of rows || []) {
    if (!out.has(mr.salesOrderId)) out.set(mr.salesOrderId, mr);
  }
  return out;
}

function mapTerminalMrHeader(mr) {
  if (!mr) return null;
  return {
    id: mr.id,
    docNo: mr.docNo ?? null,
    status: mr.status,
    closedAt: mr.closedAt ?? null,
  };
}

function caseHasUnresolvedShortage(rmLines, shortageSummary) {
  if (shortageSummary?.blockedLineCount > 0 || n(shortageSummary?.totalNetShortQty) > QUEUE_EPS) {
    return true;
  }
  return (rmLines || []).some(
    (l) => n(l.netShortageAfterIncomingQty) > QUEUE_EPS || n(l.shortageAfterReservationQty) > QUEUE_EPS,
  );
}

function mapWoMrHeader(mr) {
  if (!mr) return null;
  const lines = mr.lines || [];
  return {
    id: mr.id,
    docNo: mr.docNo,
    status: mr.status,
    sourceType: mr.sourceType,
    workOrderId: mr.workOrderId,
    procurementSourceLabel: mrProcurementSourceLabel(mr),
    lineCount: lines.length,
    totalShortageQty: round3(lines.reduce((sum, ln) => sum + n(ln.shortageQty), 0)),
    lines: lines.map((ln) => ({
      id: ln.id,
      rmItemId: ln.rmItemId,
      rmItemName: ln.rmItem?.itemName ?? "",
      unit: ln.unitSnapshot || ln.rmItem?.unit || "",
      requiredQty: n(ln.requiredQty),
      shortageQty: n(ln.shortageQty),
      procuredQty: n(ln.procuredQty),
    })),
  };
}

function fgNameForSalesOrder(so) {
  return [
    ...new Set(
      (so?.lines || [])
        .filter((line) => line.item?.itemType === "FG")
        .map((line) => line.item?.itemName)
        .filter(Boolean),
    ),
  ].join(", ");
}

function virtualWoForSoPlanningMr(mr) {
  return {
    id: null,
    docNo: null,
    status: "WO_NOT_CREATED",
    holdReason: null,
    salesOrderId: mr.salesOrderId,
    salesOrder: mr.salesOrder,
    lines: [],
  };
}

function mapWoMrToOpenMrLines(mr, wo) {
  if (!mr) return [];
  return (mr.lines || []).map((line) => ({
    materialRequirementLineId: line.id,
    materialRequirementId: mr.id,
    materialRequirementDocNo: mr.docNo,
    sourceType: mr.sourceType,
    salesOrderId: wo.salesOrderId ?? null,
    salesOrderNo: wo.salesOrder?.docNo ?? null,
    workOrderId: wo.id,
    workOrderNo: wo.docNo ?? null,
    requiredQty: n(line.requiredQty),
    shortageQty: n(line.shortageQty),
    procuredQty: n(line.procuredQty),
    status: mr.status,
    procurementStatusLabel: n(line.procuredQty) > QUEUE_EPS ? "Partially procured" : "RM Requisition pending PR",
  }));
}

function mergeSupplyPanels(panels) {
  const prById = new Map();
  const poById = new Map();
  const mrLineById = new Map();
  for (const panel of panels) {
    for (const pr of panel.prLines || []) prById.set(pr.purchaseRequestLineId, pr);
    for (const po of panel.poLines || []) poById.set(po.rmPoLineId, po);
    for (const ml of panel.openMrLines || []) mrLineById.set(ml.materialRequirementLineId, ml);
  }
  const poLines = [...poById.values()];
  const prLines = [...prById.values()];
  const openMrLines = [...mrLineById.values()];
  return {
    openMrLines,
    prLines,
    poLines,
    summary: {
      openMrCount: openMrLines.length,
      prLineCount: prLines.length,
      poLineCount: poLines.length,
      pendingGrnQty: round3(poLines.reduce((sum, l) => sum + l.pendingGrnQty, 0)),
      receivedGrnQty: round3(poLines.reduce((sum, l) => sum + l.receivedGrnQty, 0)),
    },
  };
}

async function buildWoCaseSupplyPanel(db, workOrderId, rmItemIds, woMr, wo) {
  const panels = await Promise.all(rmItemIds.map((rmItemId) => buildSupplyPanel(db, rmItemId)));
  const merged = mergeSupplyPanels(panels);
  const boundMr = resolveActiveWoMr(woMr);
  const completed = await buildCompletedProcurementSupply(db, rmItemIds, boundMr);
  const prLines = mergeUniqueRows(merged.prLines, completed.prLines, (r) => r.purchaseRequestLineId);
  const poLines = mergeUniqueRows(merged.poLines, completed.poLines, (r) => r.rmPoLineId);
  const woMrLines = mapWoMrToOpenMrLines(boundMr, wo);
  const openMrLines = woMrLines.length
    ? woMrLines
    : merged.openMrLines.filter((ln) =>
        workOrderId != null
          ? ln.workOrderId === workOrderId ||
            (ln.sourceType === "MONTHLY_PLAN" && (ln.workOrderId == null || ln.workOrderId === workOrderId))
          : ln.materialRequirementId === boundMr?.id,
      );
  const panelMrId =
    boundMr?.id ??
    openMrLines.find((ln) => ln.sourceType === "MONTHLY_PLAN")?.materialRequirementId ??
    openMrLines[0]?.materialRequirementId ??
    null;
  const summary = summarizeMergedCaseSupply({
    prLines,
    poLines,
    boundMr,
    openMrCount: openMrLines.length,
  });
  const procurementChain =
    completed.procurementChain ??
    buildProcurementChainFromSupply({ boundMr, prLines, poLines });
  return {
    workOrderId,
    materialRequirementId: panelMrId,
    rmItemId: null,
    openMrLines,
    prLines,
    poLines,
    procurementChain,
    boundMaterialRequirement: boundMr ? mapWoMrHeader(boundMr) : null,
    summary,
  };
}

function pmrPendingQtyForRm(pmrStatus, rmItemId) {
  for (const pmr of pmrStatus?.openPmrs || []) {
    const ln = (pmr.lines || []).find((l) => l.rmItemId === rmItemId);
    if (ln && ln.pendingQty > QUEUE_EPS) return ln.pendingQty;
  }
  return 0;
}

function summarizeRmLinesForCase(rmLines) {
  const blockedLineCount = rmLines.filter((l) => l.netShortageAfterIncomingQty > QUEUE_EPS).length;
  const shortLineCount = rmLines.filter((l) => l.shortageAfterReservationQty > QUEUE_EPS).length;
  const issueableLineCount = rmLines.filter((l) => l.freeStockQty > QUEUE_EPS).length;
  return {
    rmLineCount: rmLines.length,
    blockedLineCount,
    shortLineCount,
    issueableLineCount,
    totalRequiredQty: round3(rmLines.reduce((sum, l) => sum + l.requiredQty, 0)),
    totalNetShortQty: round3(rmLines.reduce((sum, l) => sum + l.netShortageAfterIncomingQty, 0)),
    totalShortAfterReservationQty: round3(rmLines.reduce((sum, l) => sum + l.shortageAfterReservationQty, 0)),
  };
}

/** RM lines still short on the WO but not yet on the open WO shortage MR. */
function rmLinesNotOnWoMr(rmLines, woMr) {
  const onCase = new Set((woMr?.lines || []).map((ln) => ln.rmItemId ?? ln.rmItem?.id));
  return rmLines.filter(
    (l) =>
      (l.netShortageAfterIncomingQty > QUEUE_EPS || l.shortageAfterReservationQty > QUEUE_EPS) &&
      !onCase.has(l.rmItemId),
  );
}

function woMrCaseLinesFullyProcured(woMr, caseSupply) {
  const lines = woMr?.lines?.length
    ? woMr.lines
    : (caseSupply?.openMrLines || []).filter((ln) => regularSoProcurementSourceTypes().includes(ln.sourceType));
  if (!lines.length) return false;
  return lines.every((ln) => {
    const shortage = n(ln.shortageQty ?? ln.requiredQty);
    if (shortage <= QUEUE_EPS) return true;
    return n(ln.procuredQty) + QUEUE_EPS >= shortage;
  });
}

/**
 * WO-level procurement escalation lifecycle (derived from MR / PR / PO / GRN only).
 * Does not alter shortage or procurement quantities.
 */
function deriveWoEscalationLifecycle({ woMr, caseSupply, rmLines }) {
  const activeWoMr = resolveActiveWoMr(woMr);
  const summary = caseSupply?.summary || emptySupplySummary();
  const openMrLines = caseSupply?.openMrLines || [];
  const pendingGrn = n(summary.pendingGrnQty);
  const prCount = summary.prLineCount ?? 0;
  const poCount = summary.poLineCount ?? 0;
  const receivedGrn = n(summary.receivedGrnQty);
  const mrHeader = activeWoMr
    ? mapWoMrHeader(activeWoMr)
    : caseSupply?.boundMaterialRequirement ??
      (openMrLines[0]
        ? {
            docNo: openMrLines[0].materialRequirementDocNo ?? null,
            lineCount: openMrLines.length,
          }
        : null);
  const additionalRmLines = rmLinesNotOnWoMr(rmLines, activeWoMr);
  const additionalRmLineCount = additionalRmLines.length;
  const mrLineCountOnCase = mrHeader?.lineCount ?? openMrLines.length ?? 0;
  const procurementInitiated = Boolean(
    activeWoMr ||
      summary.procurementCompletedForCase ||
      openMrLines.length > 0 ||
      prCount > 0 ||
      poCount > 0 ||
      receivedGrn > QUEUE_EPS ||
      mrHeader,
  );

  const base = {
    procurementInitiated,
    additionalRmLineCount,
    mrLineCountOnCase,
    materialRequirementDocNo: mrHeader?.docNo ?? null,
  };

  if (!procurementInitiated) {
    return {
      ...base,
      state: "NOT_ESCALATED",
      label: "Escalation not started",
      headline: "WO shortage not escalated to purchase",
      description: "Store can raise one RM Requisition for this work order.",
    };
  }

  if (pendingGrn > QUEUE_EPS) {
    return {
      ...base,
      state: "WAITING_GRN",
      label: "Waiting for GRN",
      headline: "WO requisition under procurement — waiting GRN",
      description: `Purchase/GRN is active. Pending GRN qty ${round3(pendingGrn)} — not yet available for Store issue.`,
    };
  }

  if (
    summary.procurementCompletedForCase ||
    (isProcuredMaterialRequirement(activeWoMr) && receivedGrn > QUEUE_EPS && pendingGrn <= QUEUE_EPS)
  ) {
    const awaitingWo = isProcuredMaterialRequirement(activeWoMr) && !activeWoMr?.workOrderId;
    return {
      ...base,
      state: "PROCUREMENT_COMPLETED",
      label: awaitingWo ? "RM received in Store" : "RM ready in Store",
      headline: awaitingWo ? "RM received in Store" : "RM ready in Store",
      description: awaitingWo
        ? "GRN complete — create Work Order in Prepare WO before material issue."
        : "Procurement and GRN are complete for this case. Store must issue RM to Production before production can start.",
    };
  }

  if (
    (prCount > 0 || poCount > 0 || isProcuredMaterialRequirement(activeWoMr)) &&
    woMrCaseLinesFullyProcured(activeWoMr, caseSupply) &&
    pendingGrn <= QUEUE_EPS
  ) {
    const awaitingWo = isProcuredMaterialRequirement(activeWoMr) && !activeWoMr.workOrderId;
    return {
      ...base,
      state: "PROCUREMENT_COMPLETED",
      label: awaitingWo ? "RM received in Store" : "RM ready in Store",
      headline: awaitingWo ? "RM received in Store" : "RM ready in Store",
      description: awaitingWo
        ? "GRN complete — create Work Order in Prepare WO before material issue."
        : "Procurement and GRN are complete for this case. Store must issue RM to Production before production can start.",
    };
  }

  if (prCount > 0 || poCount > 0) {
    return {
      ...base,
      state: "PROCUREMENT_IN_PROGRESS",
      label: "Purchase in progress",
      headline: "Purchase in progress for this WO requisition",
      description: "Continue PR / PO follow-up on the existing WO requisition — do not start a new case.",
    };
  }

  if (additionalRmLineCount > 0) {
    return {
      ...base,
      state: "PARTIALLY_ESCALATED",
      label: "Partially escalated",
      headline: "RM Requisition exists — additional shortage lines detected",
      description: `${mrLineCountOnCase} RM line(s) on case; ${additionalRmLineCount} more can be added to the same requisition.`,
    };
  }

  return {
    ...base,
    state: "ESCALATION_PENDING",
    label: "Store approval pending",
    headline: "RM Requisition pending Store approval",
    description: `WO RM Requisition ${mrHeader?.docNo || ""} is open — approve it before Purchase can act.`,
  };
}

function deriveCaseProcurementStatusLabel(escalation) {
  return escalation?.headline || escalation?.label || "Not escalated to purchase";
}

function deriveCaseIssueStatusLabel(pmrStatus, rmLines) {
  if (!hasWaitingPmr(pmrStatus)) return "No PMR waiting for issue";
  const waiting = (pmrStatus?.openPmrs || []).filter((p) => PMR_WAITING_ISSUE_STATUSES.includes(p.status));
  const docNos = waiting.map((p) => p.docNo).filter(Boolean);
  const issueable = rmLines.filter((l) => pmrPendingQtyForRm(pmrStatus, l.rmItemId) > QUEUE_EPS && l.freeStockQty > QUEUE_EPS).length;
  if (issueable > 0) return `${docNos.join(", ") || "PMR"} — ${issueable} RM line(s) ready to issue`;
  return `${docNos.join(", ") || "PMR"} — waiting for store issue`;
}

function deriveCaseStoreAction({ rmLines, pmrStatus, woMr, terminalMr, caseSupply, escalation, shortageSummary, workOrderId = null }) {
  const waitingPmr = hasWaitingPmr(pmrStatus);
  const anyIssueable =
    waitingPmr &&
    rmLines.some((line) => pmrPendingQtyForRm(pmrStatus, line.rmItemId) > QUEUE_EPS && line.freeStockQty > QUEUE_EPS);

  const activeWoMr = resolveActiveWoMr(woMr);
  const caseHasWorkOrder = Number(workOrderId) > 0;

  if (isProcuredMaterialRequirement(activeWoMr) && !activeWoMr.workOrderId && !caseHasWorkOrder) {
    return {
      key: "CREATE_WO",
      label: "Create Work Order",
      description: "RM received in Store after GRN. Create the work order to open PMR and material issue.",
    };
  }

  if (!activeWoMr && terminalMr && caseHasUnresolvedShortage(rmLines, shortageSummary)) {
    return {
      key: "REOPEN_REQUISITION",
      label: "Reopen / Raise New Requisition",
      description:
        "Previous requisition was closed. Creating a new requisition will restart procurement for the same shortage.",
    };
  }

  if (anyIssueable) {
    return {
      key: "ISSUE",
      label: "Issue RM to Production",
      description: "Transfer free store stock against the open PMR for this work order.",
    };
  }

  if (
    hasFullyIssuedPmr(pmrStatus) &&
    (escalation?.state === "PROCUREMENT_COMPLETED" || caseSupply?.summary?.procurementCompletedForCase)
  ) {
    return {
      key: "HANDOFF_TO_PRODUCTION",
      label: "RM issued — waiting for Production",
      description: "Store issue is complete. Production owns the next action on this work order.",
    };
  }

  const esc = escalation || deriveWoEscalationLifecycle({ woMr: activeWoMr, caseSupply, rmLines });

  if (esc.state === "WAITING_GRN") {
    return {
      key: "WAIT_GRN",
      label: "Waiting for GRN",
      description: esc.description,
    };
  }

  const summary = caseSupply?.summary || emptySupplySummary();
  const prCount = summary.prLineCount ?? 0;
  const poCount = summary.poLineCount ?? 0;
  const pendingGrn = n(summary.pendingGrnQty);

  if (waitingPmr && !anyIssueable) {
    if (pendingGrn > QUEUE_EPS || poCount > 0) {
      return {
        key: "WAIT_GRN",
        label: "Waiting for GRN",
        description: "Purchase order is active — record goods receipt when material arrives at Store.",
      };
    }
    if (prCount > 0) {
      return {
        key: "WAIT_PO",
        label: "Waiting for Purchase to prepare RM PO",
        description: "Purchase Request exists — waiting for Purchase to create and release the RM PO.",
      };
    }
  }

  if ((esc.state === "PROCUREMENT_COMPLETED" || caseHasStockReadyForIssue(rmLines, pmrStatus)) && anyIssueable) {
    if (!caseHasWorkOrder && !activeWoMr?.workOrderId && activeWoMr && isProcuredMaterialRequirement(activeWoMr)) {
      return {
        key: "CREATE_WO",
        label: "Create Work Order",
        description: "RM received in Store after GRN. Create the work order to open PMR and material issue.",
      };
    }
    return {
      key: "ISSUE",
      label: "Issue RM to Production",
      description:
        esc.state === "PROCUREMENT_COMPLETED"
          ? "RM is in Store after GRN — issue against the work order material request."
          : "Free store stock is available — issue RM to Production.",
    };
  }

  if (esc.state === "PROCUREMENT_IN_PROGRESS") {
    if (prCount > 0 && poCount === 0) {
      return {
        key: "WAIT_PO",
        label: "Waiting for Purchase to prepare RM PO",
        description: "Purchase Request exists — waiting for Purchase to create and release the RM PO.",
      };
    }
    return {
      key: "CONTINUE_PROCUREMENT",
      label: "Continue requisition",
      description: esc.description,
    };
  }

  if (esc.procurementInitiated) {
    const secondaryStoreAction =
      esc.additionalRmLineCount > 0
        ? {
            key: "ADD_CASE_LINES",
            label: "Add all shortage lines to existing case",
            description:
              "Adds all detectable RM shortage lines into the same WO RM Requisition.",
          }
        : null;
    return {
      key: "CONTINUE_PROCUREMENT",
      label: esc.state === "PARTIALLY_ESCALATED" ? "Continue requisition" : "View requisition status",
      description: esc.description,
      secondaryStoreAction,
    };
  }

  if (rmLines.some((l) => l.netShortageAfterIncomingQty > QUEUE_EPS || l.shortageAfterReservationQty > QUEUE_EPS)) {
    return {
      key: "ESCALATE",
      label: "Add all shortage lines to case",
      description:
        "Adds all detectable RM shortage lines into one WO RM Requisition for Store approval.",
    };
  }

  if (waitingPmr) {
    return {
      key: "REVIEW",
      label: "Waiting for RM in Store",
      description: "PMR is open — issue is available only after goods receipt and free store stock.",
    };
  }

  return {
    key: "REVIEW",
    label: "Review material blockers",
    description: "No immediate store action — review RM lines below.",
  };
}

function buildWoShortageCase({ wo, fgName, rmLines, pmrStatus, woMr, terminalMr, caseSupply }) {
  const activeWoMr = resolveActiveWoMr(woMr);
  const shortageSummary = summarizeRmLinesForCase(rmLines);
  const openPmrs = pmrStatus?.openPmrs || [];
  const escalationLifecycle = deriveWoEscalationLifecycle({ woMr: activeWoMr, caseSupply, rmLines });
  const allocationFirstStatus = deriveAllocationFirstWoStatus({ rmLines, pmrStatus });
  const storeAction = deriveCaseStoreAction({
    rmLines,
    pmrStatus,
    woMr: activeWoMr,
    terminalMr: mapTerminalMrHeader(terminalMr),
    caseSupply,
    escalation: escalationLifecycle,
    shortageSummary,
    workOrderId: wo.id,
  });
  const requiresReopenConfirm =
    !activeWoMr && Boolean(terminalMr) && caseHasUnresolvedShortage(rmLines, shortageSummary);
  return {
    workOrderId: wo.id,
    workOrderNo: wo.docNo ?? null,
    salesOrderId: wo.salesOrderId ?? null,
    salesOrderNo: wo.salesOrder?.docNo ?? null,
    customerName: customerNameForSalesOrder(wo.salesOrder),
    fgItemName: fgName,
    materialRequirement: mapWoMrHeader(activeWoMr) || caseSupply?.boundMaterialRequirement || null,
    terminalMaterialRequirement: mapTerminalMrHeader(terminalMr),
    requiresReopenConfirm,
    allocationFirstStatus,
    shortageSummary,
    pmrSummary: {
      openCount: openPmrs.length,
      waitingIssueCount: openPmrs.filter((p) => PMR_WAITING_ISSUE_STATUSES.includes(p.status)).length,
      latestDocNo: openPmrs[0]?.docNo ?? null,
    },
    escalationLifecycle,
    procurementStatusLabel: deriveCaseProcurementStatusLabel(escalationLifecycle),
    issueStatusLabel: deriveCaseIssueStatusLabel(pmrStatus, rmLines),
    nextStoreAction: storeAction,
    rmLines: rmLines.map((line) => ({
      rmItemId: line.rmItemId,
      rmItemName: line.rmItemName,
      unit: line.unit,
      requiredQty: line.requiredQty,
      freeStockQty: line.freeStockQty,
      shortageAfterReservationQty: line.shortageAfterReservationQty,
      netShortageAfterIncomingQty: line.netShortageAfterIncomingQty,
      blockerReason: line.blockerReason,
      recommendedAction: line.recommendedAction,
    })),
  };
}

function buildSoPlanningShortageCase({ mr, terminalMr, fgName, rmLines, caseSupply }) {
  const procuredAwaitingWo = isProcuredMaterialRequirement(mr) && !mr.workOrderId;
  const activeMr =
    isPurchaseVisibleMaterialRequirement(mr) || isProcuredMaterialRequirement(mr) ? mr : null;
  const shortageSummary = summarizeRmLinesForCase(rmLines);
  const escalationLifecycle = deriveWoEscalationLifecycle({
    woMr: activeMr,
    caseSupply,
    rmLines,
  });
  const requiresReopenConfirm =
    !activeMr && Boolean(terminalMr) && caseHasUnresolvedShortage(rmLines, shortageSummary);
  const noWoEscalation = procuredAwaitingWo
    ? {
        ...escalationLifecycle,
        label: "RM received in Store",
        headline: "RM received in Store",
        description: "Create Work Order in Prepare WO — material issue starts only after WO and PMR exist.",
      }
    : escalationLifecycle.state === "PROCUREMENT_COMPLETED"
      ? {
          ...escalationLifecycle,
          label: "Ready for WO creation",
          headline: "RM ready for Prepare WO",
          description: "Complete the Prepare WO step, then issue material after the work order exists.",
        }
      : escalationLifecycle;
  const allocationFirstStatus = deriveAllocationFirstWoStatus({
    rmLines,
    pmrStatus: { openPmrs: [], latestStatus: null },
    procuredAwaitingWo,
    hasWorkOrder: false,
  });
  return {
    workOrderId: null,
    workOrderNo: null,
    salesOrderId: mr.salesOrderId ?? null,
    salesOrderNo: mr.salesOrder?.docNo ?? null,
    customerName: customerNameForSalesOrder(mr.salesOrder),
    fgItemName: fgName,
    materialRequirement: mapWoMrHeader(activeMr),
    terminalMaterialRequirement: mapTerminalMrHeader(terminalMr),
    requiresReopenConfirm,
    allocationFirstStatus,
    shortageSummary,
    pmrSummary: { openCount: 0, waitingIssueCount: 0, latestDocNo: null },
    escalationLifecycle: noWoEscalation,
    procurementStatusLabel: deriveCaseProcurementStatusLabel(noWoEscalation),
    issueStatusLabel: procuredAwaitingWo ? "WO not created yet — PMR pending WO" : "WO not created yet",
    nextStoreAction: procuredAwaitingWo || noWoEscalation.state === "PROCUREMENT_COMPLETED"
      ? {
          key: "CREATE_WO",
          label: "Create Work Order",
          description: procuredAwaitingWo
            ? "RM received in Store after GRN. Create the work order to open PMR and material issue."
            : "RM is available for this SO. Return to Prepare WO to create the work order.",
        }
      : {
          key: "CONTINUE_PROCUREMENT",
          label: "Complete procurement, then create Work Order",
          description:
            "Store tracks this SO-level requisition until Purchase/GRN completes; Material Issue starts only after WO creation.",
        },
    rmLines: rmLines.map((line) => ({
      rmItemId: line.rmItemId,
      rmItemName: line.rmItemName,
      unit: line.unit,
      requiredQty: line.requiredQty,
      freeStockQty: line.freeStockQty,
      shortageAfterReservationQty: line.shortageAfterReservationQty,
      netShortageAfterIncomingQty: line.netShortageAfterIncomingQty,
      blockerReason: line.blockerReason,
      recommendedAction: line.recommendedAction,
    })),
  };
}

async function buildTraceByRmItemId(db, rmItemIds) {
  const out = new Map();
  for (const rmItemId of rmItemIds) {
    out.set(rmItemId, await buildSupplyPanel(db, rmItemId));
  }
  return out;
}

function buildQueueRow({
  wo,
  fgName,
  line,
  pmrStatus,
  materialRequirement = null,
  procuredAwaitingWo = false,
  hasWorkOrder = true,
}) {
  const queueType = queueTypeForLine(line, line.blockerReason, pmrStatus, { procuredAwaitingWo, hasWorkOrder });
  const trace = line.procurementTrace || null;
  const mrLine = firstOpenMrLine(trace);
  const sourceType = mrLine?.sourceType ?? materialRequirement?.sourceType ?? null;
  const procurementStage = summarizeProcurementStageFromTrace(trace, sourceType);
  const noWorkOrder = !wo.id;
  const row = {
    queueType,
    salesOrderId: wo.salesOrderId,
    salesOrderNo: wo.salesOrder?.docNo ?? null,
    workOrderId: wo.id,
    workOrderNo: wo.docNo ?? null,
    customerName: customerNameForSalesOrder(wo.salesOrder),
    fgItemName: fgName,
    rmItemId: line.rmItemId,
    rmItemName: line.rmItemName,
    requiredQty: line.requiredQty,
    freeStockQty: line.freeStockQty,
    physicalUsableStockQty: line.physicalUsableStockQty,
    activeAllocatedQty: line.activeAllocatedQty,
    legacyReservedQty: line.legacyReservedQty,
    effectiveReservedQty: line.effectiveReservedQty,
    incomingQty: line.incomingQty,
    shortageAfterReservationQty: line.shortageAfterReservationQty,
    netShortageAfterIncomingQty: line.netShortageAfterIncomingQty,
    allocationCoverageQty: line.allocationCoverageQty,
    allocationShortageQty: line.allocationShortageQty,
    allocationStatus: line.allocationStatus,
    reservationBreakdown: line.reservationBreakdown || [],
    blockerReason: line.blockerReason,
    recommendedAction: line.recommendedAction,
    priorityRank: priorityRankForLine(line, line.blockerReason, pmrStatus),
    rmPendingCount: (trace?.openMrLines || []).length || 1,
    requisitionStatus: mrLine?.status ?? materialRequirement?.status ?? null,
    requisitionDocNo: mrLine?.materialRequirementDocNo ?? materialRequirement?.docNo ?? null,
    materialRequirementId: mrLine?.materialRequirementId ?? materialRequirement?.id ?? null,
    sourceType,
    ...procurementStage,
    hasOpenMr: (trace?.openMrLines || []).length > 0,
    primaryPoId: (trace?.poLines || [])[0]?.purchaseOrderId ?? null,
    procurementStatus: procurementStatusForLine(line, queueType, trace),
    poStatus: poStatusForTrace(trace),
    grnReceivedPercent: grnReceivedPercentForTrace(trace),
    sourceStage: noWorkOrder ? "SO_PLANNING" : "WO_PLANNING",
  };
  row.nextOwner = nextOwnerForQueue(queueType);
  row.nextAction =
    queueType === "RM_RECEIVED_CREATE_WO"
      ? "Create Work Order in Prepare WO"
      : noWorkOrder && !materialRequirement && line.netShortageAfterIncomingQty > QUEUE_EPS
        ? "Raise Store Requisition"
        : noWorkOrder && (queueType === "RM_READY_FOR_ISSUE" || queueType === "READY_TO_RELEASE_WO")
          ? "Complete procurement, then create Work Order"
          : nextActionForQueue(row);
  return row;
}

function pushCaseQueueRowFromLines(actionQueue, { wo, fgName, rmLines, pmrStatus, materialRequirement = null, caseSupply = null, procuredAwaitingWo = false, hasWorkOrder = true, filters }) {
  const rep = pickRepresentativeRmLine(rmLines, pmrStatus);
  if (!rep) return;
  if (filters.rmItemId && rep.rmItemId !== filters.rmItemId) return;
  let q = buildQueueRow({
    wo,
    fgName,
    line: rep,
    pmrStatus,
    materialRequirement,
    procuredAwaitingWo,
    hasWorkOrder,
  });
  if (caseSupply || materialRequirement) {
    q = enrichQueueRowFromCaseSupply(q, { woMr: materialRequirement, caseSupply, pmrStatus });
  }
  if (filters.onlyBlocked && q.queueType === "INFO" && q.blockerReason === "No blocker") return;
  if (!statusMatches(q, filters.status)) return;
  if (q.queueType !== "INFO" || !filters.onlyBlocked) pushCaseQueueRow(actionQueue, q);
}

function buildDetail({ wo, fgName, rmLines, pmrStatus, woShortageCase, caseSupplyPanel }) {
  return {
    salesOrder: wo.salesOrder
      ? {
          id: wo.salesOrder.id,
          docNo: wo.salesOrder.docNo,
          orderType: wo.salesOrder.orderType,
          internalStatus: wo.salesOrder.internalStatus,
        }
      : null,
    workOrder: {
      id: wo.id,
      docNo: wo.docNo,
      status: wo.status,
      holdReason: wo.holdReason ?? null,
    },
    fgItem: { itemName: fgName },
    customer: { name: customerNameForSalesOrder(wo.salesOrder) },
    requirementDate: wo.salesOrder?.deliveryDate ?? wo.salesOrder?.requiredDate ?? null,
    pmrStatus,
    rmLines,
    woShortageCase,
    caseSupplyPanel,
    blockerExplanation:
      rmLines.find((l) => l.netShortageAfterIncomingQty > QUEUE_EPS)?.blockerReason ||
      rmLines.find((l) => l.shortageAfterReservationQty > QUEUE_EPS)?.blockerReason ||
      "No blocker",
  };
}

async function buildWorkOrderAvailabilityRows(db, wo, deps) {
  const fgLines = (wo.lines || []).map((line) => ({
    fgItemId: line.fgItemId,
    fgQty: n(line.plannedQty) > QUEUE_EPS ? n(line.plannedQty) : n(line.qty),
    bomMissing: false,
  }));
  const fgName = [...new Set((wo.lines || []).map((line) => line.fgItem?.itemName).filter(Boolean))].join(", ");
  const demand = await deps.aggregateRmDemandForFgLines(db, fgLines);
  const requiredQtyByItemId = new Map();
  for (const [rmItemId, qty] of demand.rmNeeded || []) {
    requiredQtyByItemId.set(rmItemId, round3(qty));
  }
  const availability = await deps.getMaterialAvailabilityByItems({
    db,
    itemIds: [...requiredQtyByItemId.keys()],
    requiredQtyByItemId,
  });
  return {
    fgName,
    availability,
    missingChildBoms: demand.missingChildBoms || [],
    bomIssue: !availability.length || (demand.missingChildBoms || []).length > 0,
  };
}

async function buildSalesOrderPlanningAvailabilityRows(db, so, deps) {
  const buildPlanningView = deps.buildRegularSoPlanningSnapshotView || buildRegularSoPlanningSnapshotView;
  const planning = await buildPlanningView(so.id, db);
  const fgLines = fgShortageDemandInputFromPlanningView(planning).map((line) => ({
    fgItemId: line.fgItemId,
    fgQty: line.fgQty,
    bomMissing: false,
  }));
  const fgName = fgNameForSalesOrder(so);
  const demand = await deps.aggregateRmDemandForFgLines(db, fgLines);
  const requiredQtyByItemId = new Map();
  for (const [rmItemId, qty] of demand.rmNeeded || []) {
    requiredQtyByItemId.set(rmItemId, round3(qty));
  }
  const availability = await deps.getMaterialAvailabilityByItems({
    db,
    itemIds: [...requiredQtyByItemId.keys()],
    requiredQtyByItemId,
  });
  return {
    fgName,
    availability,
    missingChildBoms: demand.missingChildBoms || [],
    bomIssue: !availability.length || (demand.missingChildBoms || []).length > 0,
  };
}

async function buildMaterialAvailabilityWorkspace(db = prisma, filtersInput = {}, depsInput = {}) {
  const filters = parseWorkspaceFilters(filtersInput);
  const deps = {
    aggregateRmDemandForFgLines,
    getMaterialAvailabilityByItems,
    buildRegularSoPlanningSnapshotView,
    computeFgGapLinesForSalesOrder,
    evaluateWoPrepareReadiness,
    ...depsInput,
  };
  const workOrdersRaw = await loadCandidateWorkOrders(db, filters);
  const workOrders = await filterNoQtyExecutionReleasedWorkOrders(db, workOrdersRaw);
  const soPlanningMrs = await loadCandidateSoPlanningMrs(db, filters);
  const procuredSoPlanningMrs = await loadProcuredSoPlanningMrs(db, filters, deps);
  const coveredSoIds = new Set(
    [...soPlanningMrs, ...procuredSoPlanningMrs].map((mr) => mr.salesOrderId).filter(Boolean),
  );
  const soPlanningSalesOrders = await loadCandidateSoPlanningShortageSalesOrders(
    db,
    filters,
    coveredSoIds,
    deps,
  );
  const pmrByWorkOrder = await loadPmrStatusByWorkOrder(db, workOrders.map((wo) => wo.id));
  const woMrByWorkOrder = await loadSoProcurementMrByWorkOrder(db, workOrders.map((wo) => wo.id));
  const terminalMrByWorkOrder = await loadTerminalSoProcurementMrByWorkOrder(db, workOrders.map((wo) => wo.id));
  const soIdsForTerminal = [
    ...soPlanningSalesOrders.map((so) => so.id),
    ...soPlanningMrs.map((mr) => mr.salesOrderId).filter(Boolean),
  ];
  const terminalMrBySalesOrder = await loadTerminalSoPlanningMrBySalesOrder(db, soIdsForTerminal);

  const raw = [];
  const allRmIds = new Set();
  for (const wo of workOrders) {
    const built = await buildWorkOrderAvailabilityRows(db, wo, deps);
    for (const line of built.availability) allRmIds.add(line.itemId);
    raw.push({ wo, ...built });
  }
  for (const mr of soPlanningMrs) {
    for (const line of mr.lines || []) allRmIds.add(line.rmItemId);
  }
  for (const mr of procuredSoPlanningMrs) {
    for (const line of mr.lines || []) allRmIds.add(line.rmItemId);
  }
  const soRaw = [];
  for (const so of soPlanningSalesOrders) {
    const built = await buildSalesOrderPlanningAvailabilityRows(db, so, deps);
    for (const line of built.availability) allRmIds.add(line.itemId);
    soRaw.push({ so, ...built });
  }

  const mprsMrByWorkOrder = await loadMprsProcurementMrByWorkOrder(
    db,
    raw.map((row) => ({ woId: row.wo.id, rmItemIds: row.availability.map((line) => line.itemId) })),
  );

  const [itemById, traceByRmItemId] = await Promise.all([
    loadItemsById(db, [...allRmIds]),
    buildTraceByRmItemId(db, [...allRmIds]),
  ]);

  const actionQueue = [];
  const details = [];
  for (const row of raw) {
    const pmrStatus = pmrByWorkOrder.get(row.wo.id) || { openPmrs: [], latestStatus: null };
    const allRmLines = row.availability.map((line) =>
      mapAvailabilityLine(line, itemById, {
        pmrStatus,
        traceByRmItemId,
        bomIssue: row.bomIssue,
        hasWorkOrder: true,
      }),
    );
    if (allRmLines.length) {
      const woMr = woMrByWorkOrder.get(row.wo.id) || mprsMrByWorkOrder.get(row.wo.id) || null;
      const terminalMr = woMr ? null : terminalMrByWorkOrder.get(row.wo.id) || null;
      const rmItemIds = allRmLines.map((l) => l.rmItemId);
      const caseSupplyPanel = await buildWoCaseSupplyPanel(db, row.wo.id, rmItemIds, woMr, row.wo);
      pushCaseQueueRowFromLines(actionQueue, {
        wo: row.wo,
        fgName: row.fgName,
        rmLines: allRmLines,
        pmrStatus,
        materialRequirement: woMr,
        caseSupply: caseSupplyPanel,
        filters,
        hasWorkOrder: true,
      });
      const woShortageCase = buildWoShortageCase({
        wo: row.wo,
        fgName: row.fgName,
        rmLines: allRmLines,
        pmrStatus,
        woMr,
        terminalMr,
        caseSupply: caseSupplyPanel,
      });
      details.push(
        buildDetail({
          wo: row.wo,
          fgName: row.fgName,
          rmLines: allRmLines,
          pmrStatus,
          woShortageCase,
          caseSupplyPanel,
        }),
      );
    }
  }

  for (const mr of soPlanningMrs) {
    const rmLinesOnMr = filters.rmItemId ? (mr.lines || []).filter((line) => line.rmItemId === filters.rmItemId) : mr.lines || [];
    if (!rmLinesOnMr.length) continue;
    const requiredQtyByItemId = new Map();
    for (const line of rmLinesOnMr) {
      requiredQtyByItemId.set(line.rmItemId, round3((requiredQtyByItemId.get(line.rmItemId) || 0) + n(line.requiredQty || line.shortageQty)));
    }
    const availability = await deps.getMaterialAvailabilityByItems({
      db,
      itemIds: [...requiredQtyByItemId.keys()],
      requiredQtyByItemId,
    });
    const pmrStatus = { openPmrs: [], latestStatus: null };
    const virtualWo = virtualWoForSoPlanningMr(mr);
    const fgName = fgNameForSalesOrder(mr.salesOrder);
    const allRmLines = availability.map((line) =>
      mapAvailabilityLine(line, itemById, {
        pmrStatus,
        traceByRmItemId,
        bomIssue: false,
        hasWorkOrder: false,
      }),
    );
    pushCaseQueueRowFromLines(actionQueue, {
      wo: virtualWo,
      fgName,
      rmLines: allRmLines,
      pmrStatus,
      materialRequirement: mr,
      filters,
      hasWorkOrder: false,
    });
    if (allRmLines.length) {
      const caseSupplyPanel = await buildWoCaseSupplyPanel(db, null, allRmLines.map((l) => l.rmItemId), mr, virtualWo);
      const soShortageCase = buildSoPlanningShortageCase({
        mr,
        terminalMr: null,
        fgName,
        rmLines: allRmLines,
        caseSupply: caseSupplyPanel,
      });
      details.push(
        buildDetail({
          wo: virtualWo,
          fgName,
          rmLines: allRmLines,
          pmrStatus,
          woShortageCase: soShortageCase,
          caseSupplyPanel,
        }),
      );
    }
  }

  for (const mr of procuredSoPlanningMrs) {
    const rmLinesOnMr = filters.rmItemId ? (mr.lines || []).filter((line) => line.rmItemId === filters.rmItemId) : mr.lines || [];
    if (!rmLinesOnMr.length) continue;
    const requiredQtyByItemId = new Map();
    for (const line of rmLinesOnMr) {
      requiredQtyByItemId.set(line.rmItemId, round3((requiredQtyByItemId.get(line.rmItemId) || 0) + n(line.requiredQty || line.shortageQty)));
    }
    const availability = await deps.getMaterialAvailabilityByItems({
      db,
      itemIds: [...requiredQtyByItemId.keys()],
      requiredQtyByItemId,
    });
    const pmrStatus = { openPmrs: [], latestStatus: null };
    const virtualWo = virtualWoForSoPlanningMr(mr);
    const fgName = fgNameForSalesOrder(mr.salesOrder);
    const allRmLines = availability.map((line) =>
      mapAvailabilityLine(line, itemById, {
        pmrStatus,
        traceByRmItemId,
        bomIssue: false,
        procuredAwaitingWo: true,
        hasWorkOrder: false,
      }),
    );
    pushCaseQueueRowFromLines(actionQueue, {
      wo: virtualWo,
      fgName,
      rmLines: allRmLines,
      pmrStatus,
      materialRequirement: mr,
      procuredAwaitingWo: true,
      hasWorkOrder: false,
      filters,
    });
    if (allRmLines.length) {
      const caseSupplyPanel = await buildWoCaseSupplyPanel(db, null, allRmLines.map((l) => l.rmItemId), mr, virtualWo);
      const soShortageCase = buildSoPlanningShortageCase({
        mr,
        terminalMr: null,
        fgName,
        rmLines: allRmLines,
        caseSupply: caseSupplyPanel,
      });
      details.push(
        buildDetail({
          wo: virtualWo,
          fgName,
          rmLines: allRmLines,
          pmrStatus,
          woShortageCase: soShortageCase,
          caseSupplyPanel,
        }),
      );
    }
  }

  for (const row of soRaw) {
    const pmrStatus = { openPmrs: [], latestStatus: null };
    const virtualWo = {
      id: null,
      docNo: null,
      status: "WO_NOT_CREATED",
      holdReason: null,
      salesOrderId: row.so.id,
      salesOrder: row.so,
      lines: [],
    };
    const allRmLines = row.availability.map((line) =>
      mapAvailabilityLine(line, itemById, {
        pmrStatus,
        traceByRmItemId,
        bomIssue: row.bomIssue,
        hasWorkOrder: false,
      }),
    );
    pushCaseQueueRowFromLines(actionQueue, {
      wo: virtualWo,
      fgName: row.fgName,
      rmLines: allRmLines.filter((line) => line.netShortageAfterIncomingQty > QUEUE_EPS || line.shortageAfterReservationQty > QUEUE_EPS),
      pmrStatus,
      filters,
      hasWorkOrder: false,
    });
    if (allRmLines.length) {
      const soShortageCase = buildSoPlanningShortageCase({
        mr: {
          id: null,
          docNo: null,
          status: null,
          sourceType: REGULAR_SO_PROCUREMENT_SOURCE,
          salesOrderId: row.so.id,
          workOrderId: null,
          salesOrder: row.so,
          lines: [],
        },
        terminalMr: terminalMrBySalesOrder.get(row.so.id) || null,
        fgName: row.fgName,
        rmLines: allRmLines,
        caseSupply: { summary: emptySupplySummary(), openMrLines: [], prLines: [], poLines: [] },
      });
      details.push(
        buildDetail({
          wo: virtualWo,
          fgName: row.fgName,
          rmLines: allRmLines,
          pmrStatus,
          woShortageCase: soShortageCase,
          caseSupplyPanel: { workOrderId: null, materialRequirementId: null, summary: emptySupplySummary(), openMrLines: [], prLines: [], poLines: [] },
        }),
      );
    }
  }

  actionQueue.sort((a, b) => a.priorityRank - b.priorityRank || b.shortageAfterReservationQty - a.shortageAfterReservationQty);

  let selectedDetail = null;
  if (filters.workOrderId) {
    selectedDetail = details.find((d) => d.workOrder.id === filters.workOrderId) ?? null;
  } else if (filters.materialRequirementId) {
    selectedDetail =
      details.find((d) => d.woShortageCase?.materialRequirement?.id === filters.materialRequirementId) ?? null;
  } else if (filters.salesOrderId) {
    selectedDetail = details.find((d) => d.salesOrder?.id === filters.salesOrderId) ?? null;
  } else if (filters.rmItemId) {
    selectedDetail = details.find((d) => d.rmLines.some((l) => l.rmItemId === filters.rmItemId)) ?? details[0] ?? null;
  } else {
    selectedDetail = details[0] ?? null;
  }

  const selectedRmItemId =
    filters.rmItemId ||
    (selectedDetail?.rmLines.some((l) => l.rmItemId === actionQueue[0]?.rmItemId)
      ? actionQueue[0]?.rmItemId
      : null) ||
    selectedDetail?.rmLines?.[0]?.rmItemId ||
    actionQueue[0]?.rmItemId ||
    null;
  const supplyPanel = selectedRmItemId
    ? traceByRmItemId.get(selectedRmItemId) || (await buildSupplyPanel(db, selectedRmItemId))
    : await buildSupplyPanel(db, null);
  const caseSupplyPanel = selectedDetail?.caseSupplyPanel ?? null;
  const selectedWoShortageCase = selectedDetail?.woShortageCase ?? null;

  return {
    filters,
    actionQueue,
    selectedDetail,
    selectedRmItemId,
    selectedWoShortageCase,
    caseSupplyPanel,
    details,
    supplyPanel,
    summary: {
      queueCount: actionQueue.length,
      blockedCount: actionQueue.filter((r) => r.netShortageAfterIncomingQty > QUEUE_EPS).length,
      partialCount: actionQueue.filter((r) => r.queueType === "WO_PARTIALLY_COVERED").length,
      pmrWaitingCount: actionQueue.filter((r) => r.queueType === "PMR_WAITING_ISSUE").length,
      incomingCoveredCount: actionQueue.filter((r) => r.queueType === "SHORTAGE_COVERED_BY_INCOMING").length,
      approvalPendingCount: actionQueue.filter((r) => r.queueType === "APPROVAL_PENDING").length,
      purchaseWaitingCount: actionQueue.filter((r) => r.queueType === "WAITING_PURCHASE_ACTION").length,
      waitingGrnCount: actionQueue.filter((r) => r.queueType === "PO_WAITING_GRN" || r.queueType === "SHORTAGE_COVERED_BY_INCOMING").length,
      partialReceivedCount: actionQueue.filter((r) => r.queueType === "PARTIAL_RM_RECEIVED").length,
      readyIssueCount: actionQueue.filter((r) => r.queueType === "RM_READY_FOR_ISSUE" || r.queueType === "PMR_WAITING_ISSUE").length,
      rmReceivedCreateWoCount: actionQueue.filter((r) => r.queueType === "RM_RECEIVED_CREATE_WO").length,
      readyReleaseCount: actionQueue.filter((r) => r.queueType === "READY_TO_RELEASE_WO").length,
    },
  };
}

/**
 * Dashboard / operational continuity — one row per WO (or SO) waiting on Store issue after GRN.
 */
async function buildStoreIssuePendingDashboardRows(db = prisma, opts = {}) {
  const workspace = await buildMaterialAvailabilityWorkspace(db, { onlyBlocked: true });
  const byCase = new Map();
  for (const row of workspace.actionQueue || []) {
    if (row.queueType !== "RM_READY_FOR_ISSUE") continue;
    if (!row.workOrderId || Number(row.workOrderId) <= 0) continue;
    if (n(row.freeStockQty) <= QUEUE_EPS) continue;
    const caseKey = `wo-${row.workOrderId}`;
    if (byCase.has(caseKey)) continue;
    byCase.set(caseKey, {
      materialRequirementId: row.materialRequirementId ?? 0,
      docNo: row.requisitionDocNo ?? null,
      workOrderId: row.workOrderId,
      workOrderNo: row.workOrderNo,
      salesOrderId: row.salesOrderId,
      salesOrderDocNo: row.salesOrderNo,
      primaryFgName: row.fgItemName,
      shortageRmLineCount: 0,
      totalShortageQty: 0,
      pendingGrnQty: 0,
      procurementStage: "RM ready in Store",
      operationalLabel: "Issue RM to Production",
      operationalKey: "STORE_ISSUE_PENDING",
      pendingPoStatus: "Complete",
      pendingGrnStatus: "Complete",
      supplierPendingStatus: "Hand off to Store",
      nextActionKey: "ISSUE_RM",
      totalRemainingQty: 0,
    });
  }
  const rows = [...byCase.values()];
  if (opts.limit > 0) return rows.slice(0, opts.limit);
  return rows;
}

/**
 * Dashboard / pending actions — one row per WO where RM is fully issued and Production owns next step.
 */
async function buildStoreProductionHandoffDashboardRows(db = prisma, opts = {}) {
  const workspace = await buildMaterialAvailabilityWorkspace(db, { onlyBlocked: true });
  const byCase = new Map();
  for (const row of workspace.actionQueue || []) {
    if (row.queueType !== "READY_TO_RELEASE_WO") continue;
    if (!row.workOrderId || Number(row.workOrderId) <= 0) continue;
    const caseKey = `wo-${row.workOrderId}`;
    if (byCase.has(caseKey)) continue;
    byCase.set(caseKey, row);
  }
  const rows = [...byCase.values()].map((row) => ({
    workOrderId: row.workOrderId,
    workOrderNo: row.workOrderNo,
    salesOrderId: row.salesOrderId,
    salesOrderDocNo: row.salesOrderNo,
    materialRequirementId: row.materialRequirementId ?? null,
    primaryFgName: row.fgItemName,
    operationalKey: "HANDOFF_TO_PRODUCTION",
    operationalLabel: "RM issued — waiting for Production",
  }));
  if (opts.limit > 0) return rows.slice(0, opts.limit);
  return rows;
}

async function buildPostGrnCreateWoDashboardRows(db = prisma, opts = {}) {
  const workspace = await buildMaterialAvailabilityWorkspace(db, { onlyBlocked: true });
  const out = [];
  const seen = new Set();
  for (const detail of workspace.details || []) {
    const c = detail?.woShortageCase;
    if (!c || c.workOrderId) continue;
    const s = c.allocationFirstStatus;
    if (!s || s.key !== "RM_RECEIVED") continue;
    const key = `so-${c.salesOrderId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      salesOrderId: c.salesOrderId,
      salesOrderDocNo: c.salesOrderNo,
      primaryFgName: c.fgItemName,
      materialRequirementId: c.materialRequirement?.id ?? null,
      materialRequirementDocNo: c.materialRequirement?.docNo ?? null,
      operationalKey: "RM_RECEIVED_CREATE_WO",
      operationalLabel: s.label,
      nextActionKey: "CREATE_WO",
    });
  }
  if (opts.limit > 0) return out.slice(0, opts.limit);
  return out;
}

/**
 * Phase A dashboard: derived allocation-first WO statuses (non-breaking, derived only).
 * Returns one row per WO/SO case (Store-owned) for WAITING_RM / PARTIALLY_ALLOCATED / READY_FOR_ISSUE.
 */
async function buildAllocationFirstDashboardRows(db = prisma, opts = {}) {
  const workspace = await buildMaterialAvailabilityWorkspace(db, { onlyBlocked: true });
  const out = [];
  const seen = new Set();
  for (const detail of workspace.details || []) {
    const c = detail?.woShortageCase;
    if (!c) continue;
    const s = c.allocationFirstStatus;
    if (!s) continue;
    const key = c.workOrderId ? `wo-${c.workOrderId}` : `so-${c.salesOrderId}`;
    if (seen.has(key)) continue;
    if (c.workOrderId && !["WAITING_RM", "PARTIALLY_ALLOCATED", "READY_FOR_ISSUE"].includes(s.key)) continue;
    if (!c.workOrderId && s.key !== "RM_RECEIVED") continue;
    seen.add(key);
    out.push({
      workOrderId: c.workOrderId,
      workOrderNo: c.workOrderNo,
      salesOrderId: c.salesOrderId,
      salesOrderDocNo: c.salesOrderNo,
      primaryFgName: c.fgItemName,
      materialRequirementId: c.materialRequirement?.id ?? null,
      operationalKey: s.key,
      operationalLabel: s.label,
      nextActionKey:
        s.key === "READY_FOR_ISSUE"
          ? "ISSUE_RM"
          : s.key === "RM_RECEIVED"
            ? "CREATE_WO"
            : "ALLOCATE_RM",
    });
  }
  if (opts.limit > 0) return out.slice(0, opts.limit);
  return out;
}

module.exports = {
  PMR_WAITING_ISSUE_STATUSES,
  WO_PLANNING_SOURCE,
  assessPostGrnCreateWoEligibility,
  buildMaterialAvailabilityWorkspace,
  buildStoreIssuePendingDashboardRows,
  buildStoreProductionHandoffDashboardRows,
  buildAllocationFirstDashboardRows,
  buildPostGrnCreateWoDashboardRows,
  buildSupplyPanel,
  buildWoCaseSupplyPanel,
  buildWoShortageCase,
  deriveCaseStoreAction,
  deriveWoEscalationLifecycle,
  deriveLineBlocker,
  deriveRecommendedAction,
  parseWorkspaceFilters,
  rmLinesNotOnWoMr,
  loadMprsProcurementMrByWorkOrder,
  buildCompletedProcurementSupply,
  summarizeMergedCaseSupply,
  enrichQueueRowFromCaseSupply,
  resolveActiveWoMr,
  buildProcurementChainFromSupply,
};
