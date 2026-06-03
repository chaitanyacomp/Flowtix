const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { computeNoQtyCreateNextRsEligibility } = require("../../src/services/noQtyCreateNextRsEligibility");

describe("noQtyCreateNextRsEligibility PMR gate", () => {
  it("blocks Create Next RS when cycle WO has REQUESTED PMR", async () => {
    const openPmr = { id: 33, docNo: "PMR-26-0001", status: "REQUESTED" };
    const db = {
      salesOrder: {
        findUnique: async () => ({ orderType: "NO_QTY", internalStatus: "OPEN" }),
      },
      salesOrderCycle: {
        findFirst: async () => ({ id: 10, cycleNo: 1 }),
      },
      requirementSheet: {
        findFirst: async (args) => {
          if (args.where?.cycle?.cycleNo?.gt != null) return null;
          if (args.where?.status === "LOCKED") return { id: 1 };
          return null;
        },
      },
      qcRejectedDisposition: { count: async () => 0 },
      productionMaterialRequest: {
        findFirst: async () => openPmr,
      },
    };
    const result = await computeNoQtyCreateNextRsEligibility(db, { salesOrderId: 1, cycleId: 10 });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "PMR_WAITING_STORE_ISSUE");
  });

  it("blocks Create Next RS when cycle WO has PARTIALLY_ISSUED PMR", async () => {
    const db = {
      salesOrder: {
        findUnique: async () => ({ orderType: "NO_QTY", internalStatus: "OPEN" }),
      },
      salesOrderCycle: {
        findFirst: async () => ({ id: 10, cycleNo: 1 }),
      },
      requirementSheet: {
        findFirst: async (args) => {
          if (args.where?.cycle?.cycleNo?.gt != null) return null;
          if (args.where?.status === "LOCKED") return { id: 1 };
          return null;
        },
      },
      qcRejectedDisposition: { count: async () => 0 },
      productionMaterialRequest: {
        findFirst: async () => ({ id: 33, docNo: "PMR-26-0001", status: "PARTIALLY_ISSUED" }),
      },
    };
    const result = await computeNoQtyCreateNextRsEligibility(db, { salesOrderId: 1, cycleId: 10 });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "PMR_PARTIALLY_ISSUED");
  });
});
