const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { recalcPmrStatus } = require("../../src/services/productionMaterialRequestService");

describe("productionMaterialRequest issue tolerance outcomes", () => {
  it("marks PMR FULLY_ISSUED when issued qty meets or exceeds required", async () => {
    let updatedStatus = null;
    const tx = {
      productionMaterialRequest: {
        findUnique: async () => ({
          id: 3,
          status: "REQUESTED",
          lines: [{ requiredQty: "12.792", issuedQty: "13" }],
        }),
        update: async (_query) => {
          updatedStatus = _query.data.status;
        },
      },
      materialAllocation: {
        findMany: async () => [],
      },
      productionMaterialRequestLine: {
        findMany: async () => [],
      },
    };

    const status = await recalcPmrStatus(tx, 3);
    assert.equal(status, "FULLY_ISSUED");
    assert.equal(updatedStatus, "FULLY_ISSUED");
  });

  it("keeps PARTIALLY_ISSUED when issued qty is below required without tolerance path", async () => {
    const tx = {
      productionMaterialRequest: {
        findUnique: async () => ({
          id: 4,
          status: "REQUESTED",
          lines: [{ requiredQty: "12.792", issuedQty: "12" }],
        }),
        update: async () => {},
      },
      materialAllocation: {
        findMany: async () => [],
      },
      productionMaterialRequestLine: {
        findMany: async () => [],
      },
    };

    const status = await recalcPmrStatus(tx, 4);
    assert.equal(status, "PARTIALLY_ISSUED");
  });
});
