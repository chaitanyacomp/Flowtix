/**
 * Single source of truth for ERP user roles.
 *
 * ERP philosophy (Phase 1 — workflow ownership cleanup):
 *  - One primary owner per workflow stage.
 *  - Other departments get read-only visibility where useful.
 *  - SUPERVISOR role is removed; QC rework approval is now Admin-only.
 *  - Accounting (payment tracking / receipts) remains in code for this phase
 *    but is owned by ADMIN + ACCOUNTS only. Operational departments keep read access.
 *
 * Note: The Prisma `UserRole` enum may still contain legacy values (e.g. `SUPERVISOR`).
 * The schema is intentionally NOT changed in this phase. Existing SUPERVISOR users
 * should be migrated to ADMIN via `scripts/migrateSupervisorUsersToAdmin.js`.
 */
const ERP_ROLES = Object.freeze([
  "ADMIN",
  "SALES",
  "STORE",
  "PRODUCTION",
  "QC",
  "ACCOUNTS",
]);

/** Every active role in the app. */
const ALL_APP_ROLES = ERP_ROLES;

/** Operational roles (excludes ACCOUNTS) — used for shop-floor / planning screens. */
const ALL_APP_ROLES_NO_ACCOUNTS = Object.freeze([
  "ADMIN",
  "SALES",
  "STORE",
  "PRODUCTION",
  "QC",
]);

// =====================================================================
// Workflow ownership groups — use these everywhere instead of literals.
// =====================================================================

/** SALES owns the customer-facing sales pipeline. */
const SO_WRITE_ROLES = Object.freeze(["ADMIN", "SALES"]);
/** List + detail read for the Sales Orders workspace (commercial + production context). */
const SO_READ_ROLES = Object.freeze(["ADMIN", "SALES", "PRODUCTION"]);
/** Single SO header/detail (Dispatch, QC, RM PO, Billing helpers) — broader than the commercial list. */
const SO_DETAIL_READ_ROLES = Object.freeze(["ADMIN", "SALES", "PRODUCTION", "STORE", "QC", "ACCOUNTS"]);
const ENQUIRY_QUOTATION_WRITE_ROLES = Object.freeze(["ADMIN", "SALES"]);

/** Requirement sheet authoring / NO_QTY cycle planning — Sales + Admin (Store executes RM/GRN/dispatch separately). */
const RS_WRITE_ROLES = Object.freeze(["ADMIN", "SALES"]);
const RS_READ_ROLES = Object.freeze(["ADMIN", "STORE", "SALES", "PRODUCTION"]);
const RM_PO_WRITE_ROLES = Object.freeze(["ADMIN", "STORE"]);
const RM_PO_READ_ROLES = Object.freeze(["ADMIN", "STORE", "ACCOUNTS"]);
const STOCK_READ_ROLES = Object.freeze(["ADMIN", "STORE", "PRODUCTION", "QC", "SALES"]);
const STOCK_WRITE_ROLES = Object.freeze(["ADMIN", "STORE"]);
const DISPATCH_WRITE_ROLES = Object.freeze(["ADMIN", "STORE"]);
/** Dispatch queue screen + dispatch APIs that mirror that queue (Store + Admin only). */
const DISPATCH_READ_ROLES = Object.freeze(["ADMIN", "STORE", "DISPATCH"]);
const CUSTOMER_RETURN_CREATE_ROLES = Object.freeze(["ADMIN", "STORE"]);
const CUSTOMER_RETURN_APPROVE_ROLES = Object.freeze(["ADMIN", "SALES"]);
const CUSTOMER_RETURN_READ_ROLES = Object.freeze(["ADMIN", "SALES", "STORE", "PRODUCTION", "QC"]);

/** Next RS (NO_QTY) cycle advance — Sales + Admin. */
const NEXT_RS_WRITE_ROLES = Object.freeze(["ADMIN", "SALES"]);

/**
 * NO_QTY flow-state helper (QC / Production / Dispatch / Dashboard) — anyone on the shop floor who
 * touches NO_QTY cycles but is not necessarily on SO_READ (e.g. STORE dispatch, QC entry).
 */
const NO_QTY_FLOW_STATE_READ_ROLES = Object.freeze(["ADMIN", "SALES", "STORE", "PRODUCTION", "QC"]);

/** PRODUCTION owns work orders + production entries + rework approval. */
const WO_WRITE_ROLES = Object.freeze(["ADMIN", "PRODUCTION"]);
const WO_PLAN_PREP_ROLES = Object.freeze(["ADMIN", "STORE", "PRODUCTION"]);
const PRODUCTION_WRITE_ROLES = Object.freeze(["ADMIN", "PRODUCTION"]);
const PRODUCTION_READ_ROLES = Object.freeze(["ADMIN", "PRODUCTION", "STORE", "QC"]);

/**
 * QC owns inspection. Rework approval / "Send For Rework" belongs to PRODUCTION
 * (Phase 1 correction): QC enters reject → PRODUCTION approves and sends for rework
 * → PRODUCTION completes rework → QC performs final recheck. ADMIN remains override only.
 *
 * The disposition status name `REWORK_PENDING_SUPERVISOR` is intentionally kept as a
 * domain status to avoid disturbing downstream state-machine code; only the role
 * allowed to act on it has changed.
 */
const QC_WRITE_ROLES = Object.freeze(["ADMIN", "QC"]);
const QC_REWORK_APPROVE_ROLES = Object.freeze(["ADMIN", "PRODUCTION"]);
const QC_REWORK_EXECUTE_ROLES = Object.freeze(["ADMIN", "PRODUCTION", "STORE"]);
const QC_PAGE_ROLES = Object.freeze(["ADMIN", "QC"]);
const QC_REPORT_READ_ROLES = Object.freeze(["ADMIN", "QC", "PRODUCTION", "STORE", "SALES"]);
const QC_LEGACY_CLASSIFY_ROLES = Object.freeze(["ADMIN", "QC"]);

/** ACCOUNTS owns Sales/Purchase Bill finalize + Tally export. */
const SALES_BILL_WRITE_ROLES = Object.freeze(["ADMIN", "ACCOUNTS"]);
const SALES_BILL_READ_ROLES = Object.freeze(["ADMIN", "ACCOUNTS", "SALES"]);
const SALES_BILL_CANCEL_ROLES = Object.freeze(["ADMIN"]);
const PURCHASE_BILL_WRITE_ROLES = Object.freeze(["ADMIN", "ACCOUNTS"]);
/** Purchase Bill draft create/edit — Accounts + Admin (GRN remains Store-owned). */
const PURCHASE_BILL_DRAFT_ROLES = Object.freeze(["ADMIN", "ACCOUNTS"]);
const PURCHASE_BILL_READ_ROLES = Object.freeze(["ADMIN", "ACCOUNTS"]);

/** Commercial / billing — legacy alias kept for backwards reference, now reads only. */
const ACCOUNTS_COMMERCIAL_ROLES = SALES_BILL_READ_ROLES;

/** Dashboard widgets / reports — broad read groups. */
const DASHBOARD_READ_ROLES = ALL_APP_ROLES;
/** Requirement & cycle planning hub — commercial + production coordination (not Store dispatch-only). */
const PLANNING_DASHBOARD_ROLES = Object.freeze(["ADMIN", "SALES", "PRODUCTION"]);
const REPORTS_WITH_ACCOUNTS_ROLES = Object.freeze(["ADMIN", "SALES", "STORE", "PRODUCTION", "QC", "ACCOUNTS"]);
const SUPPLIER_VIEW_ROLES = Object.freeze(["ADMIN", "STORE", "ACCOUNTS"]);

module.exports = {
  ERP_ROLES,
  ALL_APP_ROLES,
  ALL_APP_ROLES_NO_ACCOUNTS,
  // sales pipeline
  SO_WRITE_ROLES,
  SO_READ_ROLES,
  SO_DETAIL_READ_ROLES,
  ENQUIRY_QUOTATION_WRITE_ROLES,
  // store / planning
  RS_WRITE_ROLES,
  RS_READ_ROLES,
  RM_PO_WRITE_ROLES,
  RM_PO_READ_ROLES,
  STOCK_READ_ROLES,
  STOCK_WRITE_ROLES,
  DISPATCH_WRITE_ROLES,
  DISPATCH_READ_ROLES,
  CUSTOMER_RETURN_CREATE_ROLES,
  CUSTOMER_RETURN_APPROVE_ROLES,
  CUSTOMER_RETURN_READ_ROLES,
  NEXT_RS_WRITE_ROLES,
  NO_QTY_FLOW_STATE_READ_ROLES,
  // production
  WO_WRITE_ROLES,
  WO_PLAN_PREP_ROLES,
  PRODUCTION_WRITE_ROLES,
  PRODUCTION_READ_ROLES,
  // qc
  QC_WRITE_ROLES,
  QC_REWORK_APPROVE_ROLES,
  QC_REWORK_EXECUTE_ROLES,
  QC_PAGE_ROLES,
  QC_REPORT_READ_ROLES,
  QC_LEGACY_CLASSIFY_ROLES,
  // billing
  SALES_BILL_WRITE_ROLES,
  SALES_BILL_READ_ROLES,
  SALES_BILL_CANCEL_ROLES,
  PURCHASE_BILL_WRITE_ROLES,
  PURCHASE_BILL_DRAFT_ROLES,
  PURCHASE_BILL_READ_ROLES,
  ACCOUNTS_COMMERCIAL_ROLES, // legacy alias
  // dashboards / reports
  DASHBOARD_READ_ROLES,
  PLANNING_DASHBOARD_ROLES,
  REPORTS_WITH_ACCOUNTS_ROLES,
  SUPPLIER_VIEW_ROLES,
};
