const { parseDateStart, parseDateEnd } = require("./soDispatchTraceReport");

/**
 * Resolve Scrap Report From/To query params.
 * Blank → omit (no date filter). Invalid → { ok:false }. From>To → { ok:false }.
 * Never returns Invalid Date objects.
 *
 * @param {string | undefined | null} fromRaw
 * @param {string | undefined | null} toRaw
 * @returns {{ ok: true, from?: Date, to?: Date } | { ok: false, message: string }}
 */
function resolveScrapReportDateFilters(fromRaw, toRaw) {
  const fromStr = fromRaw != null ? String(fromRaw).trim() : "";
  const toStr = toRaw != null ? String(toRaw).trim() : "";

  let from;
  let to;
  if (fromStr) {
    from = parseDateStart(fromStr);
    if (!from) return { ok: false, message: "Invalid from date; use YYYY-MM-DD." };
  }
  if (toStr) {
    to = parseDateEnd(toStr);
    if (!to) return { ok: false, message: "Invalid to date; use YYYY-MM-DD." };
  }
  if (from && to && from.getTime() > to.getTime()) {
    return { ok: false, message: "From date must be on or before To date." };
  }
  return { ok: true, ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

module.exports = { resolveScrapReportDateFilters };
