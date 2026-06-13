const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { computeNoQtyCreateNextRsEligibility } = require("../../src/services/noQtyCreateNextRsEligibility");

function mockDb(overrides = {}) {
  const openPmr = overrides.openPmr ?? null;
  const latestSheet = overrides.latestSheet ?? { id: 1, status: "LOCKED" };
  const sheetAhead = overrides.sheetAhead ?? null;
  const draftAhead = overrides.draftAhead ?? null;

  return {
    salesOrder: {
      findUnique: async () => ({ orderType: "NO_QTY", internalStatus: "OPEN" }),
    },
    salesOrderCycle: {
      findFirst: async () => ({ id: 10, cycleNo: 1 }),
    },
    requirementSheet: {
      findFirst: async (args) => {
        if (args.where?.status === "DRAFT" && args.where?.cycle?.cycleNo?.gt != null) {
          return draftAhead;
        }
        if (args.where?.status === "LOCKED" && args.where?.cycle?.cycleNo?.gt != null) {
          return sheetAhead;
        }
        if (args.orderBy) return latestSheet;
        return null;
      },
    },
    productionMaterialRequest: {
      findFirst: async () => openPmr,
    },
    qcRejectedDisposition: {
      count: async () => overrides.pendingDispositionCount ?? 0,
    },
  };
}

describe("noQtyCreateNextRsEligibility P6B-4B rolling demand", () => {
  it("allows Create Next RS when cycle has locked RS and open PMR (RM Issue in progress)", async () => {
    const result = await computeNoQtyCreateNextRsEligibility(
      mockDb({
        openPmr: { id: 33, docNo: "PMR-26-0001", status: "REQUESTED" },
      }),
      { salesOrderId: 1, cycleId: 10 },
    );
    assert.equal(result.eligible, true);
    assert.equal(result.reason, "OK");
  });

  it("allows Create Next RS when cycle has locked RS and partially issued PMR", async () => {
    const result = await computeNoQtyCreateNextRsEligibility(
      mockDb({
        openPmr: { id: 33, docNo: "PMR-26-0001", status: "PARTIALLY_ISSUED" },
      }),
      { salesOrderId: 1, cycleId: 10 },
    );
    assert.equal(result.eligible, true);
  });

  it("blocks when latest RS on cycle is still DRAFT", async () => {
    const result = await computeNoQtyCreateNextRsEligibility(
      mockDb({ latestSheet: { id: 2, status: "DRAFT" } }),
      { salesOrderId: 1, cycleId: 10 },
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "DRAFT_RS_ON_CYCLE");
  });

  it("allows when latest RS on cycle is CANCELLED", async () => {
    const result = await computeNoQtyCreateNextRsEligibility(
      mockDb({ latestSheet: { id: 3, status: "CANCELLED" } }),
      { salesOrderId: 1, cycleId: 10 },
    );
    assert.equal(result.eligible, true);
  });

  it("blocks when a later cycle already has a DRAFT RS", async () => {
    const result = await computeNoQtyCreateNextRsEligibility(
      mockDb({ draftAhead: { id: 9, docNo: "RS-DRAFT-2" } }),
      { salesOrderId: 1, cycleId: 10 },
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "DRAFT_RS_EXISTS");
    assert.equal(result.existingNextRsDocNo, "RS-DRAFT-2");
  });

  it("blocks when a later cycle already has a LOCKED RS", async () => {
    const result = await computeNoQtyCreateNextRsEligibility(
      mockDb({ sheetAhead: { id: 8, docNo: "RS-26-0002" } }),
      { salesOrderId: 1, cycleId: 10 },
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "NEXT_RS_EXISTS");
  });
});
