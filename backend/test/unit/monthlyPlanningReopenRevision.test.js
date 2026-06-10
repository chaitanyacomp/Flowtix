const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../../src/createApp");
const { signAccessToken } = require("../../src/utils/jwt");
const { MONTHLY_PLANNING_WRITE_ROLES } = require("../../src/constants/erpRoles");
const {
  reopenMonthlyPlan,
  lockMonthlyPlan,
  getPlanRevisions,
  getProductionLines,
  updateProductionLines,
  MonthlyPlanningError,
} = require("../../src/services/monthlyPlanningService");

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

function bearerForRole(role) {
  return `Bearer ${signAccessToken({
    userId: role === "ADMIN" ? 1 : role === "STORE" ? 2 : 3,
    email: `${role.toLowerCase()}@test.com`,
    role,
    name: role,
  })}`;
}

function emptyCompositionLoader() {
  return async () => ({ periodKey: "2026-07", items: [] });
}

function emptyGreenLoader() {
  return async () => ({ anchorPeriodKey: "2026-07", items: [] });
}

function depsFor({ rmNeeded = new Map([[80, 100]]), bomByFg = null } = {}) {
  return {
    loadApprovedBomWithLines: async (_tx, fgItemId) => {
      if (bomByFg && Object.prototype.hasOwnProperty.call(bomByFg, fgItemId)) return bomByFg[fgItemId];
      return { id: 1, lines: [{ id: 1 }] };
    },
    aggregateRmDemandForFgLines: async (_tx, fgLines) => {
      const map = new Map();
      for (const fg of fgLines) {
        for (const [rmId, qty] of rmNeeded.entries()) {
          map.set(rmId, (map.get(rmId) || 0) + qty * (Number(fg.fgQty) / 10000));
        }
      }
      return { rmNeeded: map, missingChildBoms: [] };
    },
    getMaterialAvailabilityByItems: async () => [
      { itemId: 80, freeStockQty: 0, effectiveReservedQty: 0, incomingQty: 0, netShortageAfterIncomingQty: 100, warnings: [] },
    ],
  };
}

function createRevisionMockDb({
  status = "LOCKED",
  currentRevision = 1,
  releasedRevision = null,
  planLines = [],
} = {}) {
  const state = {
    plan: {
      id: 1,
      docNo: "MPP-26-0001",
      periodKey: "2026-07",
      status,
      currentRevision,
      remarks: null,
      lockedAt: status === "LOCKED" ? new Date("2026-07-01T10:00:00Z") : null,
      lockedByUserId: 9,
      reopenedAt: null,
      reopenedByUserId: null,
      releasedAt: null,
      releasedRevision,
      createdByUserId: 7,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T10:00:00Z"),
    },
    liveLines: planLines.map((l) => ({ ...l })),
    rmPlans: [],
    rmPlanLines: [],
    revisionLines: [],
    nextRmPlanId: 100,
    nextRevisionLineId: 1,
    writes: [],
  };

  const itemMeta = new Map([
    [10, { id: 10, itemName: "Cap", itemType: "FG", unit: "NOS" }],
    [11, { id: 11, itemName: "Nozzle", itemType: "FG", unit: "NOS" }],
    [80, { id: 80, itemName: "Steel", unit: "KG", minimumStockQty: 0 }],
  ]);

  const db = {
    monthlyProductionPlan: {
      findUnique: async ({ where, select, include }) => {
        if (where.id !== state.plan.id) return null;
        const row = { ...state.plan };
        if (include?.lockedBy) row.lockedBy = { id: 9, name: "Store User", email: "store@test.com" };
        if (select) {
          const out = {};
          for (const key of Object.keys(select)) {
            if (select[key] === true) out[key] = row[key];
          }
          return out;
        }
        return row;
      },
      update: async ({ where, data }) => {
        if (where.id === state.plan.id) {
          Object.assign(state.plan, data);
          state.writes.push({ type: "plan.update", data });
        }
        return { ...state.plan };
      },
    },
    monthlyProductionPlanLine: {
      findMany: async () =>
        state.liveLines.map((l) => ({
          ...l,
          fgItem: itemMeta.get(l.fgItemId),
        })),
      upsert: async ({ where, create, update }) => {
        const fgItemId = where.planId_fgItemId?.fgItemId ?? create.fgItemId;
        const idx = state.liveLines.findIndex((x) => x.fgItemId === fgItemId);
        const row = {
          id: idx >= 0 ? state.liveLines[idx].id : state.liveLines.length + 1,
          fgItemId,
          suggestedFgQty: create?.suggestedFgQty ?? update?.suggestedFgQty ?? 0,
          plannedFgQty: create?.plannedFgQty ?? update?.plannedFgQty ?? 0,
          plannedQtyOverridden: create?.plannedQtyOverridden ?? update?.plannedQtyOverridden ?? false,
          source: create?.source ?? update?.source ?? "MANUAL",
          remarks: create?.remarks ?? update?.remarks ?? null,
        };
        if (idx >= 0) state.liveLines[idx] = { ...state.liveLines[idx], ...row };
        else state.liveLines.push(row);
        state.writes.push({ type: "line.upsert", fgItemId, row });
        return row;
      },
      deleteMany: async ({ where }) => {
        state.liveLines = state.liveLines.filter((l) => !where.id.in.includes(l.id));
        return { count: where.id.in.length };
      },
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
    rmPlan: {
      create: async ({ data }) => {
        const row = { id: state.nextRmPlanId++, ...data, recalculatedBy: { id: 9, name: "Store User", email: "store@test.com" } };
        state.rmPlans.push(row);
        state.writes.push({ type: "rmPlan.create", revision: data.revision });
        return row;
      },
      findMany: async ({ where, orderBy, include }) => {
        let rows = state.rmPlans.filter((r) => r.planId === where.planId);
        if (orderBy?.revision === "desc") rows = [...rows].sort((a, b) => b.revision - a.revision);
        if (orderBy?.revision === "asc") rows = [...rows].sort((a, b) => a.revision - b.revision);
        if (include?.recalculatedBy) {
          rows = rows.map((r) => ({ ...r, recalculatedBy: r.recalculatedBy ?? null }));
        }
        return rows;
      },
      findUnique: async ({ where, include }) => {
        const r = state.rmPlans.find(
          (x) => x.planId === where.planId_revision.planId && x.revision === where.planId_revision.revision,
        );
        if (!r) return null;
        return {
          ...r,
          lines: state.rmPlanLines
            .filter((l) => l.rmPlanId === r.id)
            .map((l) => ({ ...l, rmItem: itemMeta.get(l.rmItemId) })),
        };
      },
    },
    rmPlanLine: {
      createMany: async ({ data }) => {
        state.rmPlanLines.push(...data);
        return { count: data.length };
      },
    },
    monthlyProductionPlanRevisionLine: {
      createMany: async ({ data }) => {
        for (const row of data) {
          state.revisionLines.push({ id: state.nextRevisionLineId++, ...row });
        }
        state.writes.push({ type: "revisionLine.createMany", count: data.length, revision: data[0]?.revision });
        return { count: data.length };
      },
      findMany: async ({ where, orderBy, include }) => {
        let rows = state.revisionLines.filter((r) => r.planId === where.planId);
        if (orderBy) {
          rows = [...rows].sort((a, b) => {
            if (a.revision !== b.revision) return b.revision - a.revision;
            return a.id - b.id;
          });
        }
        return rows.map((r) => ({
          ...r,
          fgItem: include?.fgItem ? itemMeta.get(r.fgItemId) : undefined,
        }));
      },
    },
    $transaction: async (fn) => fn(db),
    __state: state,
  };

  for (const model of [
    "materialRequirement",
    "materialRequirementLine",
    "purchaseRequest",
    "stockTransaction",
    "productionMaterialRequest",
  ]) {
    db[model] = {};
    for (const method of WRITE_METHODS) {
      db[model][method] = throwOnWrite(`${model}.${method}`);
    }
  }

  return db;
}

describe("monthlyPlanningService.reopenMonthlyPlan", () => {
  it("changes LOCKED plan status to DRAFT", async () => {
    const db = createRevisionMockDb({ status: "LOCKED", currentRevision: 1 });
    const res = await reopenMonthlyPlan({ db, planId: 1, actorUserId: 5 });
    assert.equal(db.__state.plan.status, "DRAFT");
    assert.equal(res.status, "DRAFT");
    assert.ok(db.__state.plan.reopenedAt);
    assert.equal(db.__state.plan.reopenedByUserId, 5);
  });

  it("does not increment currentRevision on reopen", async () => {
    const db = createRevisionMockDb({ status: "LOCKED", currentRevision: 2 });
    const res = await reopenMonthlyPlan({ db, planId: 1, actorUserId: 5 });
    assert.equal(db.__state.plan.currentRevision, 2);
    assert.equal(res.currentRevision, 2);
    assert.equal(res.draftForRevision, 3);
  });

  it("preserves existing production lines (no line deletes)", async () => {
    const db = createRevisionMockDb({
      status: "LOCKED",
      currentRevision: 1,
      planLines: [
        { id: 1, fgItemId: 10, suggestedFgQty: 10000, plannedFgQty: 10000, plannedQtyOverridden: false, source: "MANUAL", remarks: "cap" },
        { id: 2, fgItemId: 11, suggestedFgQty: 10000, plannedFgQty: 10000, plannedQtyOverridden: true, source: "REQUIREMENT_SHEET", remarks: "nozzle" },
      ],
    });
    await reopenMonthlyPlan({ db, planId: 1, actorUserId: 5 });
    assert.equal(db.__state.liveLines.length, 2);
    assert.equal(Number(db.__state.liveLines[0].plannedFgQty), 10000);
    assert.equal(Number(db.__state.liveLines[1].plannedFgQty), 10000);
    const lineWrites = db.__state.writes.filter((w) => w.type.startsWith("line"));
    assert.equal(lineWrites.length, 0);
  });

  it("preserves old RmPlan revisions", async () => {
    const db = createRevisionMockDb({ status: "LOCKED", currentRevision: 1 });
    db.__state.rmPlans.push({
      id: 100,
      planId: 1,
      revision: 1,
      totalFgPlannedQty: 20000,
      recalculatedAt: new Date(),
      recalculatedByUserId: 9,
    });
    db.__state.rmPlanLines.push({ rmPlanId: 100, rmItemId: 80, grossDemandQty: 100, netRequirementQty: 100 });
    await reopenMonthlyPlan({ db, planId: 1 });
    assert.equal(db.__state.rmPlans.length, 1);
    assert.equal(db.__state.rmPlanLines.length, 1);
    assert.equal(db.__state.writes.filter((w) => w.type === "rmPlan.create").length, 0);
  });

  it("creates no procurement / MR / stock writes", async () => {
    const db = createRevisionMockDb({ status: "LOCKED", currentRevision: 1 });
    await reopenMonthlyPlan({ db, planId: 1 });
    assert.equal(db.__state.writes.length, 1);
    assert.equal(db.__state.writes[0].type, "plan.update");
  });

  it("rejects reopen on DRAFT plan", async () => {
    const db = createRevisionMockDb({ status: "DRAFT", currentRevision: 0 });
    await assert.rejects(
      () => reopenMonthlyPlan({ db, planId: 1 }),
      (e) => e instanceof MonthlyPlanningError && e.code === "PLAN_NOT_REOPENABLE",
    );
  });
});

describe("monthlyPlanningService.lock after reopen + FG revision snapshots", () => {
  it("re-lock increments revision and creates FG snapshot with audit fields", async () => {
    const db = createRevisionMockDb({
      status: "DRAFT",
      currentRevision: 1,
      planLines: [
        { id: 1, fgItemId: 10, itemName: "Cap", unit: "NOS", suggestedFgQty: 11000, plannedFgQty: 12000, plannedQtyOverridden: true, source: "MANUAL", remarks: "rev2 cap" },
        { id: 2, fgItemId: 11, itemName: "Nozzle", unit: "NOS", suggestedFgQty: 9000, plannedFgQty: 8000, plannedQtyOverridden: false, source: "REQUIREMENT_SHEET", remarks: "rev2 nozzle" },
      ],
    });
    db.__state.rmPlans.push({
      id: 100,
      planId: 1,
      revision: 1,
      totalFgPlannedQty: 20000,
      recalculatedAt: new Date("2026-07-01T10:00:00Z"),
      recalculatedByUserId: 9,
    });
    db.__state.revisionLines.push(
      {
        id: 1,
        planId: 1,
        revision: 1,
        fgItemId: 10,
        suggestedFgQty: 10000,
        plannedFgQty: 10000,
        plannedQtyOverridden: false,
        source: "MANUAL",
        remarks: "rev1 cap",
        unitSnapshot: "NOS",
        itemNameSnapshot: "Cap",
      },
      {
        id: 2,
        planId: 1,
        revision: 1,
        fgItemId: 11,
        suggestedFgQty: 10000,
        plannedFgQty: 10000,
        plannedQtyOverridden: false,
        source: "MANUAL",
        remarks: "rev1 nozzle",
        unitSnapshot: "NOS",
        itemNameSnapshot: "Nozzle",
      },
    );

    await lockMonthlyPlan({ db, planId: 1, actorUserId: 9, deps: depsFor() });

    assert.equal(db.__state.plan.status, "LOCKED");
    assert.equal(db.__state.plan.currentRevision, 2);
    assert.equal(db.__state.rmPlans.length, 2);
    assert.equal(db.__state.revisionLines.length, 4);

    const rev1 = db.__state.revisionLines.filter((l) => l.revision === 1);
    const rev2 = db.__state.revisionLines.filter((l) => l.revision === 2);
    assert.equal(rev1.length, 2);
    assert.equal(rev2.length, 2);
    assert.equal(Number(rev1[0].plannedFgQty), 10000);
    assert.equal(Number(rev2[0].plannedFgQty), 12000);
    assert.equal(Number(rev2[1].plannedFgQty), 8000);
    assert.equal(rev2[0].plannedQtyOverridden, true);
    assert.equal(rev2[0].itemNameSnapshot, "Cap");
    assert.equal(rev2[0].unitSnapshot, "NOS");
    assert.equal(rev2[0].remarks, "rev2 cap");
  });

  it("lock still uses plannedFgQty for BOM explosion input", async () => {
    const db = createRevisionMockDb({
      status: "DRAFT",
      currentRevision: 0,
      planLines: [
        { id: 1, fgItemId: 10, suggestedFgQty: 5000, plannedFgQty: 15000, plannedQtyOverridden: true, source: "MANUAL", remarks: null },
      ],
    });
    let explodedQty = null;
    const deps = {
      ...depsFor({ rmNeeded: new Map([[80, 50]]) }),
      aggregateRmDemandForFgLines: async (_tx, fgLines) => {
        explodedQty = fgLines[0]?.fgQty;
        return { rmNeeded: new Map([[80, 50]]), missingChildBoms: [] };
      },
    };
    await lockMonthlyPlan({ db, planId: 1, deps });
    assert.equal(explodedQty, 15000);
  });
});

describe("monthlyPlanningService.getPlanRevisions", () => {
  it("returns old and latest revisions with FG lines and release flag", async () => {
    const db = createRevisionMockDb({ status: "LOCKED", currentRevision: 2, releasedRevision: 1 });
    db.__state.rmPlans.push(
      { id: 100, planId: 1, revision: 1, totalFgPlannedQty: 20000, recalculatedAt: new Date("2026-07-01T10:00:00Z"), recalculatedByUserId: 9, recalculatedBy: { name: "Store User" } },
      { id: 101, planId: 1, revision: 2, totalFgPlannedQty: 20000, recalculatedAt: new Date("2026-07-05T10:00:00Z"), recalculatedByUserId: 9, recalculatedBy: { name: "Store User" } },
    );
    db.__state.revisionLines.push(
      { id: 1, planId: 1, revision: 1, fgItemId: 10, suggestedFgQty: 10000, plannedFgQty: 10000, plannedQtyOverridden: false, source: "MANUAL", remarks: null, unitSnapshot: "NOS", itemNameSnapshot: "Cap" },
      { id: 2, planId: 1, revision: 1, fgItemId: 11, suggestedFgQty: 10000, plannedFgQty: 10000, plannedQtyOverridden: false, source: "MANUAL", remarks: null, unitSnapshot: "NOS", itemNameSnapshot: "Nozzle" },
      { id: 3, planId: 1, revision: 2, fgItemId: 10, suggestedFgQty: 11000, plannedFgQty: 12000, plannedQtyOverridden: true, source: "MANUAL", remarks: "bumped", unitSnapshot: "NOS", itemNameSnapshot: "Cap" },
      { id: 4, planId: 1, revision: 2, fgItemId: 11, suggestedFgQty: 9000, plannedFgQty: 8000, plannedQtyOverridden: false, source: "MANUAL", remarks: null, unitSnapshot: "NOS", itemNameSnapshot: "Nozzle" },
    );

    const res = await getPlanRevisions({ db, planId: 1 });
    assert.equal(res.revisions.length, 2);
    assert.equal(res.revisions[0].revision, 2);
    assert.equal(res.revisions[0].isCurrent, true);
    assert.equal(res.revisions[0].released, false);
    assert.equal(res.revisions[1].revision, 1);
    assert.equal(res.revisions[1].released, true);
    assert.equal(res.revisions[1].fgLines.length, 2);
    assert.equal(res.revisions[1].fgLines[0].itemName, "Cap");
    assert.equal(res.revisions[1].fgLines[0].plannedFgQty, 10000);
    assert.equal(res.revisions[0].fgLines[0].plannedFgQty, 12000);
  });

  it("exposes draftForRevision when plan is DRAFT after reopen", async () => {
    const db = createRevisionMockDb({ status: "DRAFT", currentRevision: 1 });
    db.__state.rmPlans.push({
      id: 100,
      planId: 1,
      revision: 1,
      totalFgPlannedQty: 20000,
      recalculatedAt: new Date(),
      recalculatedByUserId: 9,
      recalculatedBy: { name: "Store User" },
    });
    const res = await getPlanRevisions({ db, planId: 1 });
    assert.equal(res.draftForRevision, 2);
    assert.equal(res.lastLockedRevision, 1);
    assert.equal(res.revisions[0].status, "LOCKED");
    assert.equal(res.revisions[0].isCurrent, false);
  });
});

describe("monthlyPlanning reopen route authorization", () => {
  it("PURCHASE role is not in MONTHLY_PLANNING_WRITE_ROLES (reopen gated)", () => {
    assert.ok(!MONTHLY_PLANNING_WRITE_ROLES.includes("PURCHASE"));
    assert.ok(MONTHLY_PLANNING_WRITE_ROLES.includes("STORE"));
  });

  it("POST /api/monthly-planning/:id/reopen returns 403 for PURCHASE", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/monthly-planning/1/reopen")
      .set("Authorization", bearerForRole("PURCHASE"));
    assert.equal(res.status, 403);
  });
});

describe("monthlyPlanning full reopen flow", () => {
  it("LOCKED Rev1 → reopen → edit → lock → LOCKED Rev2 with immutable Rev1 FG snapshot", async () => {
    const db = createRevisionMockDb({
      status: "LOCKED",
      currentRevision: 1,
      planLines: [
        { id: 1, fgItemId: 10, suggestedFgQty: 10000, plannedFgQty: 10000, plannedQtyOverridden: false, source: "MANUAL", remarks: "cap" },
        { id: 2, fgItemId: 11, suggestedFgQty: 10000, plannedFgQty: 10000, plannedQtyOverridden: false, source: "MANUAL", remarks: "nozzle" },
      ],
    });
    db.__state.rmPlans.push({
      id: 100,
      planId: 1,
      revision: 1,
      totalFgPlannedQty: 20000,
      recalculatedAt: new Date("2026-07-01T10:00:00Z"),
      recalculatedByUserId: 9,
    });
    db.__state.revisionLines.push(
      {
        id: 1,
        planId: 1,
        revision: 1,
        fgItemId: 10,
        suggestedFgQty: 10000,
        plannedFgQty: 10000,
        plannedQtyOverridden: false,
        source: "MANUAL",
        remarks: "cap",
        unitSnapshot: "NOS",
        itemNameSnapshot: "Cap",
      },
      {
        id: 2,
        planId: 1,
        revision: 1,
        fgItemId: 11,
        suggestedFgQty: 10000,
        plannedFgQty: 10000,
        plannedQtyOverridden: false,
        source: "MANUAL",
        remarks: "nozzle",
        unitSnapshot: "NOS",
        itemNameSnapshot: "Nozzle",
      },
    );

    await reopenMonthlyPlan({ db, planId: 1, actorUserId: 5 });
    assert.equal(db.__state.plan.status, "DRAFT");
    assert.equal(db.__state.plan.currentRevision, 1);

    await updateProductionLines({
      db,
      planId: 1,
      upserts: [
        { fgItemId: 10, plannedFgQty: 12000, plannedQtyOverridden: true, remarks: "rev2 cap" },
        { fgItemId: 11, plannedFgQty: 8000, plannedQtyOverridden: false, remarks: "rev2 nozzle" },
      ],
      loadComposition: emptyCompositionLoader,
      loadGreenLevelsFn: emptyGreenLoader,
    });

    await lockMonthlyPlan({ db, planId: 1, actorUserId: 9, deps: depsFor() });
    assert.equal(db.__state.plan.status, "LOCKED");
    assert.equal(db.__state.plan.currentRevision, 2);

    const history = await getPlanRevisions({ db, planId: 1 });
    const rev1 = history.revisions.find((r) => r.revision === 1);
    const rev2 = history.revisions.find((r) => r.revision === 2);
    assert.equal(rev1.fgLines.find((l) => l.fgItemId === 10).plannedFgQty, 10000);
    assert.equal(rev1.fgLines.find((l) => l.fgItemId === 11).plannedFgQty, 10000);
    assert.equal(rev2.fgLines.find((l) => l.fgItemId === 10).plannedFgQty, 12000);
    assert.equal(rev2.fgLines.find((l) => l.fgItemId === 11).plannedFgQty, 8000);

    const editable = await getProductionLines({
      db,
      planId: 1,
      loadComposition: emptyCompositionLoader,
      loadGreenLevelsFn: emptyGreenLoader,
    });
    assert.equal(editable.status, "LOCKED");
    assert.equal(editable.editable, false);
  });
});
