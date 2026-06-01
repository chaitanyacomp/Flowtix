/**
 * Single source of truth for ERP user roles (frontend).
 * Mirrors `backend/src/constants/erpRoles.js` — keep them in sync.
 *
 * Phase 2 approved roles: ADMIN, STORE, PURCHASE, PRODUCTION, QA
 */
export const ERP_ROLES = ["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "QA"] as const;

export type ErpRole = (typeof ERP_ROLES)[number];

export const ALL_APP_ROLES = ERP_ROLES;

export const ALL_APP_ROLES_OPERATIONAL = ERP_ROLES;

/** @deprecated Use ALL_APP_ROLES_OPERATIONAL */
export const ALL_APP_ROLES_NO_ACCOUNTS = ALL_APP_ROLES_OPERATIONAL;

// =====================================================================
// Workflow ownership groups
// =====================================================================

/** ADMIN — commercial pipeline */
export const SO_WRITE_ROLES = ["ADMIN"] as const;
export const SO_READ_ROLES = ["ADMIN"] as const;
export const ENQUIRY_QUOTATION_WRITE_ROLES = ["ADMIN"] as const;

export const RS_WRITE_ROLES = ["ADMIN"] as const;
export const RS_READ_ROLES = ["ADMIN", "STORE", "PRODUCTION"] as const;
export const NEXT_RS_WRITE_ROLES = ["ADMIN"] as const;

/** PURCHASE */
export const RM_PO_WRITE_ROLES = ["ADMIN", "PURCHASE"] as const;
export const RM_PO_READ_ROLES = ["ADMIN", "PURCHASE", "STORE"] as const;
export const SUPPLIER_VIEW_ROLES = ["ADMIN", "PURCHASE"] as const;
export const SUPPLIER_WRITE_ROLES = ["ADMIN", "PURCHASE"] as const;
export const PURCHASE_DASHBOARD_ROLES = ["ADMIN", "PURCHASE"] as const;
export const PROCUREMENT_PLANNING_ROLES = ["ADMIN", "PURCHASE"] as const;

/** STORE */
export const STOCK_READ_ROLES = ["ADMIN", "STORE", "PRODUCTION"] as const;
export const STOCK_WRITE_ROLES = ["ADMIN", "STORE"] as const;
export const DISPATCH_WRITE_ROLES = ["ADMIN", "STORE"] as const;
export const DISPATCH_READ_ROLES = ["ADMIN", "STORE"] as const;
export const GRN_WRITE_ROLES = ["ADMIN", "STORE"] as const;
export const MATERIAL_ISSUE_ROLES = ["ADMIN", "STORE"] as const;
export const STORE_DASHBOARD_ROLES = ["ADMIN", "STORE"] as const;

export const CUSTOMER_RETURN_CREATE_ROLES = ["ADMIN", "STORE"] as const;
export const CUSTOMER_RETURN_APPROVE_ROLES = ["ADMIN"] as const;
export const CUSTOMER_RETURN_READ_ROLES = ["ADMIN", "STORE"] as const;

export const NO_QTY_FLOW_STATE_READ_ROLES = ["ADMIN", "STORE", "PRODUCTION", "QA"] as const;

/** PRODUCTION */
export const WO_WRITE_ROLES = ["ADMIN", "PRODUCTION"] as const;
export const WO_PLAN_PREP_ROLES = ["ADMIN", "PRODUCTION"] as const;
export const PRODUCTION_WRITE_ROLES = ["ADMIN", "PRODUCTION"] as const;
export const PRODUCTION_READ_ROLES = ["ADMIN", "PRODUCTION", "STORE", "QA"] as const;
export const PRODUCTION_DASHBOARD_ROLES = ["ADMIN", "PRODUCTION"] as const;
export const WO_PREPARE_CREATION_DASHBOARD_ROLES = ["ADMIN", "PRODUCTION"] as const;

/** QA (user role; workflow/domain strings may still say QC) */
export const QA_WRITE_ROLES = ["ADMIN", "QA"] as const;
export const QA_PAGE_ROLES = ["ADMIN", "QA"] as const;
export const QA_REPORT_READ_ROLES = ["ADMIN", "QA"] as const;
export const QA_REWORK_APPROVE_ROLES = ["ADMIN", "PRODUCTION"] as const;

/** @deprecated Prefer QA_* */
export const QC_WRITE_ROLES = QA_WRITE_ROLES;
export const QC_PAGE_ROLES = QA_PAGE_ROLES;
export const QC_REPORT_READ_ROLES = QA_REPORT_READ_ROLES;
export const QC_REWORK_APPROVE_ROLES = QA_REWORK_APPROVE_ROLES;

export const PRODUCTION_QA_PAGE_ROLES = QA_PAGE_ROLES;

/** Billing */
export const SALES_BILL_WRITE_ROLES = ["ADMIN"] as const;
export const SALES_BILL_READ_ROLES = ["ADMIN", "STORE"] as const;
export const SALES_BILL_CANCEL_ROLES = ["ADMIN"] as const;
export const PURCHASE_BILL_WRITE_ROLES = ["ADMIN", "PURCHASE"] as const;
export const PURCHASE_BILL_DRAFT_ROLES = ["ADMIN", "PURCHASE"] as const;
export const PURCHASE_BILL_READ_ROLES = ["ADMIN", "PURCHASE"] as const;

export const PLANNING_DASHBOARD_ROLES = ["ADMIN", "PRODUCTION"] as const;
export const REPORTS_ROLES = ["ADMIN"] as const;

/** @deprecated Use REPORTS_ROLES */
export const REPORTS_WITH_ACCOUNTS_ROLES = REPORTS_ROLES;

export const MONTHLY_PLANNING_READ_ROLES = ["ADMIN"] as const;
export const MONTHLY_PLANNING_WRITE_ROLES = ["ADMIN", "PURCHASE"] as const;

/** Legacy aliases */
export const PURCHASE_WITH_ACCOUNTS_ROLES = PURCHASE_BILL_READ_ROLES;
export const DISPATCH_WITH_ACCOUNTS_ROLES = DISPATCH_READ_ROLES;

export function hasErpRole(role: string | undefined, allowed: readonly string[]): boolean {
  if (!role) return false;
  return allowed.includes(role);
}
