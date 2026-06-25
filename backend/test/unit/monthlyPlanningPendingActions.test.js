const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { fetchMonthlyPlanPendingActions } = require("../../src/services/pendingActionsService");

describe("fetchMonthlyPlanPendingActions", () => {
  it("DRAFT plan surfaces Complete Monthly Plan Draft for Store", async () => {
    const db = {
      monthlyProductionPlan: {
        findMany: async () => [
          {
            id: 3,
            docNo: "MPP-26-0003",
            periodKey: "2026-06",
            planSequenceNo: 1,
            status: "DRAFT",
            updatedAt: new Date("2026-06-10T10:00:00Z"),
            createdAt: new Date("2026-06-10T09:00:00Z"),
            releasedAt: null,
          },
        ],
      },
    };
    const actions = await fetchMonthlyPlanPendingActions(db);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "Complete Monthly Plan Draft");
    assert.equal(actions[0].ownerRole, "STORE");
    assert.equal(actions[0].id, "monthly-plan:draft:3");
    assert.ok(!actions[0].action.includes("Submit"));
  });

  it("AWAITING_PURCHASE_REVIEW surfaces Purchase review only", async () => {
    const db = {
      monthlyProductionPlan: {
        findMany: async () => [
          {
            id: 4,
            docNo: "MPP-26-0004",
            periodKey: "2026-06",
            planSequenceNo: 1,
            status: "AWAITING_PURCHASE_REVIEW",
            updatedAt: new Date(),
            createdAt: new Date(),
            releasedAt: null,
          },
        ],
      },
    };
    const actions = await fetchMonthlyPlanPendingActions(db);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].ownerRole, "PURCHASE");
    assert.equal(actions[0].action, "Review June Plan 1");
  });

  it("does not emit Store submit action for DRAFT", async () => {
    const db = {
      monthlyProductionPlan: {
        findMany: async () => [
          {
            id: 5,
            docNo: "MPP-26-0005",
            periodKey: "2026-07",
            planSequenceNo: 1,
            status: "DRAFT",
            updatedAt: new Date(),
            createdAt: new Date(),
            releasedAt: null,
          },
        ],
      },
    };
    const actions = await fetchMonthlyPlanPendingActions(db);
    assert.ok(actions.every((a) => a.action !== "Submit July Plan 1"));
  });
});
