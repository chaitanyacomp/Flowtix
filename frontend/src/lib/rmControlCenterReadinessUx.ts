/**
 * M1.4 — RM Control Center readiness consumption (presentation only).
 * Maps authoritative `nextStoreAction` from GET /api/material-availability/workspace.
 */

import type { GuidedWorkflowPhase } from "./rmGuidedWorkflow";

export type BackendStoreAction = {
  key: string;
  label: string;
  description?: string | null;
  secondaryStoreAction?: { key: string; label: string; description?: string | null } | null;
};

export function normalizeStoreActionKey(key: string | null | undefined): string {
  const k = String(key ?? "REVIEW").trim().toUpperCase();
  return k || "REVIEW";
}

/** Backend `ISSUE` store action — replaces local PMR/free-stock issueability math. */
export function isStoreActionIssueReady(storeAction: BackendStoreAction | null | undefined): boolean {
  return normalizeStoreActionKey(storeAction?.key) === "ISSUE";
}

export function isStoreActionPostIssueHandoff(storeAction: BackendStoreAction | null | undefined): boolean {
  const k = normalizeStoreActionKey(storeAction?.key);
  return k === "HANDOFF_TO_PRODUCTION" || k === "RELEASE_TO_PRODUCTION";
}

/** Presentation-only guided workflow phase from backend store action key. */
export function mapStoreActionToGuidedPhase(storeActionKey: string | null | undefined): GuidedWorkflowPhase {
  switch (normalizeStoreActionKey(storeActionKey)) {
    case "ISSUE":
      return "E_READY_TO_ISSUE";
    case "HANDOFF_TO_PRODUCTION":
    case "RELEASE_TO_PRODUCTION":
      return "F_ISSUED_OPEN_PRODUCTION";
    case "WAIT_GRN":
      return "D_PO_GRN_PENDING";
    case "WAIT_PO":
      return "C_PR_CREATED";
    case "CONTINUE_PROCUREMENT":
    case "VIEW_PROCUREMENT":
    case "ADD_CASE_LINES":
    case "AWAITING_PR":
      return "B_MR_ESCALATED";
    case "ESCALATE":
    case "REOPEN_REQUISITION":
      return "A_BLOCKED";
    case "CREATE_WO":
      return "B_MR_ESCALATED";
    default:
      return "IDLE";
  }
}

export function guidedTimelineIndexForStoreAction(storeActionKey: string | null | undefined): number {
  switch (mapStoreActionToGuidedPhase(storeActionKey)) {
    case "A_BLOCKED":
      return 0;
    case "B_MR_ESCALATED":
      return 1;
    case "C_PR_CREATED":
      return 2;
    case "D_PO_GRN_PENDING":
      return 3;
    case "E_READY_TO_ISSUE":
    case "F_ISSUED_OPEN_PRODUCTION":
      return 4;
    default:
      return 0;
  }
}

export type StoreActionPrimaryPresentation =
  | { kind: "handoff"; label: string; description: string }
  | { kind: "link"; label: string; href: string; description?: string | null }
  | { kind: "waiting"; label: string; description?: string | null; href?: string | null }
  | { kind: "raise_mr"; label: string; description?: string | null }
  | { kind: "create_pr"; label: string; description?: string | null }
  | { kind: "allocation_fallback"; description?: string | null }
  | { kind: "none"; description?: string | null };

/** Center/header status chip — never mirror primary CTA wording (e.g. Create Work Order). */
export function rmControlCenterCaseStatusLabel(input: {
  storeActionKey?: string | null;
  storeActionLabel?: string | null;
  fallbackLabel?: string | null;
}): string {
  const key = normalizeStoreActionKey(input.storeActionKey);
  const label = String(input.storeActionLabel ?? "").trim();
  const fallback = String(input.fallbackLabel ?? "").trim();

  switch (key) {
    case "CREATE_WO":
      return "RM Ready";
    case "AWAITING_PR":
      return "Awaiting PR";
    case "WAIT_PO":
      return "Awaiting PO";
    case "WAIT_GRN":
      return "GRN Pending";
    case "ISSUE":
      return label || "Ready for issue";
    case "HANDOFF_TO_PRODUCTION":
    case "RELEASE_TO_PRODUCTION":
      return label || "RM issued";
    default:
      break;
  }

  if (/^create work order$/i.test(label) || /^create work order$/i.test(fallback)) return "RM Ready";
  if (/^create purchase request$/i.test(label) || /^create purchase request$/i.test(fallback)) return "Awaiting PR";
  return label || fallback || "Review case";
}

export function resolveStoreActionPrimaryPresentation(input: {
  storeAction: BackendStoreAction | null | undefined;
  issueHref: string;
  grnHref: string;
  prepareWoHref?: string | null;
  procurementWorkspaceHref?: string | null;
  noQtyPrepareWoHref?: string | null;
  isNoQtyOrder?: boolean;
  /** When Create PR / Open Workspace already shown in procurement panel. */
  hideDuplicateProcurementAction?: boolean;
}): StoreActionPrimaryPresentation {
  const action = input.storeAction;
  const key = normalizeStoreActionKey(action?.key);
  const label = action?.label?.trim() || "Review case";
  const description = action?.description?.trim() || null;

  if (isStoreActionPostIssueHandoff(action)) {
    return { kind: "handoff", label, description: description ?? label };
  }

  if (key === "ISSUE" && input.issueHref) {
    return { kind: "link", label, href: input.issueHref, description };
  }

  if (key === "CREATE_WO" && (input.noQtyPrepareWoHref || input.prepareWoHref)) {
    const href = input.noQtyPrepareWoHref || input.prepareWoHref!;
    return {
      kind: "link",
      label: input.isNoQtyOrder ? label || "Place WO" : label,
      href,
      description,
    };
  }

  if (key === "WAIT_GRN") {
    return {
      kind: "link",
      label: label || "Record GRN",
      href: input.grnHref,
      description,
    };
  }

  if (key === "WAIT_PO") {
    return {
      kind: "waiting",
      label,
      description,
      href: input.procurementWorkspaceHref ?? undefined,
    };
  }

  if (key === "AWAITING_PR") {
    // Single primary CTA at top of the right action panel (not duplicated in center/header).
    return {
      kind: "create_pr",
      label: label || "Create Purchase Request",
      description,
    };
  }

  if (key === "CONTINUE_PROCUREMENT" || key === "VIEW_PROCUREMENT") {
    if (input.hideDuplicateProcurementAction) {
      return {
        kind: "none",
        description: description ?? "Continue procurement from the panel above.",
      };
    }
    return {
      kind: "link",
      label,
      href: input.procurementWorkspaceHref ?? input.grnHref,
      description,
    };
  }

  if (key === "ESCALATE" || key === "REOPEN_REQUISITION") {
    return { kind: "raise_mr", label, description };
  }

  if (key === "REVIEW") {
    return { kind: "allocation_fallback", description };
  }

  return { kind: "none", description };
}

export function readinessBadgeFromBackendCase(input: {
  issueStatusLabel?: string | null;
  procurementStatusLabel?: string | null;
  escalationLabel?: string | null;
}): { label: string; variant: "default" | "success" | "warning" | "info" | "rejected" } {
  const issue = String(input.issueStatusLabel ?? "").trim();
  const proc = String(input.procurementStatusLabel ?? "").trim();
  const esc = String(input.escalationLabel ?? "").trim();
  const combined = `${issue} ${proc} ${esc}`.toLowerCase();
  if (/issued|handoff|production|ready for issue|ready to release/i.test(combined)) {
    return { label: issue || proc || "READY", variant: "success" };
  }
  if (/waiting for grn|grn pending|incoming/i.test(combined)) {
    return { label: issue || proc || "WAITING_GRN", variant: "info" };
  }
  if (/waiting for purchase|awaiting pr|purchase request/i.test(combined)) {
    return { label: proc || issue || "WAITING_PURCHASE", variant: "warning" };
  }
  if (/blocked|shortage|not escalated/i.test(combined)) {
    return { label: esc || proc || issue || "BLOCKED", variant: "rejected" };
  }
  if (issue || proc || esc) {
    return { label: issue || proc || esc, variant: "default" };
  }
  return { label: "SELECT WO", variant: "default" };
}
