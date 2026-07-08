/**
 * ERP-wide quantity display standard (P16-UX-UOM).
 * Every displayed quantity should include its UOM unless the column header defines one common unit.
 * Precision is derived from the item unit token (Item Master UOM).
 */

export type QuantityDisplayCategory =
  | "rm"
  | "fg"
  | "scrap"
  | "stock"
  | "planning"
  | "consumption"
  | "dispatch"
  | "qc";

export type FormatQuantityWithUnitOptions = {
  unit?: string | null;
  /** When false, omit unit suffix (column header defines common unit). Default: true when unit is provided. */
  includeUnit?: boolean;
  category?: QuantityDisplayCategory;
  /** Override decimal places; null/undefined derives from unit. */
  decimalPlaces?: number | null;
  /** Use locale grouping for large values (default true). */
  locale?: boolean;
  emptyValue?: string;
};

const INTEGER_UNIT_TOKENS = new Set([
  "NOS",
  "NO",
  "PCS",
  "PC",
  "PIECE",
  "PIECES",
  "EA",
  "EACH",
  "SET",
  "SETS",
  "UNIT",
  "UNITS",
  "BOX",
  "BOXES",
  "ROLL",
  "ROLLS",
  "BAG",
  "BAGS",
  "PACK",
  "PACKS",
  "PAIR",
  "PAIRS",
  "SHEET",
  "SHEETS",
]);

const DECIMAL_UNIT_TOKENS = new Set([
  "KG",
  "KGS",
  "KILO",
  "KILOGRAM",
  "KILOGRAMS",
  "G",
  "GM",
  "GRAM",
  "GRAMS",
  "L",
  "LTR",
  "LITRE",
  "LITER",
  "LITERS",
  "ML",
  "M",
  "MTR",
  "METER",
  "METERS",
  "METRE",
  "METRES",
  "MT",
  "TON",
  "TONNE",
  "TONNES",
]);

export function normalizeUnitToken(unit: string | null | undefined): string {
  return String(unit ?? "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s+/g, "");
}

/** Decimal places for display from item UOM (0 = integer count units). */
export function qtyDecimalPlacesFromUnit(unit: string | null | undefined): number {
  const token = normalizeUnitToken(unit);
  if (!token) return 0;
  if (DECIMAL_UNIT_TOKENS.has(token)) return 3;
  if (INTEGER_UNIT_TOKENS.has(token)) return 0;
  if (/^(KG|GM|LTR?|MTR?|MT|TON)/.test(token)) return 3;
  return 0;
}

function resolveDecimalPlaces(unit: string | null | undefined, override?: number | null): number {
  if (override != null && Number.isFinite(override)) return Math.max(0, Math.min(6, Math.trunc(override)));
  return qtyDecimalPlacesFromUnit(unit);
}

function roundQtyForDisplay(value: number, decimalPlaces: number): number {
  if (decimalPlaces <= 0) return Math.round(value);
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor + Number.EPSILON) / factor;
}

function stripTrailingZeros(fixed: string): string {
  if (!fixed.includes(".")) return fixed;
  return fixed.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

/** Format numeric portion only (no unit suffix). */
export function formatQtyNumber(
  value: number | null | undefined,
  unit?: string | null,
  opts?: { decimalPlaces?: number | null; locale?: boolean; emptyValue?: string },
): string {
  const emptyValue = opts?.emptyValue ?? "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return emptyValue;

  const decimalPlaces = resolveDecimalPlaces(unit, opts?.decimalPlaces);
  const rounded = roundQtyForDisplay(n, decimalPlaces);
  const useLocale = opts?.locale !== false;

  if (decimalPlaces <= 0) {
    const intVal = Math.round(rounded);
    if (useLocale && Math.abs(intVal) >= 1000) {
      return intVal.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
    return String(intVal);
  }

  if (useLocale && Math.abs(rounded) >= 1000) {
    return rounded.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  return stripTrailingZeros(rounded.toFixed(decimalPlaces));
}

/** Raw numeric string for editable qty fields — no thousands separators. */
export function formatQtyNumberForInput(
  value: number | null | undefined,
  unit?: string | null,
  opts?: { decimalPlaces?: number | null; emptyValue?: string },
): string {
  return formatQtyNumber(value, unit, { ...opts, locale: false });
}

function normalizeOptions(
  options?: FormatQuantityWithUnitOptions | string | null,
): FormatQuantityWithUnitOptions {
  if (typeof options === "string" || options == null) {
    return { unit: options ?? undefined };
  }
  return options;
}

/**
 * Canonical ERP quantity formatter — append item UOM with correct precision.
 */
export function formatQuantityWithUnit(
  value: number | null | undefined,
  options?: FormatQuantityWithUnitOptions | string | null,
): string {
  const opts = normalizeOptions(options);
  const unit = opts.unit;
  const unitLabel = String(unit ?? "").trim();
  const includeUnit = opts.includeUnit ?? Boolean(unitLabel);
  const emptyValue = opts.emptyValue ?? "—";

  const n = Number(value ?? NaN);
  if (!Number.isFinite(n)) {
    return includeUnit && unitLabel ? `${emptyValue} ${unitLabel}` : emptyValue;
  }

  const qty = formatQtyNumber(n, unit, {
    decimalPlaces: opts.decimalPlaces,
    locale: opts.locale,
    emptyValue,
  });
  return includeUnit && unitLabel ? `${qty} ${unitLabel}` : qty;
}

export function formatRmQuantity(
  value: number | null | undefined,
  unit?: string | null,
  options?: Omit<FormatQuantityWithUnitOptions, "unit" | "category">,
): string {
  return formatQuantityWithUnit(value, { ...options, unit, category: "rm" });
}

export function formatFgQuantity(
  value: number | null | undefined,
  unit?: string | null,
  options?: Omit<FormatQuantityWithUnitOptions, "unit" | "category">,
): string {
  return formatQuantityWithUnit(value, { ...options, unit, category: "fg" });
}

export function formatStockQuantity(
  value: number | null | undefined,
  unit?: string | null,
  options?: Omit<FormatQuantityWithUnitOptions, "unit" | "category">,
): string {
  return formatQuantityWithUnit(value, { ...options, unit, category: "stock" });
}

export function formatPlanningQuantity(
  value: number | null | undefined,
  unit?: string | null,
  options?: Omit<FormatQuantityWithUnitOptions, "unit" | "category">,
): string {
  return formatQuantityWithUnit(value, { ...options, unit, category: "planning" });
}

export function formatDispatchQuantity(
  value: number | null | undefined,
  unit?: string | null,
  options?: Omit<FormatQuantityWithUnitOptions, "unit" | "category">,
): string {
  return formatQuantityWithUnit(value, { ...options, unit, category: "dispatch" });
}

/** Dispatch qty for editable inputs — number only, no locale grouping or unit suffix. */
export function formatDispatchQuantityForInput(
  value: number | null | undefined,
  unit?: string | null,
  options?: Omit<FormatQuantityWithUnitOptions, "unit" | "category" | "locale" | "includeUnit">,
): string {
  return formatQuantityWithUnit(value, {
    ...options,
    unit,
    category: "dispatch",
    locale: false,
    includeUnit: false,
  });
}

export function formatQcQuantity(
  value: number | null | undefined,
  unit?: string | null,
  options?: Omit<FormatQuantityWithUnitOptions, "unit" | "category">,
): string {
  return formatQuantityWithUnit(value, { ...options, unit, category: "qc" });
}

/** QC qty for editable inputs — number only, no locale grouping or unit suffix. */
export function formatQcQuantityForInput(
  value: number | null | undefined,
  unit?: string | null,
  options?: Omit<FormatQuantityWithUnitOptions, "unit" | "category" | "locale" | "includeUnit">,
): string {
  return formatQuantityWithUnit(value, { ...options, unit, category: "qc", locale: false, includeUnit: false });
}

export function formatConsumptionQuantity(
  value: number | null | undefined,
  unit?: string | null,
  options?: Omit<FormatQuantityWithUnitOptions, "unit" | "category">,
): string {
  return formatQuantityWithUnit(value, { ...options, unit, category: "consumption" });
}

export function formatScrapQuantity(
  value: number | null | undefined,
  unit?: string | null,
  options?: Omit<FormatQuantityWithUnitOptions, "unit" | "category">,
): string {
  return formatQuantityWithUnit(value, { ...options, unit, category: "scrap" });
}

const CATEGORY_FORMATTERS: Record<
  QuantityDisplayCategory,
  (
    value: number | null | undefined,
    unit?: string | null,
    options?: Omit<FormatQuantityWithUnitOptions, "unit" | "category">,
  ) => string
> = {
  rm: formatRmQuantity,
  fg: formatFgQuantity,
  scrap: formatScrapQuantity,
  stock: formatStockQuantity,
  planning: formatPlanningQuantity,
  consumption: formatConsumptionQuantity,
  dispatch: formatDispatchQuantity,
  qc: formatQcQuantity,
};

/** Bind a default unit for repeated formatting in a screen (e.g. selected WO line FG unit). */
export function bindQuantityFormatter(
  category: QuantityDisplayCategory,
  defaultUnit?: string | null,
): (value: number | null | undefined, unit?: string | null) => string {
  const fn = CATEGORY_FORMATTERS[category];
  return (value, unit) => fn(value, unit ?? defaultUnit);
}

/** @deprecated Use formatRmQuantity — kept for existing imports via rmQtyDisplay. */
export const formatRmQty = formatRmQuantity;

/** FG production workspace quantities (number-only when unit omitted). */
export const formatProductionQty = formatFgQuantity;

/** Dispatch execution quantities. */
export const formatDispatchQty = formatDispatchQuantity;

/** QC entry quantities. */
export const formatQcQty = formatQcQuantity;

const PRODUCTION_QTY_PLACEHOLDER_UNITS: Record<string, string> = {
  NOS: "Nos",
  NO: "Nos",
  PCS: "Pcs",
  KG: "Kg",
  GM: "Gm",
  MTR: "Meter",
  METER: "Meter",
  MT: "Mt",
  LTR: "Ltr",
};

/** Placeholder for production qty inputs — uses Item Master UOM token. */
export function productionQtyInputPlaceholder(unit?: string | null): string {
  const token = normalizeUnitToken(unit);
  if (!token) return "Qty";
  const label =
    PRODUCTION_QTY_PLACEHOLDER_UNITS[token] ??
    (String(unit ?? "").trim() || token);
  return `Qty in ${label}`;
}
