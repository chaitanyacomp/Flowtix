/**
 * MPRS procurement copy — single source for labels, status vocabulary, and nav hints.
 * MR → PR → PO → GRN → RM Ready (Store: PR + GRN · Purchase: PO).
 */

export const PROCUREMENT_TERMS = {
  WORKSPACE_TITLE: "Procurement Workspace",
  WORKSPACE_SUBTITLE:
    "Monitor demand handoff and procurement progress. Store creates Purchase Requests and posts GRN; Purchase executes PO.",
  KPI_PENDING_MR: "Approved MR",
  KPI_PURCHASE_PLANNING: "Awaiting PR",
  KPI_OPEN_PO: "Awaiting PO",
  KPI_GRN_PENDING: "GRN Pending",
  PROCUREMENT_PENDING: "Awaiting PR",
  DASHBOARD_SECTION_TITLE: "Procurement in progress",
  DASHBOARD_SECTION_DETAIL:
    "Open MR cases moving through PR, PO, and GRN. Store tracks PR and GRN; Purchase handles PO execution.",
  DASHBOARD_EMPTY_TITLE: "No open procurement cases",
  DASHBOARD_EMPTY_DETAIL:
    "Approved material requirements will appear here as they move through PR, PO, and GRN.",
  PROCUREMENT_REQUIRED_HEADLINE: "Procurement required",
  PROCUREMENT_QUEUE_SECTION: "Procurement queue",
  OPEN_PROCUREMENT_PLANNING: "Open Procurement Workspace",
  OPEN_PROCUREMENT_WORKSPACE: "Open Procurement Workspace",
  OPEN_PURCHASE_QUEUE: "Open Approved Requisitions",
  CREATE_PURCHASE_REQUEST: "Create Purchase Request",
  PR_CREATE_SUCCESS: "Purchase Request created successfully.",
  PREPARE_RM_PO: "Prepare RM PO",
  WAITING_FOR_PURCHASE_RM_PO: "Waiting for Purchase to prepare RM PO.",
  GRN_PENDING_STORE_POSTS_RECEIPT: "GRN pending — Store posts receipt.",
  SUPPLIER_INVOICE_PENDING_PURCHASE_POSTS: "Supplier invoice pending — Purchase posts bill.",
  CREATE_RM_PO: "Create RM PO",
  SECTION_PENDING_MR_HELPER:
    "Create one Purchase Request per approved MR. RM lines below are planning detail — not separate PR documents.",
  SECTION_PURCHASE_PLANNING_DETAIL:
    "Consolidated RM demand awaiting PR. Use the MR action above to create the Purchase Request.",
  PLANNING_STATUS_MR_ACTION: "Use MR action above",
  SECTION_EMPTY_PENDING_MR: "No approved material requirements",
  SECTION_EMPTY_PENDING_MR_DETAIL:
    "When Store raises and approves an MR, it appears here for Purchase Request creation.",
  SECTION_EMPTY_PURCHASE_PLANNING: "No MR awaiting PR",
  SECTION_EMPTY_PURCHASE_PLANNING_DETAIL: "Approved MRs ready for Store to create a Purchase Request will list here.",
  SECTION_EMPTY_PR: "No purchase requests awaiting PO",
  SECTION_EMPTY_PR_DETAIL: "PR lines from Store appear here — Purchase selects lines to create an RM PO.",
  SECTION_EMPTY_PO: "No open purchase orders",
  SECTION_EMPTY_PO_DETAIL: "Released RM POs awaiting goods receipt will list here.",
  SECTION_EMPTY_GRN: "No GRN pending",
  SECTION_EMPTY_GRN_DETAIL: "PO lines with pending receipt quantity appear here for Store GRN posting.",
  SECTION_EMPTY_COMPLETED: "No completed procurement yet",
  SECTION_EMPTY_COMPLETED_DETAIL: "MRs with full RM coverage after GRN completion.",
  OPEN_PO: "Open PO",
  OPEN_GRN: "Open GRN",
  TRACK_PROCUREMENT: "Track procurement",
  WAITING_FOR_PURCHASE: "Procurement pipeline",
  SECTION_PENDING_MR: "Approved MR",
  SECTION_WO_PROCUREMENT_CASES: "Procurement cases",
  SECTION_WO_PROCUREMENT_CASES_HELPER:
    "Approved material requirements from work orders, monthly plans, and replenishment sources.",
  SECTION_PURCHASE_PLANNING: "Awaiting PR",
  SECTION_RM_PO_PENDING: "Awaiting PO",
  SECTION_GRN_PENDING: "GRN Pending",
  SECTION_COMPLETED: "RM Ready",
  /** Navigation — routes unchanged; hints clarify screen purpose. */
  NAV_RM_CONTROL_CENTER: "RM Control Center",
  NAV_RM_CONTROL_CENTER_HINT: "Operational RM availability and shortages.",
  NAV_PROCUREMENT_WORKSPACE_HINT: "Demand handoff and procurement monitoring.",
  NAV_PURCHASE_GRN: "Purchase & GRN",
  NAV_PURCHASE_GRN_HINT: "Commercial PO execution and GRN receipt processing.",
  OPEN_RM_CONTROL_CENTER: "Open RM Control Center",
  RM_CONTROL_CENTER_TITLE: "RM Control Center",
  RM_CONTROL_CENTER_SUBTITLE:
    "Operational RM availability, shortages, allocation, and procurement progress for open cases.",
  PURCHASE_GRN_PAGE_TITLE: "Purchase & GRN",
  PURCHASE_GRN_PAGE_SUBTITLE:
    "Commercial PO execution and GRN receipt processing. Purchase creates PO; Store posts GRN.",
  STORE_PULSE_TITLE: "Procurement pulse",
  STORE_PULSE_SUBTITLE: "Store-owned PR and GRN work — Purchase handles PO creation separately.",
  LOADING_PROCUREMENT: "Loading procurement cases…",
  MORE_IN_WORKSPACE: "more in Procurement Workspace",
  DEMAND_POOL_REGULAR_SO: "Sales Orders",
  DEMAND_POOL_MPRS: "Monthly Planning",
  DEMAND_POOL_STOCK_REPLENISHMENT: "Stock Replenishment",
  PROCUREMENT_SOURCE_SALES_ORDERS: "Sales Orders",
  PROCUREMENT_SOURCE_MONTHLY_PLANNING: "Monthly Planning",
  PROCUREMENT_SOURCE_STOCK_REPLENISHMENT: "Stock Replenishment",
  DEMAND_POOL_SELECTOR_LABEL: "Procurement source",
  PROCUREMENT_SOURCE_LABEL: "Demand Source",
  EXECUTION_LABEL: "Execution",
  SECTION_PROCUREMENT_DEMAND_POOLS: "Procurement Sources",
  SECTION_PROCUREMENT_CASES_REGULAR_SO: "Procurement Sources",
  SECTION_PROCUREMENT_CASES_REGULAR_SO_HELPER:
    "Approved material requirements linked to sales orders.",
  SECTION_PROCUREMENT_CASES_MPRS: "Procurement Sources",
  SECTION_PROCUREMENT_CASES_MPRS_HELPER:
    "Approved material requirements from monthly production planning.",
  SECTION_PROCUREMENT_CASES_STOCK: "Procurement Sources",
  SECTION_PROCUREMENT_CASES_STOCK_HELPER:
    "Minimum-stock and replenishment material requirements awaiting purchase handoff.",
  SECTION_EMPTY_PENDING_MR_REGULAR_SO: "No sales order procurement requirements",
  SECTION_EMPTY_PENDING_MR_REGULAR_SO_DETAIL:
    "Sales-order procurement requirements approved for purchase will appear here.",
  SECTION_EMPTY_PENDING_MR_MPRS: "No monthly planning procurement requirements",
  SECTION_EMPTY_PENDING_MR_MPRS_DETAIL:
    "Monthly planning procurement requirements approved for purchase will appear here.",
  SECTION_EMPTY_PENDING_MR_STOCK: "No stock replenishment requirements",
  SECTION_EMPTY_PENDING_MR_STOCK_DETAIL:
    "Stock replenishment requirements approved for purchase will appear here.",
  SECTION_EMPTY_PURCHASE_PLANNING_POOL:
    "No consolidated RM demand from this procurement source awaiting PR.",
  PROCUREMENT_QUEUE_POOL_HINT:
    "Purchase Request lines show procurement source context. Create RM PO from one source at a time.",
  INCOMING_PO_INFORMATIONAL: "Incoming PO quantity is informational until GRN is posted.",
} as const;

export type ProcurementDemandPoolKey = "REGULAR_SO" | "MPRS" | "STOCK_REPLENISHMENT";

export function procurementDemandPoolSectionCopy(pool: ProcurementDemandPoolKey): {
  title: string;
  helper: string;
  emptyTitle: string;
  emptyDetail: string;
} {
  switch (pool) {
    case "REGULAR_SO":
      return {
        title: PROCUREMENT_TERMS.SECTION_PROCUREMENT_CASES_REGULAR_SO,
        helper: PROCUREMENT_TERMS.SECTION_PROCUREMENT_CASES_REGULAR_SO_HELPER,
        emptyTitle: PROCUREMENT_TERMS.SECTION_EMPTY_PENDING_MR_REGULAR_SO,
        emptyDetail: PROCUREMENT_TERMS.SECTION_EMPTY_PENDING_MR_REGULAR_SO_DETAIL,
      };
    case "MPRS":
      return {
        title: PROCUREMENT_TERMS.SECTION_PROCUREMENT_CASES_MPRS,
        helper: PROCUREMENT_TERMS.SECTION_PROCUREMENT_CASES_MPRS_HELPER,
        emptyTitle: PROCUREMENT_TERMS.SECTION_EMPTY_PENDING_MR_MPRS,
        emptyDetail: PROCUREMENT_TERMS.SECTION_EMPTY_PENDING_MR_MPRS_DETAIL,
      };
    case "STOCK_REPLENISHMENT":
      return {
        title: PROCUREMENT_TERMS.SECTION_PROCUREMENT_CASES_STOCK,
        helper: PROCUREMENT_TERMS.SECTION_PROCUREMENT_CASES_STOCK_HELPER,
        emptyTitle: PROCUREMENT_TERMS.SECTION_EMPTY_PENDING_MR_STOCK,
        emptyDetail: PROCUREMENT_TERMS.SECTION_EMPTY_PENDING_MR_STOCK_DETAIL,
      };
    default:
      return {
        title: PROCUREMENT_TERMS.SECTION_WO_PROCUREMENT_CASES,
        helper: PROCUREMENT_TERMS.SECTION_WO_PROCUREMENT_CASES_HELPER,
        emptyTitle: PROCUREMENT_TERMS.SECTION_EMPTY_PENDING_MR,
        emptyDetail: PROCUREMENT_TERMS.SECTION_EMPTY_PENDING_MR_DETAIL,
      };
  }
}

/** Approved lifecycle strip — MR → PR → PO → GRN → RM Ready. */
export const PROCUREMENT_WORKFLOW_STAGES = [
  "Approved MR",
  "PR created",
  "PO released",
  "GRN pending",
  "RM Ready",
] as const;

/** Standard procurement chip / row status labels. */
export const PROCUREMENT_STATUS_VOCABULARY = {
  APPROVED_MR: "Approved MR",
  AWAITING_PR: "Awaiting PR",
  AWAITING_PO: "Awaiting PO",
  PO_RELEASED: "PO Released",
  GRN_PENDING: "GRN Pending",
  PARTIALLY_RECEIVED: "Partially Received",
  FULLY_RECEIVED: "Fully Received",
  RM_READY: "RM Ready",
} as const;

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
  PROCUREMENT_PENDING: PROCUREMENT_STATUS_VOCABULARY.AWAITING_PR,
  PR_PENDING_PO: PROCUREMENT_STATUS_VOCABULARY.AWAITING_PO,
  SUPPLIER_PENDING: PROCUREMENT_STATUS_VOCABULARY.PO_RELEASED,
  GRN_PENDING: PROCUREMENT_STATUS_VOCABULARY.GRN_PENDING,
  PARTIAL_RECEIVED: PROCUREMENT_STATUS_VOCABULARY.PARTIALLY_RECEIVED,
  RM_READY: PROCUREMENT_STATUS_VOCABULARY.RM_READY,
  PROCUREMENT_COMPLETE: PROCUREMENT_STATUS_VOCABULARY.RM_READY,
};
