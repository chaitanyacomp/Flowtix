/**
 * Authoritative ERP inventory item types (Prisma ItemType enum).
 * Do not add Packing/Scrap/Tool/etc. until schema + workflows exist.
 * Tally PACKING maps to CONSUMABLE at import time.
 */

export const ITEM_TYPE_CODES = ["RM", "FG", "SFG", "CONSUMABLE"] as const;

export type ItemTypeCode = (typeof ITEM_TYPE_CODES)[number];

export type ItemTypeDefinition = {
  code: ItemTypeCode;
  /** Add-menu / form title label */
  label: string;
  /** Compact badge / filter label */
  shortLabel: string;
  /** Manual create via Items workbench */
  manuallyCreatable: boolean;
  /** Stock-holding inventory item */
  isStock: boolean;
};

/** Single source for Add Item dropdown, Type filter, and badges. */
export const ITEM_TYPE_DEFINITIONS: readonly ItemTypeDefinition[] = [
  {
    code: "RM",
    label: "Raw Material",
    shortLabel: "RM",
    manuallyCreatable: true,
    isStock: true,
  },
  {
    code: "FG",
    label: "Finished Good",
    shortLabel: "FG",
    manuallyCreatable: true,
    isStock: true,
  },
  {
    code: "SFG",
    label: "Semi-finished Good",
    shortLabel: "SFG",
    manuallyCreatable: true,
    isStock: true,
  },
  {
    code: "CONSUMABLE",
    label: "Consumable",
    shortLabel: "CONSUMABLE",
    manuallyCreatable: true,
    isStock: true,
  },
] as const;

export function isItemTypeCode(value: unknown): value is ItemTypeCode {
  return typeof value === "string" && (ITEM_TYPE_CODES as readonly string[]).includes(value);
}

export function itemTypeDefinition(code: ItemTypeCode): ItemTypeDefinition {
  const row = ITEM_TYPE_DEFINITIONS.find((d) => d.code === code);
  if (!row) throw new Error(`Unknown item type: ${code}`);
  return row;
}

export function itemTypeLabel(code: string): string {
  if (!isItemTypeCode(code)) return code || "—";
  return itemTypeDefinition(code).label;
}

export function itemTypeShortLabel(code: string): string {
  if (!isItemTypeCode(code)) return code || "—";
  return itemTypeDefinition(code).shortLabel;
}

/** Types offered on “+ Add Item” (all current schema types). */
export const MANUALLY_CREATABLE_ITEM_TYPES = ITEM_TYPE_DEFINITIONS.filter((d) => d.manuallyCreatable);

/**
 * Future categories requested in product discussions but not in Prisma ItemType:
 * Packing Material, Stores & Spares, Tool, Scrap — map/import as CONSUMABLE or EXCLUDE today.
 */
export const FUTURE_ITEM_TYPE_CANDIDATES = [
  "PACKING_MATERIAL",
  "STORES_AND_SPARES",
  "TOOL",
  "SCRAP",
] as const;
