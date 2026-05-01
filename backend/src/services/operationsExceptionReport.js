/**
 * Operations exception classification (same rules formerly implemented in the SPA).
 * All shares, ages, and severity tiers are computed here so the frontend only filters/displays.
 */

const {
  getDispatchBacklogRows,
  getProductionQueueRows,
  getQcQueueRows,
  getRmRiskRows,
  getPurchaseSummaryRows,
} = require("./dashboardQueueSnapshots");
const { METRIC_DEFINITIONS } = require("./reportMetrics");
const {
  buildDispatchExceptions,
  buildProductionExceptions,
  buildQcExceptions,
  buildRmExceptions,
  buildPurchaseExceptions,
  buildExceptionSummary,
} = require("./operationsExceptionClassification");

async function buildOperationsExceptionReportPayload() {
  const refTimeMs = Date.now();
  const [dispatchRaw, productionRaw, qcRaw, rmRaw, purchaseRaw] = await Promise.all([
    getDispatchBacklogRows(),
    getProductionQueueRows(),
    getQcQueueRows(),
    getRmRiskRows(),
    getPurchaseSummaryRows(),
  ]);

  const dispatch = buildDispatchExceptions(dispatchRaw, refTimeMs);
  const production = buildProductionExceptions(productionRaw, refTimeMs);
  const qc = buildQcExceptions(qcRaw);
  const rm = buildRmExceptions(rmRaw);
  const purchase = buildPurchaseExceptions(purchaseRaw, refTimeMs);

  return {
    metricDefinitions: METRIC_DEFINITIONS,
    metricContextLegend: {
      SO_FIFO: "Sales-order-line FIFO dispatch attribution",
      SO_ITEM_TOTAL: "Total ordered qty for an FG across all lines on the sales order",
      WO_FIFO: "Work-order-line FIFO dispatch attribution (tracking report only)",
      QC_POOL: "QC accepted vs net dispatch at SO + FG item (shared pool)",
      QC_BATCH: "Per production batch QC pending / reject",
      WO_LINE: "Work order line production balance",
      RM_PO_LINE: "RM purchase order line receive gap",
      RM_PLANNING: "RM need from open WO BOM cover",
      DISPATCH_LEDGER: "Dispatch ledger reversal capacity per forward row",
      DISPATCHABLE_MIN: "min(SO-line remainder, stock, QC pool) on dispatch screen",
    },
    dispatch,
    production,
    qc,
    rm,
    purchase,
    summary: buildExceptionSummary({ dispatch, production, qc, rm, purchase }),
  };
}

module.exports = {
  buildOperationsExceptionReportPayload,
};
