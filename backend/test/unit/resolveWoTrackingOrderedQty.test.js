const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolveWoTrackingOrderedQty } = require("../../src/services/reportMetrics");

describe("resolveWoTrackingOrderedQty", () => {
  it("REGULAR SO uses SalesOrderLine.qty sum for the FG", () => {
    const ordered = resolveWoTrackingOrderedQty({
      orderType: "REGULAR",
      fgItemId: 10,
      soLines: [
        { itemId: 10, qty: 100 },
        { itemId: 10, qty: 25 },
        { itemId: 11, qty: 999 },
      ],
      requirementSheet: null,
    });
    assert.equal(ordered, 125);
  });

  it("NO_QTY uses locked RS baseDemandQty (customer demand), not SO line qty", () => {
    const ordered = resolveWoTrackingOrderedQty({
      orderType: "NO_QTY",
      fgItemId: 10,
      soLines: [{ itemId: 10, qty: 0 }],
      requirementSheet: {
        status: "LOCKED",
        lines: [
          {
            itemId: 10,
            baseDemandQty: 80,
            requirementQty: 80,
            totalRsQty: 120,
            productionShortfallQty: 10,
            qcRejectionRecoveryQty: 30,
            suggestedWoQtySnapshot: 95,
          },
        ],
      },
    });
    assert.equal(ordered, 80);
  });

  it("NO_QTY falls back to requirementQty when baseDemandQty missing", () => {
    const ordered = resolveWoTrackingOrderedQty({
      orderType: "NO_QTY",
      fgItemId: 10,
      soLines: [{ itemId: 10, qty: 0 }],
      requirementSheet: {
        status: "LOCKED",
        lines: [{ itemId: 10, requirementQty: 55, totalRsQty: 90, qcRejectionRecoveryQty: 35 }],
      },
    });
    assert.equal(ordered, 55);
  });

  it("multiple WOs for one RS line share the same customer demand Ordered (not WO qty)", () => {
    const rs = {
      status: "LOCKED",
      lines: [
        {
          itemId: 10,
          baseDemandQty: 200,
          requirementQty: 200,
          totalRsQty: 250,
          qcRejectionRecoveryQty: 50,
        },
      ],
    };
    const a = resolveWoTrackingOrderedQty({
      orderType: "NO_QTY",
      fgItemId: 10,
      soLines: [{ itemId: 10, qty: 0 }],
      requirementSheet: rs,
    });
    const b = resolveWoTrackingOrderedQty({
      orderType: "NO_QTY",
      fgItemId: 10,
      soLines: [{ itemId: 10, qty: 0 }],
      requirementSheet: rs,
    });
    assert.equal(a, 200);
    assert.equal(b, 200);
    assert.notEqual(a, 250);
  });

  it("kept recovery quantity must not silently become customer ordered quantity", () => {
    const ordered = resolveWoTrackingOrderedQty({
      orderType: "NO_QTY",
      fgItemId: 10,
      soLines: [{ itemId: 10, qty: 0 }],
      requirementSheet: {
        status: "LOCKED",
        lines: [
          {
            itemId: 10,
            baseDemandQty: 40,
            requirementQty: 40,
            totalRsQty: 100,
            qcRejectionRecoveryQty: 60,
            productionShortfallQty: 0,
          },
        ],
      },
    });
    assert.equal(ordered, 40);
    assert.notEqual(ordered, 100);
    assert.notEqual(ordered, 60);
  });

  it("NO_QTY without locked RS returns null (N/A), not zero from SO placeholder", () => {
    assert.equal(
      resolveWoTrackingOrderedQty({
        orderType: "NO_QTY",
        fgItemId: 10,
        soLines: [{ itemId: 10, qty: 0 }],
        requirementSheet: { status: "DRAFT", lines: [{ itemId: 10, baseDemandQty: 80 }] },
      }),
      null,
    );
    assert.equal(
      resolveWoTrackingOrderedQty({
        orderType: "NO_QTY",
        fgItemId: 10,
        soLines: [{ itemId: 10, qty: 0 }],
        requirementSheet: null,
      }),
      null,
    );
  });
});
