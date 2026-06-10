const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getMonthlyPlanByPeriod,
  createMonthlyPlan,
  cancelReopenMonthlyPlan,
  reopenMonthlyPlan,
  updateProductionLines,
  MonthlyPlanningError,
} = require("../../src/services/monthlyPlanningService");
const { getRequirementComposition } = require("../../src/services/monthlyPlanningRequirementCompositionService");

const WRITE_METHODS = [
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
];

function throwOnWrite(name) {
  return async () => {
    throw new Error(`Unexpected write: ${name}`);
  };
}

function emptyCompositionLoader() {
  return async () => ({ periodKey: "2026-06", items: [] });
}

function emptyGreenLoader() {
  return async () => ({ anchorPeriodKey: "2026-06", items: [] });
}

function createCancelReopenDb({
  status = "DRAFT",
  currentRevision = 3,
  reopenedAt = new Date("2026-07-02T10:00:00Z"),
  liveLines = [],
  snapshotLines = [],
  rmPlans = [],
} = {}) {
  const state = {
    plan: {
      id: 1,
      docNo: "MPP-26-0001",
      periodKey: "2026-07",
      status,
      currentRevision,
      remarks: null,
      lockedAt: new Date("2026-07-01T10:00:00Z"),
      lockedByUserId: 9,
      reopenedAt,
      reopenedByUserId: 5,
      releasedAt: null,
      releasedRevision: null,
      createdByUserId: 7,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-02T10:00:00Z"),
    },
    liveLines: liveLines.map((l) => ({ ...l })),
    snapshotLines: snapshotLines.map((l) => ({ ...l })),
    rmPlans: [...rmPlans],
    writes: [],
  };

  const itemMeta = new Map([
    [10, { id: 10, itemName: "Cap", itemType: "FG", unit: "NOS" }],
    [11, { id: 11, itemName: "Nozzle", itemType: "FG", unit: "NOS" }],
  ]);

  const db = {
    monthlyProductionPlan: {
      findUnique: async ({ where, select }) => {
        if (where.id !== 1 && where.periodKey && where.periodKey !== state.plan.periodKey) return null;
        if (where.periodKey && where.periodKey !== state.plan.periodKey) return null;
        if (where.id && where.id !== 1) return null;
        const row = { ...state.plan };
        if (select) {
          const out = {};
          for (const key of Object.keys(select)) {
            if (select[key] === true) out[key] = row[key];
          }
          return out;
        }
        return row;
      },
      create: async ({ data }) => {
        Object.assign(state.plan, data, { id: 1 });
        state.writes.push({ type: "plan.create" });
        return { ...state.plan, lines: [] };
      },
      update: async ({ where, data }) => {
        if (where.id === 1) Object.assign(state.plan, data);
        state.writes.push({ type: "plan.update", data });
        return { ...state.plan };
      },
      delete: throwOnWrite("monthlyProductionPlan.delete"),
    },
    monthlyProductionPlanLine: {
      findMany: async () =>
        state.liveLines.map((l) => ({
          ...l,
          fgItem: itemMeta.get(l.fgItemId),
        })),
      deleteMany: async ({ where }) => {
        const before = state.liveLines.length;
        if (where.planId) state.liveLines = state.liveLines.filter((l) => l.planId !== where.planId);
        state.writes.push({ type: "line.deleteMany", count: before - state.liveLines.length });
        return { count: before - state.liveLines.length };
      },
      createMany: async ({ data }) => {
        for (const row of data) {
          state.liveLines.push({
            id: state.liveLines.length + 1,
            planId: row.planId,
            ...row,
          });
        }
        state.writes.push({ type: "line.createMany", count: data.length });
        return { count: data.length };
      },
      upsert: async ({ where, create, update }) => {
        const fgItemId = where.planId_fgItemId?.fgItemId ?? create.fgItemId;
        const idx = state.liveLines.findIndex((x) => x.fgItemId === fgItemId);
        const row = { id: idx >= 0 ? state.liveLines[idx].id : state.liveLines.length + 1, ...create, ...update };
        if (idx >= 0) state.liveLines[idx] = { ...state.liveLines[idx], ...row };
        else state.liveLines.push(row);
        return row;
      },
    },
    monthlyProductionPlanRevisionLine: {
      findMany: async ({ where }) =>
        state.snapshotLines.filter(
          (l) => l.planId === where.planId && l.revision === where.revision,
        ),
    },
    rmPlan: {
      findMany: async () => state.rmPlans,
    },
    item: {
      findMany: async ({ where, select }) =>
        (where.id.in || [])
          .map((id) => {
            const meta = itemMeta.get(id);
            if (!meta) return null;
            if (select?.itemType) return { id: meta.id, itemType: meta.itemType };
            return meta;
          })
          .filter(Boolean),
    },
    $transaction: async (fn) => fn(db),
    __state: state,
  };

  for (const model of [
    "materialRequirement",
    "materialRequirementLine",
    "purchaseRequest",
    "stockTransaction",
    "rmPlanLine",
  ]) {
    db[model] = {};
    for (const method of WRITE_METHODS) {
      if (!db[model][method]) db[model][method] = throwOnWrite(`${model}.${method}`);
    }
  }

  return db;
}

describe("monthlyPlanning lazy draft / preview", () => {
  it("GET by period does not create a plan", async () => {
    const db = createCancelReopenDb();
    db.monthlyProductionPlan.findUnique = async () => null;
    const res = await getMonthlyPlanByPeriod({ db, period: "2026-08" });
    assert.equal(res.exists, false);
    assert.equal(res.plan, null);
    assert.equal(db.__state.writes.length, 0);
  });

  it("composition API works without a plan id", async () => {
    const db = createCancelReopenDb();
    const res = await getRequirementComposition({
      db,
      periodKey: "2026-07",
      loadRsSuggestions: async () => ({ periodKey: "2026-07", sheetCount: 0, items: [] }),
      loadGreenLevels: async () => ({ anchorPeriodKey: "2026-07", items: [] }),
    });
    assert.equal(res.periodKey, "2026-07");
    assert.ok(Array.isArray(res.items));
  });

  it("explicit POST creates DRAFT Rev 0", async () => {
    const db = createCancelReopenDb();
    db.monthlyProductionPlan.findUnique = async ({ where }) => {
      if (where.periodKey) return null;
      return db.__state.plan;
    };
    db.docSequence = {
      upsert: async () => ({ nextNumber: 2, year2: 26, docType: "MONTHLY_PRODUCTION_PLAN" }),
    };
    const res = await createMonthlyPlan({ db, period: "2026-08", actorUserId: 7 });
    assert.equal(res.plan.status, "DRAFT");
    assert.equal(res.plan.currentRevision, 0);
    assert.equal(db.__state.writes.length, 1);
  });
});

describe("monthlyPlanningService.cancelReopenMonthlyPlan", () => {
  it("restores LOCKED state and FG lines from revision snapshot", async () => {
    const db = createCancelReopenDb({
      liveLines: [
        { planId: 1, fgItemId: 10, suggestedFgQty: 12000, plannedFgQty: 12000, plannedQtyOverridden: true, source: "MANUAL", remarks: "draft edit" },
        { planId: 1, fgItemId: 11, suggestedFgQty: 8000, plannedFgQty: 8000, plannedQtyOverridden: false, source: "MANUAL", remarks: "draft edit" },
      ],
      snapshotLines: [
        { planId: 1, revision: 3, fgItemId: 10, suggestedFgQty: 10000, plannedFgQty: 10000, plannedQtyOverridden: false, source: "MANUAL", remarks: "rev3 cap" },
        { planId: 1, revision: 3, fgItemId: 11, suggestedFgQty: 10000, plannedFgQty: 10000, plannedQtyOverridden: false, source: "MANUAL", remarks: "rev3 nozzle" },
      ],
      rmPlans: [{ id: 100, planId: 1, revision: 3, totalFgPlannedQty: 20000 }],
    });

    const res = await cancelReopenMonthlyPlan({ db, planId: 1, actorUserId: 9 });
    assert.equal(res.status, "LOCKED");
    assert.equal(res.currentRevision, 3);
    assert.equal(res.restoredRevision, 3);
    assert.equal(db.__state.plan.status, "LOCKED");
    assert.equal(db.__state.plan.reopenedAt, null);
    assert.equal(db.__state.plan.currentRevision, 3);
    assert.equal(db.__state.liveLines.length, 2);
    assert.equal(Number(db.__state.liveLines[0].plannedFgQty), 10000);
    assert.equal(Number(db.__state.liveLines[1].plannedFgQty), 10000);
    assert.equal(db.__state.rmPlans.length, 1);
    assert.equal(db.__state.writes.filter((w) => w.type.startsWith("materialRequirement")).length, 0);
  });

  it("does not create a new revision", async () => {
    const db = createCancelReopenDb({
      snapshotLines: [
        { planId: 1, revision: 3, fgItemId: 10, suggestedFgQty: 10000, plannedFgQty: 10000, plannedQtyOverridden: false, source: "MANUAL", remarks: null },
      ],
      rmPlans: [
        { id: 100, revision: 1 },
        { id: 101, revision: 2 },
        { id: 102, revision: 3 },
      ],
    });
    await cancelReopenMonthlyPlan({ db, planId: 1 });
    assert.equal(db.__state.plan.currentRevision, 3);
    assert.equal(db.__state.rmPlans.length, 3);
    assert.equal(db.__state.writes.filter((w) => w.type === "rmPlan.create").length, 0);
  });

  it("rejects cancel when not reopened", async () => {
    const db = createCancelReopenDb({ reopenedAt: null, status: "DRAFT", currentRevision: 0 });
    await assert.rejects(
      () => cancelReopenMonthlyPlan({ db, planId: 1 }),
      (e) => e instanceof MonthlyPlanningError && e.code === "PLAN_NOT_CANCELLABLE",
    );
  });

  it("rejects cancel when revision snapshot missing", async () => {
    const db = createCancelReopenDb({ snapshotLines: [] });
    await assert.rejects(
      () => cancelReopenMonthlyPlan({ db, planId: 1 }),
      (e) => e instanceof MonthlyPlanningError && e.code === "REVISION_SNAPSHOT_MISSING",
    );
  });

  it("full flow: reopen → edit → cancel restores locked rev 3", async () => {
    const db = createCancelReopenDb({
      status: "LOCKED",
      currentRevision: 3,
      reopenedAt: null,
      liveLines: [
        { planId: 1, fgItemId: 10, suggestedFgQty: 10000, plannedFgQty: 10000, plannedQtyOverridden: false, source: "MANUAL", remarks: "rev3" },
      ],
      snapshotLines: [
        { planId: 1, revision: 3, fgItemId: 10, suggestedFgQty: 10000, plannedFgQty: 10000, plannedQtyOverridden: false, source: "MANUAL", remarks: "rev3" },
      ],
    });

    await reopenMonthlyPlan({ db, planId: 1, actorUserId: 5 });
    assert.equal(db.__state.plan.status, "DRAFT");

    await updateProductionLines({
      db,
      planId: 1,
      upserts: [{ fgItemId: 10, plannedFgQty: 15000, plannedQtyOverridden: true, remarks: "draft bump" }],
      loadComposition: emptyCompositionLoader,
      loadGreenLevelsFn: emptyGreenLoader,
    });
    assert.equal(Number(db.__state.liveLines[0].plannedFgQty), 15000);

    await cancelReopenMonthlyPlan({ db, planId: 1 });
    assert.equal(db.__state.plan.status, "LOCKED");
    assert.equal(Number(db.__state.liveLines[0].plannedFgQty), 10000);
    assert.equal(db.__state.plan.currentRevision, 3);
  });
});
