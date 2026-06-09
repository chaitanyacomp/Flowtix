const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePeriodKey,
  getMonthlyPlanByPeriod,
  createMonthlyPlan,
  getProductionLines,
  updateProductionLines,
  lockMonthlyPlan,
  getRmPlanning,
  getPurchasePlanning,
  releaseToProcurement,
  MonthlyPlanningError,
} = require("../../src/services/monthlyPlanningService");
const { readBoolEnv, isMonthlyPlanningEnabled } = require("../../src/config/featureFlags");

/**
 * Mock Prisma-like db. Supports the small surface the Phase 1 service uses:
 *  - monthlyProductionPlan.findUnique / create
 *  - docSequence.upsert (used by allocateDocNo)
 *  - $transaction(fn) → fn(self)
 */
function createMockDb({ existingPlan = null, nextDocSeq = 1 } = {}) {
  const state = { created: null, planById: existingPlan };
  const db = {
    monthlyProductionPlan: {
      findUnique: async ({ where }) => {
        if (where.periodKey && state.planById && state.planById.periodKey === where.periodKey) {
          return state.planById;
        }
        return state.planById && !where.periodKey ? state.planById : (where.periodKey ? null : state.planById);
      },
      create: async ({ data }) => {
        state.created = {
          id: 101,
          lines: [],
          createdAt: new Date("2026-06-01T00:00:00Z"),
          updatedAt: new Date("2026-06-01T00:00:00Z"),
          lockedAt: null,
          reopenedAt: null,
          releasedAt: null,
          releasedRevision: null,
          ...data,
        };
        return state.created;
      },
    },
    docSequence: {
      upsert: async () => ({ nextNumber: nextDocSeq + 1, year2: 26, docType: "MONTHLY_PRODUCTION_PLAN" }),
    },
    $transaction: async (fn) => fn(db),
  };
  return db;
}

describe("monthlyPlanningService.normalizePeriodKey", () => {
  it("accepts valid YYYY-MM", () => {
    assert.equal(normalizePeriodKey("2026-06"), "2026-06");
    assert.equal(normalizePeriodKey(" 2026-12 "), "2026-12");
  });

  it("rejects invalid period formats", () => {
    for (const bad of ["2026-13", "2026-00", "26-06", "2026/06", "june", "", null, undefined]) {
      assert.throws(() => normalizePeriodKey(bad), (e) => e instanceof MonthlyPlanningError && e.code === "INVALID_PERIOD");
    }
  });
});

describe("monthlyPlanningService.createMonthlyPlan", () => {
  it("creates a DRAFT plan at revision 0 with a docNo and empty lines", async () => {
    const db = createMockDb({ existingPlan: null });
    const res = await createMonthlyPlan({ db, period: "2026-06", actorUserId: 7 });
    assert.equal(res.exists, true);
    assert.equal(res.plan.periodKey, "2026-06");
    assert.equal(res.plan.status, "DRAFT");
    assert.equal(res.plan.currentRevision, 0);
    assert.equal(res.plan.createdByUserId, 7);
    assert.ok(res.plan.docNo, "docNo should be allocated");
    assert.deepEqual(res.lines, []);
    assert.deepEqual(res.revisions, []);
  });

  it("blocks a duplicate period (one plan per month)", async () => {
    const db = createMockDb({ existingPlan: { id: 5, periodKey: "2026-06" } });
    await assert.rejects(
      () => createMonthlyPlan({ db, period: "2026-06", actorUserId: 7 }),
      (e) => e instanceof MonthlyPlanningError && e.code === "DUPLICATE_PERIOD" && e.httpStatus === 409,
    );
  });

  it("rejects invalid period before touching the db", async () => {
    const db = createMockDb();
    await assert.rejects(
      () => createMonthlyPlan({ db, period: "bad" }),
      (e) => e instanceof MonthlyPlanningError && e.code === "INVALID_PERIOD",
    );
  });
});

describe("monthlyPlanningService.getMonthlyPlanByPeriod", () => {
  it("returns exists:false when no plan for the period", async () => {
    const db = createMockDb({ existingPlan: null });
    const res = await getMonthlyPlanByPeriod({ db, period: "2026-07" });
    assert.equal(res.exists, false);
    assert.equal(res.plan, null);
    assert.deepEqual(res.lines, []);
    assert.deepEqual(res.revisions, []);
  });

  it("returns the plan with mapped lines and revisions", async () => {
    const db = createMockDb({
      existingPlan: {
        id: 9,
        docNo: "MPP-26-0001",
        periodKey: "2026-06",
        status: "LOCKED",
        currentRevision: 2,
        remarks: null,
        createdByUserId: 7,
        createdAt: new Date(),
        updatedAt: new Date(),
        lockedAt: new Date(),
        reopenedAt: null,
        releasedAt: null,
        releasedRevision: null,
        lines: [
          { id: 1, fgItemId: 50, suggestedFgQty: "100.000", plannedFgQty: "120.000", source: "SALES_ORDER", remarks: null },
        ],
        rmPlans: [
          { revision: 1, recalculatedAt: new Date() },
          { revision: 2, recalculatedAt: new Date() },
        ],
      },
    });
    const res = await getMonthlyPlanByPeriod({ db, period: "2026-06" });
    assert.equal(res.exists, true);
    assert.equal(res.plan.status, "LOCKED");
    assert.equal(res.plan.currentRevision, 2);
    assert.deepEqual(res.lines, []);
    assert.equal(res.revisions.length, 2);
    assert.equal(res.revisions[1].revision, 2);
  });
});

/**
 * Mock db for production-line CRUD. Tracks upserts/deletes and serves lines back.
 */
function createLinesMockDb({ status = "DRAFT", planId = 1, items = [], existingLines = [] } = {}) {
  const state = {
    lines: existingLines.map((l) => ({ ...l })),
    upserts: [],
    deletes: [],
  };
  const itemTypeById = new Map(items.map((i) => [i.id, i.itemType]));
  const db = {
    monthlyProductionPlan: {
      findUnique: async ({ where }) =>
        where.id === planId ? { id: planId, status, periodKey: "2026-06" } : null,
    },
    monthlyProductionPlanLine: {
      findMany: async () =>
        state.lines.map((l) => ({
          id: l.id,
          fgItemId: l.fgItemId,
          suggestedFgQty: l.suggestedFgQty ?? 0,
          plannedFgQty: l.plannedFgQty ?? 0,
          plannedQtyOverridden: Boolean(l.plannedQtyOverridden),
          source: l.source ?? "MANUAL",
          remarks: l.remarks ?? null,
          fgItem: { id: l.fgItemId, itemName: `Item ${l.fgItemId}`, itemType: "FG", unit: "NOS" },
        })),
      deleteMany: async ({ where }) => {
        state.deletes.push(where.id);
        state.lines = state.lines.filter((l) => l.id !== where.id);
        return { count: 1 };
      },
      upsert: async ({ where, create, update }) => {
        state.upserts.push({ where, create, update });
        const fgItemId = where.planId_fgItemId.fgItemId;
        const found = state.lines.find((l) => l.fgItemId === fgItemId);
        if (found) Object.assign(found, update);
        else state.lines.push({ id: 1000 + state.lines.length, fgItemId, ...create });
        return {};
      },
    },
    item: {
      findMany: async ({ where }) =>
        (where.id.in || [])
          .filter((id) => itemTypeById.has(id))
          .map((id) => ({ id, itemType: itemTypeById.get(id) })),
    },
    $transaction: async (fn) => fn(db),
    __state: state,
  };
  return db;
}

const emptyCompositionLoader = async () => ({ periodKey: "2026-06", items: [] });
const emptyGreenLoader = async () => ({ anchorPeriodKey: "2026-06", items: [] });

describe("monthlyPlanningService.getProductionLines", () => {
  it("returns mapped lines + editable flag for DRAFT", async () => {
    const db = createLinesMockDb({
      status: "DRAFT",
      existingLines: [{ id: 11, fgItemId: 50, suggestedFgQty: 10, plannedFgQty: 12, source: "MANUAL" }],
    });
    const res = await getProductionLines({
      db,
      planId: 1,
      loadComposition: emptyCompositionLoader,
      loadGreenLevelsFn: emptyGreenLoader,
    });
    assert.equal(res.editable, true);
    assert.equal(res.status, "DRAFT");
    assert.equal(res.lines.length, 1);
    assert.equal(res.lines[0].fgItemId, 50);
    assert.equal(res.lines[0].fgItemName, "Item 50");
  });

  it("marks LOCKED plans not editable", async () => {
    const db = createLinesMockDb({ status: "LOCKED" });
    const res = await getProductionLines({
      db,
      planId: 1,
      loadComposition: emptyCompositionLoader,
      loadGreenLevelsFn: emptyGreenLoader,
    });
    assert.equal(res.editable, false);
    assert.equal(res.status, "LOCKED");
  });

  it("throws PLAN_NOT_FOUND for unknown plan", async () => {
    const db = createLinesMockDb({ planId: 1 });
    await assert.rejects(
      () => getProductionLines({ db, planId: 999 }),
      (e) => e instanceof MonthlyPlanningError && e.code === "PLAN_NOT_FOUND" && e.httpStatus === 404,
    );
  });
});

describe("monthlyPlanningService.updateProductionLines", () => {
  it("upserts valid FG lines on a DRAFT plan", async () => {
    const db = createLinesMockDb({ status: "DRAFT", items: [{ id: 50, itemType: "FG" }, { id: 51, itemType: "FG" }] });
    const res = await updateProductionLines({
      db,
      planId: 1,
      upserts: [
        { fgItemId: 50, plannedFgQty: 100, source: "MANUAL" },
        { fgItemId: 51, plannedFgQty: 0, source: "SALES_ORDER", remarks: "from SO" },
      ],
      loadComposition: async () => ({
        periodKey: "2026-06",
        items: [{ itemId: 51, suggestedProduction: 5 }],
      }),
      loadGreenLevelsFn: emptyGreenLoader,
    });
    assert.equal(db.__state.upserts.length, 2);
    assert.equal(res.lines.length, 2);
  });

  it("deletes rows on a DRAFT plan", async () => {
    const db = createLinesMockDb({
      status: "DRAFT",
      existingLines: [{ id: 11, fgItemId: 50, plannedFgQty: 12 }],
    });
    await updateProductionLines({
      db,
      planId: 1,
      deletes: [11],
      loadComposition: emptyCompositionLoader,
      loadGreenLevelsFn: emptyGreenLoader,
    });
    assert.deepEqual(db.__state.deletes, [11]);
  });

  it("blocks editing a LOCKED plan (read-only)", async () => {
    const db = createLinesMockDb({ status: "LOCKED", items: [{ id: 50, itemType: "FG" }] });
    await assert.rejects(
      () =>
        updateProductionLines({
          db,
          planId: 1,
          upserts: [{ fgItemId: 50, plannedFgQty: 1 }],
          loadComposition: emptyCompositionLoader,
        }),
      (e) => e instanceof MonthlyPlanningError && e.code === "PLAN_NOT_EDITABLE" && e.httpStatus === 409,
    );
  });

  it("rejects negative plannedFgQty", async () => {
    const db = createLinesMockDb({ status: "DRAFT", items: [{ id: 50, itemType: "FG" }] });
    await assert.rejects(
      () =>
        updateProductionLines({
          db,
          planId: 1,
          upserts: [{ fgItemId: 50, plannedFgQty: -5 }],
          loadComposition: emptyCompositionLoader,
        }),
      (e) => e instanceof MonthlyPlanningError && e.code === "INVALID_QTY",
    );
  });

  it("blocks duplicate fgItemId within a request", async () => {
    const db = createLinesMockDb({ status: "DRAFT", items: [{ id: 50, itemType: "FG" }] });
    await assert.rejects(
      () =>
        updateProductionLines({
          db,
          planId: 1,
          upserts: [
            { fgItemId: 50, plannedFgQty: 1 },
            { fgItemId: 50, plannedFgQty: 2 },
          ],
          loadComposition: emptyCompositionLoader,
        }),
      (e) => e instanceof MonthlyPlanningError && e.code === "DUPLICATE_FG_ITEM",
    );
  });

  it("rejects a non-FG item", async () => {
    const db = createLinesMockDb({ status: "DRAFT", items: [{ id: 70, itemType: "RM" }] });
    await assert.rejects(
      () =>
        updateProductionLines({
          db,
          planId: 1,
          upserts: [{ fgItemId: 70, plannedFgQty: 1 }],
          loadComposition: emptyCompositionLoader,
        }),
      (e) => e instanceof MonthlyPlanningError && e.code === "NOT_FG_ITEM",
    );
  });

  it("rejects an unknown fgItem", async () => {
    const db = createLinesMockDb({ status: "DRAFT", items: [] });
    await assert.rejects(
      () =>
        updateProductionLines({
          db,
          planId: 1,
          upserts: [{ fgItemId: 999, plannedFgQty: 1 }],
          loadComposition: emptyCompositionLoader,
        }),
      (e) => e instanceof MonthlyPlanningError && e.code === "FG_ITEM_NOT_FOUND",
    );
  });
});

function num(v) {
  return Number(v);
}

/**
 * Mock db + deps for lock / rm-planning. Stateful enough to read back the snapshot.
 */
function createLockMockDb({
  status = "DRAFT",
  currentRevision = 0,
  planLines = [],
  rmItems = [],
  monthlyPlanMrLines = [],
} = {}) {
  const state = {
    plan: { id: 1, status, currentRevision, periodKey: "2026-06", lockedAt: null },
    rmPlans: [], // { id, planId, revision, totalFgPlannedQty, recalculatedAt }
    rmPlanLines: [], // includes rmPlanId
    nextRmPlanId: 500,
  };
  const itemById = new Map(rmItems.map((i) => [i.id, i]));
  const db = {
    monthlyProductionPlan: {
      findUnique: async ({ where }) => (where.id === state.plan.id ? { ...state.plan } : null),
      update: async ({ where, data }) => {
        if (where.id === state.plan.id) Object.assign(state.plan, data);
        return { ...state.plan };
      },
    },
    monthlyProductionPlanLine: {
      findMany: async () =>
        planLines.map((l) => ({
          id: l.id,
          fgItemId: l.fgItemId,
          plannedFgQty: l.plannedFgQty,
          fgItem: { id: l.fgItemId, itemName: `FG ${l.fgItemId}` },
        })),
    },
    item: {
      findMany: async ({ where }) =>
        (where.id.in || []).filter((id) => itemById.has(id)).map((id) => itemById.get(id)),
    },
    rmPlan: {
      create: async ({ data }) => {
        const row = { id: state.nextRmPlanId++, ...data };
        state.rmPlans.push(row);
        return row;
      },
      findMany: async () => state.rmPlans.map((r) => ({ revision: r.revision, recalculatedAt: r.recalculatedAt })),
      findUnique: async ({ where }) => {
        const r = state.rmPlans.find(
          (x) => x.planId === where.planId_revision.planId && x.revision === where.planId_revision.revision,
        );
        if (!r) return null;
        return {
          ...r,
          lines: state.rmPlanLines
            .filter((l) => l.rmPlanId === r.id)
            .map((l) => ({ ...l, rmItem: itemById.get(l.rmItemId) || { id: l.rmItemId, itemName: `RM ${l.rmItemId}`, unit: "KG" } })),
        };
      },
    },
    rmPlanLine: {
      createMany: async ({ data }) => {
        state.rmPlanLines.push(...data);
        return { count: data.length };
      },
    },
    materialRequirementLine: {
      groupBy: async () => {
        const byItem = new Map();
        for (const l of monthlyPlanMrLines) {
          const cur = byItem.get(l.rmItemId) || { requiredQty: 0, procuredQty: 0 };
          cur.requiredQty += Number(l.requiredQty || 0);
          cur.procuredQty += Number(l.procuredQty || 0);
          byItem.set(l.rmItemId, cur);
        }
        return [...byItem.entries()].map(([rmItemId, sums]) => ({
          rmItemId,
          _sum: { requiredQty: sums.requiredQty, procuredQty: sums.procuredQty },
        }));
      },
    },
    $transaction: async (fn) => fn(db),
    __state: state,
  };
  return db;
}

function depsFor({ rmNeeded = new Map(), missingChildBoms = [], bomByFg = null, availability = [], availabilityThrows = false } = {}) {
  return {
    loadApprovedBomWithLines: async (_tx, fgItemId) => {
      if (bomByFg && Object.prototype.hasOwnProperty.call(bomByFg, fgItemId)) return bomByFg[fgItemId];
      return { id: 9, lines: [{ id: 1 }] }; // default: BOM present
    },
    aggregateRmDemandForFgLines: async () => ({ rmNeeded, missingChildBoms }),
    getMaterialAvailabilityByItems: async () => {
      if (availabilityThrows) throw new Error("availability boom");
      return availability;
    },
  };
}

describe("monthlyPlanningService.lockMonthlyPlan", () => {
  it("locks, increments revision, sets LOCKED, creates RmPlan + RmPlanLine", async () => {
    const db = createLockMockDb({
      status: "DRAFT",
      currentRevision: 0,
      planLines: [{ id: 1, fgItemId: 50, plannedFgQty: 10 }],
      rmItems: [{ id: 70, itemName: "Steel", unit: "KG", minimumStockQty: 100 }],
    });
    const deps = depsFor({
      rmNeeded: new Map([[70, 25]]),
      availability: [
        { itemId: 70, freeStockQty: 5, effectiveReservedQty: 2, incomingQty: 10, netShortageAfterIncomingQty: 10, warnings: [] },
      ],
    });
    const res = await lockMonthlyPlan({ db, planId: 1, actorUserId: 9, deps });
    assert.equal(db.__state.plan.status, "LOCKED");
    assert.equal(db.__state.plan.currentRevision, 1);
    assert.ok(db.__state.plan.lockedAt);
    assert.equal(db.__state.rmPlans.length, 1);
    assert.equal(db.__state.rmPlanLines.length, 1);
    assert.equal(res.locked, true);
    assert.equal(res.revision, 1);
    assert.equal(res.lines[0].rmItemId, 70);
    assert.equal(num(res.lines[0].grossDemandQty), 25);
    assert.equal(num(res.lines[0].netRequirementQty), 10);
    assert.equal(res.lines[0].belowMinStockFlag, true); // free 5 < min 100
  });

  it("blocks an empty plan (no planned qty > 0)", async () => {
    const db = createLockMockDb({ planLines: [{ id: 1, fgItemId: 50, plannedFgQty: 0 }] });
    await assert.rejects(
      () => lockMonthlyPlan({ db, planId: 1, deps: depsFor({}) }),
      (e) => e instanceof MonthlyPlanningError && e.code === "EMPTY_PLAN",
    );
    assert.equal(db.__state.plan.status, "DRAFT");
  });

  it("blocks lock when an FG has no approved BOM", async () => {
    const db = createLockMockDb({ planLines: [{ id: 1, fgItemId: 50, plannedFgQty: 5 }] });
    const deps = depsFor({ bomByFg: { 50: null } });
    await assert.rejects(
      () => lockMonthlyPlan({ db, planId: 1, deps }),
      (e) => e instanceof MonthlyPlanningError && e.code === "MISSING_BOM",
    );
  });

  it("blocks lock when a child SFG BOM is missing", async () => {
    const db = createLockMockDb({ planLines: [{ id: 1, fgItemId: 50, plannedFgQty: 5 }] });
    const deps = depsFor({ missingChildBoms: [{ sfgItemId: 60, sfgName: "Sub-assembly" }] });
    await assert.rejects(
      () => lockMonthlyPlan({ db, planId: 1, deps }),
      (e) => e instanceof MonthlyPlanningError && e.code === "MISSING_CHILD_BOM",
    );
  });

  it("blocks locking a non-DRAFT plan", async () => {
    const db = createLockMockDb({ status: "LOCKED", currentRevision: 1, planLines: [{ id: 1, fgItemId: 50, plannedFgQty: 5 }] });
    await assert.rejects(
      () => lockMonthlyPlan({ db, planId: 1, deps: depsFor({}) }),
      (e) => e instanceof MonthlyPlanningError && e.code === "PLAN_NOT_LOCKABLE",
    );
  });

  it("rolls back (rejects) when stock snapshot calculation fails", async () => {
    const db = createLockMockDb({ planLines: [{ id: 1, fgItemId: 50, plannedFgQty: 5 }] });
    const deps = depsFor({ rmNeeded: new Map([[70, 5]]), availabilityThrows: true });
    await assert.rejects(() => lockMonthlyPlan({ db, planId: 1, deps }), /availability boom/);
  });
});

describe("monthlyPlanningService.getRmPlanning", () => {
  it("returns empty state when plan not locked", async () => {
    const db = createLockMockDb({ status: "DRAFT", currentRevision: 0 });
    const res = await getRmPlanning({ db, planId: 1 });
    assert.equal(res.locked, false);
    assert.equal(res.exists, false);
    assert.deepEqual(res.lines, []);
  });

  it("returns the snapshot for a locked plan", async () => {
    const db = createLockMockDb({
      status: "DRAFT",
      currentRevision: 0,
      planLines: [{ id: 1, fgItemId: 50, plannedFgQty: 10 }],
      rmItems: [{ id: 70, itemName: "Steel", unit: "KG", minimumStockQty: 0 }],
    });
    const deps = depsFor({
      rmNeeded: new Map([[70, 25]]),
      availability: [{ itemId: 70, freeStockQty: 30, effectiveReservedQty: 0, incomingQty: 0, netShortageAfterIncomingQty: 0, warnings: [] }],
    });
    await lockMonthlyPlan({ db, planId: 1, deps });
    const res = await getRmPlanning({ db, planId: 1 });
    assert.equal(res.locked, true);
    assert.equal(res.exists, true);
    assert.equal(res.revision, 1);
    assert.equal(res.lines.length, 1);
    assert.equal(num(res.lines[0].netRequirementQty), 0);
  });
});

describe("monthlyPlanningService.getPurchasePlanning", () => {
  async function lockedDb({ monthlyPlanMrLines = [], net = 10 } = {}) {
    const db = createLockMockDb({
      status: "DRAFT",
      currentRevision: 0,
      planLines: [{ id: 1, fgItemId: 50, plannedFgQty: 10 }],
      rmItems: [{ id: 70, itemName: "Steel", unit: "KG", minimumStockQty: 0 }],
      monthlyPlanMrLines,
    });
    const deps = depsFor({
      rmNeeded: new Map([[70, 25]]),
      availability: [
        { itemId: 70, freeStockQty: 5, effectiveReservedQty: 0, incomingQty: 10, netShortageAfterIncomingQty: net, warnings: [] },
      ],
    });
    await lockMonthlyPlan({ db, planId: 1, deps });
    return db;
  }

  it("returns empty state when plan not locked", async () => {
    const db = createLockMockDb({ status: "DRAFT", currentRevision: 0 });
    const res = await getPurchasePlanning({ db, planId: 1 });
    assert.equal(res.locked, false);
    assert.equal(res.exists, false);
    assert.deepEqual(res.lines, []);
  });

  it("returns lines from RmPlanLine with NOT_RELEASED when no MONTHLY_PLAN MR exists", async () => {
    const db = await lockedDb({ net: 10 });
    const res = await getPurchasePlanning({ db, planId: 1 });
    assert.equal(res.locked, true);
    assert.equal(res.exists, true);
    assert.equal(res.lines.length, 1);
    const line = res.lines[0];
    assert.equal(line.rmItemId, 70);
    assert.equal(num(line.alreadyRequisitionedQty), 0);
    assert.equal(num(line.varianceQty), 10);
    assert.equal(num(line.suggestedPurchaseQty), 10);
    assert.equal(line.procurementStatus, "NOT_RELEASED");
    assert.equal(line.vendorSuggestion, null);
  });

  it("defaults to currentRevision", async () => {
    const db = await lockedDb({ net: 10 });
    const res = await getPurchasePlanning({ db, planId: 1 });
    assert.equal(res.revision, 1);
  });

  it("supports an explicit revision query", async () => {
    const db = await lockedDb({ net: 10 });
    const res = await getPurchasePlanning({ db, planId: 1, revision: 1 });
    assert.equal(res.revision, 1);
    assert.equal(res.lines.length, 1);
  });

  it("computes PARTIALLY_RELEASED variance when a MONTHLY_PLAN MR partially covers net", async () => {
    const db = await lockedDb({ net: 10, monthlyPlanMrLines: [{ rmItemId: 70, requiredQty: 4, procuredQty: 1 }] });
    const line = (await getPurchasePlanning({ db, planId: 1 })).lines[0];
    assert.equal(num(line.alreadyRequisitionedQty), 4);
    assert.equal(num(line.alreadyProcuredQty), 1);
    assert.equal(num(line.varianceQty), 6);
    assert.equal(num(line.suggestedPurchaseQty), 6);
    assert.equal(line.procurementStatus, "PARTIALLY_RELEASED");
  });

  it("marks FULLY_RELEASED and OVER_RELEASED correctly", async () => {
    const full = await lockedDb({ net: 10, monthlyPlanMrLines: [{ rmItemId: 70, requiredQty: 10 }] });
    assert.equal((await getPurchasePlanning({ db: full, planId: 1 })).lines[0].procurementStatus, "FULLY_RELEASED");

    const over = await lockedDb({ net: 10, monthlyPlanMrLines: [{ rmItemId: 70, requiredQty: 13 }] });
    const overLine = (await getPurchasePlanning({ db: over, planId: 1 })).lines[0];
    assert.equal(overLine.procurementStatus, "OVER_RELEASED");
    assert.equal(num(overLine.varianceQty), -3);
    assert.equal(num(overLine.suggestedPurchaseQty), 0);
  });
});

/**
 * Stateful mock for release tests: MR store reflects created/updated lines so
 * groupBy-based delta calculation evolves across repeated releases.
 */
function createReleaseMockDb({
  status = "LOCKED",
  currentRevision = 1,
  rmPlanLines = [],
  existingMr = null,
} = {}) {
  const state = {
    plan: { id: 1, status, currentRevision, periodKey: "2026-06" },
    mrs: [],
    nextMrId: 800,
    nextLineId: 9000,
    seq: 1,
  };
  if (existingMr) {
    state.mrs.push({
      id: existingMr.id ?? 700,
      docNo: existingMr.docNo ?? "MR-26-0001",
      status: existingMr.status ?? "APPROVED",
      sourceType: "MONTHLY_PLAN",
      monthlyProductionPlanId: 1,
      reversedAt: null,
      sourceRevision: existingMr.sourceRevision ?? 1,
      lines: (existingMr.lines || []).map((l, i) => ({
        id: l.id ?? 8000 + i,
        materialRequirementId: existingMr.id ?? 700,
        rmItemId: l.rmItemId,
        requiredQty: String(l.requiredQty ?? 0),
        shortageQty: String(l.shortageQty ?? l.requiredQty ?? 0),
        procuredQty: String(l.procuredQty ?? 0),
      })),
    });
  }
  const allLines = () => state.mrs.flatMap((m) => m.lines);
  const db = {
    monthlyProductionPlan: {
      findUnique: async ({ where }) => (where.id === state.plan.id ? { ...state.plan } : null),
      update: async ({ where, data }) => {
        if (where.id === state.plan.id) Object.assign(state.plan, data);
        return { ...state.plan };
      },
    },
    rmPlan: {
      findUnique: async ({ where }) => {
        if (where.planId_revision.revision !== state.plan.currentRevision) return null;
        return {
          id: 1,
          planId: 1,
          revision: state.plan.currentRevision,
          lines: rmPlanLines.map((l, i) => ({
            id: 100 + i,
            rmItemId: l.rmItemId,
            netRequirementQty: l.netRequirementQty,
            freeStockSnapshot: l.freeStockSnapshot ?? 0,
            unitSnapshot: l.unitSnapshot ?? "KG",
          })),
        };
      },
    },
    docSequence: {
      upsert: async () => ({ nextNumber: ++state.seq, year2: 26, docType: "MATERIAL_REQUIREMENT" }),
    },
    materialRequirement: {
      findFirst: async () => {
        const m = [...state.mrs].reverse().find((x) => x.reversedAt == null);
        return m ? { ...m, lines: m.lines.map((l) => ({ ...l })) } : null;
      },
      create: async ({ data }) => {
        const m = {
          id: state.nextMrId++,
          docNo: data.docNo,
          status: data.status,
          sourceType: data.sourceType,
          monthlyProductionPlanId: data.monthlyProductionPlanId,
          reversedAt: null,
          sourceRevision: data.sourceRevision ?? null,
          lines: [],
        };
        state.mrs.push(m);
        return { ...m, lines: [] };
      },
      update: async ({ where, data }) => {
        const m = state.mrs.find((x) => x.id === where.id);
        if (m) Object.assign(m, data);
        return { ...m };
      },
    },
    materialRequirementLine: {
      create: async ({ data }) => {
        const m = state.mrs.find((x) => x.id === data.materialRequirementId);
        const row = {
          id: state.nextLineId++,
          materialRequirementId: data.materialRequirementId,
          rmItemId: data.rmItemId,
          requiredQty: data.requiredQty,
          shortageQty: data.shortageQty,
          procuredQty: data.procuredQty ?? "0",
        };
        m.lines.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = allLines().find((l) => l.id === where.id);
        if (row) Object.assign(row, data);
        return { ...row };
      },
      groupBy: async () => {
        const byItem = new Map();
        for (const l of allLines()) {
          const cur = byItem.get(l.rmItemId) || { requiredQty: 0, procuredQty: 0 };
          cur.requiredQty += Number(l.requiredQty || 0);
          cur.procuredQty += Number(l.procuredQty || 0);
          byItem.set(l.rmItemId, cur);
        }
        return [...byItem.entries()].map(([rmItemId, sums]) => ({
          rmItemId,
          _sum: { requiredQty: sums.requiredQty, procuredQty: sums.procuredQty },
        }));
      },
    },
    $transaction: async (fn) => fn(db),
    __state: state,
  };
  return db;
}

describe("monthlyPlanningService.releaseToProcurement", () => {
  it("requires explicit confirmation", async () => {
    const db = createReleaseMockDb({ rmPlanLines: [{ rmItemId: 70, netRequirementQty: 10 }] });
    await assert.rejects(
      () => releaseToProcurement({ db, planId: 1, confirm: false }),
      (e) => e instanceof MonthlyPlanningError && e.code === "CONFIRM_REQUIRED",
    );
  });

  it("requires a LOCKED plan", async () => {
    const db = createReleaseMockDb({ status: "DRAFT", rmPlanLines: [{ rmItemId: 70, netRequirementQty: 10 }] });
    await assert.rejects(
      () => releaseToProcurement({ db, planId: 1, confirm: true }),
      (e) => e instanceof MonthlyPlanningError && e.code === "PLAN_NOT_LOCKED",
    );
  });

  it("requires the revision to match currentRevision", async () => {
    const db = createReleaseMockDb({ currentRevision: 1, rmPlanLines: [{ rmItemId: 70, netRequirementQty: 10 }] });
    await assert.rejects(
      () => releaseToProcurement({ db, planId: 1, revision: 99, confirm: true }),
      (e) => e instanceof MonthlyPlanningError && e.code === "REVISION_MISMATCH",
    );
  });

  it("first release creates demand; second release creates zero (idempotent)", async () => {
    const db = createReleaseMockDb({ rmPlanLines: [{ rmItemId: 70, netRequirementQty: 10 }] });

    const first = await releaseToProcurement({ db, planId: 1, revision: 1, confirm: true });
    assert.equal(first.releasedLineCount, 1);
    assert.equal(num(first.totalDeltaQty), 10);
    assert.equal(db.__state.mrs.length, 1);
    assert.equal(num(db.__state.mrs[0].lines[0].requiredQty), 10);

    const second = await releaseToProcurement({ db, planId: 1, revision: 1, confirm: true });
    assert.equal(second.releasedLineCount, 0);
    assert.equal(num(second.totalDeltaQty), 0);
    assert.equal(second.skippedLineCount, 1);
    // No duplicate MR, no duplicate demand.
    assert.equal(db.__state.mrs.length, 1);
    assert.equal(db.__state.mrs[0].lines.length, 1);
    assert.equal(num(db.__state.mrs[0].lines[0].requiredQty), 10);
  });

  it("revision increase emits only the delta", async () => {
    const db = createReleaseMockDb({
      currentRevision: 2,
      rmPlanLines: [{ rmItemId: 70, netRequirementQty: 15 }],
      existingMr: { id: 700, lines: [{ rmItemId: 70, requiredQty: 10 }] },
    });
    const res = await releaseToProcurement({ db, planId: 1, revision: 2, confirm: true });
    assert.equal(res.releasedLineCount, 1);
    assert.equal(num(res.totalDeltaQty), 5);
    assert.equal(num(db.__state.mrs[0].lines[0].requiredQty), 15);
  });

  it("revision decrease reduces only open demand, reports surplus, no PO cancellation", async () => {
    const db = createReleaseMockDb({
      currentRevision: 2,
      rmPlanLines: [{ rmItemId: 70, netRequirementQty: 4 }],
      existingMr: { id: 700, lines: [{ rmItemId: 70, requiredQty: 10, procuredQty: 8 }] },
    });
    const res = await releaseToProcurement({ db, planId: 1, revision: 2, confirm: true });
    assert.equal(res.releasedLineCount, 0);
    assert.equal(res.surplusLineCount, 1);
    assert.equal(num(res.surplus[0].reducedQty), 2); // only the un-procured 2 reducible
    assert.equal(num(res.surplus[0].surplusQty), 4); // 8 PO-backed remain as surplus
    // MR line reduced to PO-backed level, never below procured, never deleted.
    assert.equal(num(db.__state.mrs[0].lines[0].requiredQty), 8);
    assert.equal(db.__state.mrs.length, 1);
  });

  it("blocks release when no positive net requirement exists", async () => {
    const db = createReleaseMockDb({ rmPlanLines: [{ rmItemId: 70, netRequirementQty: 0 }] });
    await assert.rejects(
      () => releaseToProcurement({ db, planId: 1, revision: 1, confirm: true }),
      (e) => e instanceof MonthlyPlanningError && e.code === "NO_DEMAND",
    );
  });
});

describe("featureFlags.FEATURE_MONTHLY_PLANNING", () => {
  it("defaults OFF when env is unset", () => {
    const prev = process.env.FEATURE_MONTHLY_PLANNING;
    delete process.env.FEATURE_MONTHLY_PLANNING;
    try {
      assert.equal(isMonthlyPlanningEnabled(), false);
    } finally {
      if (prev !== undefined) process.env.FEATURE_MONTHLY_PLANNING = prev;
    }
  });

  it("reads truthy values as ON", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      assert.equal(readBoolEnv("__TMP_FLAG__", false) || ((process.env.__TMP_FLAG__ = v), readBoolEnv("__TMP_FLAG__", false)), true);
    }
    delete process.env.__TMP_FLAG__;
  });

  it("reads falsy / unknown values as OFF", () => {
    for (const v of ["0", "false", "no", "off", "maybe", ""]) {
      process.env.__TMP_FLAG2__ = v;
      assert.equal(readBoolEnv("__TMP_FLAG2__", false), false);
    }
    delete process.env.__TMP_FLAG2__;
  });
});
