/**
 * FG quantity precision from item unit (legacy text + optional unit master code).
 * Integer count units (Nos, Pcs, …) → whole-number FG qty.
 * Weight / length units keep up to 3 decimal places.
 */

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

function normalizeUnitToken(unit) {
  return String(unit ?? "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s+/g, "");
}

/**
 * @param {string | null | undefined} unit
 * @returns {number} 0 = integer FG qty; 3 = decimal FG qty
 */
function fgQtyDecimalPlaces(unit) {
  const token = normalizeUnitToken(unit);
  if (!token) return 0;
  if (DECIMAL_UNIT_TOKENS.has(token)) return 3;
  if (INTEGER_UNIT_TOKENS.has(token)) return 0;
  if (/^(KG|GM|LTR?|MTR?|MT|TON)/.test(token)) return 3;
  return 0;
}

function isIntegerFgUnit(unit) {
  return fgQtyDecimalPlaces(unit) <= 0;
}

/**
 * Round FG qty to item UOM precision (floor for integer units when capping from RM).
 * @param {number | string | null | undefined} qty
 * @param {string | null | undefined} unit
 * @param {{ mode?: "round" | "floor" }} [opts]
 */
function roundFgQty(qty, unit, opts = {}) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return 0;
  const places = fgQtyDecimalPlaces(unit);
  const mode = opts.mode === "floor" ? "floor" : "round";
  if (places <= 0) {
    return mode === "floor" ? Math.floor(n + 1e-9) : Math.round(n);
  }
  const factor = 1000;
  const scaled = n * factor;
  const out = mode === "floor" ? Math.floor(scaled + 1e-9) : Math.round(scaled);
  return out / factor;
}

/**
 * Max FG qty producible from available RM at given BOM per-FG consumption.
 * @param {number} availableQty
 * @param {number} requiredPerFg
 * @param {string | null | undefined} unit
 */
function capFgQtyFromRmAvailability(availableQty, requiredPerFg, unit) {
  const available = Number(availableQty);
  const perFg = Number(requiredPerFg);
  if (!Number.isFinite(available) || !Number.isFinite(perFg) || !(perFg > 0)) return 0;
  const ratio = available / perFg;
  return roundFgQty(ratio, unit, { mode: "floor" });
}

module.exports = {
  fgQtyDecimalPlaces,
  isIntegerFgUnit,
  roundFgQty,
  capFgQtyFromRmAvailability,
  normalizeUnitToken,
};
