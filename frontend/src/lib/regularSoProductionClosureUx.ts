/**
 * REGULAR_SO production closure UX — SO demand vs WO planned quantity.
 * Presentation helpers only; authoritative coverage comes from the backend.
 */

export type RegularSoDemandCoverageLine = {
  workOrderLineId: number;
  fgItemId: number;
  soDemandQty: number;
  producedOnThisWo: number;
  woPlannedQty: number;
  remainingSoDemand: number;
  woTargetBalance: number;
  soDemandCovered: boolean;
  expectedExcessBeforeQc: number;
  soShortageQty: number;
  productionObligationMet: boolean;
  hasSoShortage: boolean;
  canEndProductionWithWoRemainder: boolean;
};

export type RegularSoDemandCoverage = {
  workOrderId: number;
  workOrderDocNo?: string | null;
  workOrderStatus?: string;
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  executionStatus?: string;
  reportPending: boolean;
  soDemandQty: number;
  producedQty: number;
  woPlannedQty: number;
  woTargetBalance: number;
  remainingSoDemand: number;
  expectedExcessBeforeQc: number;
  soShortageQty: number;
  soDemandCovered: boolean;
  productionObligationMet: boolean;
  hasSoShortage: boolean;
  canEndProductionWithWoRemainder: boolean;
  canRequestEndProduction: boolean;
  lines: RegularSoDemandCoverageLine[];
};

const EPS = 1e-6;

export function formatRegularSoClosureQty(qty: number, unit?: string | null): string {
  const n = Number(qty);
  const v = Number.isFinite(n) ? n : 0;
  const rounded = Math.round(v * 1000) / 1000;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  const u = String(unit ?? "").trim();
  return u ? `${text} ${u}` : text;
}

/** Status line when SO demand is covered but WO-plan buffer remains. */
export function regularSoDemandCoveredStatusMessage(coverage: Pick<
  RegularSoDemandCoverage,
  "expectedExcessBeforeQc" | "soDemandCovered" | "woTargetBalance"
>, unit?: string | null): string | null {
  if (!coverage.soDemandCovered) return null;
  if (Number(coverage.woTargetBalance) > EPS) {
    return `SO demand covered — ${formatRegularSoClosureQty(coverage.expectedExcessBeforeQc, unit)} produced above SO demand.`;
  }
  return "SO demand covered — WO target met.";
}

export function shouldOfferRegularEndProductionCovered(
  coverage: Pick<RegularSoDemandCoverage, "canEndProductionWithWoRemainder" | "reportPending"> | null | undefined,
): boolean {
  if (!coverage) return false;
  return Boolean(coverage.canEndProductionWithWoRemainder && !coverage.reportPending);
}

export function shouldOfferRegularEndProductionShortage(
  coverage: Pick<RegularSoDemandCoverage, "hasSoShortage" | "producedQty" | "reportPending"> | null | undefined,
): boolean {
  if (!coverage) return false;
  return Boolean(coverage.hasSoShortage && Number(coverage.producedQty) > EPS && !coverage.reportPending);
}

export function shouldHideRegularProductionEntryForReport(
  coverage: Pick<RegularSoDemandCoverage, "reportPending"> | null | undefined,
): boolean {
  return Boolean(coverage?.reportPending);
}
