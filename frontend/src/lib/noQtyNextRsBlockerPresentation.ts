/**
 * P6B-4A — Human-readable Next RS eligibility (cycle-oriented business language).
 */

import {
  noQtyBusinessNextRsBlockReason,
  noQtyNextRsStatusHeadline,
} from "./noQtyRsActionLabels";

export type NoQtyNextRsBlockerInput = {
  reason?: string | null;
  blockingPmrDocNo?: string | null;
  blockingPmrStatus?: string | null;
  existingNextRsDocNo?: string | null;
  eligible?: boolean;
  /** When set, used for "already exists" messaging instead of RS doc no. */
  nextCycleNo?: number | null;
};

export type NoQtyNextRsStatusPresentation = {
  canCreate: boolean;
  title: string;
  reason: string | null;
  detail: string | null;
};

/** @deprecated Prefer noQtyBusinessNextRsBlockReason — kept for callers passing full input. */
export function formatNoQtyNextRsBlockReason(input: NoQtyNextRsBlockerInput): string {
  if (input.existingNextRsDocNo && String(input.existingNextRsDocNo).trim()) {
    return noQtyBusinessNextRsBlockReason("NEXT_RS_EXISTS");
  }
  return noQtyBusinessNextRsBlockReason(input.reason);
}

export function presentNoQtyNextRsStatus(input: NoQtyNextRsBlockerInput): NoQtyNextRsStatusPresentation {
  const eligible = input.eligible === true;
  const existing = String(input.existingNextRsDocNo ?? "").trim();
  const nextExists = Boolean(existing);

  if (eligible) {
    return {
      canCreate: true,
      title: noQtyNextRsStatusHeadline(true, false),
      reason: null,
      detail: "You can create the next cycle Requirement Sheet under this agreement.",
    };
  }

  const reasonText = formatNoQtyNextRsBlockReason(input);
  return {
    canCreate: false,
    title: noQtyNextRsStatusHeadline(false, nextExists),
    reason: nextExists
      ? input.nextCycleNo != null && input.nextCycleNo > 0
        ? `Cycle ${input.nextCycleNo} Requirement Sheet already exists.`
        : "Next cycle Requirement Sheet already exists."
      : reasonText || "Next cycle RS is not available yet.",
    detail: nextExists ? null : reasonText || null,
  };
}
