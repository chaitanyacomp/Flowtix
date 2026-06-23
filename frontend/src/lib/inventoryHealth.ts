/**
 * Canonical inventory health classification (RM procurement thresholds).
 *
 * minimumStock = critical floor; lowStockLevel = warning level (often derived from buffer %).
 */
export type InventoryHealthStatus = "OUT_OF_STOCK" | "CRITICAL" | "LOW" | "HEALTHY";

/** Default buffer % only when creating a new RM item — never forced on edit/save. */
export const DEFAULT_RM_BUFFER_PERCENT_NEW = 25;

export function parseInventoryQty(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** lowStockLevel = minimumStock + (minimumStock * bufferPercent / 100) */
export function computeDerivedLowStockLevel(minimumStock: number, bufferPercent: number): number {
  const min = Number.isFinite(minimumStock) && minimumStock > 0 ? minimumStock : 0;
  const buf = Number.isFinite(bufferPercent) && bufferPercent >= 0 ? bufferPercent : 0;
  const suggested = min + (min * buf) / 100;
  return Math.round(suggested * 1000) / 1000;
}

/**
 * Policy-driven RM health: critical only when Minimum Stock is configured and breached.
 *
 * Order: CRITICAL (below minimum) → LOW (below low alert) → HEALTHY.
 */
export function classifyInventoryHealth(args: {
  currentQty: number;
  minimumStock?: number | null;
  lowStockLevel?: number | null;
}): InventoryHealthStatus {
  const cur = Number.isFinite(args.currentQty) ? args.currentQty : 0;
  const min =
    args.minimumStock != null && Number.isFinite(args.minimumStock) ? args.minimumStock : 0;
  const low =
    args.lowStockLevel != null && Number.isFinite(args.lowStockLevel) ? args.lowStockLevel : 0;
  if (min > 0 && cur < min) return "CRITICAL";
  if (low > 0 && cur < low) return "LOW";
  return "HEALTHY";
}

export type RmInventoryAlertBand = "critical" | "warning";

/** Dashboard KPI bands — critical is minimum-stock policy only (not bare zero stock). */
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
}): InventoryHealthStatus {
  return classifyInventoryHealth({
    currentQty: args.currentQty,
    minimumStock: parseInventoryQty(args.minimumStockQty),
    lowStockLevel: parseInventoryQty(args.minStockLevel),
  });
}

export function isRmInventoryHealthAlert(args: {
  currentQty: number;
  minimumStockQty?: string | number | null;
  minStockLevel?: string | number | null;
}): boolean {
  return inventoryHealthToRmAlertBand(classifyRmInventoryHealthFromFields(args)) != null;
}

export function countRmInventoryHealthAlerts<
  T extends { itemId: number; item: { itemType: string }; usableQty: number },
>(
  rows: T[],
  thresholds: Map<
    number,
    { minimumStockQty?: string | number | null; minStockLevel?: string | number | null }
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
    return `Stock replenishment alerts: ${criticalCount} critical • ${warningCount} low`;
  }
  if (criticalCount > 0) {
    return `Stock replenishment critical: ${criticalCount} item${criticalCount === 1 ? "" : "s"} below minimum`;
  }
  return `Replenishment low: ${warningCount} item${warningCount === 1 ? "" : "s"} below alert level`;
}

export function inventoryHealthLabel(status: InventoryHealthStatus): string {
  if (status === "OUT_OF_STOCK") return "Out of stock";
  if (status === "CRITICAL") return "Critical";
  if (status === "LOW") return "Warning";
  return "Healthy";
}

export function inventoryHealthShortLabel(status: InventoryHealthStatus): string {
  if (status === "OUT_OF_STOCK") return "⛔ Out of stock";
  if (status === "CRITICAL") return "🔴 Critical";
  if (status === "LOW") return "🟡 Warning";
  return "🟢 Healthy";
}
