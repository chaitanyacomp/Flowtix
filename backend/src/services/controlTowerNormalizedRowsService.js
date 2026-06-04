/**
 * Control Tower — sample normalized operational rows (Prompt 2).
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

const DEFAULT_SAMPLE_LIMIT = 8;

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
 * Collect capped samples from dashboard queues and normalize to ControlTowerNormalizedRow.
 * @param {{ limitPerSource?: number }} [opts]
 */
async function getNormalizedOperationalRows(opts = {}) {
  const limitPerSource = Math.min(
    25,
    Math.max(1, Number(opts.limitPerSource) || DEFAULT_SAMPLE_LIMIT),
  );

  const [rmRisk, production, qa, dispatch, continueWorking] = await Promise.all([
    getRmRiskRows(),
    getProductionQueueRows(),
    getQcQueueRows(),
    getDispatchBacklogRows(),
    getContinueWorkingRows({ limit: Math.max(limitPerSource, 20) }),
  ]);

  const rows = [
    ...takeSample(rmRisk, limitPerSource).map(normalizeRmRiskRow),
    ...takeSample(production, limitPerSource).map(normalizeProductionRow),
    ...takeSample(qa, limitPerSource).map(normalizeQaRow),
    ...takeSample(dispatch, limitPerSource).map(normalizeDispatchRow),
    ...takeSample(continueWorking, limitPerSource).map(normalizeContinueWorkingRow),
  ];

  return {
    count: rows.length,
    rows,
    meta: {
      generatedAt: new Date().toISOString(),
      limitPerSource,
      sources: {
        rmRisk: { fetched: rmRisk.length, sampled: Math.min(rmRisk.length, limitPerSource) },
        production: { fetched: production.length, sampled: Math.min(production.length, limitPerSource) },
        qa: { fetched: qa.length, sampled: Math.min(qa.length, limitPerSource) },
        dispatch: { fetched: dispatch.length, sampled: Math.min(dispatch.length, limitPerSource) },
        continueWorking: {
          fetched: continueWorking.length,
          sampled: Math.min(continueWorking.length, limitPerSource),
        },
      },
      note: "Prompt 2 sample aggregator — not deduped; not role-filtered.",
    },
  };
}

module.exports = {
  getNormalizedOperationalRows,
  DEFAULT_SAMPLE_LIMIT,
};
