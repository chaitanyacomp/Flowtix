/**
 * Canonical inventory health classification (mirrors frontend `inventoryHealth.ts`).
 */

/** @typedef {"OUT_OF_STOCK"|"CRITICAL"|"LOW"|"HEALTHY"} InventoryHealthStatus */

/** @param {unknown} raw */
function parseInventoryQty(raw) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Policy-driven RM health: critical only when Minimum Stock is configured and breached.
 *
 * @param {{ currentQty: number, minimumStock?: number|null, lowStockLevel?: number|null }} args
 * @returns {InventoryHealthStatus}
 */
function classifyInventoryHealth(args) {
  const cur = Number.isFinite(args.currentQty) ? args.currentQty : 0;
  const min =
    args.minimumStock != null && Number.isFinite(args.minimumStock) ? args.minimumStock : 0;
  const low =
    args.lowStockLevel != null && Number.isFinite(args.lowStockLevel) ? args.lowStockLevel : 0;
  if (min > 0 && cur < min) return "CRITICAL";
  if (low > 0 && cur < low) return "LOW";
  return "HEALTHY";
}

/** Dashboard KPI bands — critical is minimum-stock policy only (not bare zero stock). */
function inventoryHealthToRmAlertBand(status) {
  if (status === "CRITICAL") return "critical";
  if (status === "LOW") return "warning";
  return null;
}

/**
 * @param {Array<{ id: number, itemName: string, minimumStockQty?: unknown, minStockLevel?: unknown }>} rmItems
 * @param {Map<number, number>} stockByItemId
 */
function buildRmStockHealthAlerts(rmItems, stockByItemId) {
  /** @type {Array<{ itemId: number, itemName: string, qty: number, minimumStockQty: number, minStockLevel: number, status: InventoryHealthStatus }>} */
  const rmStockCritical = [];
  /** @type {typeof rmStockCritical} */
  const rmStockWarning = [];

  for (const i of rmItems) {
    const qty = stockByItemId.get(i.id) || 0;
    const minimumStockQty = Number(i.minimumStockQty ?? 0);
    const minStockLevel = Number(i.minStockLevel ?? 0);
    const status = classifyInventoryHealth({
      currentQty: qty,
      minimumStock: minimumStockQty,
      lowStockLevel: minStockLevel,
    });
    const row = {
      itemId: i.id,
      itemName: i.itemName,
      qty,
      minimumStockQty,
      minStockLevel,
      status,
    };
    const band = inventoryHealthToRmAlertBand(status);
    if (band === "critical") rmStockCritical.push(row);
    else if (band === "warning") rmStockWarning.push(row);
  }

  const byQtyAsc = (a, b) => a.qty - b.qty;
  rmStockCritical.sort(byQtyAsc);
  rmStockWarning.sort(byQtyAsc);

  const rmStockAlert = [...rmStockCritical, ...rmStockWarning];

  return {
    rmStockCritical,
    rmStockWarning,
    rmStockAlert,
    rmStockCriticalCount: rmStockCritical.length,
    rmStockWarningCount: rmStockWarning.length,
  };
}

module.exports = {
  classifyInventoryHealth,
  inventoryHealthToRmAlertBand,
  buildRmStockHealthAlerts,
  parseInventoryQty,
};
