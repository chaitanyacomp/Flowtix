import type { ComponentProps } from "react";

import type { Badge } from "../components/ui/badge";

import {

  classifyInventoryHealth,

  classifyRmInventoryHealthFromFields,

  countRmInventoryHealthAlerts,

  inventoryHealthShortLabel,

  isRmInventoryHealthAlert,

  parseInventoryQty,

  type InventoryHealthStatus,

} from "./inventoryHealth";



/** Item stock health — mirrors centralized `inventoryHealth` rules. */

export type ItemStockStatus = InventoryHealthStatus;



export { parseInventoryQty as parseItemQtyStr };



export function computeItemStockStatus(args: {

  currentQty: number;

  minimumStock: number | null;

  lowStockAlert: number | null;

}): ItemStockStatus {

  return classifyInventoryHealth({

    currentQty: args.currentQty,

    minimumStock: args.minimumStock,

    lowStockLevel: args.lowStockAlert,

  });

}



export function itemStockStatusFromItemFields(args: {

  currentQty: number;

  minimumStockQty?: string | number | null;

  minStockLevel?: string | number | null;

}): ItemStockStatus {

  return classifyRmInventoryHealthFromFields(args);

}



export function itemStockStatusLabel(s: ItemStockStatus): string {

  return inventoryHealthShortLabel(s);

}



export function itemStockStatusBadgeVariant(s: ItemStockStatus): ComponentProps<typeof Badge>["variant"] {

  if (s === "OUT_OF_STOCK") return "rejected";

  if (s === "CRITICAL") return "rejected";

  if (s === "LOW") return "warning";

  return "success";

}



/**

 * Parsed low-stock alert level from Item master (`minStockLevel`).

 * Returns `null` when unset or zero (no planning threshold).

 */

export function parseLowStockLevel(raw: string | number | null | undefined): number | null {

  const n = parseInventoryQty(raw);

  if (n == null || n <= 0) return null;

  return n;

}



/**

 * Shortage vs the low-stock alert level (Item master `minStockLevel`):

 * `max(0, lowStockLevel - usableStock)`. When low level is unset, returns 0.

 */

export function computeLowStockShortageQty(args: {

  usableStock: number;

  minStockLevel?: string | number | null;

}): number {

  const low = parseLowStockLevel(args.minStockLevel);

  if (low == null) return 0;

  const usable = Number.isFinite(args.usableStock) ? args.usableStock : 0;

  return Math.max(0, low - usable);

}



/** RM item with any non-healthy inventory status (critical or warning band). */

export function isRmBelowLowStockAlert(args: {

  usableStock: number;

  minimumStockQty?: string | number | null;

  minStockLevel?: string | number | null;

}): boolean {

  return isRmInventoryHealthAlert({

    currentQty: args.usableStock,

    minimumStockQty: args.minimumStockQty,

    minStockLevel: args.minStockLevel,

  });

}



/** @deprecated Prefer `countRmInventoryHealthAlerts` for split critical/warning counts. */

export function countRmLowStockAlerts<

  T extends { itemId: number; item: { itemType: string }; usableQty: number },

>(

  rows: T[],

  thresholds: Map<

    number,

    { minimumStockQty?: string | number | null; minStockLevel?: string | number | null }

  >,

): number {

  return countRmInventoryHealthAlerts(rows, thresholds).total;

}



export {

  classifyInventoryHealth,

  classifyRmInventoryHealthFromFields,

  countRmInventoryHealthAlerts,

  inventoryHealthToRmAlertBand,

  inventoryHealthShortLabel,

  isRmInventoryHealthAlert,

} from "./inventoryHealth";


