/**
 * Flow terminology firewall — labels only (no business logic).
 *
 * REGULAR vs NO_QTY ecosystems must not share copy accidentally.
 * Import from here instead of hardcoding “planning”, “requirement”, etc.
 */

/** Stable identifiers for guards, analytics, and future route tagging (not persisted server-side). */
export const FLOW_TYPE = {
  REGULAR_FLOW: "REGULAR_FLOW",
  NO_QTY_FLOW: "NO_QTY_FLOW",
} as const;

/** Customer PO–driven, fixed-qty sales order → RM check → WO → production → dispatch. */
export const REGULAR_TERMS = {
  WORK_ORDER_PREPARE_TITLE: "Prepare Work Order",
  WORK_ORDER_PREPARE_SUBTITLE: "Review RM readiness before creating Work Order.",
  LOAD_RM_FG_BUTTON: "Review RM & FG",
  SELECT_SO_HELPER: "Choose a sales order, then review requirements below.",
  SELECT_SO_PROMPT: "Select a sales order to continue.",
  PRODUCTION_REQUIREMENT_CARD_TITLE: "Production requirement",
  RM_STATUS_CARD_TITLE: "Raw material status",
  SIDEBAR_BACK_TO_SALES_ORDERS: "Back to Sales Orders",
  RM_SHORTAGE_REFRESH_HINT:
    "RM shortage — raise and approve a Store RM Requisition, then create the Purchase Request in Procurement Workspace.",
  RM_SHORTAGE_RESOLVE_FIRST:
    "Raw material shortage. Raise Store RM Requisition before creating Work Order.",
  RAISE_MATERIAL_REQUIREMENT: "Raise Store Requisition",
  /** Sales Order / Prepare WO — navigate to Store execution desk (no MR raise here). */
  OPEN_RM_CONTROL_CENTER: "Open RM Control Center",
  CONTINUE_IN_RM_CONTROL_CENTER: "Continue in RM Control Center",
  MATERIAL_REQUIREMENT_RAISED_SUCCESS: "RM Requisition raised successfully",
  OPEN_MATERIAL_REQUIREMENT: "Open RM Requisition",
  OPEN_PURCHASE_PLAN: "Open Purchase Plan",
  /** RM PO / GRN execution workspace (`/rm-po-grn`). */
  OPEN_PURCHASE_AND_GRN: "Open Purchase & GRN",
  SEND_TO_PROCUREMENT: "Raise Store Requisition",
  OPEN_PURCHASE_QUEUE: "Open Approved Requisitions",
  /** RM requirement & shortage review (`/material-planning`) — not PO execution. */
  OPEN_RM_PLANNING: "Open RM Planning",
  REFRESH_STOCK: "Refresh Stock",
  MR_RAISED_SUCCESS_SUFFIX: "raised successfully.",
  MR_WAITING_PURCHASE_GRN_BEFORE_WO: "Waiting for Purchase/GRN before Work Order can be created.",
  BACK_TO_WORK_ORDERS: "Back to Work Orders",
  BACK_TO_SALES_ORDERS: "Back to Sales Orders",
  RM_OK_CONTINUE_WO: "RM is now sufficient. Continue to create the work order.",
  RESUME_WO_SUBTITLE: "RM is now sufficient. Continue on the work order screen.",
  NEXT_REVIEW_REQUIREMENTS: "Next step: review production requirements",
  /** Dashboard / global RM policy alerts — REGULAR-safe destination (stock), not NO_QTY planning hub. */
  REVIEW_RM_STATUS: "Review stock replenishment",
  /** Ribbon metric: RM items below minimum stock (warehouse replenishment — not SO/WO blockers). */
  DASHBOARD_RM_CRITICAL_LABEL: "Stock critical",
  /** Ribbon metric: RM items below low-stock alert level (replenishment planning). */
  DASHBOARD_RM_WARNING_LABEL: "Replenishment low",
  /** KPI tooltip — minimum stock alerts vs order blockers. */
  DASHBOARD_STOCK_REPLENISHMENT_TOOLTIP:
    "Critical RM means stock below minimum level. It does not necessarily block current Work Orders.",
  /** Role KPI / factory panel: active SO/WO material shortage blockers (rm-risk queue). */
  DASHBOARD_WO_RM_BLOCKED_LABEL: "WO RM blocked",
  /** Live factory micro-queue when no order-level RM blockers exist. */
  DASHBOARD_NO_WO_RM_BLOCKERS_LABEL: "No SO/WO RM blockers",
  /** @deprecated Use DASHBOARD_RM_CRITICAL_LABEL / DASHBOARD_RM_WARNING_LABEL */
  DASHBOARD_RM_ALERTS_LABEL: "RM alerts",
  TOAST_CONTINUE_PREPARE_WORK_ORDER: "Sales order created as Approved — continue to prepare work order (RM check).",
  SALES_ORDER_APPROVED_RM_CHECK_HINT:
    "You can go straight to prepare work order (RM check) — no second approval on the sales order.",
  OPEN_WORK_ORDERS: "Open Work Orders",
  VIEW_SALES_ORDER_SPOTLIGHT: "View Sales Order",
  WORK_ORDER_PREPARATION: "Work order preparation",
  /** Dense toolbar (dispatch, etc.) */
  TOOLBAR_PREPARE_WO: "Prepare WO",
  BACK_TO_PREPARE_WORK_ORDER: "Back to prepare work order",
} as const;

/**
 * Department-oriented copy for non-planning roles (Sales / Production / QC / Accounts).
 * Use these labels in workflow status chips so factory operators and managers read
 * department wording instead of technical jargon ("Requirement Pending", etc.).
 */
export const WORKFLOW_STATUS_COPY = {
  PLANNING_PENDING: "Planning Pending",
  WAITING_FOR_PLANNING_TEAM: "Waiting for Planning Team",
  WITH_PLANNING_TEAM: "With Planning Team",
  REQUIREMENT_READY_WITH_PLANNING: "Requirement Ready · With Planning",
  PLANNED_BY_STORE: "Planned by Store/Planning",
  SENT_TO_PLANNING: "Sent to Planning Department",
  CYCLE_RETURNS_TO_PLANNING: "Cycle returns to Planning Team",
  DRAFT_WITH_PLANNING: "Draft Requirement Sheet · With Planning",
  IN_PRODUCTION: "In Production",
  AWAITING_QC: "Awaiting QA",
  READY_FOR_DISPATCH: "Ready for Dispatch",
  READY_FOR_BILLING: "Ready for Billing",
  CYCLE_COMPLETED: "Cycle Completed",
} as const;

/** NO_QTY cycle / requirement-sheet / rolling planning ecosystem. */
export const NO_QTY_TERMS = {
  /** Operator-facing enquiry / commercial label (not the DB enum). */
  AGREEMENT_LABEL: "NO_QTY Agreement",
  /** Explains that qty is planned later — Requirement Sheets / cycles. */
  PLANNING_HELPER: "Requirement cycle-based planning",
  /** Matches sidebar / route title capitalization. */
  PLANNING_HUB_TITLE: "Requirement & Cycle Planning",
  PLANNING_HUB_SUBTITLE: "Review requirement sheets, shortages, and cycle-driven production signals.",
  /** Explicit CTA — use instead of generic “planning” or “production planning”. */
  OPEN_REQUIREMENT_AND_CYCLE_PLANNING: "Open Requirement & Cycle Planning",
  CONTINUE_NO_QTY_PLANNING: "Continue NO_QTY Planning",
  REQUIREMENT_SHEET_LINK: "Requirement Sheet",
  CONTINUE_PLANNING_SHORT: "Continue Planning",
  /** From NO_QTY planning hub — RM resolution is purchase/stock, not REGULAR WO prep (`/work-orders/prepare`). */
  /** @deprecated Prefer REGULAR_TERMS.OPEN_RM_PLANNING — kept for NO_QTY planning hub compatibility. */
  OPEN_RM_PURCHASE_FROM_SHORTAGE: "Open RM Planning",
  WRONG_FLOW_REGULAR_SO_TITLE: "Regular sales order",
  WRONG_FLOW_REGULAR_SO_BODY:
    "This sales order uses the fixed-quantity work-order path (RM check → work order), not requirement-sheet planning.",
  OPEN_PREPARE_WORK_ORDER: "Open prepare work order",
  WRONG_FLOW_NO_QTY_TITLE: "NO_QTY requirement planning",
  /** Shown when a NO_QTY SO is opened on REGULAR WO preparation routes. */
  WRONG_FLOW_NO_QTY_BODY: "This order belongs to NO_QTY requirement planning flow.",
  /** Primary action on REGULAR screen when order is NO_QTY — navigates to NO_QTY planning hub. */
  OPEN_REQUIREMENT_PLANNING: "Open Requirement Planning",
  /** Smart back / RM purchase back nav — aligned capitalization. */
  BACK_TO_REQUIREMENT_CYCLE_PLANNING: "Back to Requirement & Cycle Planning",
} as const;
