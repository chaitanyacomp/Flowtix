const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { MonthlyPlanningError } = require("../../src/services/monthlyPlanningService");
const {
  evaluateAdditionalPlanCreateEligibility,
  previewAdditionalPlan,
  createAdditionalPlan,
} = require("../../src/services/monthlyPlanningAdditionalPlanService");

const FORBIDDEN_MODELS = [
  "materialRequirement",
  "procurementPlanning",
  "monthlyProductionPlanRmSnapshot",
  "monthlyProductionPlanRelease",
];

function throwOnTouch(name) {
  return async () => {
    throw new Error(`Unexpected touch: ${name}`);
  };
}

function defaultComposition(overrides = {}) {
  return {
    periodKey: "2026-06",
    anchorPeriodKey: "2026-06",
    sheetCount: 0,
    itemCount: 2,
    items: [
      {
        itemId: 65,
        itemName: "Cap",
        unit: "Pcs",
        rsRequirement: 10000,
        carryForward: 0,
        greenShortage: 0,
        suggestedProduction: 10000,
      },
      {
        itemId: 66,
        itemName: "Nozzle",
        unit: "Pcs",
        rsRequirement: 10000,
        carryForward: 0,
        greenShortage: 0,
        suggestedProduction: 10000,
      },
    ],
    ...overrides,
  };
}

function createAdditionalPlanDb({
  plans = [],
  approvedLines = [],
  composition = null,
} = {}) {
  const state = {
    nextId: 100,
    nextLineId: 1,
    plans: plans.map((p, idx) => ({
      id: p.id ?? idx + 1,
      docNo: p.docNo ?? `MPP-${idx + 1}`,
      planSequenceNo: p.planSequenceNo ?? 1,
      planKind: p.planKind ?? (p.planSequenceNo > 1 ? "ADDITIONAL" : "INITIAL"),
      currentRevision: 0,
      lines: p.lines ?? [],
      rmPlans: p.rmPlans ?? [],
      lockedAt: null,
      lockedByUserId: null,
      purchaseReviewedAt: null,
      purchaseReviewedByUserId: null,
      approvedAt: null,
      approvedByUserId: null,
      purchaseRejectReason: null,
      reopenedAt: null,
      releasedAt: null,
      releasedRevision: null,
      createdAt: new Date("2026-06-01T00:00:00Z"),
      updatedAt: new Date("2026-06-01T00:00:00Z"),
      ...p,
    })),
    createdLines: [],
  };

  const db = {
    __state: state,
    monthlyProductionPlan: {
      findMany: async ({ where, orderBy }) => {
        let rows = [...state.plans];
        if (where?.periodKey) rows = rows.filter((p) => p.periodKey === where.periodKey);
        if (where?.status?.in) rows = rows.filter((p) => where.status.in.includes(p.status));
        if (where?.id?.not != null) rows = rows.filter((p) => p.id !== where.id.not);
        if (orderBy?.planSequenceNo === "asc") {
          rows.sort((a, b) => Number(a.planSequenceNo) - Number(b.planSequenceNo));
        }
        return rows;
      },
      aggregate: async ({ where }) => {
        let rows = state.plans;
        if (where?.periodKey) rows = rows.filter((p) => p.periodKey === where.periodKey);
        const maxSeq = rows.reduce((m, p) => Math.max(m, Number(p.planSequenceNo ?? 0)), 0);
        return { _max: { planSequenceNo: maxSeq > 0 ? maxSeq : null } };
      },
      count: async ({ where }) => {
        let rows = state.plans;
        if (where?.periodKey) rows = rows.filter((p) => p.periodKey === where.periodKey);
        if (where?.status) rows = rows.filter((p) => p.status === where.status);
        return rows.length;
      },
      create: async ({ data }) => {
        const row = {
          id: ++state.nextId,
          docNo: `MPP-26-${String(state.nextId).padStart(4, "0")}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          lines: [],
          ...data,
        };
        state.plans.push(row);
        return row;
      },
    },
    monthlyProductionPlanLine: {
      findMany: async ({ where }) => {
        if (where?.plan?.periodKey || where?.plan?.status) {
          return approvedLines.filter((line) => {
            if (where?.plan?.periodKey && line.periodKey !== where.plan.periodKey) return false;
            if (where?.plan?.status && line.planStatus !== where.plan.status) return false;
            return true;
          });
        }
        const plan = state.plans.find((p) => p.id === where.planId);
        return plan?.lines ?? [];
      },
      create: async ({ data }) => {
        const line = {
          id: ++state.nextLineId,
          plannedQtyOverridden: false,
          source: "REQUIREMENT_SHEET",
          remarks: null,
          ...data,
        };
        state.createdLines.push(line);
        const plan = state.plans.find((p) => p.id === data.planId);
        if (plan) {
          if (!Array.isArray(plan.lines)) plan.lines = [];
          plan.lines.push(line);
        }
        return line;
      },
    },
    item: {
      findMany: async ({ where }) => {
        const ids = where?.id?.in ?? [];
        return ids.map((id) => ({ id, itemType: "FG" }));
      },
    },
    docSequence: {
      upsert: async () => ({ nextNumber: 2, year2: 26, docType: "MONTHLY_PRODUCTION_PLAN" }),
    },
    $transaction: async (fn) => fn(db),
  };

  for (const model of FORBIDDEN_MODELS) {
    db[model] = {};
    for (const method of ["findMany", "findFirst", "create", "createMany", "update", "delete"]) {
      db[model][method] = throwOnTouch(`${model}.${method}`);
    }
  }

  const loadComposition = async () => composition ?? defaultComposition();

  return { db, loadComposition, state };
}

describe("monthlyPlanningAdditionalPlanP3.evaluateAdditionalPlanCreateEligibility", () => {
  it("requires approved plan, no active plan, and positive additional qty", () => {
    assert.equal(
      evaluateAdditionalPlanCreateEligibility({
        approvedPlanCount: 0,
        activePlan: null,
        totalAdditionalRequirementQty: 100,
      }).blockingCode,
      "NO_APPROVED_PLAN",
    );
    assert.equal(
      evaluateAdditionalPlanCreateEligibility({
        approvedPlanCount: 1,
        activePlan: { docNo: "MPP-2", planSequenceNo: 2, status: "DRAFT" },
        totalAdditionalRequirementQty: 100,
      }).blockingCode,
      "ACTIVE_PLAN_EXISTS",
    );
    assert.equal(
      evaluateAdditionalPlanCreateEligibility({
        approvedPlanCount: 1,
        activePlan: null,
        totalAdditionalRequirementQty: 0,
      }).blockingCode,
      "NO_ADDITIONAL_REQUIREMENT",
    );
    assert.equal(
      evaluateAdditionalPlanCreateEligibility({
        approvedPlanCount: 1,
        activePlan: null,
        totalAdditionalRequirementQty: 700,
      }).canCreate,
      true,
    );
  });
});

describe("monthlyPlanningAdditionalPlanP3.previewAdditionalPlan", () => {
  it("returns coverage and next plan number when eligible", async () => {
    const { db, loadComposition } = createAdditionalPlanDb({
      plans: [{ id: 1, periodKey: "2026-06", planSequenceNo: 1, status: "APPROVED" }],
      approvedLines: [
        { fgItemId: 65, plannedFgQty: "10000", periodKey: "2026-06", planStatus: "APPROVED" },
        { fgItemId: 66, plannedFgQty: "9300", periodKey: "2026-06", planStatus: "APPROVED" },
      ],
      composition: defaultComposition({
        items: [
          {
            itemId: 65,
            itemName: "Cap",
            rsRequirement: 10000,
            carryForward: 0,
            greenShortage: 0,
            suggestedProduction: 10000,
          },
          {
            itemId: 66,
            itemName: "Nozzle",
            rsRequirement: 10000,
            carryForward: 0,
            greenShortage: 0,
            suggestedProduction: 10000,
          },
        ],
      }),
    });

    const preview = await previewAdditionalPlan({
      db,
      periodKey: "2026-06",
      loadRequirementComposition: loadComposition,
    });

    assert.equal(preview.periodKey, "2026-06");
    assert.equal(preview.nextPlanSequenceNo, 2);
    assert.equal(preview.nextPlanLabel, "June Plan 2");
    assert.equal(preview.canCreate, true);
    assert.equal(preview.blockingCode, null);
    assert.equal(preview.items.length, 2);
    assert.equal(preview.totals.totalAdditionalRequirementQty, 700);
    const nozzle = preview.items.find((i) => i.fgItemId === 66);
    assert.equal(nozzle.additionalRequirementQty, 700);
  });

  it("canCreate=false when no approved plan exists but still returns coverage", async () => {
    const { db, loadComposition } = createAdditionalPlanDb({
      plans: [],
      approvedLines: [],
    });

    const preview = await previewAdditionalPlan({
      db,
      periodKey: "2026-06",
      loadRequirementComposition: loadComposition,
    });

    assert.equal(preview.canCreate, false);
    assert.equal(preview.blockingCode, "NO_APPROVED_PLAN");
    assert.equal(preview.items.length, 2);
    assert.equal(preview.totals.totalAdditionalRequirementQty, 20000);
  });

  it("canCreate=false when active plan exists", async () => {
    const { db, loadComposition } = createAdditionalPlanDb({
      plans: [
        { id: 1, periodKey: "2026-06", planSequenceNo: 1, status: "APPROVED" },
        { id: 2, periodKey: "2026-06", planSequenceNo: 2, status: "DRAFT", docNo: "MPP-2" },
      ],
      approvedLines: [
        { fgItemId: 65, plannedFgQty: "10000", periodKey: "2026-06", planStatus: "APPROVED" },
      ],
      composition: defaultComposition({
        items: [
          {
            itemId: 65,
            itemName: "Cap",
            rsRequirement: 12000,
            carryForward: 0,
            greenShortage: 0,
            suggestedProduction: 12000,
          },
        ],
      }),
    });

    const preview = await previewAdditionalPlan({
      db,
      periodKey: "2026-06",
      loadRequirementComposition: loadComposition,
    });

    assert.equal(preview.canCreate, false);
    assert.equal(preview.blockingCode, "ACTIVE_PLAN_EXISTS");
    assert.equal(preview.activePlan.planSequenceNo, 2);
    assert.equal(preview.nextPlanSequenceNo, 3);
    assert.ok(preview.items.length >= 1);
  });

  it("includes multiple approved plans in coverage totals", async () => {
    const { db, loadComposition } = createAdditionalPlanDb({
      plans: [
        { id: 1, periodKey: "2026-06", planSequenceNo: 1, status: "APPROVED" },
        { id: 2, periodKey: "2026-06", planSequenceNo: 2, status: "APPROVED" },
      ],
      approvedLines: [
        { fgItemId: 66, plannedFgQty: "4000", periodKey: "2026-06", planStatus: "APPROVED" },
        { fgItemId: 66, plannedFgQty: "3000", periodKey: "2026-06", planStatus: "APPROVED" },
      ],
      composition: defaultComposition({
        items: [
          {
            itemId: 66,
            itemName: "Nozzle",
            rsRequirement: 10000,
            carryForward: 0,
            greenShortage: 0,
            suggestedProduction: 10000,
          },
        ],
      }),
    });

    const preview = await previewAdditionalPlan({
      db,
      periodKey: "2026-06",
      loadRequirementComposition: loadComposition,
    });

    assert.equal(preview.approvedPlanCount, 2);
    assert.equal(preview.items[0].alreadyApprovedQty, 7000);
    assert.equal(preview.items[0].additionalRequirementQty, 3000);
    assert.equal(preview.nextPlanSequenceNo, 3);
  });

  it("canCreate=false when no additional requirement remains", async () => {
    const { db, loadComposition } = createAdditionalPlanDb({
      plans: [{ id: 1, periodKey: "2026-06", planSequenceNo: 1, status: "APPROVED" }],
      approvedLines: [
        { fgItemId: 65, plannedFgQty: "10000", periodKey: "2026-06", planStatus: "APPROVED" },
        { fgItemId: 66, plannedFgQty: "10000", periodKey: "2026-06", planStatus: "APPROVED" },
      ],
    });

    const preview = await previewAdditionalPlan({
      db,
      periodKey: "2026-06",
      loadRequirementComposition: loadComposition,
    });

    assert.equal(preview.canCreate, false);
    assert.equal(preview.blockingCode, "NO_ADDITIONAL_REQUIREMENT");
    assert.equal(preview.totals.totalAdditionalRequirementQty, 0);
    assert.equal(preview.items.length, 2);
  });
});

describe("monthlyPlanningAdditionalPlanP3.createAdditionalPlan", () => {
  it("blocks when no approved plan exists", async () => {
    const { db, loadComposition } = createAdditionalPlanDb({ plans: [] });
    await assert.rejects(
      () =>
        createAdditionalPlan({
          db,
          periodKey: "2026-06",
          actorRole: "STORE",
          loadRequirementComposition: loadComposition,
        }),
      (e) => e instanceof MonthlyPlanningError && e.code === "NO_APPROVED_PLAN",
    );
  });

  it("blocks when active plan exists", async () => {
    const { db, loadComposition } = createAdditionalPlanDb({
      plans: [
        { id: 1, periodKey: "2026-06", planSequenceNo: 1, status: "APPROVED" },
        { id: 2, periodKey: "2026-06", planSequenceNo: 2, status: "AWAITING_PURCHASE_REVIEW" },
      ],
      approvedLines: [
        { fgItemId: 66, plannedFgQty: "9000", periodKey: "2026-06", planStatus: "APPROVED" },
      ],
    });
    await assert.rejects(
      () =>
        createAdditionalPlan({
          db,
          periodKey: "2026-06",
          actorRole: "STORE",
          loadRequirementComposition: loadComposition,
        }),
      (e) => e instanceof MonthlyPlanningError && e.code === "ACTIVE_PLAN_EXISTS",
    );
  });

  it("blocks when total additional requirement is zero", async () => {
    const { db, loadComposition } = createAdditionalPlanDb({
      plans: [{ id: 1, periodKey: "2026-06", planSequenceNo: 1, status: "APPROVED" }],
      approvedLines: [
        { fgItemId: 65, plannedFgQty: "10000", periodKey: "2026-06", planStatus: "APPROVED" },
        { fgItemId: 66, plannedFgQty: "10000", periodKey: "2026-06", planStatus: "APPROVED" },
      ],
    });
    await assert.rejects(
      () =>
        createAdditionalPlan({
          db,
          periodKey: "2026-06",
          actorRole: "STORE",
          loadRequirementComposition: loadComposition,
        }),
      (e) => e instanceof MonthlyPlanningError && e.code === "NO_ADDITIONAL_REQUIREMENT",
    );
  });

  it("creates ADDITIONAL DRAFT plan with next sequence and positive lines only", async () => {
    const { db, loadComposition, state } = createAdditionalPlanDb({
      plans: [{ id: 1, periodKey: "2026-06", planSequenceNo: 1, status: "APPROVED" }],
      approvedLines: [
        { fgItemId: 65, plannedFgQty: "10000", periodKey: "2026-06", planStatus: "APPROVED" },
        { fgItemId: 66, plannedFgQty: "9300", periodKey: "2026-06", planStatus: "APPROVED" },
      ],
    });

    const created = await createAdditionalPlan({
      db,
      periodKey: "2026-06",
      actorUserId: 5,
      actorRole: "STORE",
      loadRequirementComposition: loadComposition,
    });

    assert.equal(created.plan.planSequenceNo, 2);
    assert.equal(created.plan.planKind, "ADDITIONAL");
    assert.equal(created.plan.status, "DRAFT");
    assert.equal(created.plan.displayLabel, "June Plan 2");
    assert.equal(created.lineCount, 1);
    assert.equal(created.lines.length, 1);
    assert.equal(created.lines[0].fgItemId, 66);
    assert.equal(created.lines[0].plannedFgQty, 700);
    assert.equal(created.lines[0].suggestedFgQty, 10000);
    assert.equal(created.lines[0].plannedQtyOverridden, false);
    assert.equal(created.lines[0].source, "REQUIREMENT_SHEET");
    assert.match(created.lines[0].remarks, /Additional requirement/);
    assert.equal(state.plans.length, 2);
  });

  it("uses plannedFgQty equal to additionalRequirementQty", async () => {
    const { db, loadComposition } = createAdditionalPlanDb({
      plans: [
        { id: 1, periodKey: "2026-06", planSequenceNo: 1, status: "APPROVED" },
        { id: 2, periodKey: "2026-06", planSequenceNo: 2, status: "APPROVED" },
      ],
      approvedLines: [
        { fgItemId: 66, plannedFgQty: "4000", periodKey: "2026-06", planStatus: "APPROVED" },
        { fgItemId: 66, plannedFgQty: "3000", periodKey: "2026-06", planStatus: "APPROVED" },
      ],
      composition: defaultComposition({
        items: [
          {
            itemId: 66,
            itemName: "Nozzle",
            rsRequirement: 10000,
            carryForward: 0,
            greenShortage: 0,
            suggestedProduction: 10000,
          },
        ],
      }),
    });

    const created = await createAdditionalPlan({
      db,
      periodKey: "2026-06",
      actorRole: "STORE",
      loadRequirementComposition: loadComposition,
    });

    assert.equal(created.plan.planSequenceNo, 3);
    assert.equal(created.lines[0].plannedFgQty, 3000);
    assert.equal(created.lines[0].suggestedFgQty, 10000);
  });

  it("does not touch procurement, RM snapshot, or release models", async () => {
    const { db, loadComposition } = createAdditionalPlanDb({
      plans: [{ id: 1, periodKey: "2026-06", planSequenceNo: 1, status: "APPROVED" }],
      approvedLines: [
        { fgItemId: 66, plannedFgQty: "5000", periodKey: "2026-06", planStatus: "APPROVED" },
      ],
    });

    await previewAdditionalPlan({
      db,
      periodKey: "2026-06",
      loadRequirementComposition: loadComposition,
    });
    await createAdditionalPlan({
      db,
      periodKey: "2026-06",
      actorRole: "STORE",
      loadRequirementComposition: loadComposition,
    });
  });
});
