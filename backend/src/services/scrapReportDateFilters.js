const { INVALID_MESSAGE, parseStrictIsoDateBoundUtc, parseStrictIsoDateOnly } = require("./strictIsoDate");

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
    const parsed = parseStrictIsoDateOnly(fromStr, { required: true });
    if (!parsed.ok) return { ok: false, message: INVALID_MESSAGE };
    from = parseStrictIsoDateBoundUtc(fromStr, "start");
  }
  if (toStr) {
    const parsed = parseStrictIsoDateOnly(toStr, { required: true });
    if (!parsed.ok) return { ok: false, message: INVALID_MESSAGE };
    to = parseStrictIsoDateBoundUtc(toStr, "end");
  }
  if (from && to && from.getTime() > to.getTime()) {
    return { ok: false, message: "From date must be on or before To date." };
  }
  return { ok: true, ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

module.exports = { resolveScrapReportDateFilters };
