/**
 * PRODUCTION desk sidebar — allow-list (Phase 2 UI cleanup).
 */
const PRODUCTION_VISIBLE_NAV_KEYS = new Set([
  "dash-home",
  "wo",
  "prod",
  "rm-control-center",
]);

export function isProductionNavItemVisible(role: string, navKey: string): boolean {
  if (role !== "PRODUCTION") return true;
  return PRODUCTION_VISIBLE_NAV_KEYS.has(navKey);
}
