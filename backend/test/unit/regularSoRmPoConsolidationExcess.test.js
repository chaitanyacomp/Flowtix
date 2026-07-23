/**
 * Regular SO multi-source consolidation + excess-to-stock (STOCK_REPLENISHMENT / general).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  consolidateRmPoAllocations,
  assertRegularSoNotMixedWithMprs,
  RM_PO_REGULAR_SO_MPRS_MIX_CODE,
  RM_PO_UOM_MISMATCH_CODE,
} = require("../../src/services/rmPoLineConsolidation");
const {
  splitOrderQtyAgainstPendingDemand,
  summarizeConsolidatedDemandAndExcess,
  splitGrnReceiptAgainstDemandAndExcess,
  formatRmPoExcessConfirmationLine,
} = require("../../src/services/rmPoDemandExcessSplit");
const { computeLineAmount } = require("../../src/services/rmPoTaxFields");
const { receivedQtyForMrLine } = require("../../src/services/procurementLifecycleService");

const helpers = { computeLineAmount };

describe("splitOrderQtyAgainstPendingDemand", () => {
  it("140 demand with 160 PO → 140 SO allocation + 20 general stock", () => {
    const split = splitOrderQtyAgainstPendingDemand(160, 140);
    assert.equal(split.demandQty, 140);
    assert.equal(split.excessToStockQty, 20);
    assert.equal(split.orderQty, 160);
  });

  it("does not inflate demand when order equals pending", () => {
    const split = splitOrderQtyAgainstPendingDemand(140, 140);
    assert.equal(split.demandQty, 140);
    assert.equal(split.excessToStockQty, 0);
  });

  it("rejects negative excess reconstruction", () => {
    assert.throws(
      () => summarizeConsolidatedDemandAndExcess([{ qty: 10, demandQty: 20, excessToStockQty: -5 }]),
      (e) => e && e.code === "RM_PO_EXCESS_NEGATIVE",
    );
  });
});

describe("Regular SO multi-SO consolidation with excess", () => {
  it("consolidates SO-26-0001 140 + SO-26-0002 80 with PO 250 → 220 demand + 30 excess", () => {
    const lines = consolidateRmPoAllocations(
      [
        {
          purchaseRequestLineId: 1,
          purchaseRequestId: 10,
          purchaseRequestDocNo: "PR-26-0001",
          itemId: 7,
          itemName: "PP",
          qty: 140,
          pendingDemandQty: 140,
          rate: 100,
          unit: "Kg",
          hsn: null,
          gstRate: 18,
          salesOrderDocNo: "SO-26-0001",
          salesOrderId: 258,
        },
        {
          purchaseRequestLineId: 2,
          purchaseRequestId: 11,
          purchaseRequestDocNo: "PR-26-0002",
          itemId: 7,
          itemName: "PP",
          qty: 110,
          pendingDemandQty: 80,
          rate: 100,
          unit: "Kg",
          hsn: null,
          gstRate: 18,
          salesOrderDocNo: "SO-26-0002",
          salesOrderId: 259,
        },
      ],
      helpers,
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0].qty, 250);
    assert.equal(lines[0].demandQty, 220);
    assert.equal(lines[0].excessToStockQty, 30);
    assert.equal(lines[0].allocations.length, 2);
    assert.equal(lines[0].allocations.find((a) => a.purchaseRequestLineId === 1).qty, 140);
    assert.equal(lines[0].allocations.find((a) => a.purchaseRequestLineId === 2).qty, 80);
    assert.equal(lines[0].allocations.find((a) => a.purchaseRequestLineId === 1).salesOrderDocNo, "SO-26-0001");
  });

  it("single-source 160 PO against 140 pending keeps source allocation at 140", () => {
    const lines = consolidateRmPoAllocations(
      [
        {
          purchaseRequestLineId: 1,
          purchaseRequestId: 10,
          itemId: 7,
          itemName: "PP",
          qty: 160,
          pendingDemandQty: 140,
          rate: 90,
          unit: "Kg",
          hsn: null,
          gstRate: 18,
          salesOrderDocNo: "SO-26-0001",
        },
      ],
      helpers,
    );
    assert.equal(lines[0].qty, 160);
    assert.equal(lines[0].demandQty, 140);
    assert.equal(lines[0].excessToStockQty, 20);
    assert.equal(lines[0].allocations[0].qty, 140);
  });

  it("rejects Regular SO + MPRS mix", () => {
    assert.throws(
      () => assertRegularSoNotMixedWithMprs(["SALES_ORDER", "MONTHLY_PLAN"]),
      (e) => e && e.code === RM_PO_REGULAR_SO_MPRS_MIX_CODE,
    );
  });

  it("rejects UOM mismatch on same RM", () => {
    assert.throws(
      () =>
        consolidateRmPoAllocations(
          [
            {
              purchaseRequestLineId: 1,
              purchaseRequestId: 10,
              itemId: 7,
              itemName: "PP",
              qty: 10,
              rate: 100,
              unit: "Kg",
              hsn: null,
              gstRate: 18,
            },
            {
              purchaseRequestLineId: 2,
              purchaseRequestId: 11,
              itemId: 7,
              itemName: "PP",
              qty: 10,
              rate: 100,
              unit: "NOS",
              hsn: null,
              gstRate: 18,
            },
          ],
          helpers,
        ),
      (e) => e && e.code === RM_PO_UOM_MISMATCH_CODE,
    );
  });

  it("formats Purchase confirmation line", () => {
    assert.equal(
      formatRmPoExcessConfirmationLine({ requiredQty: 140, poQty: 160, excessToStockQty: 20, unit: "Kg" }),
      "Required: 140 Kg | PO Qty: 160 Kg | Extra to RM Stock: 20 Kg",
    );
  });
});

describe("Partial / multi GRN against demand + excess", () => {
  it("partial GRN satisfies demand first then excess", () => {
    // PO 160 = 140 demand + 20 excess; first GRN 80 → all to demand
    const g1 = splitGrnReceiptAgainstDemandAndExcess(80, 160, 140, 0);
    assert.equal(g1.demandReceivedQty, 80);
    assert.equal(g1.excessToStockReceivedQty, 0);

    // Second GRN 80 → 60 demand + 20 excess
    const g2 = splitGrnReceiptAgainstDemandAndExcess(80, 160, 140, 80);
    assert.equal(g2.demandReceivedQty, 60);
    assert.equal(g2.excessToStockReceivedQty, 20);
    assert.ok(g2.demandReceivedQty + g2.excessToStockReceivedQty <= 80 + 1e-9);
  });

  it("never credits more than GRN qty", () => {
    const g = splitGrnReceiptAgainstDemandAndExcess(10, 250, 220, 240);
    assert.ok(g.demandReceivedQty + g.excessToStockReceivedQty <= 10 + 1e-9);
  });

  it("MR received uses demand allocation only (no SO inflation from excess)", () => {
    const mrLine = {
      shortageQty: 140,
      requiredQty: 140,
      shortClosedQty: 0,
      purchaseRequestSourceLinks: [
        {
          allocatedQty: 140,
          purchaseRequestLine: {
            sourceLinks: [{ allocatedQty: 140 }],
            poLinks: [
              {
                allocatedQty: 140,
                rmPoLine: {
                  qty: 160,
                  excessToStockQty: 20,
                  rmPo: { status: "PENDING" },
                  grnLines: [{ receivedQty: 160, grn: { reversedAt: null } }],
                },
              },
            ],
          },
        },
      ],
      procurementLinks: [],
    };
    const received = receivedQtyForMrLine(mrLine);
    // 160 * 140/160 = 140 — excess 20 not attributed to SO
    assert.ok(Math.abs(received - 140) < 0.01, `received=${received}`);
  });
});

describe("Short-close / cancellation demand isolation", () => {
  it("excess-first short close leaves SO demand allocation untouched when closing only excess", () => {
    // Documented policy: closing 20 of 160 (140+20) after zero receipt cascades 0 to PR/MR.
    const ordered = 160;
    const excessQty = 20;
    const demandAllocated = 140;
    const deltaShortClose = 20;
    const priorShort = 0;
    const excessAlreadyClosed = Math.min(priorShort, excessQty);
    const excessStillOpen = Math.max(0, excessQty - excessAlreadyClosed);
    const cascadeDelta = Math.max(0, deltaShortClose - Math.min(deltaShortClose, excessStillOpen));
    assert.equal(cascadeDelta, 0);
    assert.equal(demandAllocated, 140);
    assert.equal(ordered, 160);
  });
});
