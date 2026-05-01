/**
 * Planning zone from gap % vs red/yellow boundaries.
 *
 * Gap % = shortage as percent of requirement: ((requirement − stock) / requirement) × 100
 * (when stock covers requirement, gap is 0%; negative gap ⇒ excess stock).
 *
 * **Single rule (order-wise and product-wise):**
 * - if gapPercent >= redBoundaryPercent  ⇒ RED
 * - else if gapPercent >= yellowBoundaryPercent ⇒ YELLOW
 * - else ⇒ GREEN
 * - if gapPercent < 0 ⇒ EXCESS (stock above requirement for this line’s basis)
 *
 * DB legacy columns on Item (`planningGapGreenThresholdPercent` / `planningGapYellowThresholdPercent`) are
 * **misnamed**: the “green” column holds the **red** boundary (minimum gap% for red). They are mapped at
 * the edge into `redBoundaryPercent` / `yellowBoundaryPercent` before any logic runs.
 */

/** Defaults for order-wise / requirement-sheet views when Item fields are null. */
const DEFAULT_ORDER_WISE_RED_BOUNDARY_PCT = 50;
const DEFAULT_ORDER_WISE_YELLOW_BOUNDARY_PCT = 30;

/** Defaults for product-wise view when resolved thresholds are null. */
const DEFAULT_RED_THRESHOLD_PCT = 10;
const DEFAULT_YELLOW_THRESHOLD_PCT = 5;

/**
 * Safe number for Prisma Decimal, strings, or JSON.
 * @param {unknown} v
 * @returns {number}
 */
function toFiniteNumber(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "object" && v != null && typeof /** @type {{ toNumber?: () => number }} */ (v).toNumber === "function") {
    try {
      const x = /** @type {{ toNumber: () => number }} */ (v).toNumber();
      return Number.isFinite(x) ? x : NaN;
    } catch {
      return NaN;
    }
  }
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
}

function pickBoundary(unknown, fallback) {
  const x = toFiniteNumber(unknown);
  return Number.isFinite(x) && x > 0 ? x : fallback;
}

/**
 * @param {number | null | undefined} gapPercent
 * @param {number} redBoundaryPercent  resolved numeric boundary (includes defaults)
 * @param {number} yellowBoundaryPercent resolved; must be <= redBoundaryPercent for stable bands
 * @returns {"RED"|"YELLOW"|"GREEN"|"EXCESS"}
 */
function classifyPlanningZone(gapPercent, redBoundaryPercent, yellowBoundaryPercent) {
  if (gapPercent == null || !Number.isFinite(gapPercent)) return "GREEN";
  if (gapPercent < 0) return "EXCESS";
  const red = redBoundaryPercent;
  let yellow = yellowBoundaryPercent;
  if (yellow > red) yellow = red;
  if (gapPercent >= red) return "RED";
  if (gapPercent >= yellow) return "YELLOW";
  return "GREEN";
}

/**
 * Maps legacy Item DB columns into red/yellow boundary percents (order-wise / requirement sheets).
 * `planningGapGreenThresholdPercent` is the **red** boundary despite the name.
 *
 * @param {unknown} planningGapGreenThresholdPercent
 * @param {unknown} planningGapYellowThresholdPercent
 * @returns {{ redBoundaryPercent: number; yellowBoundaryPercent: number }}
 */
function resolveOrderWiseBoundariesFromLegacyDbFields(
  planningGapGreenThresholdPercent,
  planningGapYellowThresholdPercent,
) {
  let redBoundaryPercent = pickBoundary(planningGapGreenThresholdPercent, DEFAULT_ORDER_WISE_RED_BOUNDARY_PCT);
  let yellowBoundaryPercent = pickBoundary(planningGapYellowThresholdPercent, DEFAULT_ORDER_WISE_YELLOW_BOUNDARY_PCT);
  if (yellowBoundaryPercent > redBoundaryPercent) yellowBoundaryPercent = redBoundaryPercent;
  return { redBoundaryPercent, yellowBoundaryPercent };
}

/**
 * @typedef {{
 *   redThresholdPercent?: unknown;
 *   yellowThresholdPercent?: unknown;
 *   legacyPlanningGapRedBoundaryPercent?: unknown;
 *   legacyPlanningGapYellowBoundaryPercent?: unknown;
 * } | null | undefined} ProductWiseItemMeta
 */

/**
 * Prefer explicit red/yellow thresholds; else legacy gap columns; defaults applied when still unset.
 *
 * @param {ProductWiseItemMeta} meta
 * @returns {{ redBoundaryPercent: number; yellowBoundaryPercent: number }}
 */
function resolveProductWiseBoundariesFromItem(meta) {
  const redRaw = (() => {
    const a = toFiniteNumber(meta?.redThresholdPercent);
    if (Number.isFinite(a) && a > 0) return a;
    const b = toFiniteNumber(meta?.legacyPlanningGapRedBoundaryPercent);
    if (Number.isFinite(b) && b > 0) return b;
    return null;
  })();
  const yellowRaw = (() => {
    const a = toFiniteNumber(meta?.yellowThresholdPercent);
    if (Number.isFinite(a) && a > 0) return a;
    const b = toFiniteNumber(meta?.legacyPlanningGapYellowBoundaryPercent);
    if (Number.isFinite(b) && b > 0) return b;
    return null;
  })();

  let redBoundaryPercent = pickBoundary(redRaw, DEFAULT_RED_THRESHOLD_PCT);
  let yellowBoundaryPercent = pickBoundary(yellowRaw, DEFAULT_YELLOW_THRESHOLD_PCT);
  if (yellowBoundaryPercent > redBoundaryPercent) yellowBoundaryPercent = redBoundaryPercent;
  return { redBoundaryPercent, yellowBoundaryPercent };
}

/**
 * Order-wise entry: legacy DB field names on Item.
 *
 * FUTURE CLEANUP (tracked work): migrate callers off `computeZone(gap, planningGapGreen…, planningGapYellow…)` —
 * prefer `resolveOrderWiseBoundariesFromLegacyDbFields` + `classifyPlanningZone(gap, redBoundaryPercent, yellowBoundaryPercent)`
 * at call sites so only normalized names appear in business code; keep a thin adapter if Prisma field names must stay.
 *
 * @param {number | null | undefined} gapPercent
 * @param {unknown} planningGapGreenThresholdPercent
 * @param {unknown} planningGapYellowThresholdPercent
 */
function computeZone(gapPercent, planningGapGreenThresholdPercent, planningGapYellowThresholdPercent) {
  const { redBoundaryPercent, yellowBoundaryPercent } = resolveOrderWiseBoundariesFromLegacyDbFields(
    planningGapGreenThresholdPercent,
    planningGapYellowThresholdPercent,
  );
  return classifyPlanningZone(gapPercent, redBoundaryPercent, yellowBoundaryPercent);
}

/**
 * Product-wise when raw resolved reds/yellows are already chosen (tests, advanced use).
 * @param {number | null | undefined} gapPct
 * @param {unknown} redBoundaryRaw
 * @param {unknown} yellowBoundaryRaw
 */
function computeZoneItemWise(gapPct, redBoundaryRaw, yellowBoundaryRaw) {
  const redBoundaryPercent = pickBoundary(redBoundaryRaw, DEFAULT_RED_THRESHOLD_PCT);
  let yellowBoundaryPercent = pickBoundary(yellowBoundaryRaw, DEFAULT_YELLOW_THRESHOLD_PCT);
  if (yellowBoundaryPercent > redBoundaryPercent) yellowBoundaryPercent = redBoundaryPercent;
  return classifyPlanningZone(gapPct, redBoundaryPercent, yellowBoundaryPercent);
}

module.exports = {
  DEFAULT_RED_THRESHOLD_PCT,
  DEFAULT_YELLOW_THRESHOLD_PCT,
  DEFAULT_ORDER_WISE_RED_BOUNDARY_PCT,
  DEFAULT_ORDER_WISE_YELLOW_BOUNDARY_PCT,
  toFiniteNumber,
  classifyPlanningZone,
  resolveOrderWiseBoundariesFromLegacyDbFields,
  resolveProductWiseBoundariesFromItem,
  computeZone,
  computeZoneItemWise,
  pickBoundary,
};
