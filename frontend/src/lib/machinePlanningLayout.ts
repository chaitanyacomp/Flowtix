/**
 * Layout gate for Prepare Work Order / Machine Run Planning (UI only).
 * Compact redesign must mount for active machine-planning stages even when
 * Admin opens `/work-orders/prepare?salesOrderId=…` without `intent=machine-planning`.
 */

export const MACHINE_PLANNING_COMPACT_STAGE_KEYS = Object.freeze([
  "MACHINE_PLANNING_PENDING",
  "MACHINE_PLANNING_IN_PROGRESS",
  "MACHINE_PLANNING_AWAITING_COMPLETION",
] as const);

export type MachinePlanningCompactStageKey =
  (typeof MACHINE_PLANNING_COMPACT_STAGE_KEYS)[number];

/**
 * @param input.intentMachinePlanning URL `intent=machine-planning`
 * @param input.roleUpper normalized role (e.g. ADMIN, PRODUCTION)
 * @param input.machinePlanningKey from rm-check / planning snapshot response
 */
export function shouldUseCompactMachinePlanningLayout(input: {
  intentMachinePlanning?: boolean;
  roleUpper?: string | null;
  machinePlanningKey?: string | null;
}): boolean {
  if (input.intentMachinePlanning) return true;
  const role = String(input.roleUpper ?? "")
    .trim()
    .toUpperCase();
  if (role === "PRODUCTION") return true;
  const key = String(input.machinePlanningKey ?? "")
    .trim()
    .toUpperCase();
  return (MACHINE_PLANNING_COMPACT_STAGE_KEYS as readonly string[]).includes(key);
}
