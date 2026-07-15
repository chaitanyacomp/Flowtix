/**
 * P10-A4 — Execution register enrichment for NO_QTY inbox rows.
 */
const { buildRequirementSheetHref } = require("./noQtyRequirementSheetHref");
const { assessNoQtyPlacementStageForSheet } = require("./requirementSheetExecutionService");

const EPS = 1e-6;

const RM_COVERAGE = Object.freeze({
  READY: { key: "READY", label: "Ready" },
  PARTIAL: { key: "PARTIAL", label: "Partial" },
  AWAITING_RM: { key: "AWAITING_RM", label: "Awaiting RM" },
  BLOCKED: { key: "BLOCKED", label: "Blocked" },
  COMPLETE: { key: "COMPLETE", label: "Complete" },
});

const ACTION_NEEDED = Object.freeze({
  PLACE_WO: { key: "PLACE_WO", label: "Create Work Order", sortPriority: 1 },
  ISSUE_RM: { key: "ISSUE_RM", label: "Issue RM", sortPriority: 2 },
  AWAIT_PROCUREMENT: { key: "AWAIT_PROCUREMENT", label: "Await Procurement", sortPriority: 3 },
  BLOCKED: { key: "BLOCKED", label: "Blocked", sortPriority: 3 },
  MONITOR_WO: { key: "MONITOR_WO", label: "Monitor WOs", sortPriority: 4 },
  COMPLETE: { key: "COMPLETE", label: "Complete", sortPriority: 5 },
});

const ACTION_SORT_PRIORITY = Object.freeze({
  PLACE_WO: 1,
  ISSUE_RM: 2,
  AWAIT_PROCUREMENT: 3,
  BLOCKED: 3,
  MONITOR_WO: 4,
  COMPLETE: 5,
});

function emptyRegisterFields() {
  return {
    executionRegisterEnabled: false,
    placementRequirementSheetId: null,
    placementRequirementSheetNo: null,
    placementCycleId: null,
    rsBalanceQty: null,
    suggestedWoQty: null,
    rmCoverageStatus: null,
    rmCoverageLabel: null,
    actionNeededKey: null,
    actionNeededLabel: null,
    /** Canonical Open-column CTA — do not re-derive on the client from RM flags. */
    ctaLabel: null,
    showProcurementPendingHint: false,
    executionWorkspaceHref: null,
  };
}

function isWoTerminalStatus(status) {
  const st = String(status ?? "").toUpperCase();
  return st === "COMPLETED" || st === "CLOSED" || st === "CLOSED_WITH_SHORTFALL" || st === "REJECTED";
}

function hasOpenWorkOrders(existingWoSummary) {
  return (existingWoSummary ?? []).some((wo) => !isWoTerminalStatus(wo.woStatus));
}

function hasPendingRmIssue(existingWoSummary) {
  return (existingWoSummary ?? []).some((wo) => Number(wo.rmPendingIssueQty ?? 0) > EPS);
}

function mapRmCoverage({ placementStatus, readinessStatus, rsBalanceQty }) {
  const balance = Number(rsBalanceQty ?? 0);
  if (!(balance > EPS)) {
    return RM_COVERAGE.COMPLETE;
  }

  const placement = String(placementStatus ?? "").toUpperCase();
  const readiness = String(readinessStatus ?? "").toUpperCase();

  if (placement === "READY" && readiness === "READY_TO_PLACE_WO") return RM_COVERAGE.READY;
  if (placement === "PARTIALLY_READY" || readiness === "PARTIALLY_READY") return RM_COVERAGE.PARTIAL;
  if (
    placement === "AWAITING_PROCUREMENT" ||
    readiness === "AWAITING_PROCUREMENT" ||
    readiness === "EXISTING_WO_PENDING_RM_ISSUE"
  ) {
    return RM_COVERAGE.AWAITING_RM;
  }
  if (placement === "MISSING_BOM" || readiness === "BLOCKED") return RM_COVERAGE.BLOCKED;
  if (placement === "READY") return RM_COVERAGE.READY;
  return RM_COVERAGE.AWAITING_RM;
}

function resolvePlaceWoActionLabel({
  rmCoverage,
  placementStatus,
  readinessStatus,
  suggestedWoQty,
  rsBalanceQty,
}) {
  const suggested = Number(suggestedWoQty ?? 0);
  const balance = Number(rsBalanceQty ?? 0);
  if (suggested > EPS && balance > EPS && suggested + EPS < balance) {
    return "Place Partial WO";
  }

  const placement = String(placementStatus ?? "").toUpperCase();
  const readiness = String(readinessStatus ?? "").toUpperCase();
  const partial =
    rmCoverage?.key === RM_COVERAGE.PARTIAL.key ||
    placement === "PARTIALLY_READY" ||
    readiness === "PARTIALLY_READY";
  if (partial) return "Place Partial WO";
  return "Create Work Order";
}

/**
 * RM Coverage / CTA / hint MUST follow the resolved actionNeeded — never fight it
 * with stale placement/readiness/procurement flags after PLACE_WO is decided.
 */
function resolveRegisterPresentationFromAction({
  actionNeeded,
  assessment,
}) {
  if (actionNeeded.key === ACTION_NEEDED.PLACE_WO.key) {
    const placement = String(assessment.placementStatus ?? "").toUpperCase();
    const readiness = String(assessment.readinessStatus ?? "").toUpperCase();
    const placeWoLabel = resolvePlaceWoActionLabel({
      placementStatus: assessment.placementStatus,
      readinessStatus: assessment.readinessStatus,
      suggestedWoQty: assessment.suggestedWoQty,
      rsBalanceQty: assessment.rsBalanceQty,
    });
    // Executable WO placement is never "Awaiting RM" — even if assessor still says AWAITING_PROCUREMENT.
    const rmCoverage =
      placement === "PARTIALLY_READY" || readiness === "PARTIALLY_READY"
        ? RM_COVERAGE.PARTIAL
        : RM_COVERAGE.READY;
    return {
      rmCoverage,
      actionNeededLabel: placeWoLabel,
      ctaLabel: placeWoLabel,
      showProcurementPendingHint: false,
    };
  }

  if (actionNeeded.key === ACTION_NEEDED.AWAIT_PROCUREMENT.key) {
    return {
      rmCoverage: RM_COVERAGE.AWAITING_RM,
      actionNeededLabel: ACTION_NEEDED.AWAIT_PROCUREMENT.label,
      ctaLabel: "View Planning Status",
      showProcurementPendingHint: true,
    };
  }

  if (actionNeeded.key === ACTION_NEEDED.BLOCKED.key) {
    return {
      rmCoverage: RM_COVERAGE.BLOCKED,
      actionNeededLabel: ACTION_NEEDED.BLOCKED.label,
      ctaLabel: "View Planning Status",
      showProcurementPendingHint: false,
    };
  }

  const rmCoverage = mapRmCoverage({
    placementStatus: assessment.placementStatus,
    readinessStatus: assessment.readinessStatus,
    rsBalanceQty: assessment.rsBalanceQty,
  });
  return {
    rmCoverage,
    actionNeededLabel: actionNeeded.label,
    ctaLabel: "Open Execution Workspace",
    showProcurementPendingHint: false,
  };
}

function deriveActionNeeded({
  rsBalanceQty,
  suggestedWoQty,
  placementStatus,
  readinessStatus,
  existingWoSummary,
  released,
}) {
  const balance = Number(rsBalanceQty ?? 0);
  const suggested = Number(suggestedWoQty ?? 0);

  const readiness = String(readinessStatus ?? "").toUpperCase();
  const placement = String(placementStatus ?? "").toUpperCase();

  if (balance > EPS) {
    if (placement === "MISSING_BOM" || readiness === "BLOCKED") {
      return ACTION_NEEDED.BLOCKED;
    }
    // Plan release (or procurement-not-required handoff) is required before WO placement CTA.
    // Executable qty drives WO placement — partial RM coverage is actionable.
    if (suggested > EPS) {
      return ACTION_NEEDED.PLACE_WO;
    }
    return ACTION_NEEDED.AWAIT_PROCUREMENT;
  }

  if (hasPendingRmIssue(existingWoSummary)) {
    return ACTION_NEEDED.ISSUE_RM;
  }

  if (hasOpenWorkOrders(existingWoSummary)) {
    return ACTION_NEEDED.MONITOR_WO;
  }

  return ACTION_NEEDED.COMPLETE;
}

/**
 * Shared authoritative WO-placement pending/register predicate.
 * Aligns Store Dashboard, Execution Register, and Pending Actions.
 * `released` is true when a Monthly Plan is released **or** initial-path
 * PROCUREMENT_NOT_REQUIRED (Net RM = 0 / skip Monthly Planning) marks execution-ready.
 */
function isNoQtyWoPlacementActionable(placement) {
  const suggested = Number(placement?.suggestedWoQty ?? 0);
  const balance = Number(placement?.rsBalanceQty ?? 0);
  if (!(balance > EPS) || !(suggested > EPS)) return false;
  const actionNeeded = deriveActionNeeded({
    rsBalanceQty: placement.rsBalanceQty,
    suggestedWoQty: placement.suggestedWoQty,
    placementStatus: placement.placementStatus,
    readinessStatus: placement.readinessStatus,
    existingWoSummary: placement.existingWoSummary ?? [],
    released: placement.released,
  });
  return actionNeeded.key === ACTION_NEEDED.PLACE_WO.key;
}

function pickPlacementSheetCandidate(assessedRows, guidedCycleId) {
  const rows = (assessedRows ?? []).filter((row) => row?.assessment?.requirementSheetId);
  if (!rows.length) return null;

  const guidedRows = rows.filter(
    (row) => Number(row.sheet?.cycleId ?? row.assessment?.cycleId ?? 0) === Number(guidedCycleId ?? 0),
  );
  const guidedPending = guidedRows.filter(
    (row) =>
      Number(row.assessment.rsBalanceQty ?? 0) > EPS ||
      hasPendingRmIssue(row.assessment.existingWoSummary) ||
      hasOpenWorkOrders(row.assessment.existingWoSummary),
  );
  const candidateRows = guidedPending.length ? guidedPending : rows;

  const placeable = candidateRows.filter(
    (row) => row.assessment.rsBalanceQty > EPS && row.assessment.suggestedWoQty > EPS,
  );
  if (placeable.length) {
    return placeable.sort(
      (a, b) =>
        b.assessment.suggestedWoQty - a.assessment.suggestedWoQty ||
        b.assessment.rsBalanceQty - a.assessment.rsBalanceQty ||
        Number(b.sheet.id) - Number(a.sheet.id),
    )[0];
  }

  const withBalance = candidateRows.filter((row) => row.assessment.rsBalanceQty > EPS);
  if (withBalance.length) {
    return withBalance.sort(
      (a, b) => b.assessment.rsBalanceQty - a.assessment.rsBalanceQty || Number(b.sheet.id) - Number(a.sheet.id),
    )[0];
  }

  const withPendingIssue = candidateRows.filter((row) => hasPendingRmIssue(row.assessment.existingWoSummary));
  if (withPendingIssue.length) {
    return withPendingIssue.sort((a, b) => Number(b.sheet.id) - Number(a.sheet.id))[0];
  }

  const guided = candidateRows.filter((row) => Number(row.sheet.cycleId ?? 0) === Number(guidedCycleId ?? 0));
  if (guided.length) {
    return guided.sort(
      (a, b) =>
        Number(b.sheet.version ?? 1) - Number(a.sheet.version ?? 1) || Number(b.sheet.id) - Number(a.sheet.id),
    )[0];
  }

  return candidateRows.sort((a, b) => Number(b.sheet.id) - Number(a.sheet.id))[0];
}

function buildExecutionRegisterFieldsFromPick(salesOrderId, pick) {
  if (!pick?.assessment?.requirementSheetId) return emptyRegisterFields();

  const { sheet, assessment } = pick;
  const actionNeeded = deriveActionNeeded({
    rsBalanceQty: assessment.rsBalanceQty,
    suggestedWoQty: assessment.suggestedWoQty,
    placementStatus: assessment.placementStatus,
    readinessStatus: assessment.readinessStatus,
    existingWoSummary: assessment.existingWoSummary,
    released: assessment.released,
  });
  const presentation = resolveRegisterPresentationFromAction({ actionNeeded, assessment });

  const placementSheetId = Number(assessment.requirementSheetId);
  const placementCycleId =
    sheet?.cycleId != null && Number(sheet.cycleId) > 0
      ? Number(sheet.cycleId)
      : assessment.cycleId != null && Number(assessment.cycleId) > 0
        ? Number(assessment.cycleId)
        : null;

  return {
    executionRegisterEnabled: true,
    placementRequirementSheetId: placementSheetId,
    placementRequirementSheetNo: sheet?.docNo ?? assessment.requirementSheetDocNo ?? null,
    placementCycleId,
    rsBalanceQty: assessment.rsBalanceQty,
    suggestedWoQty: assessment.suggestedWoQty,
    rmCoverageStatus: presentation.rmCoverage.key,
    rmCoverageLabel: presentation.rmCoverage.label,
    actionNeededKey: actionNeeded.key,
    actionNeededLabel: presentation.actionNeededLabel,
    ctaLabel: presentation.ctaLabel,
    showProcurementPendingHint: presentation.showProcurementPendingHint,
    executionWorkspaceHref: buildRequirementSheetHref(salesOrderId, {
      sheetId: placementSheetId,
      cycleId: placementCycleId,
      focusExecution: true,
    }),
  };
}

/**
 * Shared SO-scoped WO placement candidate (Execution Register + Store Pending Actions).
 * Assesses all locked RS sheets for the SO and picks the same candidate the register uses.
 * Do not scope to ACTIVE cycle only — prior-cycle locked RS with remaining balance remains executable.
 *
 * @returns {Promise<{ sheet: object, assessment: object } | null>}
 */
async function resolveNoQtyWoPlacementCandidateForSo(
  db,
  salesOrderId,
  lockedSheets,
  guidedCycleId,
  deps = {},
) {
  const sheets = Array.isArray(lockedSheets) ? lockedSheets : [];
  if (!sheets.length) return null;

  const assess =
    deps.assessNoQtyPlacementStageForSheet ||
    ((client, sheetId, assessorDeps) => assessNoQtyPlacementStageForSheet(client, sheetId, assessorDeps));

  const assessed = await Promise.all(
    sheets.map(async (sheet) => ({
      sheet,
      assessment: await assess(db, sheet.id, deps),
    })),
  );

  return pickPlacementSheetCandidate(assessed, guidedCycleId);
}

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {number} salesOrderId
 * @param {number | null} guidedCycleId
 * @param {Array<object>} lockedSheets
 * @param {object} [deps]
 */
async function buildExecutionRegisterForSo(db, salesOrderId, guidedCycleId, lockedSheets, deps = {}) {
  const pick = await resolveNoQtyWoPlacementCandidateForSo(
    db,
    salesOrderId,
    lockedSheets,
    guidedCycleId,
    deps,
  );
  return buildExecutionRegisterFieldsFromPick(salesOrderId, pick);
}

function executionRegisterSortPriority(row) {
  const key = String(row?.actionNeededKey ?? "").trim();
  if (!key) return null;
  return ACTION_SORT_PRIORITY[key] ?? 99;
}

module.exports = {
  ACTION_NEEDED,
  ACTION_SORT_PRIORITY,
  RM_COVERAGE,
  buildExecutionRegisterForSo,
  buildExecutionRegisterFieldsFromPick,
  deriveActionNeeded,
  emptyRegisterFields,
  executionRegisterSortPriority,
  isNoQtyWoPlacementActionable,
  mapRmCoverage,
  pickPlacementSheetCandidate,
  resolveNoQtyWoPlacementCandidateForSo,
  resolvePlaceWoActionLabel,
  resolveRegisterPresentationFromAction,
};
