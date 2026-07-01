const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  pendingQty,
  excessIssueQty,
  recalcPmrStatus,
  PMR_SHORT_ISSUE_WAIVE_REASONS,
  assessPmrReleaseEligibility,
  formatPmrReleaseBlockedMessage,
  pmrMeetsProductionReleaseIssueRule,
} = require("../../src/services/productionMaterialRequestService");
const { resolveReadinessGate } = require("../../src/services/productionRmReadinessService");

describe("P16-13 material issue flexibility", () => {
  it("pendingQty subtracts issued and waived", () => {
    assert.equal(pendingQty({ requiredQty: 100, issuedQty: 70, waivedQty: 0 }), 30);
    assert.equal(pendingQty({ requiredQty: 7.02, issuedQty: 7, waivedQty: 0.02 }), 0);
    assert.equal(pendingQty({ requiredQty: 100, issuedQty: 101, waivedQty: 0 }), 0);
  });

  it("excessIssueQty when issued exceeds required", () => {
    assert.equal(excessIssueQty({ requiredQty: 100, issuedQty: 101 }), 1);
    assert.equal(excessIssueQty({ requiredQty: 7.02, issuedQty: 7.2 }), 0.18);
    assert.equal(excessIssueQty({ requiredQty: 100, issuedQty: 70 }), 0);
  });

  it("recalcPmrStatus — scenario 1 partial issue", async () => {
    const updates = [];
    const tx = {
      productionMaterialRequest: {
        findUnique: async () => ({
          id: 1,
          status: "REQUESTED",
          lines: [{ requiredQty: "100", issuedQty: "70", waivedQty: "0" }],
        }),
        update: async (args) => {
          updates.push(args.data);
        },
      },
    };
    const syncAllocationsForPmrIssueStatus = async () => {};
    const orig = require("../../src/services/materialAllocationService").syncAllocationsForPmrIssueStatus;
    require("../../src/services/materialAllocationService").syncAllocationsForPmrIssueStatus =
      syncAllocationsForPmrIssueStatus;
    try {
      const status = await recalcPmrStatus(tx, 1);
      assert.equal(status, "PARTIALLY_ISSUED");
      assert.equal(updates[0]?.status, "PARTIALLY_ISSUED");
    } finally {
      require("../../src/services/materialAllocationService").syncAllocationsForPmrIssueStatus = orig;
    }
  });

  it("recalcPmrStatus — scenario 3 fully issued", async () => {
    const tx = {
      productionMaterialRequest: {
        findUnique: async () => ({
          id: 1,
          status: "PARTIALLY_ISSUED",
          lines: [{ requiredQty: "100", issuedQty: "100", waivedQty: "0" }],
        }),
        update: async () => {},
      },
    };
    const orig = require("../../src/services/materialAllocationService").syncAllocationsForPmrIssueStatus;
    require("../../src/services/materialAllocationService").syncAllocationsForPmrIssueStatus = async () => {};
    try {
      assert.equal(await recalcPmrStatus(tx, 1), "FULLY_ISSUED");
    } finally {
      require("../../src/services/materialAllocationService").syncAllocationsForPmrIssueStatus = orig;
    }
  });

  it("recalcPmrStatus keeps SHORT_ISSUE_ACCEPTED", async () => {
    const tx = {
      productionMaterialRequest: {
        findUnique: async () => ({
          id: 1,
          status: "SHORT_ISSUE_ACCEPTED",
          lines: [{ requiredQty: "7.02", issuedQty: "7", waivedQty: "0.02" }],
        }),
        update: async () => {
          throw new Error("should not update");
        },
      },
    };
    const orig = require("../../src/services/materialAllocationService").syncAllocationsForPmrIssueStatus;
    require("../../src/services/materialAllocationService").syncAllocationsForPmrIssueStatus = async () => {};
    try {
      assert.equal(await recalcPmrStatus(tx, 1), "SHORT_ISSUE_ACCEPTED");
    } finally {
      require("../../src/services/materialAllocationService").syncAllocationsForPmrIssueStatus = orig;
    }
  });

  it("resolveReadinessGate — requires explicit release after issue", () => {
    const pmrs = [{ status: "PARTIALLY_ISSUED", lines: [{ requiredQty: 100, issuedQty: 70 }] }];
    assert.equal(resolveReadinessGate(pmrs, 70, false).gate, "WAITING_RELEASE_TO_PRODUCTION");
    assert.equal(resolveReadinessGate(pmrs, 70, true).gate, "READY_FOR_PRODUCTION");
    assert.equal(resolveReadinessGate(pmrs, 0, false).gate, "WAITING_STORE_ISSUE");
  });

  it("waive reasons are fixed set", () => {
    assert.ok(PMR_SHORT_ISSUE_WAIVE_REASONS.includes("SCALE_LIMITATION"));
    assert.ok(PMR_SHORT_ISSUE_WAIVE_REASONS.includes("OTHER"));
  });

  it("P16-13A scenario 1 — partial HDPE issue allows release", () => {
    const lines = [{ id: 1, itemId: 10, itemName: "HDPE", requiredQty: 100, issuedQty: 70, unit: "Kg" }];
    assert.equal(assessPmrReleaseEligibility(lines).canRelease, true);
  });

  it("P16-13A scenario 2 — zero powder blocks release", () => {
    const lines = [
      { id: 1, itemId: 10, itemName: "HDPE", requiredQty: 24.462, issuedQty: 24.462, unit: "Kg" },
      { id: 2, itemId: 20, itemName: "Powder", requiredQty: 0.498, issuedQty: 0, unit: "Kg" },
    ];
    const assessment = assessPmrReleaseEligibility(lines);
    assert.equal(assessment.canRelease, false);
    assert.equal(assessment.unissuedRequiredLines.length, 1);
    assert.equal(assessment.unissuedRequiredLines[0].itemName, "Powder");
    assert.match(formatPmrReleaseBlockedMessage(assessment.unissuedRequiredLines), /Powder/);
    assert.match(formatPmrReleaseBlockedMessage(assessment.unissuedRequiredLines), /Cannot release Work Order/);
  });

  it("P16-13A scenario 3 — minimum issue on every BOM line allows release", () => {
    const lines = [
      { id: 1, itemId: 10, itemName: "HDPE", requiredQty: 24.462, issuedQty: 10, unit: "Kg" },
      { id: 2, itemId: 20, itemName: "Powder", requiredQty: 0.498, issuedQty: 0.2, unit: "Kg" },
    ];
    assert.equal(assessPmrReleaseEligibility(lines).canRelease, true);
    assert.equal(pmrMeetsProductionReleaseIssueRule(lines), true);
  });
});
