/**
 * PRODUCTION_MANAGER desk sidebar — allow-list (presentation only).
 * Landing: Shift Production. Masters: read-only production registers.
 */
const PRODUCTION_MANAGER_VISIBLE_NAV_KEYS = new Set([
  "masters-hub",
  "machines",
  "operators",
  "shifts",
  "shift-prod",
]);

export function isProductionManagerNavItemVisible(role: string, navKey: string): boolean {
  if (role !== "PRODUCTION_MANAGER") return true;
  return PRODUCTION_MANAGER_VISIBLE_NAV_KEYS.has(navKey);
}

/** Nav keys shown for PRODUCTION_MANAGER after role + allow-list filters. */
export function listVisibleProductionManagerNavKeys(
  role: string,
  itemDefs: { navKey: string; roles: string[] }[],
): string[] {
  if (role !== "PRODUCTION_MANAGER") return [];
  return itemDefs
    .filter((n) => n.roles.includes(role) && isProductionManagerNavItemVisible(role, n.navKey))
    .map((n) => n.navKey);
}
