/**
 * Dashboard RM classification — wording/policy helpers only.
 * Separates minimum-stock replenishment alerts from SO/WO material blockers.
 */

/** True when rm-risk queue has active order-level RM shortage rows. */
export function hasSoWoRmBlockerAttention(rmRiskCount: number, canSeeRmShortageOperational: boolean): boolean {
  return canSeeRmShortageOperational && rmRiskCount > 0;
}

/**
 * Minimum-stock replenishment alerts (Item master thresholds) must not
 * suppress "Operations clear" or imply a WO is blocked.
 */
export function minimumStockReplenishmentAffectsOperationsClear(): boolean {
  return false;
}
