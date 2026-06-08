/**
 * STORE sidebar visibility — presentation only.
 * MPRS Phase 1: planning / review workspaces are visible; commercial & shop-floor remain hidden.
 */
const STORE_HIDDEN_NAV_KEYS = new Set([
  "cust",
  "tally-import",
  "backup-restore",
  "supp",
  "boms",
  "enq",
  "quot",
  "so",
  "disp",
  "salebill",
  "cust-track",
  "cust-ret",
  "purbill",
  "wo",
  "prod",
  "qc",
  "qc-report",
  "pmr",
  "mrn",
  "rm-ledger",
  "stock-adj",
  "stock-move",
  "reports",
  "account-prof",
]);

export function isStoreNavItemVisible(role: string, navKey: string): boolean {
  if (role !== "STORE") return true;
  return !STORE_HIDDEN_NAV_KEYS.has(navKey);
}

/** STORE reports workspace — dispatch/stock only (when reports route is opened). */
export const STORE_REPORT_GROUP_ORDER = ["sales-ops", "stock"] as const;
