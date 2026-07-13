/**
 * Canonical inventory health classification (RM procurement thresholds).
 *
 * RM Stock Monitor status uses Minimum Stock only (Target does not drive Healthy/Below Minimum).
 * Dashboard alerts may still use optional Target as a Low/warning band when Low Stock Level is unset.
 */
export type InventoryHealthStatus = "OUT_OF_STOCK" | "CRITICAL" | "LOW" | "HEALTHY";

/** @deprecated Prefer Target Stock for suggested qty; kept for legacy Item Master data. */
export const DEFAULT_RM_BUFFER_PERCENT_NEW = 25;

export function parseInventoryQty(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** @deprecated Internal legacy helper — UI no longer exposes Buffer %. */
export function computeDerivedLowStockLevel(minimumStock: number, bufferPercent: number): number {
  const min = Number.isFinite(minimumStock) && minimumStock > 0 ? minimumStock : 0;
  const buf = Number.isFinite(bufferPercent) && bufferPercent >= 0 ? bufferPercent : 0;
  const suggested = min + (min * buf) / 100;
  return Math.round(suggested * 1000) / 1000;
}

/**
 * Policy-driven RM health for dashboards:
 * CRITICAL (below minimum) → LOW (below low alert or below Target) → HEALTHY.
 */
export function classifyInventoryHealth(args: {
  currentQty: number;
  minimumStock?: number | null;
  lowStockLevel?: number | null;
  targetStock?: number | null;
}): InventoryHealthStatus {
  const cur = Number.isFinite(args.currentQty) ? args.currentQty : 0;
  const min =
    args.minimumStock != null && Number.isFinite(args.minimumStock) ? args.minimumStock : 0;
  const low =
    args.lowStockLevel != null && Number.isFinite(args.lowStockLevel) ? args.lowStockLevel : 0;
  const target =
    args.targetStock != null && Number.isFinite(args.targetStock) ? args.targetStock : 0;
  if (min > 0 && cur < min) return "CRITICAL";
  if (low > 0 && cur < low) return "LOW";
  if (target > min && cur < target) return "LOW";
  return "HEALTHY";
}

/** RM Stock Monitor status (Minimum-only). */
export type RmStockMonitorStatus = "BELOW_MINIMUM" | "HEALTHY";

export function classifyRmStockMonitorStatus(args: {
  currentQty: number;
  minimumStockQty?: number | null;
}): RmStockMonitorStatus {
  const current = Number.isFinite(args.currentQty) ? args.currentQty : 0;
  const minimum =
    args.minimumStockQty != null && Number.isFinite(args.minimumStockQty) ? args.minimumStockQty : 0;
  if (minimum > 0 && current < minimum) return "BELOW_MINIMUM";
  return "HEALTHY";
}

export function rmStockMonitorStatusLabel(status: RmStockMonitorStatus): string {
  if (status === "BELOW_MINIMUM") return "Below Minimum";
  return "Healthy";
}

export function resolveReplenishmentLevel(args: {
  minimumStockQty?: number | null;
  targetStockQty?: number | null;
}): number {
  const minimum =
    args.minimumStockQty != null && Number.isFinite(args.minimumStockQty) ? args.minimumStockQty : 0;
  const target =
    args.targetStockQty != null && Number.isFinite(args.targetStockQty) ? args.targetStockQty : null;
  if (target != null && target > 0) return target;
  return minimum;
}

/**
 * Suggested purchase qty:
 * max(0, Replenishment Level − Current − Open STOCK_REPLENISHMENT Qty)
 */
export function suggestedRmReplenishmentQty(args: {
  currentQty: number;
  minimumStockQty?: number | null;
  targetStockQty?: number | null;
  openStockReplenishmentQty?: number | null;
}): number {
  const current = Number.isFinite(args.currentQty) ? args.currentQty : 0;
  const open =
    args.openStockReplenishmentQty != null && Number.isFinite(args.openStockReplenishmentQty)
      ? args.openStockReplenishmentQty
      : 0;
  const level = resolveReplenishmentLevel(args);
  if (!(level > 0)) return 0;
  return Math.round(Math.max(0, level - current - open) * 1000) / 1000;
}

export function isEligibleForReplenishmentRequest(args: {
  currentQty: number;
  minimumStockQty?: number | null;
  targetStockQty?: number | null;
  openStockReplenishmentQty?: number | null;
}): boolean {
  const current = Number.isFinite(args.currentQty) ? args.currentQty : 0;
  const minimum =
    args.minimumStockQty != null && Number.isFinite(args.minimumStockQty) ? args.minimumStockQty : 0;
  if (!(minimum > 0) || !(current < minimum)) return false;
  return suggestedRmReplenishmentQty(args) > 0;
}

export type RmInventoryAlertBand = "critical" | "warning";

export function inventoryHealthToRmAlertBand(
  status: InventoryHealthStatus,
): RmInventoryAlertBand | null {
  if (status === "CRITICAL") return "critical";
  if (status === "LOW") return "warning";
  return null;
}

export function classifyRmInventoryHealthFromFields(args: {
  currentQty: number;
  minimumStockQty?: string | number | null;
  minStockLevel?: string | number | null;
  reorderQty?: string | number | null;
}): InventoryHealthStatus {
  return classifyInventoryHealth({
    currentQty: args.currentQty,
    minimumStock: parseInventoryQty(args.minimumStockQty),
    lowStockLevel: parseInventoryQty(args.minStockLevel),
    targetStock: parseInventoryQty(args.reorderQty),
  });
}

export function isRmInventoryHealthAlert(args: {
  currentQty: number;
  minimumStockQty?: string | number | null;
  minStockLevel?: string | number | null;
  reorderQty?: string | number | null;
}): boolean {
  return inventoryHealthToRmAlertBand(classifyRmInventoryHealthFromFields(args)) != null;
}

export function countRmInventoryHealthAlerts<
  T extends { itemId: number; item: { itemType: string }; usableQty: number },
>(
  rows: T[],
  thresholds: Map<
    number,
    {
      minimumStockQty?: string | number | null;
      minStockLevel?: string | number | null;
      reorderQty?: string | number | null;
    }
  >,
): { critical: number; warning: number; total: number } {
  let critical = 0;
  let warning = 0;
  for (const r of rows) {
    if (r.item.itemType !== "RM") continue;
    const th = thresholds.get(r.itemId);
    const status = classifyRmInventoryHealthFromFields({
      currentQty: Number(r.usableQty) || 0,
      minimumStockQty: th?.minimumStockQty,
      minStockLevel: th?.minStockLevel,
      reorderQty: th?.reorderQty,
    });
    const band = inventoryHealthToRmAlertBand(status);
    if (band === "critical") critical += 1;
    else if (band === "warning") warning += 1;
  }
  return { critical, warning, total: critical + warning };
}

export function formatRmStockAlertBanner(criticalCount: number, warningCount: number): string | null {
  if (criticalCount <= 0 && warningCount <= 0) return null;
  if (criticalCount > 0 && warningCount > 0) {
    return `Stock replenishment alerts: ${criticalCount} below minimum • ${warningCount} low`;
  }
  if (criticalCount > 0) {
    return `Stock replenishment: ${criticalCount} item${criticalCount === 1 ? "" : "s"} below minimum`;
  }
  return `Replenishment low: ${warningCount} item${warningCount === 1 ? "" : "s"} below target`;
}

export function inventoryHealthLabel(status: InventoryHealthStatus): string {
  if (status === "OUT_OF_STOCK") return "Out of stock";
  if (status === "CRITICAL") return "Below Minimum";
  if (status === "LOW") return "Low";
  return "Healthy";
}

export function inventoryHealthShortLabel(status: InventoryHealthStatus): string {
  if (status === "OUT_OF_STOCK") return "Out of stock";
  if (status === "CRITICAL") return "Below Minimum";
  if (status === "LOW") return "Low";
  return "Healthy";
}
