const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertNoOpenProductionRmReturnPending,
  formatRmReturnPendingBlockMessage,
} = require("../../src/services/productionRmReturnPendingGuard");

describe("productionRmReturnPendingGuard", () => {
  it("formatRmReturnPendingBlockMessage includes item qty and unit", () => {
    const message = formatRmReturnPendingBlockMessage([
      { requestedQty: "3", item: { itemName: "PP", unit: "Kg" } },
    ]);
    assert.match(message, /RM Return Pending/);
    assert.match(message, /PP — 3 Kg/);
    assert.match(message, /Waiting for Store/);
  });

  it("assertNoOpenProductionRmReturnPending throws enriched block error", async () => {
    const db = {
      productionRmReturnPending: {
        findMany: async () => [
          { requestedQty: "3", item: { itemName: "PP", unit: "Kg" } },
        ],
      },
    };
    await assert.rejects(
      () => assertNoOpenProductionRmReturnPending(db, 15),
      (err) =>
        err.code === "RM_RETURN_PENDING_STORE_ACK_REQUIRED" &&
        /PP — 3 Kg/.test(err.message),
    );
  });

  it("assertNoOpenProductionRmReturnPending passes when no open rows", async () => {
    const db = {
      productionRmReturnPending: {
        findMany: async () => [],
      },
    };
    await assert.equal(await assertNoOpenProductionRmReturnPending(db, 15), true);
  });
});
