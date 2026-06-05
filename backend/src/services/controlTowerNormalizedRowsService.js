/**
 * Control Tower — normalized operational rows (Prompt 2, 6B).
 * Read-only aggregation over existing dashboard queue services.
 */

const {
  getRmRiskRows,
  getProductionQueueRows,
  getQcQueueRows,
  getDispatchBacklogRows,
  getContinueWorkingRows,
} = require("./dashboardQueueSnapshots");
const {
  normalizeRmRiskRow,
  normalizeProductionRow,
  normalizeQaRow,
  normalizeDispatchRow,
  normalizeContinueWorkingRow,
} = require("./controlTowerRowNormalizer");
const { dedupeNormalizedRows } = require("./controlTowerRowIdentity");

const DEFAULT_SAMPLE_LIMIT = 8;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const CONTINUE_WORKING_SAMPLE_MIN = 20;
const CONTINUE_WORKING_FULL_LIMIT = 100;

const CONTROL_TOWER_ROW_MODES = Object.freeze({
  SAMPLE: "sample",
  FULL: "full",
});

/**
 * @param {unknown} value
 * @returns {"sample" | "full"}
 */
function parseControlTowerRowMode(value) {
  const token = String(value ?? "")
    .trim()
    .toLowerCase();
  if (token === CONTROL_TOWER_ROW_MODES.FULL) return CONTROL_TOWER_ROW_MODES.FULL;
  return CONTROL_TOWER_ROW_MODES.SAMPLE;
}

/**
 * @param {{ page?: unknown; pageSize?: unknown }} [opts]
 */
function parseControlTowerPagination(opts = {}) {
  const rawPage = Number(opts.page);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : DEFAULT_PAGE;

  const rawPageSize = Number(opts.pageSize);
  const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0
    ? Math.min(MAX_PAGE_SIZE, Math.floor(rawPageSize))
    : DEFAULT_PAGE_SIZE;

  return { page, pageSize };
}

/**
 * @param {unknown[]} list
 * @param {number} limit
 */
function takeSample(list, limit) {
  const n = Math.max(0, Math.floor(Number(limit) || 0));
  if (!n || !Array.isArray(list)) return [];
  return list.slice(0, n);
}

/**
 * @param {unknown[]} rows
 * @param {number} page
 * @param {number} pageSize
 */
function paginateRows(rows, page, pageSize) {
  const list = Array.isArray(rows) ? rows : [];
  const safePage = Math.max(1, Math.floor(Number(page) || DEFAULT_PAGE));
  const safePageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(Number(pageSize) || DEFAULT_PAGE_SIZE)),
  );
  const start = (safePage - 1) * safePageSize;
  if (start >= list.length) return [];
  return list.slice(start, start + safePageSize);
}

/**
 * @param {unknown[]} list
 * @param {"sample" | "full"} mode
 * @param {number} limitPerSource
 */
function selectRowsForMode(list, mode, limitPerSource) {
  if (mode === CONTROL_TOWER_ROW_MODES.FULL) {
    return Array.isArray(list) ? list : [];
  }
  return takeSample(list, limitPerSource);
}

/**
 * @param {{
 *   rmRisk?: unknown[];
 *   production?: unknown[];
 *   qa?: unknown[];
 *   dispatch?: unknown[];
 *   continueWorking?: unknown[];
 *   mode?: "sample" | "full";
 *   limitPerSource?: number;
 * }} input
 */
function mergeNormalizedRowsFromSources(input) {
  const mode = input.mode === CONTROL_TOWER_ROW_MODES.FULL
    ? CONTROL_TOWER_ROW_MODES.FULL
    : CONTROL_TOWER_ROW_MODES.SAMPLE;
  const limitPerSource = Math.min(
    25,
    Math.max(1, Number(input.limitPerSource) || DEFAULT_SAMPLE_LIMIT),
  );

  const rmRisk = selectRowsForMode(input.rmRisk, mode, limitPerSource);
  const production = selectRowsForMode(input.production, mode, limitPerSource);
  const qa = selectRowsForMode(input.qa, mode, limitPerSource);
  const dispatch = selectRowsForMode(input.dispatch, mode, limitPerSource);
  const continueWorking = selectRowsForMode(input.continueWorking, mode, limitPerSource);

  const merged = [
    ...rmRisk.map(normalizeRmRiskRow),
    ...production.map(normalizeProductionRow),
    ...qa.map(normalizeQaRow),
    ...dispatch.map(normalizeDispatchRow),
    ...continueWorking.map(normalizeContinueWorkingRow),
  ];

  const rows = dedupeNormalizedRows(merged);

  return {
    rows,
    merged,
    limitPerSource,
    mode,
    sources: {
      rmRisk: {
        fetched: (input.rmRisk || []).length,
        selected: rmRisk.length,
      },
      production: {
        fetched: (input.production || []).length,
        selected: production.length,
      },
      qa: {
        fetched: (input.qa || []).length,
        selected: qa.length,
      },
      dispatch: {
        fetched: (input.dispatch || []).length,
        selected: dispatch.length,
      },
      continueWorking: {
        fetched: (input.continueWorking || []).length,
        selected: continueWorking.length,
      },
    },
  };
}

/**
 * Fetch dashboard queue sources, normalize, and dedupe (no pagination).
 * @param {{ mode?: "sample" | "full"; limitPerSource?: number }} [opts]
 */
async function fetchNormalizedDedupedRows(opts = {}) {
  const mode = parseControlTowerRowMode(opts.mode);
  const limitPerSource = Math.min(
    25,
    Math.max(1, Number(opts.limitPerSource) || DEFAULT_SAMPLE_LIMIT),
  );

  const continueWorkingLimit =
    mode === CONTROL_TOWER_ROW_MODES.FULL
      ? CONTINUE_WORKING_FULL_LIMIT
      : Math.max(limitPerSource, CONTINUE_WORKING_SAMPLE_MIN);

  const [rmRisk, production, qa, dispatch, continueWorking] = await Promise.all([
    getRmRiskRows(),
    getProductionQueueRows(),
    getQcQueueRows(),
    getDispatchBacklogRows(),
    getContinueWorkingRows({ limit: continueWorkingLimit }),
  ]);

  const built = mergeNormalizedRowsFromSources({
    rmRisk,
    production,
    qa,
    dispatch,
    continueWorking,
    mode,
    limitPerSource,
  });

  return {
    rows: built.rows,
    meta: {
      generatedAt: new Date().toISOString(),
      mode,
      sampled: mode === CONTROL_TOWER_ROW_MODES.SAMPLE,
      limitPerSource: mode === CONTROL_TOWER_ROW_MODES.SAMPLE ? limitPerSource : null,
      rowCountBeforeDedupe: built.merged.length,
      rowCountAfterDedupe: built.rows.length,
      sources: built.sources,
      note: "Rows deduped by rowKey; highest sourcePriority wins. Pagination applied after dedupe.",
    },
  };
}

/**
 * Collect normalized operational rows with optional pagination (Prompt 6B).
 * @param {{
 *   mode?: "sample" | "full";
 *   limitPerSource?: number;
 *   page?: number;
 *   pageSize?: number;
 * }} [opts]
 */
async function getNormalizedOperationalRows(opts = {}) {
  const { page, pageSize } = parseControlTowerPagination(opts);
  const { rows: dedupedRows, meta: baseMeta } = await fetchNormalizedDedupedRows(opts);
  const totalRows = dedupedRows.length;
  const rows = paginateRows(dedupedRows, page, pageSize);

  return {
    count: rows.length,
    rows,
    meta: {
      ...baseMeta,
      totalRows,
      page,
      pageSize,
    },
  };
}

module.exports = {
  CONTROL_TOWER_ROW_MODES,
  DEFAULT_SAMPLE_LIMIT,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  parseControlTowerRowMode,
  parseControlTowerPagination,
  takeSample,
  paginateRows,
  selectRowsForMode,
  mergeNormalizedRowsFromSources,
  fetchNormalizedDedupedRows,
  getNormalizedOperationalRows,
};
