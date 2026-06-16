export const STORE_PRODUCTION_HANDOFF_LABEL = "RM issued — waiting for Production";

export const STORE_HANDOFF_STATUS_LABEL = "Ready for Production";

export const STORE_HANDOFF_COMPLETE_LABEL = "Store handoff complete";

export const STORE_HANDOFF_ACTION_LABEL = "Waiting for Production";

export const STORE_HANDOFF_NO_ACTION_LABEL = "No further Store action required";

export const STORE_HANDOFF_ISSUED_COVERAGE_LABEL = "Issued to Production";

export const STORE_HANDOFF_LINE_STATUS_PARTIAL = "Partially issued to Production";

export const POST_ISSUE_RM_TABLE_HEADERS = [
  "RM item",
  "Required",
  "Issued to Production",
  "Store Balance",
  "Status",
] as const;

export const PRE_ISSUE_RM_TABLE_HEADERS = [
  "RM item",
  "Need",
  "Available",
  "Incoming",
  "Coverage",
  "Procurement",
] as const;

export const POST_ISSUE_RM_TABLE_HELPER_TEXT =
  "Issued quantities for Production. Store Balance is remaining free stock, not WO availability.";

export const POST_ISSUE_QUEUE_TYPE = "READY_TO_RELEASE_WO";

export function isPostIssueQueueType(queueType?: string | null): boolean {
  return String(queueType ?? "").trim() === POST_ISSUE_QUEUE_TYPE;
}

export function isPostIssueStoreHandoff(input: {
  queueType?: string | null;
  storeActionKey?: string | null;
  allocationFirstKey?: string | null;
}): boolean {
  return (
    isPostIssueQueueType(input.queueType) ||
    String(input.storeActionKey ?? "").trim() === "HANDOFF_TO_PRODUCTION" ||
    String(input.allocationFirstKey ?? "").trim() === "READY_FOR_PRODUCTION"
  );
}

/** Presentation-only status for RM line row after Store handoff. */
export function storeHandoffLineStatusLabel(line: {
  requiredQty?: number;
  issuedToProductionQty?: number;
}): string {
  const required = Math.max(0, Number(line.requiredQty ?? 0));
  const issued = Math.max(0, Number(line.issuedToProductionQty ?? 0));
  if (required > 0 && issued > 0 && issued + 1e-6 < required) {
    return STORE_HANDOFF_LINE_STATUS_PARTIAL;
  }
  if (issued > 0) {
    return STORE_HANDOFF_ISSUED_COVERAGE_LABEL;
  }
  return STORE_HANDOFF_COMPLETE_LABEL;
}

/** @deprecated Use storeHandoffLineStatusLabel for Status column. */
export function storeHandoffLineCoverageLabel(line: {
  requiredQty?: number;
  issuedToProductionQty?: number;
}): string {
  return storeHandoffLineStatusLabel(line);
}

/** Rewrites production-oriented queue copy for Store post-issue states. */
export function sanitizeStoreHandoffOperatorCopy(text: string | null | undefined): string {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (
    lower.includes("start production") ||
    lower.includes("open production") ||
    lower.includes("release wo") ||
    lower.includes("release work order")
  ) {
    return STORE_HANDOFF_ACTION_LABEL;
  }
  if (lower.includes("material issued / release ready")) {
    return STORE_HANDOFF_COMPLETE_LABEL;
  }
  return raw;
}
