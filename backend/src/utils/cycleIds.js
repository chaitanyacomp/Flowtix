/**
 * Valid FK to SalesOrderCycle.id — null / legacy missing / non-positive must not match an active cycle.
 * @param {unknown} v
 * @returns {number | null}
 */
function normalizePositiveCycleId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Strict positive integer for HTTP query params (avoids Prisma validation errors on floats / garbage).
 * @param {unknown} v
 * @returns {number | null}
 */
function parseStrictPositiveIntId(v) {
  if (v == null) return null;
  const raw = Array.isArray(v) ? v[0] : v;
  const s = String(raw ?? "").trim();
  if (!/^\d{1,15}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

module.exports = { normalizePositiveCycleId, parseStrictPositiveIntId };
