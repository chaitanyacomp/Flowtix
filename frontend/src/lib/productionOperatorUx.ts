import { formatFgQuantity, qtyDecimalPlacesFromUnit } from "./quantityDisplay";



/** Effective max qty operator may enter on this save (WO remaining ∩ RM cap when present). */

export function resolveProductionEntryMaxQty(

  remainingQty: number | null | undefined,

  rmEntryQtyCap: number | null | undefined,

): number | null {

  const rem = Number(remainingQty ?? 0);

  if (!(rem > 0)) return rmEntryQtyCap != null ? Number(rmEntryQtyCap) : 0;

  if (rmEntryQtyCap != null && Number.isFinite(Number(rmEntryQtyCap))) {

    return Math.min(rem, Number(rmEntryQtyCap));

  }

  return rem;

}



export function formatProductionOperatorQty(

  value: number | null | undefined,

  unit?: string | null,

): string {

  if (value == null || !Number.isFinite(Number(value))) return "—";

  return formatFgQuantity(Number(value), unit ?? undefined);

}



/** Short UOM token for compact helper text — Max: 6000 m */

export function formatProductionOperatorShortUnit(unit?: string | null): string {

  const raw = String(unit ?? "").trim();

  if (!raw) return "";

  const key = raw.toLowerCase();

  if (key === "meter" || key === "mtr" || key === "m") return "m";

  if (key === "nos" || key === "no" || key === "pcs" || key === "numbers") return "nos";

  if (key === "kg" || key === "kilogram") return "kg";

  if (key === "gm" || key === "gram") return "gm";

  return raw.length <= 4 ? raw.toLowerCase() : raw;

}



export function formatProductionOperatorMaxHelper(

  maxAllowedQty: number | null | undefined,

  unit?: string | null,
  labelPrefix = "Max",

): string | null {

  if (maxAllowedQty == null || !Number.isFinite(Number(maxAllowedQty))) return null;

  const qty = formatFgQuantity(Number(maxAllowedQty), undefined).replace(/\s+[^\d.,]+$/, "");

  const u = formatProductionOperatorShortUnit(unit);

  return u ? `${labelPrefix}: ${qty} ${u}` : `${labelPrefix}: ${qty}`;

}



/** Operator qty placeholder — unit-aware; integer UOMs avoid misleading decimals. */
export function productionOperatorQtyPlaceholder(unit?: string | null): string {
  const u = String(unit ?? "").trim();
  const decimals = qtyDecimalPlacesFromUnit(u);
  const sample = decimals <= 0 ? "0" : decimals === 3 ? "0.000" : "0.00";
  if (!u) return sample;
  const key = u.toLowerCase();
  const label =
    key === "mtr" || key === "m" ? "Meter" : key === "nos" || key === "no" ? "Nos" : u;
  return decimals <= 0 ? label : `${sample} ${label}`;
}



export const PRODUCTION_SAVE_BUTTON_LABEL = "Save Production";



export const productionOperatorDateInputClass =
  "erp-flow-filter-input h-12 w-[9.5rem] shrink-0 tabular-nums text-sm font-semibold";

export const productionOperatorQtyInputClass =
  "h-12 w-full min-w-[11rem] max-w-[15rem] shrink-0 rounded-md border-2 border-sky-300 bg-white px-3 text-right text-xl font-bold tabular-nums shadow-sm focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-200";

export const productionOperatorFieldLabelClass =
  "text-[11px] font-bold uppercase tracking-wider text-slate-600";

