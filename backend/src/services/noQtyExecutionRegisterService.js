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
  PLACE_WO: { key: "PLACE_WO", label: "Place WO", sortPriority: 1 },
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
    rsBalanceQty: null,
    suggestedWoQty: null,
    rmCoverageStatus: null,
    rmCoverageLabel: null,
    actionNeededKey: null,
    actionNeededLabel: null,
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

function deriveActionNeeded({
  rsBalanceQty,
  suggestedWoQty,
  placementStatus,
  readinessStatus,
  existingWoSummary,
}) {
  const balance = Number(rsBalanceQty ?? 0);
  const suggested = Number(suggestedWoQty ?? 0);

  if (balance > EPS && suggested > EPS) {
    return ACTION_NEEDED.PLACE_WO;
  }

  if (balance > EPS) {
    const placement = String(placementStatus ?? "").toUpperCase();
    const readiness = String(readinessStatus ?? "").toUpperCase();
    if (placement === "MISSING_BOM" || readiness === "BLOCKED") {
      return ACTION_NEEDED.BLOCKED;
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

function pickPlacementSheetCandidate(assessedRows, guidedCycleId) {
  const rows = (assessedRows ?? []).filter((row) => row?.assessment?.requirementSheetId);
  if (!rows.length) return null;

  const placeable = rows.filter(
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

  const withBalance = rows.filter((row) => row.assessment.rsBalanceQty > EPS);
  if (withBalance.length) {
    return withBalance.sort(
      (a, b) => b.assessment.rsBalanceQty - a.assessment.rsBalanceQty || Number(b.sheet.id) - Number(a.sheet.id),
    )[0];
  }

  const withPendingIssue = rows.filter((row) => hasPendingRmIssue(row.assessment.existingWoSummary));
  if (withPendingIssue.length) {
    return withPendingIssue.sort((a, b) => Number(b.sheet.id) - Number(a.sheet.id))[0];
  }

  const guided = rows.filter((row) => Number(row.sheet.cycleId ?? 0) === Number(guidedCycleId ?? 0));
  if (guided.length) {
    return guided.sort(
      (a, b) =>
        Number(b.sheet.version ?? 1) - Number(a.sheet.version ?? 1) || Number(b.sheet.id) - Number(a.sheet.id),
    )[0];
  }

  return rows.sort((a, b) => Number(b.sheet.id) - Number(a.sheet.id))[0];
}

function buildExecutionRegisterFieldsFromPick(salesOrderId, pick) {
  if (!pick?.assessment?.requirementSheetId) return emptyRegisterFields();

  const { sheet, assessment } = pick;
  const rmCoverage = mapRmCoverage({
    placementStatus: assessment.placementStatus,
    readinessStatus: assessment.readinessStatus,
    rsBalanceQty: assessment.rsBalanceQty,
  });
  const actionNeeded = deriveActionNeeded({
    rsBalanceQty: assessment.rsBalanceQty,
    suggestedWoQty: assessment.suggestedWoQty,
    placementStatus: assessment.placementStatus,
    readinessStatus: assessment.readinessStatus,
    existingWoSummary: assessment.existingWoSummary,
  });

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
    rsBalanceQty: assessment.rsBalanceQty,
    suggestedWoQty: assessment.suggestedWoQty,
    rmCoverageStatus: rmCoverage.key,
    rmCoverageLabel: rmCoverage.label,
    actionNeededKey: actionNeeded.key,
    actionNeededLabel: actionNeeded.label,
    executionWorkspaceHref: buildRequirementSheetHref(salesOrderId, {
      sheetId: placementSheetId,
      cycleId: placementCycleId,
      focusExecution: true,
    }),
  };
}

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {number} salesOrderId
 * @param {number | null} guidedCycleId
 * @param {Array<object>} lockedSheets
 * @param {object} [deps]
 */
async function buildExecutionRegisterForSo(db, salesOrderId, guidedCycleId, lockedSheets, deps = {}) {
  const sheets = Array.isArray(lockedSheets) ? lockedSheets : [];
  if (!sheets.length) return emptyRegisterFields();

  const assess =
    deps.assessNoQtyPlacementStageForSheet ||
    ((client, sheetId, assessorDeps) => assessNoQtyPlacementStageForSheet(client, sheetId, assessorDeps));

  const assessed = await Promise.all(
    sheets.map(async (sheet) => ({
      sheet,
      assessment: await assess(db, sheet.id, deps),
    })),
  );

  const pick = pickPlacementSheetCandidate(assessed, guidedCycleId);
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
  mapRmCoverage,
  pickPlacementSheetCandidate,
};
