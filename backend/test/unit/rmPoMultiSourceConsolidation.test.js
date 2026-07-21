/**
 * Commercial RM PO consolidation + multi-pool create rules.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  consolidateRmPoAllocations,
  RM_PO_RATE_MISMATCH_CODE,
  RM_PO_NO_ELIGIBLE_LINES_CODE,
} = require("../../src/services/rmPoLineConsolidation");
const {
  assertSingleDemandPoolFromSourceTypes,
  assertKnownDemandPoolsForCommercialRmPo,
  MIXED_PROCUREMENT_DEMAND_POOL_CODE,
} = require("../../src/services/procurementDemandPoolService");
const { receivedQtyForMrLine } = require("../../src/services/procurementLifecycleService");
const { computeLineAmount } = require("../../src/services/rmPoTaxFields");

describe("assertKnownDemandPoolsForCommercialRmPo", () => {
  it("allows mixed MPRS + STOCK_REPLENISHMENT on commercial RM PO", () => {
    const pools = assertKnownDemandPoolsForCommercialRmPo(["MONTHLY_PLAN", "STOCK_REPLENISHMENT"]);
    assert.deepEqual(pools, ["MPRS", "STOCK_REPLENISHMENT"]);
  });

  it("still rejects mixed pools for purchase request (firewall)", () => {
    assert.throws(
      () => assertSingleDemandPoolFromSourceTypes(["MONTHLY_PLAN", "STOCK_REPLENISHMENT"], "purchase request"),
      (e) => e && e.code === MIXED_PROCUREMENT_DEMAND_POOL_CODE,
    );
  });
});

describe("consolidateRmPoAllocations", () => {
  const helpers = { computeLineAmount };

  it("RS-only: one allocation → one commercial line", () => {
    const lines = consolidateRmPoAllocations(
      [
        {
          purchaseRequestLineId: 1,
          purchaseRequestId: 10,
          purchaseRequestDocNo: "PR-26-0001",
          itemId: 70,
          itemName: "HDPE",
          qty: 114,
          rate: 100,
          unit: "KG",
          hsn: "3901",
          gstRate: 18,
        },
      ],
      helpers,
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0].qty, 114);
    assert.equal(lines[0].allocations.length, 1);
  });

  it("Replenishment-only: one allocation → one commercial line", () => {
    const lines = consolidateRmPoAllocations(
      [
        {
          purchaseRequestLineId: 2,
          purchaseRequestId: 11,
          purchaseRequestDocNo: "PR-26-0002",
          itemId: 70,
          itemName: "HDPE",
          qty: 500,
          rate: 100,
          unit: "KG",
          hsn: "3901",
          gstRate: 18,
        },
      ],
      helpers,
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0].qty, 500);
  });

  it("combined RS + Replenishment: same RM consolidates with separate allocations", () => {
    const lines = consolidateRmPoAllocations(
      [
        {
          purchaseRequestLineId: 1,
          purchaseRequestId: 10,
          purchaseRequestDocNo: "PR-26-0001",
          itemId: 70,
          itemName: "HDPE",
          qty: 114,
          rate: 100,
          unit: "KG",
          hsn: "3901",
          gstRate: 18,
        },
        {
          purchaseRequestLineId: 2,
          purchaseRequestId: 11,
          purchaseRequestDocNo: "PR-26-0002",
          itemId: 70,
          itemName: "HDPE",
          qty: 500,
          rate: 100,
          unit: "KG",
          hsn: "3901",
          gstRate: 18,
        },
      ],
      helpers,
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0].qty, 614);
    assert.equal(lines[0].allocations.length, 2);
    assert.deepEqual(
      lines[0].allocations.map((a) => a.purchaseRequestLineId).sort(),
      [1, 2],
    );
    assert.equal(lines[0].allocations.find((a) => a.purchaseRequestLineId === 1).qty, 114);
    assert.equal(lines[0].allocations.find((a) => a.purchaseRequestLineId === 2).qty, 500);
  });

  it("partial quantities from both PRs consolidate", () => {
    const lines = consolidateRmPoAllocations(
      [
        {
          purchaseRequestLineId: 1,
          purchaseRequestId: 10,
          itemId: 70,
          itemName: "PP",
          qty: 50,
          rate: 80,
          unit: "KG",
          hsn: null,
          gstRate: 18,
        },
        {
          purchaseRequestLineId: 2,
          purchaseRequestId: 11,
          itemId: 70,
          itemName: "PP",
          qty: 25,
          rate: 80,
          unit: "KG",
          hsn: null,
          gstRate: 18,
        },
      ],
      helpers,
    );
    assert.equal(lines[0].qty, 75);
  });

  it("qty 0 allocations are excluded (deselect)", () => {
    const lines = consolidateRmPoAllocations(
      [
        {
          purchaseRequestLineId: 1,
          purchaseRequestId: 10,
          itemId: 70,
          itemName: "HDPE",
          qty: 0,
          rate: 100,
          unit: "KG",
          hsn: null,
          gstRate: 18,
        },
        {
          purchaseRequestLineId: 2,
          purchaseRequestId: 11,
          itemId: 71,
          itemName: "PP",
          qty: 40,
          rate: 90,
          unit: "KG",
          hsn: null,
          gstRate: 18,
        },
      ],
      helpers,
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0].itemId, 71);
  });

  it("rejects rate mismatch for same RM with clear incompatible lines", () => {
    assert.throws(
      () =>
        consolidateRmPoAllocations(
          [
            {
              purchaseRequestLineId: 1,
              purchaseRequestId: 10,
              purchaseRequestDocNo: "PR-26-0001",
              itemId: 70,
              itemName: "HDPE",
              qty: 114,
              rate: 100,
              unit: "KG",
              hsn: null,
              gstRate: 18,
            },
            {
              purchaseRequestLineId: 2,
              purchaseRequestId: 11,
              purchaseRequestDocNo: "PR-26-0002",
              itemId: 70,
              itemName: "HDPE",
              qty: 500,
              rate: 110,
              unit: "KG",
              hsn: null,
              gstRate: 18,
            },
          ],
          helpers,
        ),
      (e) => e && e.code === RM_PO_RATE_MISMATCH_CODE && e.details?.incompatibleAllocations?.length === 2,
    );
  });

  it("rejects empty selection", () => {
    assert.throws(
      () => consolidateRmPoAllocations([], helpers),
      (e) => e && e.code === RM_PO_NO_ELIGIBLE_LINES_CODE,
    );
  });

  it("two different RMs stay as two commercial lines", () => {
    const lines = consolidateRmPoAllocations(
      [
        {
          purchaseRequestLineId: 1,
          purchaseRequestId: 10,
          itemId: 70,
          itemName: "HDPE",
          qty: 10,
          rate: 100,
          unit: "KG",
          hsn: null,
          gstRate: 18,
        },
        {
          purchaseRequestLineId: 2,
          purchaseRequestId: 10,
          itemId: 71,
          itemName: "PP",
          qty: 20,
          rate: 90,
          unit: "KG",
          hsn: null,
          gstRate: 18,
        },
      ],
      helpers,
    );
    assert.equal(lines.length, 2);
  });
});

describe("GRN proportional receipt across consolidated source allocations", () => {
  it("partial GRN splits by allocatedQty ratio without merging pools", () => {
    // Consolidated PO line qty 614 with allocations 114 (MPRS) and 500 (replenishment)
    const mrLineMprs = {
      shortageQty: 114,
      requiredQty: 114,
      shortClosedQty: 0,
      purchaseRequestSourceLinks: [
        {
          allocatedQty: 114,
          purchaseRequestLine: {
            sourceLinks: [{ allocatedQty: 114 }],
            poLinks: [
              {
                allocatedQty: 114,
                rmPoLine: {
                  qty: 614,
                  rmPo: { status: "PENDING" },
                  grnLines: [{ receivedQty: 307, grn: { reversedAt: null } }],
                },
              },
            ],
          },
        },
      ],
      procurementLinks: [],
    };
    const mrLineRepl = {
      shortageQty: 500,
      requiredQty: 500,
      shortClosedQty: 0,
      purchaseRequestSourceLinks: [
        {
          allocatedQty: 500,
          purchaseRequestLine: {
            sourceLinks: [{ allocatedQty: 500 }],
            poLinks: [
              {
                allocatedQty: 500,
                rmPoLine: {
                  qty: 614,
                  rmPo: { status: "PENDING" },
                  grnLines: [{ receivedQty: 307, grn: { reversedAt: null } }],
                },
              },
            ],
          },
        },
      ],
      procurementLinks: [],
    };

    const mprsReceived = receivedQtyForMrLine(mrLineMprs);
    const replReceived = receivedQtyForMrLine(mrLineRepl);
    // 307 * 114/614 ≈ 57, 307 * 500/614 ≈ 250
    assert.ok(Math.abs(mprsReceived - 57) < 0.5, `mprs=${mprsReceived}`);
    assert.ok(Math.abs(replReceived - 250) < 0.5, `repl=${replReceived}`);
    assert.ok(Math.abs(mprsReceived + replReceived - 307) < 0.01);
  });
});
