/**
 * STORE (dispatch desk) sidebar visibility — presentation only.
 * Does not change route permissions; hidden links remain unreachable via nav only.
 */

const STORE_HIDDEN_NAV_KEYS = new Set([
  // Masters — config / engineering
  "cust",
  "tally-import",
  "backup-restore",
  "supp",
  "units",
  "boms",
  // Sales flow — non-dispatch commercial
  "enq",
  "quot",
  "so",
  // Production flow
  "plan-dash",
  "wo",
  "prod",
  "qc",
  "qc-report",
  // Purchase accounting (GRN lives under Material Planning)
  "purbill",
]);

export function isStoreNavItemVisible(role: string, navKey: string): boolean {
  if (role !== "STORE") return true;
  return !STORE_HIDDEN_NAV_KEYS.has(navKey);
}

/** Reports hub: STORE sees dispatch + stock operational reports first. */
export const STORE_REPORT_GROUP_ORDER = [
  "sales-ops",
  "stock",
  "purchase",
  "exceptions",
] as const;
