/**
 * Single source of truth for ERP user roles (Phase 2).
 *
 * Approved roles: ADMIN, STORE, PURCHASE, PRODUCTION, QA
 *
 * Domain/workflow terminology (QC stages, DISPATCH transaction types, etc.) is unchanged —
 * only JWT `user.role` and permission arrays use QA / STORE / PURCHASE here.
 */
const ERP_ROLES = Object.freeze(["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "QA"]);

/** Every active role in the app. */
const ALL_APP_ROLES = ERP_ROLES;

/** Shop-floor + planning roles (same as ALL_APP_ROLES in Phase 2). */
const ALL_APP_ROLES_OPERATIONAL = ERP_ROLES;

/** @deprecated Use ALL_APP_ROLES_OPERATIONAL */
const ALL_APP_ROLES_NO_ACCOUNTS = ALL_APP_ROLES_OPERATIONAL;

// =====================================================================
// Workflow ownership groups
// =====================================================================

/** ADMIN — commercial pipeline (enquiry → quotation → SO → RS). */
const SO_WRITE_ROLES = Object.freeze(["ADMIN"]);
const SO_READ_ROLES = Object.freeze(["ADMIN"]);
const SO_DETAIL_READ_ROLES = Object.freeze(["ADMIN", "PRODUCTION", "STORE", "PURCHASE", "QA"]);
const ENQUIRY_QUOTATION_WRITE_ROLES = Object.freeze(["ADMIN"]);

/** STORE — NO_QTY requirement sheet / customer schedule planning (MPRS Phase 1 ownership). */
const RS_WRITE_ROLES = Object.freeze(["ADMIN", "STORE"]);
const RS_READ_ROLES = Object.freeze(["ADMIN", "STORE", "PRODUCTION"]);
const NEXT_RS_WRITE_ROLES = Object.freeze(["ADMIN", "STORE"]);

/** PURCHASE — PO execution, GRN coordination, purchase bills (not planning initiation). */
const RM_PO_WRITE_ROLES = Object.freeze(["ADMIN", "PURCHASE"]);
const RM_PO_READ_ROLES = Object.freeze(["ADMIN", "PURCHASE", "STORE"]);
const SUPPLIER_VIEW_ROLES = Object.freeze(["ADMIN", "PURCHASE"]);
const SUPPLIER_WRITE_ROLES = Object.freeze(["ADMIN", "PURCHASE"]);
const PURCHASE_DASHBOARD_ROLES = Object.freeze(["ADMIN", "PURCHASE"]);
/** Planning workspace visibility (Store review + Purchase execution context). */
const PROCUREMENT_PLANNING_ROLES = Object.freeze(["ADMIN", "STORE", "PURCHASE"]);

/** STORE — MR / requisition lifecycle (approve, send); not RM PO creation. */
const MATERIAL_REQUISITION_WRITE_ROLES = Object.freeze(["ADMIN", "STORE"]);

/** STORE — RM Control Center allocation actions. */
const RM_ALLOCATION_WRITE_ROLES = Object.freeze(["ADMIN", "STORE"]);

/** RM Control Center workspace (read + Store allocation). */
const RM_CONTROL_CENTER_ROLES = Object.freeze(["ADMIN", "STORE", "PRODUCTION"]);

/** Dashboard — procurement prepare / review queue (Store escalation + Purchase execution). */
const PROCUREMENT_REVIEW_DASHBOARD_ROLES = Object.freeze(["ADMIN", "STORE", "PURCHASE"]);

/** STORE — GRN execution, stock, material issue, dispatch. */
const STOCK_READ_ROLES = Object.freeze(["ADMIN", "STORE", "PRODUCTION"]);
const STOCK_WRITE_ROLES = Object.freeze(["ADMIN", "STORE"]);
const DISPATCH_WRITE_ROLES = Object.freeze(["ADMIN", "STORE"]);
const DISPATCH_READ_ROLES = Object.freeze(["ADMIN", "STORE"]);
const GRN_WRITE_ROLES = Object.freeze(["ADMIN", "STORE"]);
const MATERIAL_ISSUE_ROLES = Object.freeze(["ADMIN", "STORE"]);
const STORE_DASHBOARD_ROLES = Object.freeze(["ADMIN", "STORE"]);

const CUSTOMER_RETURN_CREATE_ROLES = Object.freeze(["ADMIN", "STORE"]);
const CUSTOMER_RETURN_APPROVE_ROLES = Object.freeze(["ADMIN"]);
const CUSTOMER_RETURN_READ_ROLES = Object.freeze(["ADMIN", "STORE"]);

const NO_QTY_FLOW_STATE_READ_ROLES = Object.freeze(["ADMIN", "STORE", "PRODUCTION", "QA"]);

/** PRODUCTION — work orders, production entry, rework approval, prepare WO. */
const WO_WRITE_ROLES = Object.freeze(["ADMIN", "PRODUCTION"]);
const WO_PLAN_PREP_ROLES = Object.freeze(["ADMIN", "PRODUCTION"]);
const PRODUCTION_WRITE_ROLES = Object.freeze(["ADMIN", "PRODUCTION"]);
const PRODUCTION_READ_ROLES = Object.freeze(["ADMIN", "PRODUCTION", "STORE", "QA"]);
const PRODUCTION_DASHBOARD_ROLES = Object.freeze(["ADMIN", "PRODUCTION"]);
const WO_PREPARE_CREATION_DASHBOARD_ROLES = Object.freeze(["ADMIN", "PRODUCTION"]);

/** QA — inspection posting, QA reports, hold/rejection (domain statuses still use QC_* names). */
const QA_WRITE_ROLES = Object.freeze(["ADMIN", "QA"]);
const QA_PAGE_ROLES = Object.freeze(["ADMIN", "QA"]);
const QA_REPORT_READ_ROLES = Object.freeze(["ADMIN", "QA"]);
const QA_LEGACY_CLASSIFY_ROLES = Object.freeze(["ADMIN", "QA"]);
const QA_REWORK_APPROVE_ROLES = Object.freeze(["ADMIN", "PRODUCTION"]);
const QA_REWORK_EXECUTE_ROLES = Object.freeze(["ADMIN", "PRODUCTION", "STORE"]);

/** @deprecated Phase 2 alias — prefer QA_* constants */
const QC_WRITE_ROLES = QA_WRITE_ROLES;
const QC_PAGE_ROLES = QA_PAGE_ROLES;
const QC_REPORT_READ_ROLES = QA_REPORT_READ_ROLES;
const QC_LEGACY_CLASSIFY_ROLES = QA_LEGACY_CLASSIFY_ROLES;
const QC_REWORK_APPROVE_ROLES = QA_REWORK_APPROVE_ROLES;
const QC_REWORK_EXECUTE_ROLES = QA_REWORK_EXECUTE_ROLES;

/** Production QA workspace route — QA operators only (posting still QA_WRITE). */
const PRODUCTION_QA_PAGE_ROLES = QA_PAGE_ROLES;

/** ADMIN — sales bill finalize (commercial billing). */
const SALES_BILL_WRITE_ROLES = Object.freeze(["ADMIN"]);
const SALES_BILL_READ_ROLES = Object.freeze(["ADMIN", "STORE"]);
const SALES_BILL_CANCEL_ROLES = Object.freeze(["ADMIN"]);

/** PURCHASE — purchase bill draft/finalize. */
const PURCHASE_BILL_WRITE_ROLES = Object.freeze(["ADMIN", "PURCHASE"]);
const PURCHASE_BILL_DRAFT_ROLES = Object.freeze(["ADMIN", "PURCHASE"]);
const PURCHASE_BILL_READ_ROLES = Object.freeze(["ADMIN", "PURCHASE"]);

/** @deprecated */
const ACCOUNTS_COMMERCIAL_ROLES = SALES_BILL_READ_ROLES;

const DASHBOARD_READ_ROLES = ALL_APP_ROLES;
/** NO_QTY cycle / requirement planning hub — Store owns RS planning. */
const PLANNING_DASHBOARD_ROLES = Object.freeze(["ADMIN", "STORE", "PRODUCTION"]);
const REPORTS_ROLES = Object.freeze(["ADMIN"]);

/** Monthly planning workspace (MPRS) — Store-owned write; Purchase read-only. */
const MONTHLY_PLANNING_READ_ROLES = Object.freeze(["ADMIN", "STORE", "PURCHASE"]);
const MONTHLY_PLANNING_WRITE_ROLES = Object.freeze(["ADMIN", "STORE"]);
/** Plan-document P1: Purchase approve / reject after Store submit-for-review. */
const MONTHLY_PLANNING_PURCHASE_REVIEW_ROLES = Object.freeze(["ADMIN", "PURCHASE"]);

/** @deprecated Use REPORTS_ROLES */
const REPORTS_WITH_ACCOUNTS_ROLES = REPORTS_ROLES;

module.exports = {
  ERP_ROLES,
  ALL_APP_ROLES,
  ALL_APP_ROLES_OPERATIONAL,
  ALL_APP_ROLES_NO_ACCOUNTS,
  // commercial (ADMIN)
  SO_WRITE_ROLES,
  SO_READ_ROLES,
  SO_DETAIL_READ_ROLES,
  ENQUIRY_QUOTATION_WRITE_ROLES,
  RS_WRITE_ROLES,
  RS_READ_ROLES,
  NEXT_RS_WRITE_ROLES,
  // purchase
  RM_PO_WRITE_ROLES,
  RM_PO_READ_ROLES,
  SUPPLIER_VIEW_ROLES,
  SUPPLIER_WRITE_ROLES,
  PURCHASE_DASHBOARD_ROLES,
  PROCUREMENT_PLANNING_ROLES,
  MATERIAL_REQUISITION_WRITE_ROLES,
  RM_ALLOCATION_WRITE_ROLES,
  RM_CONTROL_CENTER_ROLES,
  PROCUREMENT_REVIEW_DASHBOARD_ROLES,
  // store
  STOCK_READ_ROLES,
  STOCK_WRITE_ROLES,
  DISPATCH_WRITE_ROLES,
  DISPATCH_READ_ROLES,
  GRN_WRITE_ROLES,
  MATERIAL_ISSUE_ROLES,
  STORE_DASHBOARD_ROLES,
  CUSTOMER_RETURN_CREATE_ROLES,
  CUSTOMER_RETURN_APPROVE_ROLES,
  CUSTOMER_RETURN_READ_ROLES,
  NO_QTY_FLOW_STATE_READ_ROLES,
  // production
  WO_WRITE_ROLES,
  WO_PLAN_PREP_ROLES,
  PRODUCTION_WRITE_ROLES,
  PRODUCTION_READ_ROLES,
  PRODUCTION_DASHBOARD_ROLES,
  WO_PREPARE_CREATION_DASHBOARD_ROLES,
  // qa
  QA_WRITE_ROLES,
  QA_PAGE_ROLES,
  QA_REPORT_READ_ROLES,
  QA_LEGACY_CLASSIFY_ROLES,
  QA_REWORK_APPROVE_ROLES,
  QA_REWORK_EXECUTE_ROLES,
  QC_WRITE_ROLES,
  QC_PAGE_ROLES,
  QC_REPORT_READ_ROLES,
  QC_LEGACY_CLASSIFY_ROLES,
  QC_REWORK_APPROVE_ROLES,
  QC_REWORK_EXECUTE_ROLES,
  PRODUCTION_QA_PAGE_ROLES,
  // billing
  SALES_BILL_WRITE_ROLES,
  SALES_BILL_READ_ROLES,
  SALES_BILL_CANCEL_ROLES,
  PURCHASE_BILL_WRITE_ROLES,
  PURCHASE_BILL_DRAFT_ROLES,
  PURCHASE_BILL_READ_ROLES,
  ACCOUNTS_COMMERCIAL_ROLES,
  // dashboards / reports
  DASHBOARD_READ_ROLES,
  PLANNING_DASHBOARD_ROLES,
  REPORTS_ROLES,
  REPORTS_WITH_ACCOUNTS_ROLES,
  MONTHLY_PLANNING_READ_ROLES,
  MONTHLY_PLANNING_WRITE_ROLES,
  MONTHLY_PLANNING_PURCHASE_REVIEW_ROLES,
};
