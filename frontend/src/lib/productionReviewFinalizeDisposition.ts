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
