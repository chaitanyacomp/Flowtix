const test = require("node:test");
const assert = require("node:assert/strict");

const { isRegularWoPrepareCandidate } = require("../../src/services/woPrepareOperationalQueue");

test("isRegularWoPrepareCandidate accepts NORMAL WO_PENDING with FG lines", () => {
  assert.equal(
    isRegularWoPrepareCandidate({
      orderType: "NORMAL",
      internalStatus: "APPROVED",
      processStage: { key: "WO_PENDING", label: "WO pending" },
      lines: [{ item: { itemType: "FG" } }],
    }),
    true,
  );
});

test("isRegularWoPrepareCandidate rejects NO_QTY and REPLACEMENT", () => {
  assert.equal(
    isRegularWoPrepareCandidate({
      orderType: "NO_QTY",
      internalStatus: "APPROVED",
      processStage: { key: "WO_PENDING", label: "WO pending" },
      lines: [{ item: { itemType: "FG" } }],
    }),
    false,
  );
  assert.equal(
    isRegularWoPrepareCandidate({
      orderType: "REPLACEMENT",
      internalStatus: "APPROVED",
      processStage: { key: "WO_PENDING", label: "WO pending" },
      lines: [{ item: { itemType: "FG" } }],
    }),
    false,
  );
});
