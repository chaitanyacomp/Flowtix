/**
 * Single source of truth for ERP user roles (frontend).
 * Mirrors `backend/src/constants/erpRoles.js` — keep them in sync.
 *
 * Phase 1 ownership cleanup:
 *  - SUPERVISOR is removed.
 *  - Workflow ownership groups (e.g. SO_WRITE_ROLES) replace literal arrays.
 *  - One primary owner per stage; other roles get read-only visibility where useful.
 */
export const ERP_ROLES = [
  "ADMIN",
  "SALES",
  "STORE",
  "PRODUCTION",
  "QC",
  "ACCOUNTS",
] as const;

export type ErpRole = (typeof ERP_ROLES)[number];

export const ALL_APP_ROLES = ERP_ROLES;

/** Operational roles only (no ACCOUNTS). */
export const ALL_APP_ROLES_NO_ACCOUNTS = ["ADMIN", "SALES", "STORE", "PRODUCTION", "QC"] as const;

// =====================================================================
// Workflow ownership groups — use these instead of literal arrays.
// =====================================================================

/** SALES — owns sales pipeline. */
export const SO_WRITE_ROLES = ["ADMIN", "SALES"] as const;
/** Sales Orders list/detail — commercial + production context (not Store dispatch-only). */
export const SO_READ_ROLES = ["ADMIN", "SALES", "PRODUCTION"] as const;
export const ENQUIRY_QUOTATION_WRITE_ROLES = ["ADMIN", "SALES"] as const;

/** Requirement sheet authoring / NO_QTY planning — Sales + Admin. */
export const RS_WRITE_ROLES = ["ADMIN", "SALES"] as const;
export const RS_READ_ROLES = ["ADMIN", "STORE", "SALES", "PRODUCTION"] as const;
export const RM_PO_WRITE_ROLES = ["ADMIN", "STORE"] as const;
export const RM_PO_READ_ROLES = ["ADMIN", "STORE", "ACCOUNTS"] as const;
export const STOCK_READ_ROLES = ["ADMIN", "STORE", "PRODUCTION", "QC", "SALES"] as const;
export const STOCK_WRITE_ROLES = ["ADMIN", "STORE"] as const;
export const DISPATCH_WRITE_ROLES = ["ADMIN", "STORE"] as const;
export const DISPATCH_READ_ROLES = ["ADMIN", "STORE", "DISPATCH"] as const;
export const CUSTOMER_RETURN_CREATE_ROLES = ["ADMIN", "STORE"] as const;
export const CUSTOMER_RETURN_APPROVE_ROLES = ["ADMIN", "SALES"] as const;
export const CUSTOMER_RETURN_READ_ROLES = ["ADMIN", "SALES", "STORE", "PRODUCTION", "QC"] as const;

/** Next RS (NO_QTY) — Sales + Admin. */
export const NEXT_RS_WRITE_ROLES = ["ADMIN", "SALES"] as const;

/**
 * NO_QTY flow-state API — matches backend NO_QTY_FLOW_STATE_READ_ROLES (QC / Production / Dispatch / Dashboard).
 */
export const NO_QTY_FLOW_STATE_READ_ROLES = ["ADMIN", "SALES", "STORE", "PRODUCTION", "QC"] as const;

/** PRODUCTION — owns work order, production entry, rework approval. */
export const WO_WRITE_ROLES = ["ADMIN", "PRODUCTION"] as const;
export const WO_PLAN_PREP_ROLES = ["ADMIN", "STORE", "PRODUCTION"] as const;
export const PRODUCTION_WRITE_ROLES = ["ADMIN", "PRODUCTION"] as const;
export const PRODUCTION_READ_ROLES = ["ADMIN", "PRODUCTION", "STORE", "QC"] as const;

/** QC — owns inspection. Rework approval / "Send For Rework" belongs to PRODUCTION (with ADMIN override). */
export const QC_WRITE_ROLES = ["ADMIN", "QC"] as const;
export const QC_PAGE_ROLES = ["ADMIN", "QC"] as const;
export const QC_REPORT_READ_ROLES = ["ADMIN", "QC", "PRODUCTION", "STORE", "SALES"] as const;
export const QC_REWORK_APPROVE_ROLES = ["ADMIN", "PRODUCTION"] as const;

/** ACCOUNTS — owns Sales/Purchase Bill finalize + Tally export. */
export const SALES_BILL_WRITE_ROLES = ["ADMIN", "ACCOUNTS"] as const;
export const SALES_BILL_READ_ROLES = ["ADMIN", "ACCOUNTS", "SALES"] as const;
export const SALES_BILL_CANCEL_ROLES = ["ADMIN"] as const;
export const PURCHASE_BILL_WRITE_ROLES = ["ADMIN", "ACCOUNTS"] as const;
export const PURCHASE_BILL_DRAFT_ROLES = ["ADMIN", "ACCOUNTS"] as const;
export const PURCHASE_BILL_READ_ROLES = ["ADMIN", "ACCOUNTS"] as const;

/** Legacy alias — Sales/Accounts/Admin read on commercial screens. Prefer SALES_BILL_* groups. */
export const ACCOUNTS_COMMERCIAL_ROLES = SALES_BILL_READ_ROLES;

/** Dashboards / reports. */
export const PLANNING_DASHBOARD_ROLES = ["ADMIN", "SALES", "PRODUCTION"] as const;
export const REPORTS_WITH_ACCOUNTS_ROLES = ["ADMIN", "SALES", "STORE", "PRODUCTION", "QC", "ACCOUNTS"] as const;
export const SUPPLIER_VIEW_ROLES = ["ADMIN", "STORE", "ACCOUNTS"] as const;

/** Legacy alias for Purchase Bills (kept for backward references). */
export const PURCHASE_WITH_ACCOUNTS_ROLES = PURCHASE_BILL_READ_ROLES;
/** Legacy alias for Dispatch screen. */
export const DISPATCH_WITH_ACCOUNTS_ROLES = DISPATCH_READ_ROLES;
