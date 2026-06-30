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

  it("emits separate release actions with plan-specific hrefs and ids", async () => {
    const db = {
      monthlyProductionPlan: {
        findMany: async () => [
          {
            id: 11,
            docNo: "MPP-26-0011",
            periodKey: "2026-06",
            planSequenceNo: 1,
            status: "APPROVED",
            updatedAt: new Date("2026-06-11T10:00:00Z"),
            createdAt: new Date("2026-06-11T09:00:00Z"),
            releasedAt: null,
          },
          {
            id: 12,
            docNo: "MPP-26-0012",
            periodKey: "2026-06",
            planSequenceNo: 2,
            status: "APPROVED",
            updatedAt: new Date("2026-06-12T10:00:00Z"),
            createdAt: new Date("2026-06-12T09:00:00Z"),
            releasedAt: null,
          },
        ],
      },
    };

    const actions = await fetchMonthlyPlanPendingActions(db);
    const releaseActions = actions.filter((a) => a.action.startsWith("Release "));
    assert.equal(releaseActions.length, 2);

    const plan1 = releaseActions.find((a) => a.action === "Release June Plan 1");
    const plan2 = releaseActions.find((a) => a.action === "Release June Plan 2");
    assert.ok(plan1);
    assert.ok(plan2);
    assert.equal(plan1.planId, 11);
    assert.equal(plan1.monthlyPlanId, 11);
    assert.match(plan1.href, /planId=11/);
    assert.match(plan1.href, /monthlyPlanId=11/);
    assert.equal(plan2.planId, 12);
    assert.equal(plan2.monthlyPlanId, 12);
    assert.match(plan2.href, /planId=12/);
    assert.match(plan2.href, /monthlyPlanId=12/);
  });
});
