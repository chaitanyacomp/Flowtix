const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  createMonthlyPlan,
  getMonthlyPlanByPeriod,
  updateProductionLines,
  MonthlyPlanningError,
} = require("../../src/services/monthlyPlanningService");
const {
  MONTHLY_PLAN_ACTIVE_STATUSES,
  assertNoOtherActivePlanInPeriod,
  getNextPlanSequenceNo,
  resolvePlanKindForSequence,
  submitPlanForPurchaseReview,
  purchaseApprovePlan,
  purchaseRejectPlan,
  isPlanEditableStatus,
  isPlanImmutableStatus,
  buildPlanDisplayLabel,
} = require("../../src/services/monthlyPlanningPlanLifecycleService");

function createPlanDocumentDb(initialPlans = []) {
  const state = {
    nextId: 100,
    nextLineId: 1,
    plans: initialPlans.map((p, idx) => ({
      id: p.id ?? idx + 1,
      planSequenceNo: p.planSequenceNo ?? 1,
      planKind: p.planKind ?? (p.planSequenceNo > 1 ? "ADDITIONAL" : "INITIAL"),
      currentRevision: p.currentRevision ?? 0,
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
  };

  const db = {
    __state: state,
    monthlyProductionPlan: {
      findUnique: async ({ where, select }) => {
        let row = null;
        if (where.id != null) row = state.plans.find((p) => p.id === where.id) ?? null;
        else if (where.periodKey) row = state.plans.find((p) => p.periodKey === where.periodKey) ?? null;
        if (!row) return null;
        if (!select) return { ...row };
        const out = {};
        for (const key of Object.keys(select)) {
          if (select[key] === true) out[key] = row[key];
        }
        return out;
      },
      findMany: async ({ where, orderBy, include, select }) => {
        let rows = [...state.plans];
        if (where?.periodKey) rows = rows.filter((p) => p.periodKey === where.periodKey);
        if (where?.status?.in) rows = rows.filter((p) => where.status.in.includes(p.status));
        if (where?.id?.not != null) rows = rows.filter((p) => p.id !== where.id.not);
        if (orderBy?.planSequenceNo === "asc") {
          rows.sort((a, b) => Number(a.planSequenceNo) - Number(b.planSequenceNo));
        }
        return rows.map((r) => ({ ...r, lines: r.lines ?? [], rmPlans: r.rmPlans ?? [] }));
      },
      aggregate: async ({ where, _max }) => {
        let rows = state.plans;
        if (where?.periodKey) rows = rows.filter((p) => p.periodKey === where.periodKey);
        const maxSeq = rows.reduce((m, p) => Math.max(m, Number(p.planSequenceNo ?? 0)), 0);
        return { _max: { planSequenceNo: maxSeq > 0 ? maxSeq : null } };
      },
      create: async ({ data, include }) => {
        const row = {
          id: ++state.nextId,
          docNo: `MPP-26-${String(state.nextId).padStart(4, "0")}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          lines: [],
          rmPlans: [],
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
          ...data,
        };
        state.plans.push(row);
        return include?.lines ? row : row;
      },
      update: async ({ where, data }) => {
        const idx = state.plans.findIndex((p) => p.id === where.id);
        assert.notEqual(idx, -1);
        state.plans[idx] = { ...state.plans[idx], ...data, updatedAt: new Date() };
        return state.plans[idx];
      },
    },
    monthlyProductionPlanLine: {
      findMany: async ({ where }) => {
        const plan = state.plans.find((p) => p.id === where.planId);
        return plan?.lines ?? [];
      },
      upsert: async () => ({}),
      deleteMany: async () => ({ count: 0 }),
    },
    item: {
      findMany: async () => [{ id: 65, itemType: "FG" }],
    },
    rmPlan: {
      findUnique: async () => null,
      create: async ({ data }) => {
        const row = { id: 501, ...data };
        if (!state.rmPlans) state.rmPlans = [];
        state.rmPlans.push(row);
        return row;
      },
    },
    rmPlanLine: {
      createMany: async () => ({ count: 0 }),
    },
    monthlyProductionPlanRevisionLine: {
      createMany: async () => ({ count: 0 }),
    },
    docSequence: {
      upsert: async () => ({ nextNumber: 2, year2: 26, docType: "MONTHLY_PRODUCTION_PLAN" }),
    },
    $transaction: async (fn) => fn(db),
  };
  return db;
}

describe("monthlyPlanningPlanDocumentP1.lifecycle helpers", () => {
  it("exposes active statuses DRAFT and AWAITING_PURCHASE_REVIEW", () => {
    assert.deepEqual(MONTHLY_PLAN_ACTIVE_STATUSES, ["DRAFT", "AWAITING_PURCHASE_REVIEW"]);
    assert.equal(isPlanEditableStatus("DRAFT"), true);
    assert.equal(isPlanEditableStatus("AWAITING_PURCHASE_REVIEW"), false);
    assert.equal(isPlanImmutableStatus("APPROVED"), true);
    assert.equal(isPlanImmutableStatus("LOCKED"), true);
  });

  it("assigns plan kind from sequence number", () => {
    assert.equal(resolvePlanKindForSequence(1), "INITIAL");
    assert.equal(resolvePlanKindForSequence(2), "ADDITIONAL");
  });

  it("builds human-readable display labels", () => {
    assert.equal(
      buildPlanDisplayLabel({ periodKey: "2026-06", planSequenceNo: 2 }),
      "June Plan 2",
    );
  });
});

describe("monthlyPlanningPlanDocumentP1.multiple plans per period", () => {
  it("allows a second plan when the first is APPROVED", async () => {
    const db = createPlanDocumentDb([
      {
        id: 1,
        periodKey: "2026-06",
        planSequenceNo: 1,
        status: "APPROVED",
      },
    ]);
    const res = await createMonthlyPlan({ db, period: "2026-06", actorUserId: 2 });
    assert.equal(res.plan.planSequenceNo, 2);
    assert.equal(res.plan.planKind, "ADDITIONAL");
    assert.equal(res.plan.status, "DRAFT");
  });

  it("enforces unique sequence per period via getNextPlanSequenceNo", async () => {
    const db = createPlanDocumentDb([
      { id: 1, periodKey: "2026-06", planSequenceNo: 1, status: "APPROVED" },
      { id: 2, periodKey: "2026-06", planSequenceNo: 2, status: "APPROVED" },
    ]);
    const next = await getNextPlanSequenceNo(db, "2026-06");
    assert.equal(next, 3);
  });

  it("blocks create when an active plan already exists", async () => {
    const db = createPlanDocumentDb([
      { id: 1, periodKey: "2026-06", planSequenceNo: 1, status: "DRAFT" },
    ]);
    await assert.rejects(
      () => createMonthlyPlan({ db, period: "2026-06" }),
      (e) => e instanceof MonthlyPlanningError && e.code === "ACTIVE_PLAN_EXISTS",
    );
  });

  it("getMonthlyPlanByPeriod returns all plans and a primary selection", async () => {
    const db = createPlanDocumentDb([
      { id: 1, periodKey: "2026-06", planSequenceNo: 1, status: "APPROVED", docNo: "MPP-1" },
      { id: 2, periodKey: "2026-06", planSequenceNo: 2, status: "DRAFT", docNo: "MPP-2" },
    ]);
    const res = await getMonthlyPlanByPeriod({ db, period: "2026-06" });
    assert.equal(res.exists, true);
    assert.equal(res.plans.length, 2);
    assert.equal(res.plan.id, 2, "primary should prefer active DRAFT plan");
  });
});

describe("monthlyPlanningPlanDocumentP1.purchase review transitions", () => {
  it("submit for review moves DRAFT to AWAITING_PURCHASE_REVIEW", async () => {
    const db = createPlanDocumentDb([
      {
        id: 10,
        periodKey: "2026-07",
        planSequenceNo: 1,
        status: "DRAFT",
        lines: [{ plannedFgQty: "100" }],
      },
    ]);
    const res = await submitPlanForPurchaseReview({ db, planId: 10, actorUserId: 2 });
    assert.equal(res.status, "AWAITING_PURCHASE_REVIEW");
    assert.ok(res.lockedAt);
    assert.equal(db.__state.plans[0].status, "AWAITING_PURCHASE_REVIEW");
  });

  it("purchase approve freezes plan as APPROVED", async () => {
    const db = createPlanDocumentDb([
      {
        id: 11,
        periodKey: "2026-07",
        planSequenceNo: 1,
        status: "AWAITING_PURCHASE_REVIEW",
        lines: [{ id: 1, fgItemId: 65, plannedFgQty: "100", suggestedFgQty: "0", plannedQtyOverridden: false, source: "MANUAL" }],
      },
    ]);
    const deps = {
      loadApprovedBomWithLines: async () => ({ id: 1, lines: [{ id: 1 }] }),
      aggregateRmDemandForFgLines: async () => ({ rmNeeded: new Map([[70, 5]]), missingChildBoms: [] }),
      getMaterialAvailabilityByItems: async () => [
        { itemId: 70, freeStockQty: 0, effectiveReservedQty: 0, incomingQty: 0, netShortageAfterIncomingQty: 5, warnings: [] },
      ],
    };
    const res = await purchaseApprovePlan({ db, planId: 11, actorUserId: 3, deps });
    assert.equal(res.status, "APPROVED");
    assert.ok(res.approvedAt);
  });

  it("purchase reject returns plan to DRAFT with reason", async () => {
    const db = createPlanDocumentDb([
      {
        id: 12,
        periodKey: "2026-07",
        planSequenceNo: 1,
        status: "AWAITING_PURCHASE_REVIEW",
        lockedAt: new Date(),
        lockedByUserId: 2,
      },
    ]);
    const res = await purchaseRejectPlan({ db, planId: 12, reason: "FG qty needs correction", actorUserId: 3 });
    assert.equal(res.status, "DRAFT");
    assert.equal(res.purchaseRejectReason, "FG qty needs correction");
    assert.equal(db.__state.plans[0].lockedAt, null);
  });

  it("approved plan is not editable", async () => {
    const db = createPlanDocumentDb([
      {
        id: 13,
        periodKey: "2026-07",
        planSequenceNo: 1,
        status: "APPROVED",
      },
    ]);
    await assert.rejects(
      () =>
        updateProductionLines({
          db,
          planId: 13,
          upserts: [{ fgItemId: 65, plannedFgQty: 50 }],
          loadComposition: async () => ({ periodKey: "2026-07", items: [] }),
        }),
      (e) => e instanceof MonthlyPlanningError && e.code === "PLAN_NOT_EDITABLE",
    );
  });
});

describe("monthlyPlanningPlanDocumentP1.one active plan rule", () => {
  it("assertNoOtherActivePlanInPeriod ignores the current plan id", async () => {
    const db = createPlanDocumentDb([
      { id: 20, periodKey: "2026-08", planSequenceNo: 1, status: "DRAFT" },
    ]);
    await assertNoOtherActivePlanInPeriod(db, "2026-08", 20);
  });

  it("submit blocks when another active plan exists in the period", async () => {
    const db = createPlanDocumentDb([
      { id: 21, periodKey: "2026-08", planSequenceNo: 1, status: "DRAFT", lines: [{ plannedFgQty: 10 }] },
      { id: 22, periodKey: "2026-08", planSequenceNo: 2, status: "DRAFT", lines: [{ plannedFgQty: 5 }] },
    ]);
    await assert.rejects(
      () => submitPlanForPurchaseReview({ db, planId: 22, actorUserId: 2 }),
      (e) => e instanceof MonthlyPlanningError && e.code === "ACTIVE_PLAN_EXISTS",
    );
  });
});

describe("monthlyPlanningPlanDocumentP1.legacy migration compatibility", () => {
  it("loads legacy LOCKED plans with planSequenceNo default semantics", async () => {
    const db = createPlanDocumentDb([
      {
        id: 30,
        docNo: "MPP-26-0001",
        periodKey: "2026-06",
        planSequenceNo: 1,
        planKind: "INITIAL",
        status: "LOCKED",
        currentRevision: 1,
        releasedRevision: 1,
        rmPlans: [{ revision: 1, recalculatedAt: new Date() }],
      },
    ]);
    const res = await getMonthlyPlanByPeriod({ db, period: "2026-06" });
    assert.equal(res.exists, true);
    assert.equal(res.plan.status, "LOCKED");
    assert.equal(res.plan.planSequenceNo, 1);
    assert.equal(res.plan.currentRevision, 1);
    assert.equal(res.revisions.length, 1);
  });
});

