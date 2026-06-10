/** Purchase / procurement operational copy (RM Requisition -> PR -> PO -> GRN). */

export const PROCUREMENT_TERMS = {
  WORKSPACE_TITLE: "Procurement Workspace",
  WORKSPACE_SUBTITLE:
    "Legacy MR execution: continue approved Store RM Requisitions through PR, PO, and GRN (use for exceptions during transition).",
  KPI_PENDING_MR: "Approved requisitions",
  KPI_PURCHASE_PLANNING: "Purchase Planning",
  KPI_OPEN_PO: "Open PO",
  KPI_GRN_PENDING: "GRN Pending",
  PROCUREMENT_PENDING: "Procurement Pending",
  DASHBOARD_SECTION_TITLE: "Supply timeline (legacy)",
  DASHBOARD_SECTION_DETAIL:
    "Incoming PO/GRN visibility for open requisitions. Operational next action remains allocation and issue by Store.",
  DASHBOARD_EMPTY_TITLE: "No supply timeline items",
  DASHBOARD_EMPTY_DETAIL:
    "No requisitions are currently awaiting PO/GRN. Store allocation and issue remain the operational truth for WOs.",
  PROCUREMENT_REQUIRED_HEADLINE: "Procurement required",
  PROCUREMENT_QUEUE_SECTION: "Procurement queue",
  OPEN_PROCUREMENT_PLANNING: "Open Procurement Planning",
  OPEN_PURCHASE_QUEUE: "Open Purchase Queue",
  CREATE_PURCHASE_REQUEST: "Create Purchase Request",
  PR_CREATE_SUCCESS: "Purchase Request created successfully.",
  PREPARE_RM_PO: "Prepare RM PO",
  CREATE_RM_PO: "Create RM PO",
  SECTION_PENDING_MR_HELPER:
    "Create one purchase request per MR (parent document). RM lines below are planning detail only — no separate PR per item.",
  SECTION_PURCHASE_PLANNING_DETAIL:
    "Consolidated RM demand from open MRs. Purchase request is created once per MR using the action in the table above.",
  PLANNING_STATUS_MR_ACTION: "Use MR action above",
  SECTION_EMPTY_PENDING_MR: "No open material requirements",
  SECTION_EMPTY_PENDING_MR_DETAIL:
    "When Store raises an MR for a REGULAR sales order, it will appear here for purchase follow-up.",
  SECTION_EMPTY_PURCHASE_PLANNING: "No purchase planning pending",
  SECTION_EMPTY_PURCHASE_PLANNING_DETAIL: "RM pool demand is allocated or not yet approved by Store.",
  SECTION_EMPTY_PR: "No purchase requests awaiting PO",
  SECTION_EMPTY_PR_DETAIL: "Consolidated PR lines from Store will appear here — select lines to create an RM PO.",
  SECTION_EMPTY_PO: "No open purchase orders",
  SECTION_EMPTY_PO_DETAIL: "Approved or partial RM POs awaiting goods receipt will list here.",
  SECTION_EMPTY_GRN: "No GRN pending",
  SECTION_EMPTY_GRN_DETAIL: "PO lines with pending receipt quantity will appear here.",
  SECTION_EMPTY_COMPLETED: "No completed procurement yet",
  SECTION_EMPTY_COMPLETED_DETAIL: "RM Requisitions completed after full RM coverage.",
  OPEN_PO: "Open PO",
  OPEN_GRN: "Open GRN",
  WAITING_FOR_PURCHASE: "Incoming supply timeline",
  SECTION_PENDING_MR: "Approved Store Requisitions",
  SECTION_WO_PROCUREMENT_CASES: "Procurement cases",
  SECTION_WO_PROCUREMENT_CASES_HELPER:
    "Store-approved material requisitions from work orders, monthly plans, and other demand sources.",
  SECTION_PURCHASE_PLANNING: "Purchase Planning Pending",
  SECTION_RM_PO_PENDING: "RM PO Pending",
  SECTION_GRN_PENDING: "GRN Pending",
  SECTION_COMPLETED: "Procurement Completed",
} as const;

/** Ordered procurement pipeline shown on MR rows. */
export const PROCUREMENT_WORKFLOW_STAGES = [
  "Store requisition approved",
  "Purchase request pending",
  "PO pending",
  "GRN pending",
  "RM ready",
] as const;

/** Maps backend `operationalKey` to active workflow stage index (0–4). */
export function procurementWorkflowStageIndex(operationalKey: string): number {
  switch (operationalKey) {
    case "PR_PENDING_PO":
      return 2;
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

export const PROCUREMENT_STATUS_LABELS: Record<string, string> = {
  PROCUREMENT_PENDING: "Store requisition approved",
  PR_PENDING_PO: "PO pending",
  SUPPLIER_PENDING: "PO pending",
  GRN_PENDING: "GRN pending",
  PARTIAL_RECEIVED: "GRN pending",
  RM_READY: "RM ready",
  PROCUREMENT_COMPLETE: "RM ready",
};
