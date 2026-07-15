const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateAdditionalPlanCreateEligibility,
  assessAdditionalPlanRmProcurementNeed,
} = require("../../src/services/monthlyPlanningAdditionalPlanService");

describe("Additional Monthly Plan procurement gate", () => {
  it("evaluate: blocks create when uncovered FG exists but procurementRequired=false", () => {
    const result = evaluateAdditionalPlanCreateEligibility({
      approvedPlanCount: 1,
      activePlan: null,
      totalAdditionalRequirementQty: 1025,
      procurementRequired: false,
      netRmShortageQty: 0,
    });
    assert.equal(result.canCreate, false);
    assert.equal(result.blockingCode, "NO_PROCUREMENT_NEED");
  });

  it("evaluate: allows create when net RM shortage remains", () => {
    const result = evaluateAdditionalPlanCreateEligibility({
      approvedPlanCount: 1,
      activePlan: null,
      totalAdditionalRequirementQty: 1025,
      procurementRequired: true,
      netRmShortageQty: 40,
    });
    assert.equal(result.canCreate, true);
    assert.equal(result.blockingCode, null);
  });

  it("evaluate: legacy callers without RM fields still create when FG uncovered", () => {
    const result = evaluateAdditionalPlanCreateEligibility({
      approvedPlanCount: 1,
      activePlan: null,
      totalAdditionalRequirementQty: 700,
    });
    assert.equal(result.canCreate, true);
  });

  it("assess: procurementRequired=false when free stock covers BOM demand", async () => {
    const need = await assessAdditionalPlanRmProcurementNeed({
      coverageItems: [{ fgItemId: 10, additionalRequirementQty: 1000 }],
      aggregateRmDemand: async (_db, fgLines) => {
        assert.equal(fgLines[0].fgQty, 1000);
        return { rmNeeded: new Map([[201, 500]]), missingChildBoms: [] };
      },
      loadAvailability: async () => [
        { itemId: 201, freeStockQty: 500, physicalUsableStockQty: 500, incomingQty: 0 },
      ],
    });
    assert.equal(need.procurementRequired, false);
    assert.equal(need.netRmShortageQty, 0);
  });

  it("assess: inbound PO coverage also suppresses procurement need", async () => {
    const need = await assessAdditionalPlanRmProcurementNeed({
      coverageItems: [{ fgItemId: 10, additionalRequirementQty: 100 }],
      aggregateRmDemand: async () => ({ rmNeeded: new Map([[201, 80]]), missingChildBoms: [] }),
      loadAvailability: async () => [
        { itemId: 201, freeStockQty: 20, physicalUsableStockQty: 20, incomingQty: 60 },
      ],
    });
    assert.equal(need.procurementRequired, false);
    assert.equal(need.netRmShortageQty, 0);
  });

  it("assess: procurementRequired=true when stock + inbound cannot cover", async () => {
    const need = await assessAdditionalPlanRmProcurementNeed({
      coverageItems: [{ fgItemId: 10, additionalRequirementQty: 1000 }],
      aggregateRmDemand: async () => ({ rmNeeded: new Map([[201, 500]]), missingChildBoms: [] }),
      loadAvailability: async () => [
        { itemId: 201, freeStockQty: 100, physicalUsableStockQty: 100, incomingQty: 50 },
      ],
    });
    assert.equal(need.procurementRequired, true);
    assert.equal(need.netRmShortageQty, 350);
  });
});
