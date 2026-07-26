/**
 * Review & Finalize remaining-WO disposition options.
 * Factory process: production is recorded only after activity stops — there is no
 * “keep running / Continue Production” finalize decision. Resume + workspace
 * Continue tab handle later production after a Pause.
 */

export type ReviewFinalizeDisposition = "PAUSE" | "END_WITH_SHORTAGE";

export type ReviewFinalizeDispositionOption = {
  id: ReviewFinalizeDisposition;
  title: string;
  description: string;
};

/** Two balanced cards when WO quantity remains. Never includes Continue Production. */
export const REVIEW_FINALIZE_REMAINING_OPTIONS: readonly ReviewFinalizeDispositionOption[] = [
  {
    id: "PAUSE",
    title: "Pause Production",
    description:
      "Production has temporarily stopped. Finalize this quantity and send it to QC. Keep the remaining quantity in the same WO. Resume is required before any further production. No Production Report yet.",
  },
  {
    id: "END_WITH_SHORTAGE",
    title: "End Production with Shortage",
    description:
      "No further production for this WO. Finalize this quantity, then complete the mandatory RM Production Report. Shortage transfer/recovery follows Confirm Report & Close WO.",
  },
] as const;

export function reviewFinalizePrimaryButtonLabel(input: {
  remainingAfterEntry: number;
  disposition: ReviewFinalizeDisposition | null | undefined;
}): string {
  const remaining = Number(input.remainingAfterEntry);
  if (Number.isFinite(remaining) && remaining <= 1e-6) return "Complete Production";
  if (input.disposition === "PAUSE") return "Pause Production";
  if (input.disposition === "END_WITH_SHORTAGE") return "End Production";
  return "Select an outcome";
}

/** Operator must deliberately choose Pause or End when balance remains. */
export function isReviewFinalizeDispositionReady(input: {
  remainingAfterEntry: number;
  disposition: ReviewFinalizeDisposition | null | undefined;
}): boolean {
  const remaining = Number(input.remainingAfterEntry);
  if (Number.isFinite(remaining) && remaining <= 1e-6) return true;
  return input.disposition === "PAUSE" || input.disposition === "END_WITH_SHORTAGE";
}

/** Guard: modal must never offer Continue as a finalize card. */
export function reviewFinalizeOptionsIncludeContinue(
  options: readonly { id: string; title: string }[] = REVIEW_FINALIZE_REMAINING_OPTIONS,
): boolean {
  return options.some(
    (o) => o.id === "CONTINUE" || /continue production/i.test(String(o.title ?? "")),
  );
}

/** WO planned − previously finalized − current draft (matches backend remainder intent). */
export function computeReviewFinalizeShortageQty(
  plannedQty: number,
  previouslyFinalized: number,
  currentDraft: number,
): number {
  const planned = Number(plannedQty);
  const prev = Number(previouslyFinalized);
  const draft = Number(currentDraft);
  const p = Number.isFinite(planned) ? planned : 0;
  const a = Number.isFinite(prev) ? prev : 0;
  const d = Number.isFinite(draft) ? draft : 0;
  return Math.max(0, p - a - d);
}

export type ReviewFinalizeFlowKind = "NO_QTY" | "GREEN_LEVEL" | "REGULAR" | "OTHER";

/**
 * Shortage panel copy for End Production with Shortage.
 * NO_QTY must never claim the shortage is lost (REGULAR permanent-close language).
 */
export function reviewFinalizeShortagePanelCopy(input: {
  flow: ReviewFinalizeFlowKind;
  shortageQty: number;
  formatQty: (n: number) => string;
  unit?: string | null;
}): {
  heading: string;
  body: string;
  checkbox: string;
  button: string;
  testId: string;
} {
  const qtyLabel = `${input.formatQty(input.shortageQty)}${input.unit?.trim() ? ` ${input.unit.trim()}` : ""}`;
  if (input.flow === "NO_QTY") {
    return {
      heading: `Closing this WO leaves exactly ${qtyLabel} unproduced.`,
      body: `This WO will close permanently. The ${qtyLabel} shortage will be transferred to RS-1 recovery for Keep/Waive decision and can be planned in the next cycle/new WO.`,
      checkbox: `I understand this WO will close permanently and the ${qtyLabel} shortage transfers to RS-1 recovery (Keep/Waive).`,
      button: "End Production — Transfer Shortage",
      testId: "noqty-review-finalize-shortage-recovery",
    };
  }
  if (input.flow === "GREEN_LEVEL") {
    return {
      heading: `Closing this WO leaves exactly ${qtyLabel} unproduced.`,
      body: "This WO will close permanently. Remaining Green Level quantity returns to replenishment planning — it is not discarded.",
      checkbox: "I understand this WO will close permanently and remaining qty returns to Green Level planning.",
      button: "End Production with Shortage",
      testId: "green-level-review-finalize-shortage",
    };
  }
  // Fallback for non-REGULAR hardened flows — never claim shortage is lost without recovery.
  return {
    heading: `Closing this WO leaves exactly ${qtyLabel} unproduced.`,
    body: "This WO will close permanently. Remaining quantity follows the applicable planning recovery path.",
    checkbox: "I understand this WO will close permanently.",
    button: "End Production with Shortage",
    testId: "review-finalize-shortage-generic",
  };
}
