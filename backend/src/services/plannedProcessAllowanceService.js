const { Prisma } = require("../prismaClientPackage");
const Decimal = Prisma.Decimal;

const PLANNED_ALLOWANCE_NORMAL_MAX_PCT = new Decimal(5);
const PLANNED_ALLOWANCE_INITIAL_ISSUE_MAX_PCT = new Decimal(10);
const ALLOWANCE_SOURCES = Object.freeze({ QUANTITY: "QUANTITY" });
const CALC_TOLERANCE = new Decimal("0.000001");

function d(value) {
  try {
    return new Decimal(value ?? 0);
  } catch {
    return new Decimal(NaN);
  }
}

function allowanceError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, code });
}

function applicableBomRequirement(theoreticalBomQty, alreadyIssuedQty = 0) {
  const theoretical = d(theoreticalBomQty);
  const issued = Decimal.max(0, d(alreadyIssuedQty));
  if (!theoretical.isFinite() || theoretical.isNegative()) {
    throw allowanceError("Theoretical BOM RM must be zero or positive.", "INVALID_THEORETICAL_BOM_RM");
  }
  const bomCovered = Decimal.min(issued, theoretical);
  return Decimal.max(0, theoretical.minus(bomCovered)).toDecimalPlaces(6).toNumber();
}

/**
 * Add Qty is the only client-authored allowance input.
 * Applicable BOM entitlement for allowance % / Issue Now default = remaining after prior issues.
 * UI Qty (BOM) displays the original theoretical BOM; Remaining is shown separately.
 * Allowance % = Add Qty ÷ applicable BOM × 100 (acknowledgement / approval band).
 * When applicable BOM is already fully covered, % is evaluated against original BOM
 * so approval bands remain defined without double-counting issued qty in Issue Now.
 * Issue target for this fill = applicable BOM + Add Qty.
 */
function calculatePlannedProcessAllowance(theoreticalBomQty, extraAllowanceQty, alreadyIssuedQty = 0) {
  const theoretical = d(theoreticalBomQty);
  const allowanceQty = d(extraAllowanceQty);
  if (!theoretical.isFinite() || theoretical.isNegative()) {
    throw allowanceError("Theoretical BOM RM must be zero or positive.", "INVALID_THEORETICAL_BOM_RM");
  }
  if (!allowanceQty.isFinite() || allowanceQty.isNegative()) {
    throw allowanceError("Add Qty cannot be negative.", "PLANNED_ALLOWANCE_NEGATIVE");
  }
  const applicable = d(applicableBomRequirement(theoretical, alreadyIssuedQty));
  const pctBase = applicable.gt(0) ? applicable : theoretical;
  const pct = pctBase.isZero() ? new Decimal(0) : allowanceQty.div(pctBase).times(100);
  const thisIssueTarget = applicable.plus(allowanceQty);
  if (pct.gt(PLANNED_ALLOWANCE_INITIAL_ISSUE_MAX_PCT)) {
    throw allowanceError(
      "Planned Process Allowance above 10% is not permitted for an initial issue. Use Additional RM Issue with approval.",
      "PLANNED_ALLOWANCE_INITIAL_ISSUE_LIMIT",
      409,
    );
  }
  return {
    theoreticalBomQty: theoretical.toDecimalPlaces(6).toNumber(),
    applicableBomQty: applicable.toDecimalPlaces(6).toNumber(),
    allowanceInputSource: ALLOWANCE_SOURCES.QUANTITY,
    enteredAllowancePct: null,
    enteredAllowanceQty: allowanceQty.toDecimalPlaces(6).toNumber(),
    plannedAllowancePct: pct.toDecimalPlaces(4).toNumber(),
    plannedAllowanceQty: allowanceQty.toDecimalPlaces(6).toNumber(),
    recommendedIssueQty: thisIssueTarget.toDecimalPlaces(6).toNumber(),
    requiresAdminApproval: pct.gt(PLANNED_ALLOWANCE_NORMAL_MAX_PCT),
  };
}

function defaultIssueNowQty(theoreticalBomQty, extraAllowanceQty, alreadyIssuedQty = 0) {
  const applicableBom = d(applicableBomRequirement(theoreticalBomQty, alreadyIssuedQty));
  const extra = d(extraAllowanceQty);
  if (!extra.isFinite() || extra.isNegative()) {
    throw allowanceError("Add Qty cannot be negative.", "PLANNED_ALLOWANCE_NEGATIVE");
  }
  return applicableBom.plus(extra).toDecimalPlaces(6).toNumber();
}

function validatePlannedProcessAllowance(input, actor = {}) {
  const source = String(input.allowanceInputSource || ALLOWANCE_SOURCES.QUANTITY).trim().toUpperCase();
  if (source === "PERCENT" || input.enteredAllowancePct != null) {
    throw allowanceError(
      "Allowance % is calculated by the server. Submit Add Qty only.",
      "PLANNED_ALLOWANCE_PERCENT_NOT_ACCEPTED",
      400,
    );
  }
  if (source !== ALLOWANCE_SOURCES.QUANTITY) {
    throw allowanceError("Allowance input source must be QUANTITY.", "PLANNED_ALLOWANCE_SOURCE_INVALID");
  }

  const alreadyIssued = d(input.alreadyIssuedQty ?? 0);
  const applicable = d(applicableBomRequirement(input.theoreticalBomQty, alreadyIssued));
  const submittedExtraQty = input.enteredAllowanceQty ?? input.plannedAllowanceQty;
  const issueQty = input.issueQty == null ? null : d(input.issueQty);
  if (issueQty != null && (!issueQty.isFinite() || issueQty.isNegative())) {
    throw allowanceError("Issue Now must be zero or positive.", "PLANNED_ALLOWANCE_ISSUE_INVALID");
  }
  const derivedExtraQty = issueQty == null ? null : Decimal.max(0, issueQty.minus(applicable));
  if (derivedExtraQty != null && submittedExtraQty != null) {
    const supplied = d(submittedExtraQty);
    if (!supplied.isFinite() || supplied.minus(derivedExtraQty).abs().gt(CALC_TOLERANCE)) {
      throw allowanceError(
        "Submitted Add Qty does not match Issue Now and the current remaining BOM quantity.",
        "PLANNED_ALLOWANCE_CALCULATION_MISMATCH",
        409,
      );
    }
  }
  const extraQty = derivedExtraQty ?? submittedExtraQty ?? 0;
  const result = calculatePlannedProcessAllowance(input.theoreticalBomQty, extraQty, alreadyIssued);
  const issueDefault = defaultIssueNowQty(input.theoreticalBomQty, extraQty, alreadyIssued);

  // Percentage and recommendation are server-owned. Reject manipulated derived values.
  for (const [field, expected] of [
    ["plannedAllowancePct", result.plannedAllowancePct],
    ["plannedAllowanceQty", result.plannedAllowanceQty],
    ["recommendedIssueQty", result.recommendedIssueQty],
    ["enteredAllowancePct", null],
  ]) {
    if (input[field] == null) continue;
    if (expected == null) {
      throw allowanceError(
        "Submitted Allowance % is not accepted; the server calculates percentage from Add Qty.",
        "PLANNED_ALLOWANCE_PERCENT_NOT_ACCEPTED",
        409,
      );
    }
    const supplied = d(input[field]);
    if (!supplied.isFinite() || supplied.minus(expected).abs().gt(CALC_TOLERANCE)) {
      throw allowanceError(
        `Submitted ${field} does not match the server-calculated planned allowance.`,
        "PLANNED_ALLOWANCE_CALCULATION_MISMATCH",
        409,
      );
    }
  }

  const reason = String(input.allowanceReason || "").trim();
  if (result.requiresAdminApproval && !reason) {
    throw allowanceError(
      "A reason is required when Planned Process Allowance is above 5%.",
      "PLANNED_ALLOWANCE_REASON_REQUIRED",
    );
  }

  /**
   * mode:
   * - ISSUE (default): Store may issue ≤5%; above 5% requires Admin role or a linked APPROVED request.
   * - SUBMIT_APPROVAL: Store may create an approval request (no stock move); skips Admin role gate.
   */
  const mode = String(actor.mode || "ISSUE").trim().toUpperCase();
  const role = String(actor.role || "").toUpperCase();
  const hasApprovedRequest = Boolean(actor.approvedAllowanceRequest);

  if (result.requiresAdminApproval && mode === "ISSUE" && role !== "ADMIN" && !hasApprovedRequest) {
    throw allowanceError(
      "Admin approval is required before issuing RM with Planned Process Allowance above 5%. Send for Admin Approval first.",
      "PLANNED_ALLOWANCE_ADMIN_APPROVAL_REQUIRED",
      403,
    );
  }

  return {
    ...result,
    defaultIssueNowQty: issueDefault,
    allowanceReason: reason || null,
    approvalStatus: result.requiresAdminApproval
      ? hasApprovedRequest || role === "ADMIN"
        ? "APPROVED"
        : "PENDING_APPROVAL"
      : "NOT_REQUIRED",
  };
}

function assessIssueAgainstPlannedAllowance(input) {
  const alreadyIssued = Decimal.max(0, d(input.alreadyIssuedQty ?? 0));
  const thisIssue = d(input.issueQty);
  const theoretical = d(input.theoreticalBomQty);
  const extra = d(input.extraAllowanceQty ?? input.plannedAllowanceQty ?? 0);
  if (
    !thisIssue.isFinite() ||
    thisIssue.isNegative() ||
    !theoretical.isFinite() ||
    theoretical.isNegative() ||
    !extra.isFinite() ||
    extra.isNegative()
  ) {
    throw allowanceError("Invalid issue or planned allowance quantity.", "PLANNED_ALLOWANCE_ISSUE_INVALID");
  }
  const applicableBom = d(applicableBomRequirement(theoretical, alreadyIssued));
  const targetThisIssue = applicableBom.plus(extra);
  const cumulativeIssued = alreadyIssued.plus(thisIssue);
  const trueShortQty = Decimal.max(0, theoretical.minus(cumulativeIssued)).toDecimalPlaces(6).toNumber();
  const belowTargetQty = Decimal.max(0, targetThisIssue.minus(thisIssue)).toDecimalPlaces(6).toNumber();
  const excessIssueQty = Decimal.max(0, thisIssue.minus(targetThisIssue)).toDecimalPlaces(6).toNumber();
  return {
    applicableBomQty: applicableBom.toDecimalPlaces(6).toNumber(),
    targetIssueQty: targetThisIssue.toDecimalPlaces(6).toNumber(),
    trueShortQty,
    belowRecommendedQty: belowTargetQty,
    excessIssueQty,
  };
}

/**
 * Recover the runner share already present inside Theoretical BOM RM.
 * Does not add runner on top of theoretical or recommended quantities.
 */
function recoverIncludedRunnerQty(theoreticalBomQty, fgWeight, runnerWeight) {
  const theoretical = d(theoreticalBomQty);
  const fg = d(fgWeight);
  const runner = d(runnerWeight);
  if (!theoretical.isFinite() || theoretical.isNegative()) {
    throw allowanceError("Theoretical BOM RM must be zero or positive.", "INVALID_THEORETICAL_BOM_RM");
  }
  if (!fg.isFinite() || fg.isNegative() || !runner.isFinite() || runner.isNegative()) {
    return 0;
  }
  const shot = fg.plus(runner);
  if (shot.isZero()) return 0;
  return theoretical.times(runner.div(shot)).toDecimalPlaces(6).toNumber();
}

module.exports = {
  ALLOWANCE_SOURCES,
  PLANNED_ALLOWANCE_NORMAL_MAX_PCT,
  PLANNED_ALLOWANCE_INITIAL_ISSUE_MAX_PCT,
  calculatePlannedProcessAllowance,
  validatePlannedProcessAllowance,
  assessIssueAgainstPlannedAllowance,
  applicableBomRequirement,
  defaultIssueNowQty,
  recoverIncludedRunnerQty,
};
