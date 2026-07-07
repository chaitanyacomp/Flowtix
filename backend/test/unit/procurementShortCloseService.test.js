const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { buildShortClosePreview } = require("../../src/services/procurementShortCloseService");

describe("procurement short close preview", () => {
  it("blocks zero-receipt short close", () => {
    const rmPo = {
      id: 9,
      status: "PENDING",
      lines: [
        {
          id: 91,
          itemId: 3,
          qty: "100",
          shortClosedQty: "0",
          item: { itemName: "RM-A", unit: "Kg" },
          procurementLinks: [],
        },
      ],
      grns: [],
    };
    const receivedByLine = new Map();
    const preview = buildShortClosePreview(rmPo, receivedByLine);
    assert.equal(preview.canShortClose, false);
    assert.match(preview.blockReason ?? "", /Zero-receipt/i);
  });

  it("allows short close when received qty exists", () => {
    const rmPo = {
      id: 10,
      status: "PARTIAL",
      lines: [
        {
          id: 101,
          itemId: 3,
          qty: "100",
          shortClosedQty: "0",
          item: { itemName: "RM-A", unit: "Kg" },
          procurementLinks: [],
        },
      ],
      grns: [{ reversedAt: null, lines: [{ rmPoLineId: 101, receivedQty: "40" }] }],
    };
    const receivedByLine = new Map([[101, 40]]);
    const preview = buildShortClosePreview(rmPo, receivedByLine);
    assert.equal(preview.canShortClose, true);
    assert.equal(preview.impactSummary.totalOutstanding, 60);
    assert.equal(preview.impactSummary.totalOutstandingAfterClose, 0);
  });
});
