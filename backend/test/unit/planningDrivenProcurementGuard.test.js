const { test, describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  isPlanningDrivenProcurementEnabled,
  FEATURE_PLANNING_DRIVEN_PROCUREMENT,
} = require("../../src/config/featureFlags");
const {
  blockProcurementDemandWhenPlanningDriven,
  PLANNING_DRIVEN_BLOCK_MESSAGE,
} = require("../../src/middleware/planningDrivenProcurementGuard");
const {
  groupMaterialRequirementsByCase,
  mrSourceDescriptor,
  buildSourceTypesByRmItem,
} = require("../../src/services/procurementWorkspaceService");

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe("featureFlags.FEATURE_PLANNING_DRIVEN_PROCUREMENT", () => {
  const prev = process.env[FEATURE_PLANNING_DRIVEN_PROCUREMENT];
  afterEach(() => {
    if (prev == null) delete process.env[FEATURE_PLANNING_DRIVEN_PROCUREMENT];
    else process.env[FEATURE_PLANNING_DRIVEN_PROCUREMENT] = prev;
  });

  it("defaults OFF when unset", () => {
    delete process.env[FEATURE_PLANNING_DRIVEN_PROCUREMENT];
    assert.equal(isPlanningDrivenProcurementEnabled(), false);
  });

  it("is ON when env is truthy", () => {
    process.env[FEATURE_PLANNING_DRIVEN_PROCUREMENT] = "true";
    assert.equal(isPlanningDrivenProcurementEnabled(), true);
  });
});

describe("blockProcurementDemandWhenPlanningDriven middleware", () => {
  const prev = process.env[FEATURE_PLANNING_DRIVEN_PROCUREMENT];
  afterEach(() => {
    if (prev == null) delete process.env[FEATURE_PLANNING_DRIVEN_PROCUREMENT];
    else process.env[FEATURE_PLANNING_DRIVEN_PROCUREMENT] = prev;
  });

  it("calls next() when flag OFF (old flows work)", () => {
    delete process.env[FEATURE_PLANNING_DRIVEN_PROCUREMENT];
    let called = false;
    const res = mockRes();
    blockProcurementDemandWhenPlanningDriven({}, res, () => {
      called = true;
    });
    assert.equal(called, true);
    assert.equal(res.statusCode, null);
  });

  it("blocks with 403 + clear message when flag ON", () => {
    process.env[FEATURE_PLANNING_DRIVEN_PROCUREMENT] = "1";
    let called = false;
    const res = mockRes();
    blockProcurementDemandWhenPlanningDriven({}, res, () => {
      called = true;
    });
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "PLANNING_DRIVEN_PROCUREMENT_ACTIVE");
    assert.equal(res.body.error.message, PLANNING_DRIVEN_BLOCK_MESSAGE);
    assert.equal(PLANNING_DRIVEN_BLOCK_MESSAGE, "Procurement demand must be raised through Monthly Planning.");
  });
});

describe("groupMaterialRequirementsByCase — MONTHLY_PLAN grouping fix", () => {
  it("keeps different monthly plans in separate groups (June vs July do not collapse)", async () => {
    const mrs = [
      { id: 1, sourceType: "MONTHLY_PLAN", monthlyProductionPlanId: 10, status: "APPROVED", lines: [] },
      { id: 2, sourceType: "MONTHLY_PLAN", monthlyProductionPlanId: 11, status: "APPROVED", lines: [] },
    ];
    const groups = await groupMaterialRequirementsByCase(mrs, {});
    assert.equal(groups.length, 2);
    assert.ok(groups.every((g) => g.items.length === 1));
  });

  it("groups MRs of the same plan together", async () => {
    const now = new Date();
    const mrs = [
      { id: 1, sourceType: "MONTHLY_PLAN", monthlyProductionPlanId: 10, status: "APPROVED", lines: [], updatedAt: now },
      { id: 2, sourceType: "MONTHLY_PLAN", monthlyProductionPlanId: 10, status: "APPROVED", lines: [], updatedAt: now },
    ];
    const groups = await groupMaterialRequirementsByCase(mrs, {});
    assert.equal(groups.length, 1);
    assert.equal(groups[0].items.length, 2);
  });

  it("does not collapse MONTHLY_PLAN with STOCK_REPLENISHMENT", async () => {
    const mrs = [
      { id: 1, sourceType: "MONTHLY_PLAN", monthlyProductionPlanId: 10, status: "APPROVED", lines: [] },
      { id: 2, sourceType: "STOCK_REPLENISHMENT", status: "APPROVED", lines: [] },
    ];
    const groups = await groupMaterialRequirementsByCase(mrs, {});
    assert.equal(groups.length, 2);
  });
});

describe("mrSourceDescriptor — Monthly Plan source badge data", () => {
  it("returns plan period + revision for MONTHLY_PLAN", () => {
    const d = mrSourceDescriptor({
      sourceType: "MONTHLY_PLAN",
      monthlyProductionPlanId: 10,
      sourceRevision: 3,
      monthlyProductionPlan: { periodKey: "2026-06" },
    });
    assert.equal(d.type, "MONTHLY_PLAN");
    assert.equal(d.label, "June Plan 1");
    assert.equal(d.planDocumentLabel, "June Plan 1");
    assert.equal(d.periodKey, "2026-06");
    assert.equal(d.sourceRevision, 3);
    assert.equal(d.monthlyProductionPlanId, 10);
  });

  it("labels other sources without plan fields", () => {
    assert.equal(mrSourceDescriptor({ sourceType: "SALES_ORDER" }).label, "Sales Order");
    assert.equal(mrSourceDescriptor({ sourceType: "STOCK_REPLENISHMENT" }).label, "Stock Replenishment");
    const noPlan = mrSourceDescriptor({ sourceType: "MONTHLY_PLAN" });
    assert.equal(noPlan.periodKey, null);
    assert.equal(noPlan.label, "Monthly Plan");
  });

  it("uses Monthly Plan fallback for legacy LOCKED revision without document label", () => {
    const d = mrSourceDescriptor({
      sourceType: "MONTHLY_PLAN",
      sourceRevision: 2,
      monthlyProductionPlan: {
        periodKey: "2026-06",
        status: "LOCKED",
        currentRevision: 2,
        planSequenceNo: 1,
      },
    });
    assert.equal(d.label, "Monthly Plan");
    assert.equal(d.planDocumentLabel, null);
  });
});

describe("buildSourceTypesByRmItem — duplicate-source detection", () => {
  it("flags RM items demanded by more than one source type", () => {
    const map = buildSourceTypesByRmItem([
      { sourceType: "MONTHLY_PLAN", lines: [{ rmItemId: 70 }, { rmItemId: 71 }] },
      { sourceType: "SALES_ORDER", lines: [{ rmItemId: 70 }] },
    ]);
    assert.equal(map.get(70).size, 2); // multiple sources
    assert.equal(map.get(71).size, 1); // single source
    assert.ok(map.get(70).has("MONTHLY_PLAN"));
    assert.ok(map.get(70).has("SALES_ORDER"));
  });
});
