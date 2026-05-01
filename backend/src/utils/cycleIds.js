/**
 * Valid FK to SalesOrderCycle.id — null / legacy missing / non-positive must not match an active cycle.
 * @param {unknown} v
 * @returns {number | null}
 */
function normalizePositiveCycleId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

module.exports = { normalizePositiveCycleId };
