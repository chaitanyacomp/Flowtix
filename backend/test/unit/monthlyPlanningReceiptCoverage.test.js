const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  RECEIPT_COVERAGE_STATUSES,
  deriveReceiptCoverageStatus,
  physicalCoveragePercent,
  pendingReceiptQty,
  mapLineReceiptCoverage,
  summarizeReceiptCoverage,
  grnQtyForPoLine,
  aggregatePoAndReceivedByItem,
  enrichPurchasePlanningWithReceiptCoverage,
} = require("../../src/services/monthlyPlanningReceiptCoverageService");

describe("monthlyPlanningReceiptCoverageService", () => {
  it("deriveReceiptCoverageStatus follows P7A rules", () => {
    assert.equal(deriveReceiptCoverageStatus(100, 100), RECEIPT_COVERAGE_STATUSES.FULLY_COVERED);
    assert.equal(deriveReceiptCoverageStatus(100, 50), RECEIPT_COVERAGE_STATUSES.PARTIALLY_COVERED);
    assert.equal(deriveReceiptCoverageStatus(100, 0), RECEIPT_COVERAGE_STATUSES.NOT_RECEIVED);
    assert.equal(deriveReceiptCoverageStatus(100, 120), RECEIPT_COVERAGE_STATUSES.OVER_COVERED);
  });

  it("physicalCoveragePercent and pendingReceiptQty match example totals", () => {
    assert.ok(Math.abs(physicalCoveragePercent(341.12, 210) - 61.56) < 0.01);
    assert.equal(pendingReceiptQty(341.12, 210), 131.12);
  });

  it("mapLineReceiptCoverage matches PP row example", () => {
    const row = mapLineReceiptCoverage(
      {
        rmItemId: 1,
        currentRequirementQty: 330.87,
        previouslyReleasedQty: 330.87,
      },
      { poQty: 200, receivedQty: 200, poLineIds: new Set([1]) },
    );
    assert.equal(row.poQty, 200);
    assert.equal(row.receivedQty, 200);
    assert.equal(row.pendingReceiptQty, 130.87);
    assert.equal(row.receiptCoverageStatus, RECEIPT_COVERAGE_STATUSES.PARTIALLY_COVERED);
    assert.ok(Math.abs(row.physicalCoveragePct - 60.444) < 0.01);
  });

  it("summarizeReceiptCoverage aggregates line totals", () => {
    const lines = [
      mapLineReceiptCoverage(
        { rmItemId: 1, currentRequirementQty: 330.87, previouslyReleasedQty: 330.87 },
        { poQty: 200, receivedQty: 200, poLineIds: new Set([1]) },
      ),
      mapLineReceiptCoverage(
        { rmItemId: 2, currentRequirementQty: 10.25, previouslyReleasedQty: 10.25 },
        { poQty: 10, receivedQty: 10, poLineIds: new Set([2]) },
      ),
    ];
    const totals = summarizeReceiptCoverage(lines);
    assert.equal(totals.requirementQty, 341.12);
    assert.equal(totals.releasedQty, 341.12);
    assert.equal(totals.poQty, 210);
    assert.equal(totals.receivedQty, 210);
    assert.equal(totals.pendingReceiptQty, 131.12);
    assert.ok(Math.abs(totals.physicalCoveragePct - 61.561) < 0.01);
  });

  it("grnQtyForPoLine excludes reversed GRNs", () => {
    const qty = grnQtyForPoLine({
      grnLines: [
        { receivedQty: 200, grn: { reversedAt: null } },
        { receivedQty: 50, grn: { reversedAt: new Date() } },
      ],
    });
    assert.equal(qty, 200);
  });

  it("aggregatePoAndReceivedByItem dedupes PO lines per item", () => {
    const mrLine = {
      rmItemId: 1,
      purchaseRequestSourceLinks: [
        {
          purchaseRequestLine: {
            poLinks: [
              {
                rmPoLine: {
                  id: 10,
                  qty: 200,
                  grnLines: [{ receivedQty: 200, grn: { reversedAt: null } }],
                },
              },
            ],
          },
        },
      ],
      procurementLinks: [],
    };
    const mrLine2 = {
      rmItemId: 1,
      purchaseRequestSourceLinks: [
        {
          purchaseRequestLine: {
            poLinks: [
              {
                rmPoLine: {
                  id: 10,
                  qty: 200,
                  grnLines: [{ receivedQty: 200, grn: { reversedAt: null } }],
                },
              },
            ],
          },
        },
      ],
      procurementLinks: [],
    };
    const byItem = aggregatePoAndReceivedByItem([mrLine, mrLine2]);
    assert.equal(byItem.get(1).poQty, 200);
    assert.equal(byItem.get(1).receivedQty, 200);
  });

  it("enrichPurchasePlanningWithReceiptCoverage attaches fields without changing release fields", () => {
    const base = {
      locked: true,
      exists: true,
      planId: 5,
      lines: [
        {
          rmItemId: 1,
          rmItemName: "PP",
          currentRequirementQty: 330.87,
          previouslyReleasedQty: 330.87,
          additionalRequirementQty: 0,
          procurementStatus: "FULLY_RELEASED",
        },
      ],
    };
    const receiptCoverage = {
      totals: summarizeReceiptCoverage([
        mapLineReceiptCoverage(base.lines[0], { poQty: 200, receivedQty: 200, poLineIds: new Set([1]) }),
      ]),
      lines: [],
      byRmItemId: {
        1: mapLineReceiptCoverage(base.lines[0], { poQty: 200, receivedQty: 200, poLineIds: new Set([1]) }),
      },
    };
    const enriched = enrichPurchasePlanningWithReceiptCoverage(base, receiptCoverage);
    assert.equal(enriched.lines[0].poQty, 200);
    assert.equal(enriched.lines[0].receivedQty, 200);
    assert.equal(enriched.lines[0].additionalRequirementQty, 0);
    assert.equal(enriched.lines[0].procurementStatus, "FULLY_RELEASED");
    assert.equal(enriched.receiptCoverage.totals.physicalCoveragePct, receiptCoverage.totals.physicalCoveragePct);
  });
});
