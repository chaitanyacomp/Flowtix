/**
 * PRODUCTION desk sidebar — allow-list (Phase 2 UI cleanup).
 * Requirement & Cycle Planning is Production Manager–owned (hidden unless fallback later).
 */
const PRODUCTION_VISIBLE_NAV_KEYS = new Set([
  "dash-home",
  "wo",
  "prod",
  "shift-prod",
  "rm-control-center",
]);

export function isProductionNavItemVisible(role: string, navKey: string): boolean {
  if (role !== "PRODUCTION") return true;
  return PRODUCTION_VISIBLE_NAV_KEYS.has(navKey);
}

/** Production Flow → Requirement & Cycle Planning hub (queue). */
export const REQUIREMENT_CYCLE_PLANNING_HREF = "/planning-dashboard";

function stripPathQuery(pathname: string): string {
  return String(pathname || "").split(/[?#]/)[0];
}

/**
 * Active highlight for Requirement & Cycle Planning:
 * planning queue + machine-run planning workspace (prepare / rm-check).
 */
export function isRequirementCyclePlanningNavActive(pathname: string): boolean {
  const p = stripPathQuery(pathname);
  if (p.startsWith("/planning-dashboard")) return true;
  if (p === "/rm-check" || p.startsWith("/rm-check/")) return true;
  if (p.startsWith("/work-orders/prepare")) return true;
  return false;
}

/**
 * Work Order register (created WOs) — not the prepare / machine-planning workspace.
 */
export function isWorkOrderRegisterNavActive(pathname: string): boolean {
  const p = stripPathQuery(pathname);
  if (p.startsWith("/work-orders/prepare")) return false;
  if (p === "/rm-check" || p.startsWith("/rm-check/")) return false;
  if (p === "/work-orders") return true;
  if (p.startsWith("/work-orders/")) return true;
  return false;
}

/** Shift Production landing + active session workspace. */
export function isShiftProductionNavActive(pathname: string): boolean {
  const p = stripPathQuery(pathname);
  return p === "/shift-production" || p.startsWith("/shift-production/");
}

/** Production Flow nav keys shown after role + production allow-list filters. */
export function listVisibleProductionFlowNavKeys(
  role: string,
  itemDefs: { navKey: string; roles: string[] }[],
): string[] {
  return itemDefs
    .filter((n) => n.roles.includes(role) && isProductionNavItemVisible(role, n.navKey))
    .map((n) => n.navKey);
}
