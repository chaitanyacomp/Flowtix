/**
 * P7A — Purchase Planning physical receipt coverage (read-only).
 * Traces MONTHLY_PLAN MR → PO → GRN for one plan without mutating planning/procurement logic.
 */

const { prisma } = require("../utils/prisma");
const { QUEUE_EPS, qtyToNumber } = require("./rmPurchaseHelpers");
const { round3 } = require("./bomExplosionService");

const RECEIPT_COVERAGE_STATUSES = Object.freeze({
  FULLY_COVERED: "FULLY_COVERED",
  PARTIALLY_COVERED: "PARTIALLY_COVERED",
  NOT_RECEIVED: "NOT_RECEIVED",
  OVER_COVERED: "OVER_COVERED",
});

const RECEIPT_COVERAGE_STATUS_LABELS = Object.freeze({
  FULLY_COVERED: "Fully Covered",
  PARTIALLY_COVERED: "Partially Covered",
  NOT_RECEIVED: "Not Received",
  OVER_COVERED: "Over Covered",
});

function n(v) {
  return round3(qtyToNumber(v));
}

function grnQtyForPoLine(rmPoLine) {
  let sum = 0;
  for (const gl of rmPoLine?.grnLines || []) {
    if (gl.grn?.reversedAt) continue;
    sum += qtyToNumber(gl.receivedQty);
  }
  return round3(sum);
}

function collectPoTouchesFromMrLine(mrLine) {
  const touches = [];
  for (const sl of mrLine.purchaseRequestSourceLinks || []) {
    const prLine = sl.purchaseRequestLine;
    for (const link of prLine?.poLinks || []) {
      if (!link.rmPoLine) continue;
      touches.push({ rmPoLine: link.rmPoLine });
    }
  }
  for (const link of mrLine.procurementLinks || []) {
    if (!link.rmPoLine) continue;
    touches.push({ rmPoLine: link.rmPoLine });
  }
  return touches;
}

function aggregatePoAndReceivedByItem(mrLines) {
  /** @type {Map<number, { poQty: number; receivedQty: number; poLineIds: Set<number> }>} */
  const byItem = new Map();

  for (const mrLine of mrLines) {
    const rmItemId = mrLine.rmItemId;
    let agg = byItem.get(rmItemId);
    if (!agg) {
      agg = { poQty: 0, receivedQty: 0, poLineIds: new Set() };
      byItem.set(rmItemId, agg);
    }

    for (const touch of collectPoTouchesFromMrLine(mrLine)) {
      const poLineId = touch.rmPoLine.id;
      if (agg.poLineIds.has(poLineId)) continue;
      agg.poLineIds.add(poLineId);
      agg.poQty = round3(agg.poQty + n(touch.rmPoLine.qty));
      agg.receivedQty = round3(agg.receivedQty + grnQtyForPoLine(touch.rmPoLine));
    }
  }

  return byItem;
}

function physicalCoveragePercent(requirementQty, receivedQty) {
  if (requirementQty <= QUEUE_EPS) return null;
  return round3((receivedQty / requirementQty) * 100);
}

function pendingReceiptQty(requirementQty, receivedQty) {
  return round3(requirementQty - receivedQty);
}

function deriveReceiptCoverageStatus(requirementQty, receivedQty) {
  if (receivedQty <= QUEUE_EPS) return RECEIPT_COVERAGE_STATUSES.NOT_RECEIVED;
  if (receivedQty > requirementQty + QUEUE_EPS) return RECEIPT_COVERAGE_STATUSES.OVER_COVERED;
  if (receivedQty + QUEUE_EPS >= requirementQty) return RECEIPT_COVERAGE_STATUSES.FULLY_COVERED;
  return RECEIPT_COVERAGE_STATUSES.PARTIALLY_COVERED;
}

function readRequirementQty(line) {
  return n(line.currentRequirementQty ?? line.netRequirementQty ?? 0);
}

function readReleasedQty(line) {
  return n(line.previouslyReleasedQty ?? line.alreadyRequisitionedQty ?? 0);
}

function mapLineReceiptCoverage(purchaseLine, receiptAgg) {
  const requirementQty = readRequirementQty(purchaseLine);
  const releasedQty = readReleasedQty(purchaseLine);
  const poQty = receiptAgg?.poQty ?? 0;
  const receivedQty = receiptAgg?.receivedQty ?? 0;
  const pendingQty = pendingReceiptQty(requirementQty, receivedQty);
  const physicalCoveragePct = physicalCoveragePercent(requirementQty, receivedQty);
  const receiptCoverageStatus = deriveReceiptCoverageStatus(requirementQty, receivedQty);

  return {
    rmItemId: purchaseLine.rmItemId,
    requirementQty,
    releasedQty,
    poQty,
    receivedQty,
    pendingReceiptQty: pendingQty,
    physicalCoveragePct,
    receiptCoverageStatus,
    receiptCoverageStatusLabel: RECEIPT_COVERAGE_STATUS_LABELS[receiptCoverageStatus],
  };
}

function summarizeReceiptCoverage(lineCoverages) {
  const totals = {
    requirementQty: 0,
    releasedQty: 0,
    poQty: 0,
    receivedQty: 0,
    pendingReceiptQty: 0,
    physicalCoveragePct: null,
  };

  for (const line of lineCoverages) {
    totals.requirementQty = round3(totals.requirementQty + line.requirementQty);
    totals.releasedQty = round3(totals.releasedQty + line.releasedQty);
    totals.poQty = round3(totals.poQty + line.poQty);
    totals.receivedQty = round3(totals.receivedQty + line.receivedQty);
    totals.pendingReceiptQty = round3(totals.pendingReceiptQty + line.pendingReceiptQty);
  }

  totals.physicalCoveragePct = physicalCoveragePercent(totals.requirementQty, totals.receivedQty);
  return totals;
}

const MR_LINE_INCLUDE = {
  purchaseRequestSourceLinks: {
    include: {
      purchaseRequestLine: {
        include: {
          poLinks: {
            include: {
              rmPoLine: {
                include: {
                  grnLines: { include: { grn: { select: { reversedAt: true } } } },
                },
              },
            },
          },
        },
      },
    },
  },
  procurementLinks: {
    include: {
      rmPoLine: {
        include: {
          grnLines: { include: { grn: { select: { reversedAt: true } } } },
        },
      },
    },
  },
};

/**
 * Read-only receipt coverage for Purchase Planning (one monthly plan).
 * @param {{ db?: object; planId: number; lines?: object[] }} params
 */
async function buildPurchasePlanningReceiptCoverage({ db = prisma, planId, lines = [] } = {}) {
  const id = Number(planId);
  if (!Number.isFinite(id) || id <= 0) {
    return { totals: summarizeReceiptCoverage([]), lines: [], byRmItemId: {} };
  }

  const mrLines = await db.materialRequirementLine.findMany({
    where: {
      materialRequirement: {
        monthlyProductionPlanId: id,
        sourceType: "MONTHLY_PLAN",
        reversedAt: null,
      },
    },
    include: MR_LINE_INCLUDE,
  });

  const receiptByItem = aggregatePoAndReceivedByItem(mrLines);
  const lineCoverages = (lines || []).map((purchaseLine) =>
    mapLineReceiptCoverage(purchaseLine, receiptByItem.get(purchaseLine.rmItemId)),
  );

  const byRmItemId = Object.fromEntries(lineCoverages.map((l) => [l.rmItemId, l]));
  const totals = summarizeReceiptCoverage(lineCoverages);

  return {
    totals,
    lines: lineCoverages,
    byRmItemId,
  };
}

/**
 * Attach receipt coverage fields to purchase-planning lines (read-only enrichment).
 * @param {object} purchasePlanningResponse
 * @param {Awaited<ReturnType<typeof buildPurchasePlanningReceiptCoverage>>} receiptCoverage
 */
function enrichPurchasePlanningWithReceiptCoverage(purchasePlanningResponse, receiptCoverage) {
  if (!purchasePlanningResponse?.lines?.length || !receiptCoverage) {
    return purchasePlanningResponse;
  }

  const byItem = receiptCoverage.byRmItemId ?? {};
  const enrichedLines = purchasePlanningResponse.lines.map((line) => {
    const rc = byItem[line.rmItemId];
    if (!rc) return line;
    return {
      ...line,
      poQty: rc.poQty,
      receivedQty: rc.receivedQty,
      pendingReceiptQty: rc.pendingReceiptQty,
      physicalCoveragePct: rc.physicalCoveragePct,
      receiptCoverageStatus: rc.receiptCoverageStatus,
      receiptCoverageStatusLabel: rc.receiptCoverageStatusLabel,
    };
  });

  return {
    ...purchasePlanningResponse,
    lines: enrichedLines,
    receiptCoverage: {
      totals: receiptCoverage.totals,
    },
  };
}

module.exports = {
  RECEIPT_COVERAGE_STATUSES,
  RECEIPT_COVERAGE_STATUS_LABELS,
  grnQtyForPoLine,
  aggregatePoAndReceivedByItem,
  physicalCoveragePercent,
  pendingReceiptQty,
  deriveReceiptCoverageStatus,
  mapLineReceiptCoverage,
  summarizeReceiptCoverage,
  buildPurchasePlanningReceiptCoverage,
  enrichPurchasePlanningWithReceiptCoverage,
};
