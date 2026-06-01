/**
 * PURCHASE desk sidebar visibility — presentation only (Phase 2 UI cleanup).
 */
const PURCHASE_HIDDEN_NAV_KEYS = new Set([
  "cust",
  "items",
  "opening-stock",
  "units",
  "locations",
  "tally-import",
  "backup-restore",
  "boms",
  "enq",
  "quot",
  "so",
  "disp",
  "cust-track",
  "cust-ret",
  "salebill",
  "mat-issue",
  "stock",
  "stock-move",
  "stock-adj",
  "rm-ledger",
  "rm-control-center",
  "monthly-planning",
  "plan-dash",
  "wo",
  "prod",
  "pmr",
  "mrn",
  "qc",
  "qc-report",
  "reports",
  "account-prof",
]);

export function isPurchaseNavItemVisible(role: string, navKey: string): boolean {
  if (role !== "PURCHASE") return true;
  return !PURCHASE_HIDDEN_NAV_KEYS.has(navKey);
}

export const PURCHASE_REPORT_GROUP_ORDER = ["purchase", "commercial", "exceptions"] as const;
