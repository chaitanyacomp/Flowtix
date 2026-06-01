/** WO shortage procurement visibility — presentation only (Phase A). */

export const WO_PROCUREMENT_CONTINUITY = {
  PROCUREMENT_INITIATED: "RM Requisition active",
  PO_CREATED: "PO created",
  MATERIAL_INCOMING: "Material incoming",
  WAITING_GRN: "Waiting GRN",
  READY_FOR_ISSUE: "Ready for issue",
  COVERED_BY_INCOMING: (qty: string) => `${qty} covered by incoming PO`,
  WAITING_GRN_QTY: (qty: string) => `Waiting GRN: ${qty}`,
  PARTIAL_COVERAGE: "Procurement partially covering this WO",
  PENDING_GRN_CASE: "Incoming GRN pending for this WO",
  PROCUREMENT_ACTIVE: "RM Requisition already raised",
  TRACK_IN_RM_CONTROL: "Track in Store RM Workspace",
  OPEN_RM_CONTROL_CENTER: "Open Store RM Workspace",
} as const;

export function buildRmControlCenterHref(opts: {
  workOrderId?: number;
  rmItemId?: number | null;
  salesOrderId?: number | null;
  materialRequirementId?: number | null;
  returnTo?: string | null;
  onlyBlocked?: boolean;
}): string {
  const q = new URLSearchParams();
  if (opts.workOrderId != null && opts.workOrderId > 0) q.set("workOrderId", String(opts.workOrderId));
  if (opts.rmItemId != null && opts.rmItemId > 0) q.set("rmItemId", String(opts.rmItemId));
  if (opts.salesOrderId != null && opts.salesOrderId > 0) q.set("salesOrderId", String(opts.salesOrderId));
  if (opts.materialRequirementId != null && opts.materialRequirementId > 0) {
    q.set("materialRequirementId", String(opts.materialRequirementId));
  }
  if (opts.returnTo) q.set("returnTo", opts.returnTo);
  if (opts.onlyBlocked) q.set("onlyBlocked", "true");
  const s = q.toString();
  return s ? `/reports/rm-shortage?${s}` : "/reports/rm-shortage";
}

export function formatProcurementQty(n: number, unit?: string): string {
  const u = unit?.trim() ? ` ${unit}` : "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;
}

/** Maps dashboard / MR operational keys to continuous workflow labels. */
export function procurementStageLabelForKey(operationalKey: string | null | undefined): string {
  switch (String(operationalKey ?? "").trim()) {
    case "PR_PENDING_PO":
      return WO_PROCUREMENT_CONTINUITY.PO_CREATED;
    case "SUPPLIER_PENDING":
      return WO_PROCUREMENT_CONTINUITY.MATERIAL_INCOMING;
    case "GRN_PENDING":
      return WO_PROCUREMENT_CONTINUITY.WAITING_GRN;
    case "RM_READY":
    case "PROCUREMENT_COMPLETE":
      return WO_PROCUREMENT_CONTINUITY.READY_FOR_ISSUE;
    case "PROCUREMENT_PENDING":
      return WO_PROCUREMENT_CONTINUITY.PROCUREMENT_INITIATED;
    default:
      return WO_PROCUREMENT_CONTINUITY.PROCUREMENT_INITIATED;
  }
}

export function storeActionButtonLabel(key: string | null | undefined): string {
  switch (key) {
    case "REOPEN_REQUISITION":
      return "Reopen / Raise New Requisition";
    case "ESCALATE":
      return "Raise Store Requisition";
    case "CONTINUE_PROCUREMENT":
      return "Continue RM Requisition";
    case "WAIT_GRN":
      return WO_PROCUREMENT_CONTINUITY.TRACK_IN_RM_CONTROL;
    case "VIEW_PROCUREMENT":
      return "View requisition progress";
    case "ISSUE":
      return WO_PROCUREMENT_CONTINUITY.READY_FOR_ISSUE;
    case "CREATE_WO":
      return "Create Work Order";
    default:
      return "Review WO case";
  }
}

/** WO procurement lifecycle strip (display only). */
export const WO_PROCUREMENT_WORKFLOW_STAGES = [
  "RM Requisition",
  "PR created",
  "PO created",
  "GRN pending",
  "RM ready",
] as const;

/** Maps backend `operationalKey` to strip index (0–4). */
export function woProcurementStageIndex(operationalKey: string | null | undefined): number {
  switch (String(operationalKey ?? "").trim()) {
    case "PR_PENDING_PO":
      return 1;
    case "SUPPLIER_PENDING":
      return 2;
    case "GRN_PENDING":
    case "PARTIAL_RECEIVED":
      return 3;
    case "RM_READY":
    case "PROCUREMENT_COMPLETE":
      return 4;
    case "PROCUREMENT_PENDING":
    default:
      return 0;
  }
}

/** Lifecycle-aware copy when PR list is empty on RM Control Center. */
export function prSectionEmptyMessage(opts: {
  escalationState?: string | null;
  prLineCount: number;
  procurementInitiated?: boolean;
}): string {
  if (opts.prLineCount > 0) return "";
  if (!opts.procurementInitiated) {
    return "No procurement handoff yet — add shortage lines to the WO case first.";
  }
  switch (opts.escalationState) {
    case "ESCALATION_PENDING":
    case "PARTIALLY_ESCALATED":
      return "Procurement handoff created — waiting for Purchase Request creation.";
    case "PROCUREMENT_IN_PROGRESS":
      return "Procurement in progress — Purchase Request pending.";
    case "WAITING_GRN":
      return "Procurement in progress — material incoming (GRN pending).";
    case "PROCUREMENT_COMPLETED":
      return "Procurement completed for this WO case.";
    default:
      return "Waiting for Purchase Request creation.";
  }
}

export function buildProcurementWorkspaceHref(opts: {
  salesOrderId?: number | null;
  workOrderId?: number | null;
  rmItemId?: number | null;
  materialRequirementId?: number | null;
  returnTo?: string | null;
}): string {
  const q = new URLSearchParams();
  if (opts.salesOrderId != null && opts.salesOrderId > 0) q.set("salesOrderId", String(opts.salesOrderId));
  if (opts.workOrderId != null && opts.workOrderId > 0) q.set("workOrderId", String(opts.workOrderId));
  if (opts.rmItemId != null && opts.rmItemId > 0) q.set("rmItemId", String(opts.rmItemId));
  if (opts.materialRequirementId != null && opts.materialRequirementId > 0) {
    q.set("materialRequirementId", String(opts.materialRequirementId));
  }
  if (opts.returnTo) q.set("returnTo", opts.returnTo);
  const s = q.toString();
  return s ? `/procurement-planning?${s}` : "/procurement-planning";
}

export function prStatusLabel(status: string | null | undefined): string {
  const s = String(status ?? "").trim();
  if (!s) return "Purchase request";
  if (s === "PENDING_PURCHASE") return "Awaiting PO";
  if (s === "PARTIALLY_ORDERED") return "PO partially created";
  if (s === "ORDERED") return "Fully ordered";
  return s.replaceAll("_", " ");
}
