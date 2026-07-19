/**
 * Material Issue allowance presentation (Add Qty authored only).
 * Allowance % = Add Qty ÷ applicable BOM Qty × 100 (read-only acknowledgement).
 * Issue Now default = applicable BOM + Add Qty (no double-count of prior issues).
 * Backend remains authoritative.
 */

const QTY_SCALE = 1_000_000n;
const PCT_SCALE = 10_000n;
const HUNDRED_SCALED = 100n * PCT_SCALE;

export type PlannedAllowanceInputSource = "QUANTITY";

export type PlannedAllowanceCalculation = {
  valid: boolean;
  source: PlannedAllowanceInputSource;
  theoreticalQty: number;
  /** Remaining BOM entitlement for this issue (Qty BOM display). */
  applicableBomQty: number;
  enteredQty: string;
  calculatedPct: number;
  calculatedQty: number;
  /** This-issue target = applicable BOM + Add Qty. */
  recommendedIssueQty: number;
  defaultIssueNowQty: number;
  requiresReason: boolean;
  requiresAdminApproval: boolean;
  blocked: boolean;
  error: string | null;
};

export type PlannedIssuePosition =
  | "INVALID"
  | "TRUE_SHORT"
  | "BELOW_TARGET"
  | "ON_TARGET"
  | "EXCESS";

export type PlannedIssueAssessment = {
  position: PlannedIssuePosition;
  trueShortQty: number;
  belowTargetQty: number;
  excessQty: number;
};

export type IssueStatusPresentation = {
  stockBadge: "Ready" | "Short";
  stockTone: "ready" | "warning";
  issueLabel: string;
  issueMessage: string;
  tone: "ready" | "warning" | "danger";
};

function parseScaled(raw: string | number | null | undefined, scaleDigits: number): bigint | null {
  const value = String(raw ?? "").trim();
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value) || value === ".") return null;
  const normalized = value.startsWith(".") ? `0${value}` : value;
  const [whole = "0", fractional = ""] = normalized.split(".");
  const padded = `${fractional}${"0".repeat(scaleDigits)}`.slice(0, scaleDigits);
  try {
    return BigInt(whole) * 10n ** BigInt(scaleDigits) + BigInt(padded || "0");
  } catch {
    return null;
  }
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Invalid allowance denominator");
  return (numerator + denominator / 2n) / denominator;
}

function scaledToNumber(value: bigint, scale: bigint): number {
  return Number(value) / Number(scale);
}

export function formatAllowanceInput(value: number, maxFractionDigits = 6): string {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(maxFractionDigits).replace(/\.?0+$/, "");
}

export function applicableBomRequirement(
  theoreticalQty: number | string,
  alreadyIssuedQty: number | string = 0,
): number {
  const theoreticalMicro = parseScaled(theoreticalQty, 6);
  const issuedMicro = parseScaled(alreadyIssuedQty, 6);
  if (theoreticalMicro == null || theoreticalMicro < 0n) return Number.NaN;
  const issued = issuedMicro == null || issuedMicro < 0n ? 0n : issuedMicro;
  const covered = issued < theoreticalMicro ? issued : theoreticalMicro;
  return scaledToNumber(theoreticalMicro - covered, QTY_SCALE);
}

export function calculatePlannedAllowance(input: {
  theoreticalQty: number | string;
  quantityRaw: string;
  alreadyIssuedQty?: number | string;
}): PlannedAllowanceCalculation {
  const theoreticalMicro = parseScaled(input.theoreticalQty, 6);
  const enteredQty = input.quantityRaw;
  const alreadyIssued = Number(input.alreadyIssuedQty ?? 0);
  const invalid = (message: string): PlannedAllowanceCalculation => ({
    valid: false,
    source: "QUANTITY",
    theoreticalQty: Number(input.theoreticalQty),
    applicableBomQty: Number.NaN,
    enteredQty,
    calculatedPct: Number.NaN,
    calculatedQty: Number.NaN,
    recommendedIssueQty: Number.NaN,
    defaultIssueNowQty: Number.NaN,
    requiresReason: false,
    requiresAdminApproval: false,
    blocked: false,
    error: message,
  });

  if (theoreticalMicro == null || theoreticalMicro < 0n) {
    return invalid("Qty (BOM) must be zero or positive.");
  }

  const parsedQty = parseScaled(input.quantityRaw, 6);
  if (parsedQty == null) return invalid("Enter a valid Add Qty.");
  if (parsedQty < 0n) return invalid("Add Qty cannot be negative.");

  const allowanceMicro = parsedQty;
  const applicableBom = applicableBomRequirement(input.theoreticalQty, alreadyIssued);
  const applicableMicro = parseScaled(applicableBom, 6) ?? 0n;
  const pctBaseMicro = applicableMicro > 0n ? applicableMicro : theoreticalMicro;
  const pctScaled =
    pctBaseMicro === 0n
      ? 0n
      : divideRounded(allowanceMicro * HUNDRED_SCALED, pctBaseMicro);
  const defaultIssueNow = applicableBom + scaledToNumber(allowanceMicro, QTY_SCALE);
  const pct = scaledToNumber(pctScaled, PCT_SCALE);
  const blocked = pct > 10;

  return {
    valid: true,
    source: "QUANTITY",
    theoreticalQty: scaledToNumber(theoreticalMicro, QTY_SCALE),
    applicableBomQty: applicableBom,
    enteredQty,
    calculatedPct: pct,
    calculatedQty: scaledToNumber(allowanceMicro, QTY_SCALE),
    recommendedIssueQty: Math.round(defaultIssueNow * 1_000_000) / 1_000_000,
    defaultIssueNowQty: Math.round(defaultIssueNow * 1_000_000) / 1_000_000,
    requiresReason: pct > 5,
    requiresAdminApproval: pct > 5,
    blocked,
    error: blocked ? "Above 10% allowance · Blocked" : null,
  };
}

export function assessIssueAgainstAllowance(input: {
  issueQty: number | string;
  theoreticalQty: number;
  alreadyIssuedQty?: number;
  extraAllowanceQty: number;
}): PlannedIssueAssessment {
  const issue = Number(input.issueQty);
  const theoretical = Number(input.theoreticalQty);
  const alreadyIssued = Math.max(0, Number(input.alreadyIssuedQty ?? 0));
  const extra = Number(input.extraAllowanceQty);
  if (![issue, theoretical, extra].every(Number.isFinite) || issue < 0 || extra < 0) {
    return { position: "INVALID", trueShortQty: 0, belowTargetQty: 0, excessQty: 0 };
  }
  const round6 = (v: number) => Math.round(v * 1_000_000) / 1_000_000;
  const applicableBom = applicableBomRequirement(theoretical, alreadyIssued);
  const target = round6(applicableBom + extra);
  const cumulative = round6(alreadyIssued + issue);
  const trueShortQty = round6(Math.max(0, theoretical - cumulative));
  const belowTargetQty = round6(Math.max(0, target - issue));
  const excessQty = round6(Math.max(0, issue - target));
  if (trueShortQty > 1e-6 && issue + 1e-6 < applicableBom) {
    return { position: "TRUE_SHORT", trueShortQty, belowTargetQty, excessQty };
  }
  if (excessQty > 1e-6) return { position: "EXCESS", trueShortQty, belowTargetQty, excessQty };
  if (belowTargetQty > 1e-6) {
    return { position: "BELOW_TARGET", trueShortQty, belowTargetQty, excessQty };
  }
  return { position: "ON_TARGET", trueShortQty, belowTargetQty, excessQty };
}

/** Stock readiness beside Available Qty (compact). */
export function stockReadinessBadge(availableQty: number | null | undefined, issueQty: number | string): {
  label: "Ready" | "Short";
  tone: "ready" | "warning";
} {
  const issue = Number(issueQty);
  if (availableQty == null || !Number.isFinite(issue)) {
    return { label: "Ready", tone: "ready" };
  }
  if (issue > availableQty + 1e-6) {
    return { label: "Short", tone: "warning" };
  }
  return { label: "Ready", tone: "ready" };
}

/** Bottom-right Issue Status presentation. */
export function issueStatusPresentation(input: {
  calculation: PlannedAllowanceCalculation;
  availableQty?: number | null;
  issueQty: number | string;
  reason?: string | null;
  actorRole?: string | null;
}): IssueStatusPresentation {
  const issueQty = Number(input.issueQty);
  const stock = stockReadinessBadge(input.availableQty, issueQty);
  const isAdmin = String(input.actorRole ?? "").toUpperCase() === "ADMIN";
  const hasReason = Boolean(String(input.reason ?? "").trim());

  if (input.availableQty != null && Number.isFinite(issueQty) && issueQty > input.availableQty + 1e-6) {
    return {
      stockBadge: stock.label,
      stockTone: stock.tone,
      issueLabel: "Insufficient stock",
      issueMessage: "Issue Now exceeds available stock.",
      tone: "danger",
    };
  }
  if (!input.calculation.valid || input.calculation.blocked) {
    return {
      stockBadge: stock.label,
      stockTone: stock.tone,
      issueLabel: "Above 10% allowance · Blocked",
      issueMessage: input.calculation.error ?? "Use Additional RM Issue.",
      tone: "danger",
    };
  }
  if (input.calculation.requiresAdminApproval) {
    if (isAdmin && hasReason) {
      return {
        stockBadge: stock.label,
        stockTone: stock.tone,
        issueLabel: "Approved by Admin",
        issueMessage: "Reason recorded · Admin approved.",
        tone: "ready",
      };
    }
    return {
      stockBadge: stock.label,
      stockTone: stock.tone,
      issueLabel: "Reason and Admin approval required",
      issueMessage: hasReason ? "Admin approval required above 5%." : "Reason required above 5%.",
      tone: "warning",
    };
  }
  return {
    stockBadge: stock.label,
    stockTone: stock.tone,
    issueLabel: "Normal · No approval required",
    issueMessage: "Within 5% allowance.",
    tone: "ready",
  };
}

/** @deprecated Prefer issueStatusPresentation for the compact card. */
export function plannedAllowanceStatus(input: {
  calculation: PlannedAllowanceCalculation;
  issue: PlannedIssueAssessment;
  availableQty?: number | null;
  issueQty: number | string;
  reason?: string | null;
}): {
  label: "Ready" | "Approval Required" | "Blocked" | "Short Issue" | "Excess Issue" | "Insufficient Stock";
  message: string | null;
  tone: "ready" | "warning" | "danger";
} {
  const presentation = issueStatusPresentation({
    calculation: input.calculation,
    availableQty: input.availableQty,
    issueQty: input.issueQty,
    reason: input.reason,
  });
  if (presentation.tone === "danger" && presentation.issueLabel.includes("stock")) {
    return { label: "Insufficient Stock", message: presentation.issueMessage, tone: "danger" };
  }
  if (presentation.tone === "danger") {
    return { label: "Blocked", message: presentation.issueMessage, tone: "danger" };
  }
  if (presentation.tone === "warning") {
    return { label: "Approval Required", message: presentation.issueMessage, tone: "warning" };
  }
  return { label: "Ready", message: null, tone: "ready" };
}
