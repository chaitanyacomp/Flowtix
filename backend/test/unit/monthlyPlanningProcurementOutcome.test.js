const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MONTHLY_PLAN_PROCUREMENT_OUTCOME,
  assessMonthlyPlanProcurementOutcome,
  markPlanProcurementNotRequired,
  completeProcurementHandoffIfNotRequired,
} = require("../../src/services/monthlyPlanningProcurementOutcomeService");

function createOutcomeDb({
  status = "APPROVED",
  releasedAt = null,
  netLines = [{ netRequirementQty: 0 }],
} = {}) {
  const plan = {
    id: 1,
    status,
    currentRevision: 0,
    periodKey: "2026-06",
    planSequenceNo: 1,
    planKind: "INITIAL",
    releasedAt,
    releasedRevision: null,
    approvedAt: new Date("2026-06-01"),
  };
  return {
    monthlyProductionPlan: {
      findUnique: async () => ({ ...plan }),
      update: async ({ data }) => {
        Object.assign(plan, data);
        return { ...plan };
      },
    },
    rmPlan: {
      findFirst: async () => ({ id: 10, revision: 1 }),
      findUnique: async () => ({
        id: 10,
        planId: 1,
        revision: 1,
        lines: netLines,
      }),
    },
    __plan: plan,
  };
}

describe("monthlyPlanningProcurementOutcomeService", () => {
  it("returns RELEASE_REQUIRED when approved snapshot has positive net RM", async () => {
    const db = createOutcomeDb({ netLines: [{ netRequirementQty: 12 }] });
    const res = await assessMonthlyPlanProcurementOutcome({ db, planId: 1 });
    assert.equal(res.outcome, MONTHLY_PLAN_PROCUREMENT_OUTCOME.RELEASE_REQUIRED);
    assert.equal(res.releaseRequired, true);
    assert.equal(res.executionReady, false);
    assert.equal(res.procurementRequired, true);
  });

  it("returns PROCUREMENT_NOT_REQUIRED when approved snapshot net RM is zero", async () => {
    const db = createOutcomeDb({ netLines: [{ netRequirementQty: 0 }] });
    const res = await assessMonthlyPlanProcurementOutcome({ db, planId: 1 });
    assert.equal(res.outcome, MONTHLY_PLAN_PROCUREMENT_OUTCOME.PROCUREMENT_NOT_REQUIRED);
    assert.equal(res.releaseRequired, false);
    assert.equal(res.executionReady, true);
    assert.equal(res.procurementRequired, false);
  });

  it("marks releasedAt without creating MR when procurement is not required", async () => {
    const db = createOutcomeDb({ netLines: [{ netRequirementQty: 0 }] });
    const res = await markPlanProcurementNotRequired({ db, planId: 1, actorUserId: 9 });
    assert.equal(res.marked, true);
    assert.equal(res.materialRequirementId, null);
    assert.ok(db.__plan.releasedAt);
    assert.equal(db.__plan.releasedByUserId, 9);
  });

  it("completeProcurementHandoffIfNotRequired is a no-op when release is required", async () => {
    const db = createOutcomeDb({ netLines: [{ netRequirementQty: 5 }] });
    const res = await completeProcurementHandoffIfNotRequired({ db, planId: 1 });
    assert.equal(res.marked, false);
    assert.equal(res.outcome, MONTHLY_PLAN_PROCUREMENT_OUTCOME.RELEASE_REQUIRED);
    assert.equal(db.__plan.releasedAt, null);
  });
});
