/**
 * Phase 3B — Production Material Request (PMR). Request/control layer; stock moves via MIN only.
 */

const { prisma } = require("../utils/prisma");
const { filterNoQtyExecutionReleasedWorkOrders, assertNoQtyWorkOrderExecutionReleased } = require("./noQtyExecutionBoundaryService");
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("./docNoService");
const { aggregateRmDemandForFgLines, loadApprovedBomWithLines } = require("./bomExplosionService");
const { STOCK_EPS, getItemStockQty } = require("./stockService");
const { qtyToNumber } = require("./rmPurchaseHelpers");
const {
  createMaterialIssueNote,
  loadIssuedByWorkOrderFromMaterialIssues,
  computeMaterialIssuePlanLine,
} = require("./materialIssueService");
const {
  getWorkOrderProductionLocationIdsForReturn,
  loadNetConsumedAtProduction,
  loadReturnedByWorkOrder,
} = require("./materialReturnService");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");
const {
  createAllocationsForPmr,
  cancelAllocationsForPmr,
  loadPmrAllocationByItem,
  syncAllocationsForPmrIssueStatus,
  refreshAllocationsForOpenPmrReconcile,
} = require("./materialAllocationService");
const auditLog = require("./auditLog");
const {
  computeMaxAllowedRmIssueQty,
  computeRmIssueToleranceQty,
} = require("./rmIssueToleranceService");
const {
  validatePlannedProcessAllowance,
  assessIssueAgainstPlannedAllowance,
  recoverIncludedRunnerQty,
} = require("./plannedProcessAllowanceService");
const {
  resolvePmrLineIssueRounding,
  assertIssueWithinRoundingTarget,
  computeRoundedIssueTargetQty,
  kgIssueRoundingApplies,
} = require("./rmIssueRoundingService");
const {
  planOpenPmrPlannedRequirementReconcile,
  CLOSED_SKIP_STATUSES,
  OPERATOR_RECONCILE_FAILED_MESSAGE,
  describePrismaUniqueViolation,
} = require("./pmrPlannedRequirementReconcileService");
const {
  snapshotProductionRmMap,
  mergePurgingIntoRmNeeded,
  buildPurgingPlanningSummary,
} = require("./bomPurgingRmPlanningService");
const {
  resolveApprovedRequestForIssue,
  markRmAllowanceApprovalIssued,
  clearStaleAllowanceRequestsAfterNormalIssue,
} = require("./rmAllowanceApprovalService");
const { resolveWorkOrderOperationalStatus } = require("./workOrderOperationalStatus");
const {
  isRegularSoOrderType,
  isWithinRoundingTolerance,
  computeRoundedDownToleranceQty,
  deriveRegularSoRmIssueStatus,
  assertRegularSoCumulativeAllowanceGate,
  round3: regularSoRound3,
} = require("./regularSoRmIssuePlanning");

const STORE_ISSUE_STATUSES = ["REQUESTED", "PARTIALLY_ISSUED"];
const PMR_ISSUED_STATUSES = ["FULLY_ISSUED", "SHORT_ISSUE_ACCEPTED"];
const PMR_EXISTING_WORKFLOW_STATUSES = [...STORE_ISSUE_STATUSES, ...PMR_ISSUED_STATUSES];
const PMR_NON_CANCELLED_STATUSES = ["DRAFT", ...PMR_EXISTING_WORKFLOW_STATUSES];

const PMR_SHORT_ISSUE_WAIVE_REASONS = [
  "SCALE_LIMITATION",
  "PACKING_LIMITATION",
  "MANAGEMENT_DECISION",
  "ROUNDING_TOLERANCE",
  "OTHER",
];

function n(v) {
  return qtyToNumber(v);
}

function round3(v) {
  return Math.round((Number(v) || 0) * 1000) / 1000;
}

function runInTransaction(db, fn) {
  return typeof db?.$transaction === "function" ? db.$transaction(fn) : fn(db);
}

function pendingQty(line) {
  const ceiling =
    n(line.roundedIssueTargetQty) > STOCK_EPS ? n(line.roundedIssueTargetQty) : n(line.requiredQty);
  const iss = n(line.issuedQty);
  const waived = n(line.waivedQty);
  return Math.max(0, ceiling - iss - waived);
}

function effectiveRequiredQty(line) {
  const ceiling =
    n(line.roundedIssueTargetQty) > STOCK_EPS ? n(line.roundedIssueTargetQty) : n(line.requiredQty);
  const waived = n(line.waivedQty);
  return round3(Math.max(0, ceiling - waived));
}

function excessIssueQty(line) {
  const req = n(line.requiredQty);
  const iss = n(line.issuedQty);
  return round3(Math.max(0, iss - req));
}

function pmrIssueSelectionRank(status) {
  const s = String(status ?? "").trim().toUpperCase();
  if (s === "FULLY_ISSUED") return 0;
  if (s === "SHORT_ISSUE_ACCEPTED") return 1;
  return 99;
}

function sortPmrsByIssuedPriority(a, b) {
  const ar = pmrIssueSelectionRank(a?.status);
  const br = pmrIssueSelectionRank(b?.status);
  if (ar !== br) return ar - br;
  return Number(b?.id ?? 0) - Number(a?.id ?? 0);
}

function normalizePmrLineForReleaseCheck(line) {
  return {
    pmrLineId: line.id,
    itemId: line.itemId,
    itemName: line.itemName ?? line.item?.itemName ?? `Item #${line.itemId ?? "?"}`,
    unit: line.unit ?? line.unitSnapshot ?? line.item?.unit ?? "",
    requiredQty: round3(n(line.requiredQty)),
    issuedQty: round3(n(line.issuedQty)),
  };
}

/** P16-13A: every required BOM line must have issued qty > 0 before production release. */
function listUnissuedRequiredPmrLines(lines) {
  return (lines || [])
    .map(normalizePmrLineForReleaseCheck)
    .filter((ln) => ln.requiredQty > STOCK_EPS && ln.issuedQty <= STOCK_EPS);
}

function assessPmrReleaseEligibility(lines, { alreadyReleased = false } = {}) {
  const unissuedRequiredLines = listUnissuedRequiredPmrLines(lines);
  const totalIssued = round3((lines || []).reduce((s, l) => s + n(l.issuedQty), 0));
  const canRelease =
    !alreadyReleased && totalIssued > STOCK_EPS && unissuedRequiredLines.length === 0;
  return { canRelease, unissuedRequiredLines, totalIssued };
}

function formatPmrReleaseBlockedMessage(unissuedRequiredLines) {
  const bullets = (unissuedRequiredLines || [])
    .map((l) => {
      const unit = l.unit?.trim() ? ` ${l.unit.trim()}` : "";
      return `• ${l.itemName} (${round3(l.issuedQty)} / ${round3(l.requiredQty)}${unit})`;
    })
    .join("\n");
  return [
    "Cannot release Work Order.",
    "",
    "The following BOM materials have not been issued.",
    "",
    bullets,
    "",
    "Issue at least some quantity for every required material before releasing production.",
  ]
    .filter((line, idx, arr) => !(line === "" && idx === arr.length - 2 && !bullets))
    .join("\n");
}

/** True when PMR has at least one issue and every required line has issued qty > 0. */
function pmrMeetsProductionReleaseIssueRule(pmrOrLines) {
  const lines = Array.isArray(pmrOrLines) ? pmrOrLines : pmrOrLines?.lines;
  return assessPmrReleaseEligibility(lines || []).canRelease;
}

function releaseReadyPmrRank(pmr) {
  const status = String(pmr?.status ?? "").trim().toUpperCase();
  if (status === "FULLY_ISSUED") return 0;
  if (status === "SHORT_ISSUE_ACCEPTED") return 1;
  return 99;
}

function pickReleaseReadyPmr(pmrs = []) {
  return [...pmrs]
    .filter((pmr) => PMR_ISSUED_STATUSES.includes(String(pmr?.status ?? "").trim().toUpperCase()))
    .filter((pmr) => pmrMeetsProductionReleaseIssueRule(pmr.lines || []))
    .sort((a, b) => releaseReadyPmrRank(a) - releaseReadyPmrRank(b) || Number(a.id ?? 0) - Number(b.id ?? 0))[0] ?? null;
}

/**
 * Store release eligibility — single source of truth for Pending Actions and /production-release.
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number[]} workOrderIds
 */
async function loadStoreProductionReleaseEligibilityByWorkOrder(db, workOrderIds) {
  const ids = [...new Set((workOrderIds || []).map((id) => Number(id)).filter((id) => id > 0))];
  const out = new Map();
  if (!ids.length) return out;

  const [workOrders, productionEntryGroups, executions, pmrRows] = await Promise.all([
    db.workOrder.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        docNo: true,
        status: true,
        sourceType: true,
        salesOrderId: true,
        cycleId: true,
        requirementSheetId: true,
        materialReleasedToProductionAt: true,
        salesOrder: { select: { docNo: true, orderType: true } },
        lines: {
          select: {
            id: true,
            plannedQty: true,
            qty: true,
            fgItem: { select: { itemName: true } },
          },
        },
      },
    }),
    db.productionEntry.groupBy({
      by: ["workOrderLineId"],
      where: { workOrderLine: { workOrderId: { in: ids } } },
      _count: { _all: true },
    }),
    db.workOrderProductionExecution.findMany({
      where: { workOrderId: { in: ids } },
      select: { workOrderId: true, executionStatus: true },
    }),
    db.productionMaterialRequest.findMany({
      where: { workOrderId: { in: ids }, status: { not: "CANCELLED" } },
      include: { lines: { select: { requiredQty: true, issuedQty: true } } },
      orderBy: { id: "desc" },
    }),
  ]);

  const lineToWoId = new Map();
  for (const wo of workOrders) {
    for (const line of wo.lines || []) {
      lineToWoId.set(line.id, wo.id);
    }
  }
  const productionEntryCountByWo = new Map();
  for (const group of productionEntryGroups) {
    const woId = lineToWoId.get(group.workOrderLineId);
    if (!woId) continue;
    productionEntryCountByWo.set(
      woId,
      (productionEntryCountByWo.get(woId) ?? 0) + Number(group._count?._all ?? 0),
    );
  }
  const execStatusByWo = new Map(
    executions.map((row) => [
      Number(row.workOrderId),
      String(row.executionStatus ?? "NOT_STARTED").trim().toUpperCase(),
    ]),
  );
  const pmrsByWo = new Map();
  for (const pmr of pmrRows) {
    const woId = Number(pmr.workOrderId);
    if (!pmrsByWo.has(woId)) pmrsByWo.set(woId, []);
    pmrsByWo.get(woId).push(pmr);
  }

  for (const wo of workOrders) {
    const woId = Number(wo.id);
    const released = Boolean(wo.materialReleasedToProductionAt);
    const pmr = pickReleaseReadyPmr(pmrsByWo.get(woId) || []);
    const hasProductionEntry = (productionEntryCountByWo.get(woId) ?? 0) > 0;
    const execStatus = execStatusByWo.get(woId) ?? "NOT_STARTED";
    const executionStarted = execStatus !== "NOT_STARTED";
    const operational = resolveWorkOrderOperationalStatus(wo, wo.salesOrder);
    const productionInProgress =
      operational.authority === "WORK_ORDER_STATUS" && operational.workOrderStatus === "IN_PROGRESS";
    let blockReason = null;
    if (released) blockReason = "ALREADY_RELEASED";
    else if (!pmr) blockReason = "PMR_NOT_READY";
    else if (hasProductionEntry) blockReason = "PRODUCTION_ENTRY_EXISTS";
    else if (executionStarted) blockReason = "PRODUCTION_EXECUTION_STARTED";
    else if (productionInProgress) blockReason = "WORK_ORDER_IN_PROGRESS";
    else if (
      operational.productionClosed ||
      execStatus === "COMPLETED"
    ) {
      blockReason = "WORK_ORDER_CLOSED";
    }
    out.set(woId, {
      eligible: blockReason == null,
      blockReason,
      pmr,
      wo,
      hasProductionEntry,
      executionStarted,
      executionStatus: execStatus,
      released,
    });
  }
  return out;
}

function computeFreeStoreStockLine({ totalStoreStock, reservedForOtherOrdersQty }) {
  const total = round3(Math.max(0, n(totalStoreStock)));
  const reserved = round3(Math.max(0, n(reservedForOtherOrdersQty)));
  return {
    totalStoreStock: total,
    reservedForOtherOrdersQty: reserved,
    freeStoreStock: round3(Math.max(0, total - reserved)),
  };
}

async function loadReservedForOtherOpenPmrsByItem(db, { itemIds, excludePmrId }) {
  const ids = [...new Set((itemIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return new Map();
  const rows = await getMaterialAvailabilityByItems({
    db,
    itemIds: ids,
    excludePmrId,
    includeIncoming: false,
    includeIssued: false,
  });
  const out = new Map();
  for (const row of rows || []) {
    if (n(row.effectiveReservedQty) <= STOCK_EPS) continue;
    out.set(row.itemId, round3(n(row.effectiveReservedQty)));
  }
  return out;
}

function mapPmrLine(ln) {
  const required = n(ln.requiredQty);
  const issued = n(ln.issuedQty);
  const waived = n(ln.waivedQty);
  const effectiveRequired = effectiveRequiredQty(ln);
  const pending = pendingQty(ln);
  const excess = Math.max(0, issued - required);
  return {
    id: ln.id,
    itemId: ln.itemId,
    itemName: ln.item?.itemName ?? "",
    unit: ln.unitSnapshot || ln.item?.unit || "",
    requiredQty: required,
    originalRequiredQty: required,
    effectiveRequiredQty: effectiveRequired,
    issuedQty: issued,
    /** Alias for Store UI / reports — unissued qty closed without stock movement. */
    waivedQty: waived,
    shortIssueQty: waived,
    excessIssueQty: excess,
    pendingQty: pending,
    remainingQty: pending,
    issueIncrementSnapshot: ln.issueIncrementSnapshot != null ? n(ln.issueIncrementSnapshot) : null,
    roundedIssueTargetQty: ln.roundedIssueTargetQty != null ? n(ln.roundedIssueTargetQty) : null,
    productionRmQty: ln.productionRmQty != null ? n(ln.productionRmQty) : null,
    purgingRmQty: ln.purgingRmQty != null ? n(ln.purgingRmQty) : null,
  };
}

/**
 * M1.5 — Additive Store PMR readiness (read-only). Does not change issue/lifecycle rules.
 * UI must consume these instead of re-deriving actionable status locally.
 */
function derivePmrStoreIssueReadiness(status, totalPending) {
  const storeIssueReady =
    STORE_ISSUE_STATUSES.includes(String(status ?? "")) && n(totalPending) > STOCK_EPS;
  return {
    storeIssueReady,
    hasPendingIssueQty: n(totalPending) > STOCK_EPS,
    storeActionKey: storeIssueReady ? "ISSUE" : "NONE",
    storeActionLabel: storeIssueReady ? "Issue available RM" : "Not open for store issue",
  };
}

/**
 * Store Material Issue side-queue lifecycle (authoritative; not inferred from UI text).
 * READY_TO_ISSUE — nothing issued yet, actionable balance remains.
 * PARTIALLY_ISSUED — some issued, open balance remains, short-close not applied.
 * COMPLETE — obligation satisfied (fully issued).
 * SHORT_CLOSED — remaining balance explicitly closed (Short Issue Accepted).
 */
function derivePmrIssueQueueState(status, totalIssued, totalPending) {
  const st = String(status ?? "").toUpperCase();
  if (st === "SHORT_ISSUE_ACCEPTED") return "SHORT_CLOSED";
  if (st === "FULLY_ISSUED" || st === "CANCELLED") return "COMPLETE";
  if (st === "PARTIALLY_ISSUED") return "PARTIALLY_ISSUED";
  if (n(totalIssued) > STOCK_EPS && n(totalPending) > STOCK_EPS) return "PARTIALLY_ISSUED";
  if (STORE_ISSUE_STATUSES.includes(st) && n(totalPending) > STOCK_EPS) return "READY_TO_ISSUE";
  if (n(totalPending) > STOCK_EPS) return "READY_TO_ISSUE";
  return "COMPLETE";
}

/** Line readiness for Material Issue workspace (presentation of already-computed stock fields). */
function derivePmrIssueLineReadiness(line) {
  const pending = n(line.pmrPendingQty ?? line.pendingQty);
  const free = line.freeStoreStock == null && line.issueAvailableStoreQty == null && line.available == null
    ? null
    : n(line.freeStoreStock ?? line.issueAvailableStoreQty ?? line.available);
  const physical = n(line.totalStoreStock ?? line.physicalUsableStockQty ?? 0);
  const incoming = n(line.incomingQty ?? 0);
  const coveredByIncoming = n(line.coveredByIncomingQty ?? 0);

  if (pending <= STOCK_EPS) {
    return {
      lineReadinessKey: "COMPLETE",
      lineReadinessLabel: "Fully Issued",
      lineReadinessExplanation: null,
      waitingProcurement: false,
    };
  }
  if (free != null && free > STOCK_EPS) {
    if (free + STOCK_EPS < pending) {
      return {
        lineReadinessKey: "PARTIAL",
        lineReadinessLabel: "Partially available",
        lineReadinessExplanation: `Only ${free.toLocaleString()} available of ${pending.toLocaleString()} pending.`,
        waitingProcurement: incoming > STOCK_EPS || coveredByIncoming > STOCK_EPS,
      };
    }
    return {
      lineReadinessKey: "READY",
      lineReadinessLabel: "Ready to issue",
      lineReadinessExplanation: "Enter issue quantity when ready.",
      waitingProcurement: false,
    };
  }
  if (incoming > STOCK_EPS || coveredByIncoming > STOCK_EPS) {
    return {
      lineReadinessKey: "WAITING_PROCUREMENT",
      lineReadinessLabel: "Waiting procurement",
      lineReadinessExplanation: "Material is on order — waiting for procurement or GRN at store.",
      waitingProcurement: true,
    };
  }
  if (physical > STOCK_EPS) {
    return {
      lineReadinessKey: "COMMITTED_ELSEWHERE",
      lineReadinessLabel: "Committed to other WO",
      lineReadinessExplanation: "Physical stock exists but is committed to other work orders.",
      waitingProcurement: false,
    };
  }
  return {
    lineReadinessKey: "NO_STOCK",
    lineReadinessLabel: "No available stock",
    lineReadinessExplanation: "No free stock at the selected store location.",
    waitingProcurement: false,
  };
}

function mapPmrRow(row) {
  const lines = (row.lines || []).map(mapPmrLine);
  const totalRequired = lines.reduce((s, l) => s + l.requiredQty, 0);
  const totalEffectiveRequired = lines.reduce((s, l) => s + l.effectiveRequiredQty, 0);
  const totalIssued = lines.reduce((s, l) => s + l.issuedQty, 0);
  const totalWaived = lines.reduce((s, l) => s + l.waivedQty, 0);
  const totalExcessIssue = lines.reduce((s, l) => s + l.excessIssueQty, 0);
  const totalPending = lines.reduce((s, l) => s + l.pendingQty, 0);
  const storeReadiness = derivePmrStoreIssueReadiness(row.status, totalPending);
  const issueQueueState = derivePmrIssueQueueState(row.status, totalIssued, totalPending);
  const pendingLineCount = lines.filter((l) => n(l.pendingQty) > STOCK_EPS).length;
  const orderType = row.workOrder?.salesOrder?.orderType ?? null;
  let statusLabel =
    row.status === "SHORT_ISSUE_ACCEPTED"
      ? "Closed – Short Issue Accepted"
      : row.status === "FULLY_ISSUED"
        ? "Fully Issued"
        : row.status === "PARTIALLY_ISSUED"
          ? "Partially Issued"
          : row.status;
  let issueStatusKey = row.status;
  if (isRegularSoOrderType(orderType) && (totalRequired > STOCK_EPS || totalIssued > STOCK_EPS)) {
    const derived = deriveRegularSoRmIssueStatus({
      theoreticalRmRequiredQty: totalRequired,
      cumulativeRmIssuedQty: totalIssued,
      waivedQty: totalWaived,
      shortCloseReason: row.shortIssueCloseReason,
    });
    statusLabel = derived.statusLabel;
    issueStatusKey = derived.statusKey;
  } else if (row.status === "FULLY_ISSUED" && totalIssued > totalRequired + STOCK_EPS) {
    statusLabel = "Excess/Allowance Issued";
    issueStatusKey = "EXCESS_ALLOWANCE_ISSUED";
  }
  return {
    id: row.id,
    docNo: row.docNo,
    status: row.status,
    statusLabel,
    issueStatusKey,
    shortIssueCloseReason: row.shortIssueCloseReason ?? null,
    issueQueueState,
    remarks: row.remarks,
    workOrderId: row.workOrderId,
    workOrderNo: row.workOrder?.docNo ?? null,
    salesOrderId: row.workOrder?.salesOrderId ?? null,
    salesOrderNo: row.workOrder?.salesOrder?.docNo ?? null,
    orderType: orderType,
    requirementSheetId: row.workOrder?.requirementSheetId ?? null,
    requestedAt: row.requestedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lineCount: lines.length,
    pendingLineCount,
    totalRequired,
    totalOriginalRequired: totalRequired,
    totalEffectiveRequired,
    totalIssued,
    totalWaived,
    totalShortIssueQty: totalWaived,
    totalExcessIssue,
    totalPending,
    ...storeReadiness,
    lines,
    materialIssues: (row.materialIssueNotes || []).map((m) => ({
      id: m.id,
      docNo: m.docNo,
      createdAt: m.createdAt,
    })),
  };
}

async function recalcPmrStatus(tx, pmrId) {
  const pmr = await tx.productionMaterialRequest.findUnique({
    where: { id: pmrId },
    include: { lines: true },
  });
  if (!pmr || pmr.status === "CANCELLED" || pmr.status === "DRAFT") return pmr?.status;
  if (pmr.status === "SHORT_ISSUE_ACCEPTED") {
    await syncAllocationsForPmrIssueStatus(tx, pmrId);
    return pmr.status;
  }

  let allSatisfied = true;
  let anyIssued = false;
  let anyWaived = false;
  for (const ln of pmr.lines) {
    const ceiling =
      n(ln.roundedIssueTargetQty) > STOCK_EPS ? n(ln.roundedIssueTargetQty) : n(ln.requiredQty);
    const iss = n(ln.issuedQty);
    const waived = n(ln.waivedQty);
    if (iss > STOCK_EPS) anyIssued = true;
    if (waived > STOCK_EPS) anyWaived = true;
    if (iss + waived + STOCK_EPS < ceiling) allSatisfied = false;
  }

  let next = pmr.status;
  if (!anyIssued) next = "REQUESTED";
  else if (allSatisfied) {
    next = anyWaived ? "SHORT_ISSUE_ACCEPTED" : "FULLY_ISSUED";
  } else next = "PARTIALLY_ISSUED";

  if (next !== pmr.status) {
    await tx.productionMaterialRequest.update({ where: { id: pmrId }, data: { status: next } });
  }
  await syncAllocationsForPmrIssueStatus(tx, pmrId);
  return next;
}

/**
 * Persist WO-authoritative planned requirement (+ Kg rounding snapshots) onto an open PMR.
 * Safe for pre-migration PMRs that stored production-only requiredQty (missing planned purge).
 * Skips completed/closed PMRs. Never rewrites historical MIN rows.
 *
 * Persistence is per canonical RM itemId (update existing line; upsert only for truly new items).
 * Allocation refresh reuses MAL-{pmrId}-{itemId} so soft-cancel+create cannot hit P2002.
 */
async function reconcileOpenPmrPlannedRequirementAgainstWoPlan(pmrId, db = prisma, actor = {}) {
  const pmr = await db.productionMaterialRequest.findUnique({
    where: { id: pmrId },
    include: {
      lines: true,
      workOrder: { select: { id: true, salesOrderId: true, docNo: true } },
    },
  });
  if (!pmr) {
    const err = new Error("Production material request not found");
    err.statusCode = 404;
    throw err;
  }

  const status = String(pmr.status ?? "").toUpperCase();
  if (CLOSED_SKIP_STATUSES.has(status)) {
    return {
      pmrId,
      applied: false,
      skipped: true,
      skipReason: "PMR_CLOSED_OR_COMPLETE",
      reviewRequired: false,
      failed: false,
      lineResults: [],
    };
  }

  const suggestions = await buildBomSuggestionsForWorkOrder(pmr.workOrderId, db);
  const itemIds = [
    ...new Set([
      ...(pmr.lines || []).map((l) => Number(l.itemId)),
      ...(suggestions.lines || []).map((l) => Number(l.itemId)),
    ]),
  ].filter((id) => Number.isFinite(id) && id > 0);

  const items =
    itemIds.length > 0
      ? await db.item.findMany({
          where: { id: { in: itemIds } },
          include: { unitRef: { select: { unitCode: true, unitName: true } } },
        })
      : [];
  const itemsById = new Map(items.map((i) => [i.id, i]));

  const plan = planOpenPmrPlannedRequirementReconcile({
    pmr,
    suggestionLines: suggestions.lines,
    itemsById,
  });

  if (!plan.eligible || plan.skipped) {
    return {
      pmrId,
      applied: false,
      skipped: true,
      skipReason: plan.skipReason,
      reviewRequired: false,
      failed: false,
      lineResults: [],
      suggestions,
    };
  }

  if (!plan.changed) {
    return {
      pmrId,
      applied: false,
      skipped: false,
      reviewRequired: plan.reviewRequired,
      failed: false,
      lineResults: plan.linePlans,
      addLineResults: plan.addLinePlans,
      suggestions,
    };
  }

  const upsertPmrLineByItem = async (tx, patch) => {
    const itemId = Number(patch.itemId);
    const existing = await tx.productionMaterialRequestLine.findFirst({
      where: { productionMaterialRequestId: pmrId, itemId },
      select: { id: true, issuedQty: true },
    });
    if (existing) {
      return tx.productionMaterialRequestLine.update({
        where: { id: existing.id },
        data: {
          requiredQty: patch.requiredQty,
          productionRmQty: patch.productionRmQty,
          purgingRmQty: patch.purgingRmQty,
          issueIncrementSnapshot: patch.issueIncrementSnapshot,
          roundedIssueTargetQty: patch.roundedIssueTargetQty,
          ...(patch.unitSnapshot != null ? { unitSnapshot: patch.unitSnapshot } : {}),
        },
      });
    }
    return tx.productionMaterialRequestLine.create({
      data: {
        productionMaterialRequestId: pmrId,
        itemId,
        requiredQty: patch.requiredQty,
        issuedQty: "0",
        unitSnapshot: patch.unitSnapshot || null,
        productionRmQty: patch.productionRmQty,
        purgingRmQty: patch.purgingRmQty,
        issueIncrementSnapshot: patch.issueIncrementSnapshot,
        roundedIssueTargetQty: patch.roundedIssueTargetQty,
      },
    });
  };

  const run = async (tx) => {
    for (const lp of plan.linePlans) {
      if (lp.action !== "UPDATE" || !lp.patch || !lp.lineId) continue;
      await tx.productionMaterialRequestLine.update({
        where: { id: lp.lineId },
        data: lp.patch,
      });
    }
    for (const ap of plan.addLinePlans) {
      if (ap.action !== "UPSERT" || !ap.patch) continue;
      await upsertPmrLineByItem(tx, ap.patch);
    }

    const refreshed = await tx.productionMaterialRequest.findUnique({
      where: { id: pmrId },
      include: {
        lines: true,
        workOrder: { select: { salesOrderId: true } },
      },
    });
    if (refreshed) {
      await refreshAllocationsForOpenPmrReconcile(
        tx,
        {
          ...refreshed,
          salesOrderId: refreshed.workOrder?.salesOrderId ?? pmr.workOrder?.salesOrderId,
        },
        refreshed.lines,
        actor,
      );
    }
  };

  try {
    if (typeof db?.$transaction === "function") {
      await db.$transaction(run);
    } else {
      await run(db);
    }
  } catch (err) {
    const detail = describePrismaUniqueViolation(err);
    console.error("[pmr-reconcile] failed", {
      pmrId,
      prismaCode: detail.code,
      model: detail.model,
      constraint: detail.constraint || detail.target,
      message: detail.message,
      /**
       * Historical failure mode before fix:
       * cancelAllocationsForPmr (soft CANCELLED) + createAllocationsForPmr createMany
       * reusing allocationNo MAL-{pmrId}-{itemId} → P2002 on MaterialAllocation.allocationNo.
       * Alternate: create second ProductionMaterialRequestLine for same itemId → P2002 on
       * PmrLine_pmrId_itemId_key when production+purge were not aggregated.
       */
      failedOperationHint:
        detail.target === "allocationNo" || /allocationNo/i.test(detail.message)
          ? "MaterialAllocation.allocationNo unique (MAL-{pmrId}-{itemId}) during allocation refresh"
          : detail.target?.includes?.("itemId") || /PmrLine_pmrId_itemId/i.test(detail.message)
            ? "ProductionMaterialRequestLine unique (productionMaterialRequestId, itemId)"
            : "unknown unique / transaction failure during PMR planned-requirement reconcile",
    });
    const soft = new Error(OPERATOR_RECONCILE_FAILED_MESSAGE);
    soft.statusCode = 409;
    soft.code = "PMR_PLANNED_REQUIREMENT_RECONCILE_FAILED";
    soft.cause = err;
    soft.reconcileFailed = true;
    soft.prismaDetail = detail;
    throw soft;
  }

  return {
    pmrId,
    applied: true,
    skipped: false,
    reviewRequired: plan.reviewRequired,
    failed: false,
    lineResults: plan.linePlans,
    addLineResults: plan.addLinePlans,
    suggestions,
  };
}

/**
 * BOM-based RM suggestions for a work order (approved BOM explosion on planned FG qty).
 * Includes production/shot RM (runner in baseQty) + planned purging once.
 */
async function buildBomSuggestionsForWorkOrder(workOrderId, db = prisma) {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      lines: { include: { fgItem: { select: { id: true, itemName: true } } } },
      salesOrder: { select: { docNo: true } },
    },
  });
  if (!wo) {
    const err = new Error("Work order not found");
    err.statusCode = 404;
    throw err;
  }

  const fgLines = [];
  for (const ln of wo.lines) {
    const bom = await loadApprovedBomWithLines(db, ln.fgItemId);
    const planned = n(ln.plannedQty) > STOCK_EPS ? n(ln.plannedQty) : n(ln.qty);
    fgLines.push({
      fgItemId: ln.fgItemId,
      fgItemName: ln.fgItem?.itemName ?? "",
      fgQty: planned,
      bomMissing: !bom?.lines?.length,
    });
  }

  const { rmNeeded, missingChildBoms } = await aggregateRmDemandForFgLines(db, fgLines);
  const productionRmByItemId = snapshotProductionRmMap(rmNeeded);
  const plannedPurgeCount = n(wo.plannedPurgeCount);
  const purgingPlanning = await buildPurgingPlanningSummary(db, fgLines, { plannedPurgeCount });
  mergePurgingIntoRmNeeded(rmNeeded, purgingPlanning.purgingRmByItemId);

  const itemIds = [...rmNeeded.keys()];
  const items =
    itemIds.length > 0
      ? await db.item.findMany({
          where: { id: { in: itemIds } },
          select: {
            id: true,
            itemName: true,
            unit: true,
            itemType: true,
            issueIncrement: true,
            unitRef: { select: { unitCode: true, unitName: true } },
          },
        })
      : [];
  const itemById = new Map(items.map((i) => [i.id, i]));

  const lines = [...rmNeeded.entries()]
    .map(([itemId, requiredQty]) => {
      const it = itemById.get(itemId);
      const productionRmQty = n(productionRmByItemId.get(itemId));
      const purgingRmQty = round3(Math.max(0, n(requiredQty) - productionRmQty));
      const increment = n(it?.issueIncrement);
      const applies = kgIssueRoundingApplies(it, { issueIncrement: increment });
      const roundedIssueTargetQty = applies
        ? computeRoundedIssueTargetQty(requiredQty, increment)
        : null;
      return {
        itemId,
        itemName: it?.itemName ?? `Item #${itemId}`,
        unit: it?.unit ?? "",
        itemType: it?.itemType ?? "RM",
        requiredQty,
        productionRmQty,
        purgingRmQty,
        issueIncrement: applies ? increment : null,
        roundedIssueTargetQty,
        issuedQty: 0,
        pendingQty: applies ? roundedIssueTargetQty : requiredQty,
      };
    })
    .sort((a, b) => a.itemName.localeCompare(b.itemName));

  return {
    workOrderId: wo.id,
    workOrderNo: wo.docNo,
    salesOrderNo: wo.salesOrder?.docNo ?? null,
    plannedPurgeCount,
    fgLines,
    lines,
    missingChildBoms,
  };
}

async function loadApprovedProducedQtyByWorkOrderLine(db, workOrderLineIds) {
  if (!workOrderLineIds.length) return new Map();
  const rows = await db.productionEntry.groupBy({
    by: ["workOrderLineId"],
    where: {
      workOrderLineId: { in: workOrderLineIds },
      workflowStatus: "APPROVED",
    },
    _sum: { producedQty: true },
  });
  return new Map(rows.map((r) => [r.workOrderLineId, n(r._sum.producedQty)]));
}

async function buildWorkOrderMaterialIssueSnapshot(db, workOrderId, fromLocationId = null) {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      docNo: true,
      status: true,
      salesOrder: { select: { id: true, docNo: true, orderType: true } },
      lines: {
        select: {
          id: true,
          fgItemId: true,
          qty: true,
          plannedQty: true,
          fgItem: { select: { id: true, itemName: true } },
        },
      },
    },
  });
  if (!wo) {
    const err = new Error("Work order not found");
    err.statusCode = 404;
    throw err;
  }

  const workOrderLineIds = (wo.lines || []).map((ln) => ln.id);
  const approvedProducedByLine = await loadApprovedProducedQtyByWorkOrderLine(db, workOrderLineIds);
  const shortfallClosed = String(wo.status) === "CLOSED_WITH_SHORTFALL";

  const fullFgLines = [];
  const balanceFgLines = [];
  const fgLineSummaries = [];
  for (const ln of wo.lines || []) {
    const planned = n(ln.plannedQty) > STOCK_EPS ? n(ln.plannedQty) : n(ln.qty);
    const produced = n(approvedProducedByLine.get(ln.id));
    const shortfallQty = shortfallClosed ? Math.max(0, planned - produced) : 0;
    const remaining = Math.max(0, planned - produced - shortfallQty);
    fgLineSummaries.push({
      workOrderLineId: ln.id,
      fgItemId: ln.fgItemId,
      fgItemName: ln.fgItem?.itemName ?? "",
      plannedQty: round3(planned),
      approvedProducedQty: round3(produced),
      shortfallClosedQty: round3(shortfallQty),
      remainingQty: round3(remaining),
    });
    fullFgLines.push({
      fgItemId: ln.fgItemId,
      fgItemName: ln.fgItem?.itemName ?? "",
      fgQty: planned,
      bomMissing: false,
    });
    if (remaining > STOCK_EPS) {
      balanceFgLines.push({
        fgItemId: ln.fgItemId,
        fgItemName: ln.fgItem?.itemName ?? "",
        fgQty: remaining,
        bomMissing: false,
      });
    }
  }

  const [fullDemand, balanceDemand, prodLocIds, issuedMap, returnedMap] = await Promise.all([
    aggregateRmDemandForFgLines(db, fullFgLines),
    aggregateRmDemandForFgLines(db, balanceFgLines),
    getWorkOrderProductionLocationIdsForReturn(db, wo.id),
    loadIssuedByWorkOrderFromMaterialIssues(db, wo.id),
    loadReturnedByWorkOrder(db, wo.id),
  ]);
  const consumedMap = await loadNetConsumedAtProduction(db, wo.id, prodLocIds);

  const itemIds = new Set([
    ...fullDemand.rmNeeded.keys(),
    ...balanceDemand.rmNeeded.keys(),
    ...issuedMap.keys(),
    ...consumedMap.keys(),
    ...returnedMap.keys(),
  ]);
  const items =
    itemIds.size > 0
      ? await db.item.findMany({
          where: { id: { in: [...itemIds] } },
          select: { id: true, itemName: true, unit: true },
        })
      : [];
  const itemById = new Map(items.map((it) => [it.id, it]));

  const linesByItemId = new Map();
  for (const itemId of itemIds) {
    const available =
      fromLocationId != null
        ? await getItemStockQty(itemId, db, { stockBucket: "USABLE", locationId: fromLocationId })
        : null;
    const calc = computeMaterialIssuePlanLine({
      fullWoRmNeed: fullDemand.rmNeeded.get(itemId) ?? 0,
      consumedQty: consumedMap.get(itemId) ?? 0,
      returnedQty: returnedMap.get(itemId) ?? 0,
      issuedToProductionQty: issuedMap.get(itemId) ?? 0,
      requiredForBalanceQty: balanceDemand.rmNeeded.get(itemId) ?? 0,
      availableInStore: available,
    });
    linesByItemId.set(itemId, {
      itemId,
      itemName: itemById.get(itemId)?.itemName ?? `Item #${itemId}`,
      unit: itemById.get(itemId)?.unit ?? "",
      ...calc,
    });
  }

  return {
    workOrderId: wo.id,
    workOrderNo: wo.docNo,
    orderType: wo.salesOrder?.orderType ?? null,
    fgLines: fgLineSummaries,
    linesByItemId,
    missingChildBoms: [
      ...(fullDemand.missingChildBoms || []),
      ...(balanceDemand.missingChildBoms || []),
    ],
  };
}

async function listProductionMaterialRequests(db = prisma, { status, pendingForStore, limit = 100 } = {}) {
  /** @type {import('@prisma/client').Prisma.ProductionMaterialRequestWhereInput} */
  const where = {};
  if (pendingForStore) {
    where.status = { in: STORE_ISSUE_STATUSES };
  } else if (status) {
    where.status = status;
  }

  const rows = await db.productionMaterialRequest.findMany({
    where,
    orderBy: { id: "desc" },
    take: limit,
    include: {
      workOrder: {
        select: {
          id: true,
          docNo: true,
          salesOrderId: true,
          cycleId: true,
          requirementSheetId: true,
          salesOrder: { select: { docNo: true, orderType: true } },
        },
      },
      lines: { include: { item: { select: { id: true, itemName: true, unit: true } } } },
      materialIssueNotes: { select: { id: true, docNo: true, createdAt: true }, orderBy: { id: "desc" } },
    },
  });
  const mapped = rows.map(mapPmrRow);
  const woRows = rows.map((r) => ({
    id: r.workOrderId,
    salesOrderId: r.workOrder?.salesOrderId,
    cycleId: r.workOrder?.cycleId,
    requirementSheetId: r.workOrder?.requirementSheetId,
    salesOrder: r.workOrder?.salesOrder,
  }));
  const visibleWoIds = new Set(
    (await filterNoQtyExecutionReleasedWorkOrders(db, woRows)).map((wo) => wo.id),
  );
  return mapped.filter((pmr) => visibleWoIds.has(pmr.workOrderId));
}

async function getProductionMaterialRequestById(id, db = prisma) {
  const row = await db.productionMaterialRequest.findUnique({
    where: { id },
    include: {
      workOrder: {
        select: { docNo: true, salesOrder: { select: { docNo: true, orderType: true } } },
      },
      lines: { include: { item: { select: { id: true, itemName: true, unit: true } } } },
      materialIssueNotes: { select: { id: true, docNo: true, createdAt: true }, orderBy: { id: "desc" } },
    },
  });
  if (!row) {
    const err = new Error("Production material request not found");
    err.statusCode = 404;
    throw err;
  }
  return mapPmrRow(row);
}

async function getExistingProductionMaterialRequestForWorkOrder(workOrderId, db = prisma, opts = {}) {
  const woId = Number(workOrderId);
  if (!Number.isFinite(woId) || woId <= 0) {
    const err = new Error("Work order id is required.");
    err.statusCode = 400;
    throw err;
  }

  const statuses = Array.isArray(opts.statuses) && opts.statuses.length ? opts.statuses : PMR_EXISTING_WORKFLOW_STATUSES;
  const rows = await db.productionMaterialRequest.findMany({
    where: { workOrderId: woId, status: { in: statuses } },
    orderBy: { id: "desc" },
    select: { id: true, status: true },
  });
  if (!rows.length) return null;
  const row = opts.preferIssued ? [...rows].sort(sortPmrsByIssuedPriority)[0] : rows[0];
  return getProductionMaterialRequestById(row.id, db);
}

/**
 * @param {{ workOrderId: number, remarks?: string | null, lines?: Array<{ itemId: number, requiredQty: number }>, useBom?: boolean }} input
 */
async function createProductionMaterialRequest(input, actor = {}, db = prisma) {
  return runInTransaction(db, async (tx) => {
    const wo = await tx.workOrder.findUnique({
      where: { id: input.workOrderId },
      include: { salesOrder: { select: { orderType: true } } },
    });
    if (!wo) {
      const err = new Error("Work order not found");
      err.statusCode = 404;
      throw err;
    }
    await assertNoQtyWorkOrderExecutionReleased(tx, input.workOrderId, "Material request");
    if (!["PENDING", "IN_PROGRESS"].includes(wo.status)) {
      const err = new Error("Work order must be pending or in progress to request material.");
      err.statusCode = 400;
      throw err;
    }

    const existingPmr = await tx.productionMaterialRequest.findFirst({
      where: { workOrderId: input.workOrderId, status: { not: "CANCELLED" } },
      orderBy: { id: "asc" },
      select: { id: true, docNo: true, status: true },
    });
    if (existingPmr && !input.allowApprovedAdditionalRmRequest) {
      const err = new Error("A PMR already exists for this work order.");
      err.statusCode = 409;
      err.code = "PMR_ALREADY_EXISTS_FOR_WORK_ORDER";
      err.details = {
        pmrId: existingPmr.id,
        pmrDocNo: existingPmr.docNo ?? null,
        pmrStatus: existingPmr.status,
      };
      throw err;
    }

    let linePayload = input.lines;
    let suggestionByItemId = new Map();
    if (!linePayload?.length && input.useBom !== false) {
      const bom = await buildBomSuggestionsForWorkOrder(input.workOrderId, tx);
      linePayload = bom.lines.map((l) => ({
        itemId: l.itemId,
        requiredQty: l.requiredQty,
        productionRmQty: l.productionRmQty,
        purgingRmQty: l.purgingRmQty,
        issueIncrement: l.issueIncrement,
        roundedIssueTargetQty: l.roundedIssueTargetQty,
      }));
      suggestionByItemId = new Map(bom.lines.map((l) => [l.itemId, l]));
    }
    if (!linePayload?.length) {
      const err = new Error("Add at least one RM line or enable BOM suggestions.");
      err.statusCode = 400;
      throw err;
    }

    const itemIds = [...new Set(linePayload.map((l) => l.itemId))];
    const items = await tx.item.findMany({
      where: { id: { in: itemIds } },
      include: { unitRef: { select: { unitCode: true, unitName: true } } },
    });
    if (items.length !== itemIds.length) {
      const err = new Error("One or more items not found");
      err.statusCode = 400;
      throw err;
    }
    const bad = items.filter((i) => i.itemType !== "RM");
    if (bad.length) {
      const err = new Error("Only RM items can be requested.");
      err.statusCode = 400;
      throw err;
    }
    const itemById = new Map(items.map((i) => [i.id, i]));

    const docNo = await allocateDocNo(tx, { docType: DocType.PRODUCTION_MATERIAL_REQUEST, date: new Date() });
    const pmr = await tx.productionMaterialRequest.create({
      data: {
        docNo,
        workOrderId: input.workOrderId,
        status: "DRAFT",
        remarks: input.remarks?.trim() || null,
        createdByUserId: actor.userId ?? null,
        lines: {
          create: linePayload.map((l) => {
            const qty = n(l.requiredQty);
            if (qty <= STOCK_EPS) {
              const err = new Error("Required qty must be positive.");
              err.statusCode = 400;
              throw err;
            }
            const it = itemById.get(l.itemId);
            const suggestion = suggestionByItemId.get(l.itemId);
            const increment =
              l.issueIncrement != null
                ? n(l.issueIncrement)
                : suggestion?.issueIncrement != null
                  ? n(suggestion.issueIncrement)
                  : n(it?.issueIncrement);
            const applies = kgIssueRoundingApplies(it, { issueIncrement: increment });
            const rounded =
              l.roundedIssueTargetQty != null
                ? n(l.roundedIssueTargetQty)
                : applies
                  ? computeRoundedIssueTargetQty(qty, increment)
                  : null;
            return {
              itemId: l.itemId,
              requiredQty: String(qty),
              unitSnapshot: it?.unit ?? null,
              productionRmQty:
                l.productionRmQty != null
                  ? String(n(l.productionRmQty))
                  : suggestion?.productionRmQty != null
                    ? String(n(suggestion.productionRmQty))
                    : null,
              purgingRmQty:
                l.purgingRmQty != null
                  ? String(n(l.purgingRmQty))
                  : suggestion?.purgingRmQty != null
                    ? String(n(suggestion.purgingRmQty))
                    : null,
              issueIncrementSnapshot: applies ? String(increment) : null,
              roundedIssueTargetQty: applies && rounded != null ? String(rounded) : null,
            };
          }),
        },
      },
      include: {
        workOrder: { select: { docNo: true, salesOrderId: true, salesOrder: { select: { docNo: true } } } },
        lines: { include: { item: true } },
        materialIssueNotes: true,
      },
    });

    await createAllocationsForPmr(
      tx,
      { ...pmr, salesOrderId: wo.salesOrderId, workOrderId: input.workOrderId },
      pmr.lines,
      actor,
    );

    return mapPmrRow(pmr);
  });
}

async function submitProductionMaterialRequest(pmrId, actor = {}, db = prisma) {
  return runInTransaction(db, async (tx) => {
    const pmr = await tx.productionMaterialRequest.findUnique({
      where: { id: pmrId },
      include: { lines: true },
    });
    if (!pmr) {
      const err = new Error("Production material request not found");
      err.statusCode = 404;
      throw err;
    }
    if (pmr.status !== "DRAFT") {
      const err = new Error("Only draft requests can be submitted.");
      err.statusCode = 400;
      throw err;
    }
    if (!pmr.lines.length) {
      const err = new Error("Add at least one line before submitting.");
      err.statusCode = 400;
      throw err;
    }

    await tx.productionMaterialRequest.update({
      where: { id: pmrId },
      data: {
        status: "REQUESTED",
        requestedAt: new Date(),
        requestedByUserId: actor.userId ?? null,
      },
    });

    const userId = actor.userId;
    if (typeof userId === "number" && Number.isFinite(userId)) {
      await auditLog.write(tx, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `PMR:${pmrId}`,
        actorUserId: userId,
        actorRole: actor.role,
        summary: `PMR ${pmr.docNo || pmrId} submitted for store issue`,
        payload: { module: "PMR", actionLabel: "REQUESTED", ref: { type: "PMR", id: String(pmrId), no: pmr.docNo } },
      });
    }

    return getProductionMaterialRequestById(pmrId, tx);
  });
}

async function cancelProductionMaterialRequest(pmrId, actor = {}, db = prisma) {
  return runInTransaction(db, async (tx) => {
    const pmr = await tx.productionMaterialRequest.findUnique({ where: { id: pmrId } });
    if (!pmr) {
      const err = new Error("Production material request not found");
      err.statusCode = 404;
      throw err;
    }
    if (pmr.status === "FULLY_ISSUED") {
      const err = new Error("Fully issued requests cannot be cancelled.");
      err.statusCode = 400;
      throw err;
    }
    const withLines = await tx.productionMaterialRequest.findUnique({
      where: { id: pmrId },
      include: { lines: true },
    });
    if (withLines?.lines?.some((l) => n(l.issuedQty) > STOCK_EPS)) {
      const err = new Error("Cannot cancel after material has been issued.");
      err.statusCode = 400;
      throw err;
    }

    await tx.productionMaterialRequest.update({
      where: { id: pmrId },
      data: { status: "CANCELLED" },
    });
    await cancelAllocationsForPmr(tx, pmrId, actor);
    return getProductionMaterialRequestById(pmrId, tx);
  });
}

/**
 * Reuse the PMR for a regular work order so Store issue can proceed.
 * Creation is allowed only for explicit WO creation paths that pass allowCreate.
 */
async function ensureSubmittedProductionMaterialRequestForWorkOrder(workOrderId, actor = {}, db = prisma, opts = {}) {
  await assertNoQtyWorkOrderExecutionReleased(db, workOrderId, "Material request");
  const woId = Number(workOrderId);
  if (!Number.isFinite(woId) || woId <= 0) {
    const err = new Error("Work order id is required.");
    err.statusCode = 400;
    throw err;
  }

  const existingWorkflowPmr = await db.productionMaterialRequest.findFirst({
    where: { workOrderId: woId, status: { in: PMR_EXISTING_WORKFLOW_STATUSES } },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  if (existingWorkflowPmr) {
    return getProductionMaterialRequestById(existingWorkflowPmr.id, db);
  }

  const existingDraft = await db.productionMaterialRequest.findFirst({
    where: { workOrderId: woId, status: "DRAFT" },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  if (existingDraft) {
    return submitProductionMaterialRequest(existingDraft.id, actor, db);
  }

  if (!opts.allowCreate) {
    const err = new Error("No PMR exists for this work order.");
    err.statusCode = 404;
    err.code = "PMR_NOT_FOUND_FOR_WORK_ORDER";
    throw err;
  }

  const created = await createProductionMaterialRequest({ workOrderId: woId, useBom: true }, actor, db);
  return submitProductionMaterialRequest(created.id, actor, db);
}

/**
 * Store issues material against PMR → creates MIN + updates issued qty on PMR lines.
 */
async function issueMaterialAgainstPmr(pmrId, input, actor = {}) {
  try {
    const reconcile = await reconcileOpenPmrPlannedRequirementAgainstWoPlan(pmrId, prisma, actor);
    if (reconcile.reviewRequired) {
      const err = new Error(
        "PMR planned requirement needs manual review after WO reconcile before further issue.",
      );
      err.statusCode = 409;
      err.code = "PMR_RECONCILE_REVIEW_REQUIRED";
      throw err;
    }
  } catch (err) {
    if (err?.code === "PMR_RECONCILE_REVIEW_REQUIRED") throw err;
    if (err?.reconcileFailed || err?.code === "PMR_PLANNED_REQUIREMENT_RECONCILE_FAILED") {
      throw err;
    }
    throw err;
  }

  const pmr = await prisma.productionMaterialRequest.findUnique({
    where: { id: pmrId },
    include: { lines: true, workOrder: { include: { salesOrder: { select: { orderType: true } } } } },
  });
  if (!pmr) {
    const err = new Error("Production material request not found");
    err.statusCode = 404;
    throw err;
  }
  if (!STORE_ISSUE_STATUSES.includes(pmr.status)) {
    const err = new Error("This request is not open for store issue.");
    err.statusCode = 400;
    throw err;
  }
  if (!input.lines?.length) {
    const err = new Error("Add at least one line to issue.");
    err.statusCode = 400;
    throw err;
  }

  const lineById = new Map(pmr.lines.map((l) => [l.id, l]));
  const itemIds = [...new Set(pmr.lines.map((l) => l.itemId))];
  const [issueAvailabilityRows, woLines, items] = await Promise.all([
    getMaterialAvailabilityByItems({
      db: prisma,
      itemIds,
      excludePmrId: pmrId,
      locationScope: { locationId: input.fromLocationId },
      includeIncoming: false,
      includeIssued: false,
    }),
    prisma.workOrderLine.findMany({
      where: { workOrderId: pmr.workOrderId },
      select: { fgItemId: true, plannedQty: true, qty: true },
    }),
    prisma.item.findMany({
      where: { id: { in: itemIds } },
      include: { unitRef: { select: { unitCode: true, unitName: true } } },
    }),
  ]);
  const issueAvailabilityByItem = new Map(issueAvailabilityRows.map((row) => [row.itemId, row]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const fgItemIds = [...new Set(woLines.map((ln) => ln.fgItemId).filter(Boolean))];
  const approvedBoms = fgItemIds.length
    ? await prisma.bom.findMany({
        where: { fgItemId: { in: fgItemIds }, status: "APPROVED" },
        orderBy: [{ fgItemId: "asc" }, { revisionNo: "desc" }],
        select: { fgItemId: true, fgWeight: true, runnerWeight: true },
      })
    : [];
  const bomByFg = new Map();
  for (const bom of approvedBoms) {
    if (!bomByFg.has(bom.fgItemId)) bomByFg.set(bom.fgItemId, bom);
  }
  let weightedFgWeight = 0;
  let weightedRunnerWeight = 0;
  let weightBasis = 0;
  for (const ln of woLines) {
    const bom = bomByFg.get(ln.fgItemId);
    if (!bom) continue;
    const fgQty = Math.max(0, n(ln.plannedQty) > STOCK_EPS ? n(ln.plannedQty) : n(ln.qty));
    if (fgQty <= STOCK_EPS) continue;
    weightedFgWeight += n(bom.fgWeight) * fgQty;
    weightedRunnerWeight += n(bom.runnerWeight) * fgQty;
    weightBasis += fgQty;
  }
  const snapshotFgWeight = weightBasis > STOCK_EPS ? weightedFgWeight / weightBasis : 0;
  const snapshotRunnerWeight = weightBasis > STOCK_EPS ? weightedRunnerWeight / weightBasis : 0;
  const issueLines = [];
  const overIssueAuditLines = [];
  for (const row of input.lines) {
    const pl = lineById.get(row.pmrLineId);
    if (!pl) {
      const err = new Error("Invalid PMR line.");
      err.statusCode = 400;
      throw err;
    }
    const qty = n(row.issueQty);
    if (qty <= STOCK_EPS) continue;
    const item = itemById.get(pl.itemId);
    const availability = issueAvailabilityByItem.get(pl.itemId);
    const freeStoreStock = n(availability?.freeStockQty);
    const roundingPlan = resolvePmrLineIssueRounding({
      line: pl,
      item,
      availableQty: freeStoreStock,
    });
    assertIssueWithinRoundingTarget({ issueQty: qty, plan: roundingPlan, itemId: pl.itemId });

    // PMR requiredQty is planned requirement (BOM+runner+purge). Runner not added again.
    const theoreticalBomQty = n(pl.requiredQty);
    const alreadyIssuedQty = n(pl.issuedQty);
    const kgRounded = Boolean(roundingPlan.applies);

    let planning;
    let approvedAllowanceRequest = null;
    if (kgRounded) {
      // Kg upward rounding replaces free Add Qty / Planned Process Allowance on normal issue.
      if (n(row.enteredAllowanceQty ?? row.plannedAllowanceQty ?? 0) > STOCK_EPS) {
        const err = new Error(
          "Add Qty / Planned Process Allowance is not used for Kg RM issue. Unexpected extra RM requires an Additional Material Request.",
        );
        err.statusCode = 400;
        err.code = "KG_RM_USE_ADDITIONAL_MATERIAL_REQUEST";
        throw err;
      }
      planning = {
        allowanceInputSource: "QUANTITY",
        theoreticalBomQty,
        enteredAllowancePct: 0,
        enteredAllowanceQty: 0,
        plannedAllowancePct: 0,
        plannedAllowanceQty: 0,
        recommendedIssueQty: roundingPlan.suggestedIssueQty,
        allowanceReason: null,
        approvalStatus: null,
        requiresAdminApproval: false,
      };
    } else {
      const enteredAllowanceQty = row.enteredAllowanceQty ?? row.plannedAllowanceQty ?? 0;
      if (String(actor.role || "").toUpperCase() !== "ADMIN") {
        approvedAllowanceRequest = await resolveApprovedRequestForIssue(
          {
            pmrLineId: pl.id,
            allowanceApprovalRequestId: row.allowanceApprovalRequestId,
            enteredAllowanceQty,
            issueQty: qty,
            theoreticalBomQty,
            alreadyIssuedQty,
          },
          prisma,
        );
      }
      planning = validatePlannedProcessAllowance(
        {
          allowanceInputSource: "QUANTITY",
          theoreticalBomQty,
          alreadyIssuedQty,
          issueQty: qty,
          enteredAllowanceQty,
          plannedAllowanceQty: enteredAllowanceQty,
          recommendedIssueQty: row.recommendedIssueQty,
          allowanceReason: row.allowanceReason,
        },
        { ...actor, mode: "ISSUE", approvedAllowanceRequest },
      );
      if (isRegularSoOrderType(pmr.workOrder?.salesOrder?.orderType)) {
        assertRegularSoCumulativeAllowanceGate({
          theoreticalRmRequiredQty: theoreticalBomQty,
          cumulativeNetIssuedAfter: alreadyIssuedQty + qty,
          role: actor.role,
          hasApprovedRequest: Boolean(approvedAllowanceRequest),
        });
      }
    }

    const includedRunnerQty = recoverIncludedRunnerQty(
      theoreticalBomQty,
      snapshotFgWeight,
      snapshotRunnerWeight,
    );
    const issuePosition = kgRounded
      ? { excessIssueQty: Math.max(0, alreadyIssuedQty + qty - theoreticalBomQty) }
      : assessIssueAgainstPlannedAllowance({
          issueQty: qty,
          alreadyIssuedQty,
          theoreticalBomQty,
          extraAllowanceQty: planning.plannedAllowanceQty,
        });
    const overIssueQty = issuePosition.excessIssueQty;
    if (qty > freeStoreStock + STOCK_EPS) {
      const err = new Error(
        `Issue qty exceeds free store stock for item #${pl.itemId}. Free: ${round3(freeStoreStock)}, requested: ${round3(qty)}.`,
      );
      err.statusCode = 409;
      err.code = "PMR_FREE_STOCK_EXCEEDED";
      throw err;
    }
    issueLines.push({
      itemId: pl.itemId,
      issueQty: qty,
      pmrLineId: pl.id,
      theoreticalBomQty,
      includedRunnerQty,
      skipPlannedAllowance: kgRounded,
      alreadyIssuedQty,
      allowanceInputSource: planning.allowanceInputSource,
      enteredAllowancePct: planning.enteredAllowancePct,
      enteredAllowanceQty: planning.enteredAllowanceQty,
      plannedAllowancePct: planning.plannedAllowancePct,
      plannedAllowanceQty: planning.plannedAllowanceQty,
      recommendedIssueQty: planning.recommendedIssueQty,
      allowanceReason: planning.allowanceReason,
      allowanceApprovalRequestId: approvedAllowanceRequest?.id ?? null,
      issueIncrementSnapshot: roundingPlan.applies ? roundingPlan.issueIncrement : null,
      plannedRequiredQtySnapshot: roundingPlan.applies ? roundingPlan.plannedRequiredQty : null,
      roundedIssueTargetQty: roundingPlan.applies ? roundingPlan.roundedIssueTargetQty : null,
      roundingExcessQty: roundingPlan.applies ? roundingPlan.roundingExcessQty : null,
    });
    if (overIssueQty > STOCK_EPS && !kgRounded) {
      overIssueAuditLines.push({
        pmrLineId: pl.id,
        itemId: pl.itemId,
        pendingQty: pendingQty(pl),
        recommendedIssueQty: planning.recommendedIssueQty,
        issueQty: qty,
        overIssueQty,
        requiredQty: n(pl.requiredQty),
        issuedQtyBefore: n(pl.issuedQty),
      });
    }
  }
  if (!issueLines.length) {
    const err = new Error("Add at least one positive issue quantity.");
    err.statusCode = 400;
    throw err;
  }

  const overIssueRemark =
    overIssueAuditLines.length > 0
      ? ` Excess issue: ${overIssueAuditLines
          .map((l) => `item #${l.itemId} +${round3(l.overIssueQty)}`)
          .join("; ")}.`
      : "";
  const baseRemarks = input.remarks?.trim() || `Issue against ${pmr.docNo || `PMR-${pmrId}`}`;

  const note = await prisma.$transaction(async (tx) => {
    const created = await createMaterialIssueNote(
      {
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        workOrderId: pmr.workOrderId,
        productionMaterialRequestId: pmrId,
        remarks: `${baseRemarks}${overIssueRemark}`,
        lines: issueLines.map((l) => ({
          itemId: l.itemId,
          issueQty: l.issueQty,
          pmrLineId: l.pmrLineId,
          theoreticalBomQty: l.theoreticalBomQty,
          includedRunnerQty: l.includedRunnerQty,
          skipPlannedAllowance: l.skipPlannedAllowance,
          allowanceInputSource: l.allowanceInputSource,
          enteredAllowancePct: l.enteredAllowancePct,
          enteredAllowanceQty: l.enteredAllowanceQty,
          plannedAllowancePct: l.plannedAllowancePct,
          plannedAllowanceQty: l.plannedAllowanceQty,
          recommendedIssueQty: l.recommendedIssueQty,
          allowanceReason: l.allowanceReason,
          allowanceApprovalRequestId: l.allowanceApprovalRequestId,
          alreadyIssuedQty: n(lineById.get(l.pmrLineId)?.issuedQty),
          issueIncrementSnapshot: l.issueIncrementSnapshot,
          plannedRequiredQtySnapshot: l.plannedRequiredQtySnapshot,
          roundedIssueTargetQty: l.roundedIssueTargetQty,
          roundingExcessQty: l.roundingExcessQty,
        })),
      },
      actor,
      tx,
    );

    for (const il of issueLines) {
      const pl = lineById.get(il.pmrLineId);
      const nextIssued = n(pl.issuedQty) + il.issueQty;
      await tx.productionMaterialRequestLine.update({
        where: { id: il.pmrLineId },
        data: { issuedQty: String(nextIssued) },
      });
      if (il.allowanceApprovalRequestId) {
        await markRmAllowanceApprovalIssued(
          il.allowanceApprovalRequestId,
          { materialIssueNoteId: created.id, userId: actor.userId },
          tx,
        );
      } else {
        // ≤5% (or Admin direct) issue — clear leftover Rejected/Approved so PAs stay accurate.
        await clearStaleAllowanceRequestsAfterNormalIssue(il.pmrLineId, tx);
      }
    }
    await recalcPmrStatus(tx, pmrId);

    const userId = actor.userId;
    if (overIssueAuditLines.length && typeof userId === "number" && Number.isFinite(userId)) {
      await auditLog.write(tx, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.WORK_ORDER,
        entityId: String(pmr.workOrderId),
        actorUserId: userId,
        actorRole: actor.role,
        summary: `RM excess issue on ${pmr.docNo || `PMR-${pmrId}`}`,
        payload: {
          module: "MATERIAL_ISSUE",
          actionLabel: "RM_EXCESS_ISSUE",
          ref: { type: "PMR", id: String(pmrId), no: pmr.docNo },
          materialIssueNoteId: created.id,
          materialIssueDocNo: created.docNo,
          lines: overIssueAuditLines,
        },
      });
    }

    return created;
  });

  return {
    materialIssue: {
      id: note.id,
      docNo: note.docNo,
      toLocation: note.toLocation,
    },
    overIssueLines: overIssueAuditLines,
    pmr: await getProductionMaterialRequestById(pmrId),
  };
}

/** Store issue context for a PMR (all lines + store availability for guided issue UI). */
async function buildPmrIssueContext(pmrId, fromLocationId, db = prisma) {
  let reconcile = {
    applied: false,
    skipped: false,
    reviewRequired: false,
    failed: false,
    operatorMessage: null,
    lineResults: [],
  };
  try {
    reconcile = {
      ...(await reconcileOpenPmrPlannedRequirementAgainstWoPlan(pmrId, db)),
      failed: false,
      operatorMessage: null,
    };
  } catch (err) {
    if (err?.reconcileFailed || err?.code === "PMR_PLANNED_REQUIREMENT_RECONCILE_FAILED") {
      reconcile = {
        applied: false,
        skipped: false,
        reviewRequired: false,
        failed: true,
        operatorMessage: err.message || OPERATOR_RECONCILE_FAILED_MESSAGE,
        lineResults: [],
        prismaDetail: err.prismaDetail || null,
      };
    } else {
      throw err;
    }
  }

  const pmr = await getProductionMaterialRequestById(pmrId, db);
  const woRelease = await db.workOrder.findUnique({
    where: { id: pmr.workOrderId },
    select: {
      materialReleasedToProductionAt: true,
      materialReleasedByUserId: true,
    },
  });
  const canIssueBase = STORE_ISSUE_STATUSES.includes(pmr.status);
  const canIssue = canIssueBase && !reconcile.reviewRequired && !reconcile.failed;
  const releaseAssessment = assessPmrReleaseEligibility(pmr.lines, {
    alreadyReleased: Boolean(woRelease?.materialReleasedToProductionAt),
  });
  const canRelease = releaseAssessment.canRelease;
  if (!canIssueBase && !canRelease && releaseAssessment.totalIssued <= STOCK_EPS) {
    const err = new Error("This request is not open for store issue.");
    err.statusCode = 400;
    throw err;
  }

  const rawPmr = await db.productionMaterialRequest.findUnique({
    where: { id: pmrId },
    select: {
      workOrder: {
        select: {
          salesOrder: { select: { orderType: true } },
          lines: {
            orderBy: { id: "asc" },
            select: { fgItem: { select: { itemName: true } } },
          },
        },
      },
    },
  });
  const fgNames = [
    ...new Set(
      (rawPmr?.workOrder?.lines || [])
        .map((ln) => ln.fgItem?.itemName)
        .filter(Boolean),
    ),
  ];
  const productionItemName = fgNames.length ? fgNames.join(", ") : null;

  const woIssueSnapshot = await buildWorkOrderMaterialIssueSnapshot(db, pmr.workOrderId, fromLocationId ?? null);
  const itemIds = pmr.lines.map((l) => l.itemId);
  const requiredQtyByItemId = new Map(pmr.lines.map((l) => [l.itemId, n(l.pendingQty)]));
  const globalAvailabilityRows =
    fromLocationId
      ? await getMaterialAvailabilityByItems({
          db,
          itemIds,
          requiredQtyByItemId,
          locationScope: { locationId: fromLocationId },
          includeIncoming: true,
          includeIssued: true,
        })
      : [];
  const issueAvailabilityRows =
    fromLocationId
      ? await getMaterialAvailabilityByItems({
          db,
          itemIds,
          requiredQtyByItemId,
          excludePmrId: pmrId,
          locationScope: { locationId: fromLocationId },
          includeIncoming: true,
          includeIssued: true,
        })
      : [];
  const globalAvailabilityByItem = new Map(globalAvailabilityRows.map((row) => [row.itemId, row]));
  const issueAvailabilityByItem = new Map(issueAvailabilityRows.map((row) => [row.itemId, row]));
  const currentAllocationByItem = await loadPmrAllocationByItem(db, pmrId);
  const itemRows =
    itemIds.length > 0
      ? await db.item.findMany({
          where: { id: { in: itemIds } },
          include: { unitRef: { select: { unitCode: true, unitName: true } } },
        })
      : [];
  const itemById = new Map(itemRows.map((i) => [i.id, i]));

  async function enrichLine(l) {
    let totalStoreStock = null;
    let reservedForOtherOrdersQty = 0;
    let freeStoreStock = null;
    const availability = globalAvailabilityByItem.get(l.itemId) ?? null;
    const issueAvailability = issueAvailabilityByItem.get(l.itemId) ?? null;
    const currentAllocation = currentAllocationByItem.get(l.itemId) ?? null;
    if (fromLocationId) {
      totalStoreStock = availability?.physicalUsableStockQty ?? 0;
      reservedForOtherOrdersQty = issueAvailability?.effectiveReservedQty ?? 0;
      freeStoreStock = issueAvailability?.freeStockQty ?? 0;
    }
    const woLine = woIssueSnapshot?.linesByItemId?.get(l.itemId) ?? null;
    const item = itemById.get(l.itemId);
    const roundingPlan = resolvePmrLineIssueRounding({
      line: {
        ...l,
        requiredQty: l.requiredQty ?? l.fullWoRmNeed,
        issuedQty: l.issuedQty,
        waivedQty: l.waivedQty,
        issueIncrementSnapshot: l.issueIncrementSnapshot,
        roundedIssueTargetQty: l.roundedIssueTargetQty,
      },
      item,
      availableQty: freeStoreStock,
    });
    const linePendingQty = roundingPlan.remainingIssueQty;
    const issueCapQty = linePendingQty;
    const woStillRequired = woLine ? n(woLine.stillRequiredQty) : null;
    const rmIssueToleranceQty = 0;
    const maxAllowedIssueQty = roundingPlan.applies
      ? linePendingQty
      : freeStoreStock == null
        ? linePendingQty
        : round3(Math.max(linePendingQty, n(freeStoreStock)));
    const suggestedIssueQty = roundingPlan.suggestedIssueQty;
    const enriched = {
      ...l,
      kgIssueRoundingApplies: roundingPlan.applies,
      issueIncrement: roundingPlan.issueIncrement,
      plannedRequiredQty: roundingPlan.plannedRequiredQty,
      roundedIssueTargetQty: roundingPlan.roundedIssueTargetQty,
      roundingExcessQty: roundingPlan.roundingExcessQty,
      allowProcessAllowance: !roundingPlan.applies,
      totalStoreStock,
      reservedForOtherOrdersQty,
      freeStoreStock,
      physicalUsableStockQty: availability?.physicalUsableStockQty ?? totalStoreStock,
      activeAllocatedQty: availability?.activeAllocatedQty ?? 0,
      legacyReservedQty: availability?.legacyReservedQty ?? reservedForOtherOrdersQty,
      effectiveReservedQty: availability?.effectiveReservedQty ?? reservedForOtherOrdersQty,
      freeStockQty: availability?.freeStockQty ?? freeStoreStock,
      totalReservedQty: availability?.effectiveReservedQty ?? reservedForOtherOrdersQty,
      globalFreeStockQty: availability?.freeStockQty ?? freeStoreStock,
      issueAvailableStoreQty: freeStoreStock,
      reservationForCurrentPmrQty: round3(
        Math.max(0, n(availability?.effectiveReservedQty) - n(issueAvailability?.effectiveReservedQty)),
      ),
      reservationBreakdown: availability?.reservationBreakdown ?? [],
      incomingQty: availability?.incomingQty ?? 0,
      issuedToProductionQty: availability?.issuedToProductionQty ?? 0,
      shortageAfterReservationQty: availability?.shortageAfterReservationQty ?? null,
      coveredByIncomingQty: availability?.coveredByIncomingQty ?? 0,
      netShortageAfterIncomingQty: availability?.netShortageAfterIncomingQty ?? null,
      allocationCoverageQty: currentAllocation?.activeAllocatedQty ?? availability?.allocationCoverageQty ?? 0,
      allocationShortageQty:
        currentAllocation != null
          ? round3(Math.max(0, linePendingQty - n(currentAllocation.activeAllocatedQty)))
          : availability?.allocationShortageQty ?? null,
      allocationStatus:
        currentAllocation?.activeAllocatedQty > STOCK_EPS
          ? currentAllocation.activeAllocatedQty + STOCK_EPS >= linePendingQty
            ? "FULLY_ALLOCATED"
            : "PARTIALLY_ALLOCATED"
          : availability?.allocationStatus ?? "NOT_ALLOCATED",
      availabilityWarnings: availability?.warnings ?? [],
      availableStoreQty: freeStoreStock,
      /** @deprecated alias for older clients */
      available: freeStoreStock,
      pmrPendingQty: linePendingQty,
      fullWoRmNeed: woLine?.fullWoRmNeed ?? l.requiredQty,
      consumedQty: woLine?.consumedQty ?? 0,
      returnedQty: woLine?.returnedQty ?? 0,
      atProductionQty: woLine?.atProductionQty ?? 0,
      requiredForBalanceQty: woLine?.requiredForBalanceQty ?? linePendingQty,
      stillRequiredQty: issueCapQty,
      issueCapQty,
      rmIssueToleranceQty,
      maxAllowedIssueQty,
      suggestedIssueQty,
    };
    return {
      ...enriched,
      ...derivePmrIssueLineReadiness(enriched),
    };
  }

  const lines = await Promise.all(pmr.lines.map(enrichLine));
  const pendingLines = lines.filter((l) => n(l.issueCapQty) > STOCK_EPS);
  const storeReadiness = derivePmrStoreIssueReadiness(pmr.status, pmr.totalPending);
  const issueQueueState = derivePmrIssueQueueState(pmr.status, pmr.totalIssued, pmr.totalPending);
  const canIssueAnyPendingLine = pendingLines.some((l) => l.lineReadinessKey === "READY" || l.lineReadinessKey === "PARTIAL");
  const waitingProcurement = pendingLines.some((l) => l.waitingProcurement === true);
  const waitingProcurementLines = pendingLines.filter((l) => l.lineReadinessKey === "WAITING_PROCUREMENT");
  const blockerReason = reconcile.failed
    ? reconcile.operatorMessage || OPERATOR_RECONCILE_FAILED_MESSAGE
    : reconcile.reviewRequired
    ? "PMR planned requirement needs manual review after WO reconcile (issued qty vs rounded target)."
    : !canIssueBase
    ? "This request is not open for store issue."
    : canIssueAnyPendingLine
      ? null
      : waitingProcurement
        ? "Waiting for Store / Purchase stock (procurement / GRN)."
        : pendingLines.some((l) => l.lineReadinessKey === "COMMITTED_ELSEWHERE")
          ? "Stock is committed to other work orders."
          : pendingLines.length > 0
            ? "No free stock available for issue at the selected store location."
            : "No pending quantity to issue.";

  const withinRoundingToleranceEligible =
    isRegularSoOrderType(pmr.workOrder?.salesOrder?.orderType ?? pmr.orderType) &&
    n(pmr.totalIssued) > STOCK_EPS &&
    n(pmr.totalPending) > STOCK_EPS &&
    (pmr.lines || []).every((l) => {
      const remaining = n(l.pendingQty);
      if (remaining <= STOCK_EPS) return true;
      return isWithinRoundingTolerance(n(l.requiredQty ?? l.theoreticalBomQty), n(l.issuedQty));
    });

  const issueDecision = {
    totalRequired: pmr.totalEffectiveRequired,
    totalOriginalRequired: pmr.totalOriginalRequired ?? pmr.totalRequired,
    totalEffectiveRequired: pmr.totalEffectiveRequired,
    totalIssued: pmr.totalIssued,
    totalWaived: pmr.totalWaived,
    totalShortIssueQty: pmr.totalShortIssueQty ?? pmr.totalWaived,
    totalExcessIssue: pmr.totalExcessIssue,
    totalRemaining: pmr.totalPending,
    pmrStatus: pmr.status,
    pmrStatusLabel: pmr.statusLabel ?? null,
    canIssueMore: canIssue,
    canIssueAnyPendingLine: canIssue && canIssueAnyPendingLine,
    waitingProcurement,
    waitingProcurementLineCount: waitingProcurementLines.length,
    blockerReason,
    storeActionKey: canIssue ? storeReadiness.storeActionKey : "NONE",
    storeActionLabel: canIssue
      ? storeReadiness.storeActionLabel
      : reconcile.failed
        ? "Planned qty refresh failed"
        : reconcile.reviewRequired
          ? "Manual review required"
          : storeReadiness.storeActionLabel,
    storeIssueReady: canIssue && storeReadiness.storeIssueReady,
    issueQueueState,
    canWaiveRemaining:
      canIssue && n(pmr.totalIssued) > STOCK_EPS && n(pmr.totalPending) > STOCK_EPS,
    withinRoundingToleranceEligible,
    canReleaseToProduction: canRelease,
    unissuedRequiredLines: releaseAssessment.unissuedRequiredLines,
    releaseBlockedByUnissuedBom: releaseAssessment.unissuedRequiredLines.length > 0,
    materialReleasedToProductionAt: woRelease?.materialReleasedToProductionAt ?? null,
    showPartialDecisionPanel:
      n(pmr.totalIssued) > STOCK_EPS && n(pmr.totalPending) > STOCK_EPS && pmr.status !== "SHORT_ISSUE_ACCEPTED",
    plannedRequirementReconcile: {
      applied: Boolean(reconcile.applied),
      skipped: Boolean(reconcile.skipped),
      skipReason: reconcile.skipReason ?? null,
      reviewRequired: Boolean(reconcile.reviewRequired),
      failed: Boolean(reconcile.failed),
      operatorMessage: reconcile.failed
        ? reconcile.operatorMessage || OPERATOR_RECONCILE_FAILED_MESSAGE
        : null,
      lines: (reconcile.lineResults || [])
        .filter((r) => r.action === "UPDATE" || r.reviewRequired)
        .map((r) => ({
          itemId: r.itemId,
          lineId: r.lineId,
          action: r.action,
          plannedRequiredQty: r.plannedRequiredQty,
          roundedIssueTargetQty: r.roundedIssueTargetQty,
          roundingExcessQty: r.roundingExcessQty,
          productionRmQty: r.productionRmQty,
          purgingRmQty: r.purgingRmQty,
          reviewRequired: r.reviewRequired,
          reviewReason: r.reviewReason,
        })),
    },
  };

  return {
    pmr: { ...pmr, productionItemName, ...storeReadiness, issueQueueState, storeIssueReady: canIssue && storeReadiness.storeIssueReady },
    lines,
    pendingLines,
    issueDecision,
  };
}

/** P16-13: Store waives remaining unissued PMR qty (short issue accepted). */
async function waiveRemainingPmrQty(pmrId, input, actor = {}) {
  const reason = String(input?.reason ?? "").trim().toUpperCase();
  if (!PMR_SHORT_ISSUE_WAIVE_REASONS.includes(reason)) {
    const err = new Error("A valid waive reason is required.");
    err.statusCode = 400;
    throw err;
  }
  const remarks = input?.remarks?.trim() || null;

  return prisma.$transaction(async (tx) => {
    const pmr = await tx.productionMaterialRequest.findUnique({
      where: { id: pmrId },
      include: {
        lines: true,
        workOrder: { include: { salesOrder: { select: { orderType: true } } } },
      },
    });
    if (!pmr) {
      const err = new Error("Production material request not found");
      err.statusCode = 404;
      throw err;
    }
    if (pmr.status === "CANCELLED" || pmr.status === "DRAFT") {
      const err = new Error("This request cannot be waived.");
      err.statusCode = 400;
      throw err;
    }
    if (pmr.status === "SHORT_ISSUE_ACCEPTED") {
      const err = new Error("Remaining quantity is already waived.");
      err.statusCode = 400;
      throw err;
    }
    const totalIssued = (pmr.lines || []).reduce((s, l) => s + n(l.issuedQty), 0);
    if (totalIssued <= STOCK_EPS) {
      const err = new Error("Issue at least some material before waiving remaining quantity.");
      err.statusCode = 400;
      throw err;
    }

    const isRegular = isRegularSoOrderType(pmr.workOrder?.salesOrder?.orderType);
    if (reason === "ROUNDING_TOLERANCE") {
      if (!isRegular) {
        const err = new Error("Rounding tolerance acknowledgement applies to REGULAR_SO work orders only.");
        err.statusCode = 400;
        err.code = "ROUNDING_TOLERANCE_REGULAR_SO_ONLY";
        throw err;
      }
      for (const ln of pmr.lines) {
        const remaining = pendingQty(ln);
        if (remaining <= STOCK_EPS) continue;
        const theoretical = n(ln.requiredQty);
        const issued = n(ln.issuedQty);
        if (!isWithinRoundingTolerance(theoretical, issued)) {
          const tol = computeRoundedDownToleranceQty(theoretical);
          const err = new Error(
            `Shortage ${regularSoRound3(remaining)} exceeds rounding tolerance ${tol} for item #${ln.itemId}. Keep Partially Issued or use a short-issue reason.`,
          );
          err.statusCode = 409;
          err.code = "ROUNDING_TOLERANCE_EXCEEDED";
          throw err;
        }
      }
    }

    const waivedLines = [];
    for (const ln of pmr.lines) {
      const remaining = pendingQty(ln);
      if (remaining <= STOCK_EPS) continue;
      const nextWaived = round3(n(ln.waivedQty) + remaining);
      await tx.productionMaterialRequestLine.update({
        where: { id: ln.id },
        data: { waivedQty: String(nextWaived) },
      });
      waivedLines.push({
        pmrLineId: ln.id,
        itemId: ln.itemId,
        requiredQty: n(ln.requiredQty),
        issuedQty: n(ln.issuedQty),
        waivedQty: nextWaived,
        remainingWaived: remaining,
        toleranceQty: computeRoundedDownToleranceQty(n(ln.requiredQty)),
      });
    }
    if (!waivedLines.length) {
      const err = new Error("No remaining quantity to waive.");
      err.statusCode = 400;
      throw err;
    }

    const closedAt = new Date();
    await tx.productionMaterialRequest.update({
      where: { id: pmrId },
      data: {
        status: "SHORT_ISSUE_ACCEPTED",
        shortIssueCloseReason: reason,
        shortIssueClosedAt: closedAt,
        shortIssueClosedByUserId:
          typeof actor.userId === "number" && Number.isFinite(actor.userId) ? actor.userId : null,
      },
    });
    // Release residual allocation so unissued qty returns to free usable stock.
    // Never create StockTransaction for waived / short-issue qty.
    await syncAllocationsForPmrIssueStatus(tx, pmrId);

    const userId = actor.userId;
    if (typeof userId === "number" && Number.isFinite(userId)) {
      const actionLabel =
        reason === "ROUNDING_TOLERANCE" ? "PMR_ROUNDING_TOLERANCE_ACKNOWLEDGED" : "PMR_SHORT_ISSUE_CLOSED";
      await auditLog.write(tx, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.WORK_ORDER,
        entityId: String(pmr.workOrderId),
        actorUserId: userId,
        actorRole: actor.role,
        summary:
          reason === "ROUNDING_TOLERANCE"
            ? `Rounding tolerance acknowledged on ${pmr.docNo || `PMR-${pmrId}`} — WO target permitted; inventory moved issued qty only`
            : `Short Issue Closed on ${pmr.docNo || `PMR-${pmrId}`} — inventory moved issued qty only`,
        payload: {
          module: "MATERIAL_ISSUE",
          actionLabel,
          legacyActionLabel: "PMR_WAIVE_REMAINING",
          flow: isRegular ? "REGULAR_SO" : pmr.workOrder?.salesOrder?.orderType ?? null,
          ref: { type: "PMR", id: String(pmrId), no: pmr.docNo },
          reason,
          remarks,
          closedByUserId: userId,
          closedAt: closedAt.toISOString(),
          inventoryRule: "STOCK_MOVEMENT_EQUALS_ISSUED_QTY_ONLY",
          lines: waivedLines.map((w) => ({
            ...w,
            shortIssueQty: w.remainingWaived,
            theoreticalRequirement: w.requiredQty,
            actualCumulativeIssue: w.issuedQty,
            toleranceDifference: w.remainingWaived,
          })),
        },
      });
    }

    return getProductionMaterialRequestById(pmrId, tx);
  });
}

/** P16-13: Store explicitly releases WO to production after at least one issue. */
async function releaseWorkOrderMaterialToProduction(workOrderId, input = {}, actor = {}) {
  const woId = Number(workOrderId);
  if (!Number.isFinite(woId) || woId <= 0) {
    const err = new Error("workOrderId is required");
    err.statusCode = 400;
    throw err;
  }
  const remarks = input?.remarks?.trim() || null;
  const pmrId = input?.pmrId != null ? Number(input.pmrId) : null;

  return prisma.$transaction(async (tx) => {
    const wo = await tx.workOrder.findUnique({
      where: { id: woId },
      select: {
        id: true,
        docNo: true,
        materialReleasedToProductionAt: true,
        productionMaterialRequests: {
          where: { status: { not: "CANCELLED" } },
          include: { lines: true, materialIssueNotes: { select: { id: true } } },
          orderBy: { id: "desc" },
        },
      },
    });
    if (!wo) {
      const err = new Error("Work order not found");
      err.statusCode = 404;
      throw err;
    }
    if (wo.materialReleasedToProductionAt) {
      const err = new Error("Work order is already released to production.");
      err.statusCode = 400;
      throw err;
    }

    const pmrs = wo.productionMaterialRequests || [];
    const targetPmr =
      pmrId != null && Number.isFinite(pmrId)
        ? pmrs.find((p) => p.id === pmrId)
        : pmrs.find((p) => STORE_ISSUE_STATUSES.includes(p.status) || p.status === "FULLY_ISSUED" || p.status === "SHORT_ISSUE_ACCEPTED") ?? pmrs[0];
    if (!targetPmr) {
      const err = new Error("No production material request found for this work order.");
      err.statusCode = 400;
      throw err;
    }

    const totalIssued = (targetPmr.lines || []).reduce((s, l) => s + n(l.issuedQty), 0);
    const hasIssueNote = (targetPmr.materialIssueNotes || []).length > 0;
    if (totalIssued <= STOCK_EPS || !hasIssueNote) {
      const err = new Error("Release requires at least one material issue transaction.");
      err.statusCode = 400;
      throw err;
    }

    const releaseAssessment = assessPmrReleaseEligibility(targetPmr.lines);
    if (!releaseAssessment.canRelease) {
      const err = new Error(formatPmrReleaseBlockedMessage(releaseAssessment.unissuedRequiredLines));
      err.statusCode = 400;
      err.code = "PMR_RELEASE_UNISSUED_BOM_LINES";
      err.unissuedRequiredLines = releaseAssessment.unissuedRequiredLines;
      throw err;
    }

    const releasedAt = new Date();
    const userId = actor.userId;
    await tx.workOrder.update({
      where: { id: woId },
      data: {
        materialReleasedToProductionAt: releasedAt,
        materialReleasedByUserId: typeof userId === "number" && Number.isFinite(userId) ? userId : null,
      },
    });

    if (typeof userId === "number" && Number.isFinite(userId)) {
      await auditLog.write(tx, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.WORK_ORDER,
        entityId: String(woId),
        actorUserId: userId,
        actorRole: actor.role,
        summary: `Released to production: ${wo.docNo || `WO-${woId}`}`,
        payload: {
          module: "MATERIAL_ISSUE",
          actionLabel: "RELEASE_TO_PRODUCTION",
          ref: { type: "PMR", id: String(targetPmr.id), no: targetPmr.docNo },
          pmrStatus: targetPmr.status,
          totalRequired: round3((targetPmr.lines || []).reduce((s, l) => s + n(l.requiredQty), 0)),
          totalIssued: round3(totalIssued),
          totalRemaining: round3((targetPmr.lines || []).reduce((s, l) => s + pendingQty(l), 0)),
          remarks,
        },
      });
    }

    return {
      workOrderId: woId,
      workOrderNo: wo.docNo,
      materialReleasedToProductionAt: releasedAt,
      pmr: await getProductionMaterialRequestById(targetPmr.id, tx),
    };
  });
}

async function acknowledgePmrIssueLater(pmrId, actor = {}) {
  const pmr = await getProductionMaterialRequestById(pmrId);
  if (!STORE_ISSUE_STATUSES.includes(pmr.status) || n(pmr.totalPending) <= STOCK_EPS) {
    const err = new Error("Issue Later applies only when partial issue with remaining quantity.");
    err.statusCode = 400;
    throw err;
  }
  const userId = actor.userId;
  if (typeof userId === "number" && Number.isFinite(userId)) {
    await auditLog.write(prisma, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.WORK_ORDER,
      entityId: String(pmr.workOrderId),
      actorUserId: userId,
      actorRole: actor.role,
      summary: `Issue Later on ${pmr.docNo || `PMR-${pmrId}`}`,
      payload: {
        module: "MATERIAL_ISSUE",
        actionLabel: "PMR_ISSUE_LATER",
        ref: { type: "PMR", id: String(pmrId), no: pmr.docNo },
        totalRemaining: pmr.totalPending,
      },
    });
  }
  return pmr;
}

module.exports = {
  STORE_ISSUE_STATUSES,
  PMR_ISSUED_STATUSES,
  PMR_EXISTING_WORKFLOW_STATUSES,
  PMR_NON_CANCELLED_STATUSES,
  PMR_SHORT_ISSUE_WAIVE_REASONS,
  derivePmrStoreIssueReadiness,
  derivePmrIssueQueueState,
  derivePmrIssueLineReadiness,
  buildBomSuggestionsForWorkOrder,
  listProductionMaterialRequests,
  getProductionMaterialRequestById,
  getExistingProductionMaterialRequestForWorkOrder,
  createProductionMaterialRequest,
  submitProductionMaterialRequest,
  ensureSubmittedProductionMaterialRequestForWorkOrder,
  cancelProductionMaterialRequest,
  issueMaterialAgainstPmr,
  buildPmrIssueContext,
  reconcileOpenPmrPlannedRequirementAgainstWoPlan,
  waiveRemainingPmrQty,
  releaseWorkOrderMaterialToProduction,
  acknowledgePmrIssueLater,
  buildWorkOrderMaterialIssueSnapshot,
  loadReservedForOtherOpenPmrsByItem,
  computeFreeStoreStockLine,
  recalcPmrStatus,
  pendingQty,
  effectiveRequiredQty,
  excessIssueQty,
  listUnissuedRequiredPmrLines,
  assessPmrReleaseEligibility,
  formatPmrReleaseBlockedMessage,
  pmrMeetsProductionReleaseIssueRule,
  pickReleaseReadyPmr,
  loadStoreProductionReleaseEligibilityByWorkOrder,
};
