/**
 * P11 — FG Green Level planning settings (singleton AppSetting).
 */

const ALLOWED_GREEN_LEVEL_HISTORY_MONTHS = Object.freeze([3, 6, 12]);
const DEFAULT_GREEN_LEVEL_HISTORY_MONTHS = 6;

const GREEN_LEVEL_SOURCE_MANUAL = "MANUAL";
const GREEN_LEVEL_SOURCE_AUTOMATIC = "AUTOMATIC";
const ALLOWED_GREEN_LEVEL_SOURCES = Object.freeze([
  GREEN_LEVEL_SOURCE_MANUAL,
  GREEN_LEVEL_SOURCE_AUTOMATIC,
]);
/** Go-live default: client enters FG Green Level manually from Excel. */
const DEFAULT_GREEN_LEVEL_SOURCE = GREEN_LEVEL_SOURCE_MANUAL;

/**
 * @param {unknown} raw
 * @returns {number}
 */
function clampGreenLevelHistoryMonths(raw) {
  const n = Number(raw);
  if (ALLOWED_GREEN_LEVEL_HISTORY_MONTHS.includes(n)) return n;
  return DEFAULT_GREEN_LEVEL_HISTORY_MONTHS;
}

/**
 * @param {unknown} raw
 * @returns {"MANUAL"|"AUTOMATIC"}
 */
function normalizeGreenLevelSource(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === GREEN_LEVEL_SOURCE_AUTOMATIC) return GREEN_LEVEL_SOURCE_AUTOMATIC;
  return GREEN_LEVEL_SOURCE_MANUAL;
}

/**
 * @param {{
 *   greenLevelSource: string;
 *   manualGreenLevelQty?: unknown;
 *   autoSuggestedBaseQty?: unknown;
 * }} args
 * @returns {number}
 */
function resolveActiveGreenBaseQty({ greenLevelSource, manualGreenLevelQty, autoSuggestedBaseQty }) {
  const manual = Number(manualGreenLevelQty);
  const auto = Number(autoSuggestedBaseQty);
  const manualQty = Number.isFinite(manual) && manual > 0 ? Math.round(manual * 1000) / 1000 : 0;
  const autoQty = Number.isFinite(auto) && auto > 0 ? Math.round(auto * 1000) / 1000 : 0;
  if (normalizeGreenLevelSource(greenLevelSource) === GREEN_LEVEL_SOURCE_MANUAL) return manualQty;
  return autoQty;
}

module.exports = {
  ALLOWED_GREEN_LEVEL_HISTORY_MONTHS,
  DEFAULT_GREEN_LEVEL_HISTORY_MONTHS,
  GREEN_LEVEL_SOURCE_MANUAL,
  GREEN_LEVEL_SOURCE_AUTOMATIC,
  ALLOWED_GREEN_LEVEL_SOURCES,
  DEFAULT_GREEN_LEVEL_SOURCE,
  clampGreenLevelHistoryMonths,
  normalizeGreenLevelSource,
  resolveActiveGreenBaseQty,
};
