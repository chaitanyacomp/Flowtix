/**
 * Control Tower board read-model (Prompt 5, 6B).
 * Groups normalized, deduped rows into approved operational board swimlanes.
 */

const {
  CONTROL_TOWER_ROW_MODES,
  fetchNormalizedDedupedRows,
  parseControlTowerRowMode,
  parseControlTowerPagination,
  paginateRows,
} = require("./controlTowerNormalizedRowsService");
const { groupControlTowerRows } = require("./controlTowerBoardGroups");

/**
 * @param {{ mode?: string | null | undefined }} [options]
 * @returns {"sample" | "full"}
 */
function resolveBoardReadMode(options = {}) {
  if (options.mode != null && String(options.mode).trim() !== "") {
    return parseControlTowerRowMode(options.mode);
  }
  return CONTROL_TOWER_ROW_MODES.FULL;
}

/**
 * @param {object[]} groups
 * @param {object[]} ungrouped
 * @param {Set<string>} pageRowKeys
 */
function applyBoardRowPageFilter(groups, ungrouped, pageRowKeys) {
  return {
    groups: groups.map((group) => ({
      ...group,
      rows: group.rows.filter((row) => pageRowKeys.has(row.rowKey)),
    })),
    ungrouped: ungrouped.filter((row) => pageRowKeys.has(row.rowKey)),
  };
}

/**
 * @param {{
 *   mode?: "sample" | "full";
 *   limitPerSource?: number;
 *   page?: number;
 *   pageSize?: number;
 * }} [options]
 */
async function getControlTowerBoardRows(options = {}) {
  const mode = resolveBoardReadMode(options);
  const { page, pageSize } = parseControlTowerPagination(options);

  const { rows: dedupedRows, meta: pipelineMeta } = await fetchNormalizedDedupedRows({
    ...options,
    mode,
  });

  const { groups, ungrouped } = groupControlTowerRows(dedupedRows);
  const pageRows = paginateRows(dedupedRows, page, pageSize);
  const pageRowKeys = new Set(pageRows.map((r) => r.rowKey));

  const { groups: pagedGroups, ungrouped: pagedUngrouped } = applyBoardRowPageFilter(
    groups,
    ungrouped,
    pageRowKeys,
  );

  const groupedCount = groups.reduce((sum, g) => sum + g.count, 0);

  return {
    groups: pagedGroups,
    ungrouped: pagedUngrouped,
    meta: {
      rowCount: pageRows.length,
      groupedCount,
      ungroupedCount: ungrouped.length,
      generatedAt: new Date().toISOString(),
      source: "normalized_deduped_rows",
      mode: pipelineMeta.mode,
      sampled: pipelineMeta.sampled,
      rowCountBeforeDedupe: pipelineMeta.rowCountBeforeDedupe,
      rowCountAfterDedupe: pipelineMeta.rowCountAfterDedupe,
      totalRows: dedupedRows.length,
      page,
      pageSize,
    },
  };
}

module.exports = {
  resolveBoardReadMode,
  applyBoardRowPageFilter,
  getControlTowerBoardRows,
};
