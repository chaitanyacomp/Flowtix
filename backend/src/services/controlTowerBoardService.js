/**
 * Control Tower board read-model (Prompt 5).
 * Groups normalized, deduped rows into approved operational board swimlanes.
 */

const { getNormalizedOperationalRows } = require("./controlTowerNormalizedRowsService");
const { groupControlTowerRows } = require("./controlTowerBoardGroups");

/**
 * @param {{ limitPerSource?: number }} [options]
 */
async function getControlTowerBoardRows(options = {}) {
  const payload = await getNormalizedOperationalRows(options);
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const { groups, ungrouped } = groupControlTowerRows(rows);

  const groupedCount = groups.reduce((sum, g) => sum + g.count, 0);

  return {
    groups,
    ungrouped,
    meta: {
      rowCount: rows.length,
      groupedCount,
      ungroupedCount: ungrouped.length,
      generatedAt: new Date().toISOString(),
      source: "normalized_deduped_rows",
    },
  };
}

module.exports = {
  getControlTowerBoardRows,
};
