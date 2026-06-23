const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getRmPlanning,
  getPurchasePlanning,
  releaseToProcurement,
  MonthlyPlanningError,
} = require("../../src/services/monthlyPlanningService");
const {
  submitPlanForPurchaseReview,
  purchaseApprovePlan,
  purchaseRejectPlan,
} = require("../../src/services/monthlyPlanningPlanLifecycleService");
const { APPROVED_PLAN_SNAPSHOT_REVISION } = require("../../src/services/monthlyPlanningRmSnapshotService");
const { mapMonthlyPlanContext } = require("../../src/services/procurementTraceService");

function depsFor({ rmNeeded = new Map([[70, 12]]), fgItemId = 65, greenShortage = 700 } = {}) {
  return {
    allowLegacyLock: true,
    loadApprovedBomWithLines: async () => ({ id: 1, lines: [{ id: 1 }] }),
    loadFgGreenShortageInputs: async () => [
      { fgItemId, fgItemName: "Nozzle", greenShortage },
    ],
    aggregateRmDemandForFgLines: async (_tx, fgLines) => {
      const map = new Map();
      for (const fg of fgLines) {
        for (const [rmId, qty] of rmNeeded.entries()) {
          map.set(rmId, (map.get(rmId) ?? 0) + qty * Number(fg.fgQty > 0 ? 1 : 0));
        }
      }
      return { rmNeeded: map.size ? rmNeeded : new Map([[70, 12]]), missingChildBoms: [] };
    },
    getMaterialAvailabilityByItems: async () => [
      {
        itemId: 70,
        physicalUsableStockQty: 2,
        freeStockQty: 2,
        effectiveReservedQty: 0,
        incomingQty: 0,
        netShortageAfterIncomingQty: 10,
        warnings: [],
      },
    ],
  };
}

function createP4bDb(initialPlans = []) {
  const state = {
    nextId: 100,
    nextRmPlanId: 500,
    nextRmLineId: 600,
    nextMrId: 800,
    nextMrLineId: 9000,
    seq: 1,
    rmPlans: [],
    rmPlanLines: [],
    mrs: [],
    plans: initialPlans.map((p, idx) => ({
      id: p.id ?? idx + 1,
      periodKey: "2026-06",
      planSequenceNo: p.planSequenceNo ?? 1,
      planKind: p.planKind ?? (p.planSequenceNo > 1 ? "ADDITIONAL" : "INITIAL"),
      currentRevision: p.currentRevision ?? 0,
      status: p.status ?? "DRAFT",
      lines: p.lines ?? [{ id: 1, fgItemId: 65, plannedFgQty: "700", suggestedFgQty: "10000", plannedQtyOverridden: false, source: "REQUIREMENT_SHEET", remarks: null, fgItem: { id: 65, itemName: "Nozzle", unit: "Pcs" } }],
      lockedAt: null,
      lockedByUserId: null,
      purchaseReviewedAt: null,
      purchaseReviewedByUserId: null,
      approvedAt: null,
      approvedByUserId: null,
      purchaseRejectReason: null,
      releasedAt: null,
      releasedRevision: null,
      ...p,
    })),
  };

  const db = {
    __state: state,
    monthlyProductionPlan: {
      findUnique: async ({ where, select }) => {
        const row = state.plans.find((p) => p.id === where.id) ?? null;
        if (!row) return null;
        if (!select) return { ...row };
        const out = {};
        for (const key of Object.keys(select)) {
          if (select[key] === true) out[key] = row[key];
        }
        return out;
      },
      findMany: async ({ where }) => {
        let rows = [...state.plans];
        if (where?.periodKey) rows = rows.filter((p) => p.periodKey === where.periodKey);
        if (where?.status?.in) rows = rows.filter((p) => where.status.in.includes(p.status));
        if (where?.id?.not != null) rows = rows.filter((p) => p.id !== where.id.not);
        return rows;
      },
      update: async ({ where, data }) => {
        const idx = state.plans.findIndex((p) => p.id === where.id);
        state.plans[idx] = { ...state.plans[idx], ...data };
        return state.plans[idx];
      },
    },
    monthlyProductionPlanLine: {
      findMany: async ({ where, include }) => {
        const plan = state.plans.find((p) => p.id === where.planId);
        const lines = plan?.lines ?? [];
        if (!include?.fgItem) return lines;
        return lines.map((l) => ({ ...l, fgItem: l.fgItem ?? { id: l.fgItemId, itemName: "FG", unit: "Pcs" } }));
      },
    },
    monthlyProductionPlanRevisionLine: {
      createMany: async () => ({ count: 0 }),
    },
    rmPlan: {
      findFirst: async ({ where, orderBy }) => {
        let rows = state.rmPlans.filter((r) => r.planId === where.planId);
        if (orderBy?.revision === "desc") rows.sort((a, b) => b.revision - a.revision);
        return rows[0] ?? null;
      },
      findMany: async ({ where, orderBy }) => {
        let rows = state.rmPlans.filter((r) => r.planId === where.planId);
        if (orderBy?.revision === "asc") rows.sort((a, b) => a.revision - b.revision);
        return rows.map((r) => ({ revision: r.revision, recalculatedAt: r.recalculatedAt }));
      },
      findUnique: async ({ where, include }) => {
        const row = state.rmPlans.find(
          (r) => r.planId === where.planId_revision.planId && r.revision === where.planId_revision.revision,
        );
        if (!row) return null;
        if (!include?.lines) return { ...row };
        return {
          ...row,
          lines: state.rmPlanLines
            .filter((l) => l.rmPlanId === row.id)
            .map((l) => ({ ...l, rmItem: { id: l.rmItemId, itemName: "Steel", unit: "KG" } })),
        };
      },
      create: async ({ data }) => {
        const row = { id: ++state.nextRmPlanId, ...data };
        state.rmPlans.push(row);
        return row;
      },
    },
    rmPlanLine: {
      createMany: async ({ data }) => {
        for (const row of data) {
          state.rmPlanLines.push({ id: ++state.nextRmLineId, ...row });
        }
        return { count: data.length };
      },
    },
    item: {
      findMany: async ({ where }) => {
        const ids = where?.id?.in ?? [65];
        return ids.map((id) => ({
          id,
          itemName: id === 65 ? "Nozzle" : "Steel",
          unit: "Pcs",
          minimumStockQty: 0,
          itemType: id === 65 ? "FG" : "RM",
        }));
      },
    },
    materialRequirementLine: {
      groupBy: async () => [],
      create: async ({ data }) => {
        const row = { id: ++state.nextMrLineId, ...data };
        const mr = state.mrs.find((m) => m.id === data.materialRequirementId);
        if (mr) {
          if (!mr.lines) mr.lines = [];
          mr.lines.push(row);
        }
        return row;
      },
      update: async ({ where, data }) => {
        for (const mr of state.mrs) {
          const line = mr.lines?.find((l) => l.id === where.id);
          if (line) {
            Object.assign(line, data);
            return line;
          }
        }
        return null;
      },
    },
    materialRequirement: {
      findFirst: async () => null,
      findMany: async ({ where } = {}) => {
        const ids = where?.id?.in ?? [];
        return state.mrs
          .filter((mr) => ids.includes(mr.id) && String(mr.status ?? "") !== "CANCELLED")
          .map((mr) => ({
            ...mr,
            sentToPurchaseAt: mr.sentToPurchaseAt ?? null,
            lines: (mr.lines ?? []).map((line) => ({
              ...line,
              requiredQty: line.requiredQty,
              shortageQty: line.shortageQty ?? line.requiredQty,
              procuredQty: line.procuredQty ?? "0",
              procurementLinks: line.procurementLinks ?? [],
              purchaseRequestSourceLinks: line.purchaseRequestSourceLinks ?? [],
            })),
          }));
      },
      create: async ({ data }) => {
        const mr = { id: ++state.nextMrId, ...data, lines: [] };
        state.mrs.push(mr);
        return { ...mr, lines: [] };
      },
      update: async ({ where, data }) => {
        const mr = state.mrs.find((m) => m.id === where.id);
        Object.assign(mr, data);
        return mr;
      },
    },
    docSequence: {
      upsert: async () => ({ nextNumber: ++state.seq, year2: 26, docType: "MATERIAL_REQUIREMENT" }),
    },
    $transaction: async (fn) => fn(db),
  };
  return db;
}

describe("monthlyPlanningPlanDocumentP4b.approve RM snapshot", () => {
  it("approve creates RM snapshot for APPROVED plan", async () => {
    const db = createP4bDb([
      { id: 11, status: "AWAITING_PURCHASE_REVIEW", planSequenceNo: 1, planKind: "INITIAL" },
    ]);
    const res = await purchaseApprovePlan({ db, planId: 11, actorUserId: 3, deps: depsFor() });
    assert.equal(res.status, "APPROVED");
    assert.equal(res.rmSnapshot.revision, APPROVED_PLAN_SNAPSHOT_REVISION);
    assert.equal(res.rmSnapshot.created, true);
    assert.equal(db.__state.rmPlans.length, 1);
    assert.equal(db.__state.rmPlanLines.length, 1);
    assert.equal(db.__state.plans[0].status, "APPROVED");
  });

  it("approve is idempotent and does not duplicate RM snapshot", async () => {
    const db = createP4bDb([
      { id: 12, status: "AWAITING_PURCHASE_REVIEW", planSequenceNo: 2, planKind: "ADDITIONAL" },
    ]);
    const deps = depsFor({ rmNeeded: new Map([[70, 5]]) });
    const first = await purchaseApprovePlan({ db, planId: 12, deps });
    assert.equal(first.rmSnapshot.created, true);
    const { ensureApprovedPlanRmSnapshot } = require("../../src/services/monthlyPlanningRmSnapshotService");
    const second = await ensureApprovedPlanRmSnapshot({ db, planId: 12, deps });
    assert.equal(second.created, false);
    assert.equal(db.__state.rmPlans.length, 1);
  });

  it("submit does not create RM snapshot", async () => {
    const db = createP4bDb([{ id: 13, status: "DRAFT", planSequenceNo: 1 }]);
    await submitPlanForPurchaseReview({ db, planId: 13, actorUserId: 2 });
    assert.equal(db.__state.rmPlans.length, 0);
    assert.equal(db.__state.plans[0].status, "AWAITING_PURCHASE_REVIEW");
  });

  it("reject does not create RM snapshot", async () => {
    const db = createP4bDb([{ id: 14, status: "AWAITING_PURCHASE_REVIEW", planSequenceNo: 1 }]);
    await purchaseRejectPlan({ db, planId: 14, reason: "Fix qty", actorUserId: 3 });
    assert.equal(db.__state.rmPlans.length, 0);
    assert.equal(db.__state.plans[0].status, "DRAFT");
  });
});

describe("monthlyPlanningPlanDocumentP4b.read planning on APPROVED", () => {
  it("getRmPlanning works for APPROVED", async () => {
    const db = createP4bDb([{ id: 20, status: "AWAITING_PURCHASE_REVIEW", planSequenceNo: 1 }]);
    await purchaseApprovePlan({ db, planId: 20, deps: depsFor() });
    const rm = await getRmPlanning({ db, planId: 20 });
    assert.equal(rm.locked, true);
    assert.equal(rm.exists, true);
    assert.equal(rm.status, "APPROVED");
    assert.equal(rm.revision, APPROVED_PLAN_SNAPSHOT_REVISION);
    assert.equal(rm.lines.length, 1);
  });

  it("getPurchasePlanning works for APPROVED", async () => {
    const db = createP4bDb([{ id: 21, status: "AWAITING_PURCHASE_REVIEW", planSequenceNo: 1 }]);
    await purchaseApprovePlan({ db, planId: 21, deps: depsFor() });
    const pp = await getPurchasePlanning({ db, planId: 21 });
    assert.equal(pp.locked, true);
    assert.equal(pp.exists, true);
    assert.equal(pp.lines.length, 1);
    assert.equal(pp.lines[0].additionalRequirementQty, 10);
  });

  it("DRAFT and AWAITING remain blocked for RM planning", async () => {
    const draftDb = createP4bDb([{ id: 22, status: "DRAFT" }]);
    const draftRm = await getRmPlanning({ db: draftDb, planId: 22 });
    assert.equal(draftRm.exists, false);

    const awaitingDb = createP4bDb([{ id: 23, status: "AWAITING_PURCHASE_REVIEW" }]);
    const awaitingRm = await getRmPlanning({ db: awaitingDb, planId: 23 });
    assert.equal(awaitingRm.exists, false);
  });
});

describe("monthlyPlanningPlanDocumentP4b.release on APPROVED", () => {
  it("releaseToProcurement works for APPROVED plan documents", async () => {
    const db = createP4bDb([{ id: 30, status: "AWAITING_PURCHASE_REVIEW", planSequenceNo: 2, planKind: "ADDITIONAL" }]);
    await purchaseApprovePlan({ db, planId: 30, deps: depsFor() });
    const res = await releaseToProcurement({ db, planId: 30, confirm: true, actorUserId: 2 });
    assert.equal(res.releasedLineCount, 1);
    assert.equal(db.__state.mrs.length, 1);
    assert.match(db.__state.mrs[0].remarks, /June Plan 2/);
    assert.doesNotMatch(db.__state.mrs[0].remarks, /rev 1/i);
  });

  it("blocks release for DRAFT and AWAITING_PURCHASE_REVIEW", async () => {
    const draftDb = createP4bDb([{ id: 31, status: "DRAFT" }]);
    await assert.rejects(
      () => releaseToProcurement({ db: draftDb, planId: 31, confirm: true }),
      (e) => e instanceof MonthlyPlanningError && e.code === "PLAN_NOT_RELEASABLE",
    );
    const awaitingDb = createP4bDb([{ id: 32, status: "AWAITING_PURCHASE_REVIEW" }]);
    await assert.rejects(
      () => releaseToProcurement({ db: awaitingDb, planId: 32, confirm: true }),
      (e) => e instanceof MonthlyPlanningError && e.code === "PLAN_NOT_RELEASABLE",
    );
  });
});

describe("monthlyPlanningPlanDocumentP4b.multi-plan isolation", () => {
  it("keeps separate RM snapshots per plan document", async () => {
    const db = createP4bDb([
      { id: 40, status: "AWAITING_PURCHASE_REVIEW", planSequenceNo: 1, planKind: "INITIAL", lines: [{ id: 1, fgItemId: 65, plannedFgQty: "10000", suggestedFgQty: "10000", plannedQtyOverridden: false, source: "REQUIREMENT_SHEET", fgItem: { id: 65, itemName: "Cap", unit: "Pcs" } }] },
      { id: 41, status: "AWAITING_PURCHASE_REVIEW", planSequenceNo: 2, planKind: "ADDITIONAL", lines: [{ id: 2, fgItemId: 65, plannedFgQty: "700", suggestedFgQty: "10000", plannedQtyOverridden: false, source: "REQUIREMENT_SHEET", fgItem: { id: 65, itemName: "Nozzle", unit: "Pcs" } }] },
    ]);
    await purchaseApprovePlan({ db, planId: 40, deps: depsFor({ rmNeeded: new Map([[70, 100]]) }) });
    await purchaseApprovePlan({ db, planId: 41, deps: depsFor({ rmNeeded: new Map([[70, 7]]) }) });
    assert.equal(db.__state.rmPlans.length, 2);
    const plan1Rm = await getRmPlanning({ db, planId: 40 });
    const plan2Rm = await getRmPlanning({ db, planId: 41 });
    assert.equal(plan1Rm.lines[0].grossDemandQty, 100);
    assert.equal(plan2Rm.lines[0].grossDemandQty, 7);
  });
});

describe("monthlyPlanningPlanDocumentP4b.procurement trace labels", () => {
  it("uses plan document label for APPROVED releases", () => {
    const ctx = mapMonthlyPlanContext({
      sourceRevision: 1,
      monthlyProductionPlan: {
        id: 50,
        docNo: "MPP-26-0050",
        periodKey: "2026-06",
        currentRevision: 0,
        status: "APPROVED",
        planSequenceNo: 2,
        planKind: "ADDITIONAL",
      },
    });
    assert.equal(ctx.label, "June Plan 2");
  });

  it("keeps revision wording for legacy LOCKED plans", () => {
    const ctx = mapMonthlyPlanContext({
      sourceRevision: 2,
      monthlyProductionPlan: {
        id: 51,
        docNo: "MPP-legacy",
        periodKey: "2026-06",
        currentRevision: 2,
        status: "LOCKED",
        planSequenceNo: 1,
        planKind: "INITIAL",
      },
    });
    assert.equal(ctx.label, "Monthly Plan Rev 2");
  });
});
