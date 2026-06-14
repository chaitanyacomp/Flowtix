const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const {
  getRmPlanning,
  getPurchasePlanning,
  releaseToProcurement,
  MonthlyPlanningError,
} = require("../../src/services/monthlyPlanningService");
const {
  submitPlanForPurchaseReview,
  purchaseApprovePlan,
} = require("../../src/services/monthlyPlanningPlanLifecycleService");
const {
  previewAdditionalPlan,
  createAdditionalPlan,
} = require("../../src/services/monthlyPlanningAdditionalPlanService");
const { mrSourceDescriptor, sourceRefForMr } = require("../../src/services/procurementWorkspaceService");
const { sourceRefForRequirement } = require("../../src/services/procurementPlanningService");
const { mapMonthlyPlanContext } = require("../../src/services/procurementTraceService");
const { APPROVED_PLAN_SNAPSHOT_REVISION } = require("../../src/services/monthlyPlanningRmSnapshotService");

const additionalPlanBodySchema = z.object({
  remarks: z.string().trim().max(2000).optional(),
  confirmPastPeriod: z.literal(true).optional(),
});

function depsFor({ rmNeeded = new Map([[70, 12]]) } = {}) {
  return {
    allowLegacyLock: true,
    loadApprovedBomWithLines: async () => ({ id: 1, lines: [{ id: 1 }] }),
    aggregateRmDemandForFgLines: async () => ({ rmNeeded, missingChildBoms: [] }),
    getMaterialAvailabilityByItems: async ({ itemIds, requiredQtyByItemId }) =>
      (itemIds ?? [70]).map((itemId) => {
        const gross = Number(requiredQtyByItemId?.[itemId] ?? rmNeeded.get(itemId) ?? 0);
        return {
          itemId,
          freeStockQty: 0,
          effectiveReservedQty: 0,
          incomingQty: 0,
          netShortageAfterIncomingQty: gross,
          warnings: [],
        };
      }),
  };
}

function createP4dDb(initialPlans = []) {
  const state = {
    nextId: 100,
    nextRmPlanId: 500,
    nextMrId: 800,
    nextMrLineId: 9000,
    seq: 1,
    rmPlans: [],
    rmPlanLines: [],
    mrs: [],
    plans: initialPlans.map((p, idx) => ({
      id: p.id ?? idx + 1,
      periodKey: p.periodKey ?? "2026-10",
      planSequenceNo: p.planSequenceNo ?? 1,
      planKind: p.planKind ?? (p.planSequenceNo > 1 ? "ADDITIONAL" : "INITIAL"),
      currentRevision: p.currentRevision ?? 0,
      status: p.status ?? "DRAFT",
      lines:
        p.lines ??
        [{ id: 1, fgItemId: 65, plannedFgQty: "5000", suggestedFgQty: "5000", plannedQtyOverridden: false, source: "MANUAL", fgItem: { id: 65, itemName: "Cap", unit: "Pcs" } }],
      lockedAt: null,
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
        const row = { id: ++state.nextId, ...data, lines: [] };
        state.plans.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const idx = state.plans.findIndex((p) => p.id === where.id);
        state.plans[idx] = { ...state.plans[idx], ...data };
        return state.plans[idx];
      },
    },
    monthlyProductionPlanLine: {
      findMany: async ({ where }) => {
        if (where?.plan?.periodKey || where?.plan?.status) {
          const rows = [];
          for (const plan of state.plans) {
            if (where?.plan?.periodKey && plan.periodKey !== where.plan.periodKey) continue;
            if (where?.plan?.status && plan.status !== where.plan.status) continue;
            for (const line of plan.lines ?? []) {
              rows.push({
                fgItemId: line.fgItemId,
                plannedFgQty: line.plannedFgQty,
                plan: { periodKey: plan.periodKey, status: plan.status },
              });
            }
          }
          return rows;
        }
        const plan = state.plans.find((p) => p.id === where.planId);
        return (plan?.lines ?? []).map((l) => ({
          ...l,
          fgItem: l.fgItem ?? { id: l.fgItemId, itemName: "FG", unit: "Pcs" },
        }));
      },
      createMany: async ({ data }) => {
        const plan = state.plans.find((p) => p.id === data[0]?.planId);
        for (const row of data) plan.lines.push({ id: plan.lines.length + 1, ...row });
        return { count: data.length };
      },
    },
    monthlyProductionPlanRevisionLine: { createMany: async () => ({ count: 0 }) },
    rmPlan: {
      findFirst: async ({ where }) => {
        const rows = state.rmPlans.filter((r) => r.planId === where.planId);
        return rows[0] ? { revision: rows[0].revision } : null;
      },
      findMany: async ({ where }) =>
        state.rmPlans.filter((r) => r.planId === where.planId).map((r) => ({ revision: r.revision })),
      findUnique: async ({ where, include }) => {
        const row = state.rmPlans.find(
          (r) => r.planId === where.planId_revision.planId && r.revision === where.planId_revision.revision,
        );
        if (!row) return null;
        if (!include?.lines) return { ...row };
        return {
          ...row,
          lines: state.rmPlanLines.filter((l) => l.rmPlanId === row.id),
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
        for (const row of data) state.rmPlanLines.push({ id: state.rmPlanLines.length + 1, ...row });
        return { count: data.length };
      },
    },
    item: {
      findMany: async ({ where }) =>
        (where?.id?.in ?? [65]).map((id) => ({
          id,
          itemName: "RM",
          unit: "Kg",
          minimumStockQty: 0,
          itemType: id === 65 ? "FG" : "RM",
        })),
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
      findFirst: async ({ where }) => {
        const rows = state.mrs.filter((mr) => {
          if (where?.monthlyProductionPlanId != null && mr.monthlyProductionPlanId !== where.monthlyProductionPlanId) {
            return false;
          }
          if (where?.sourceType && mr.sourceType !== where.sourceType) return false;
          return true;
        });
        return rows[0] ?? null;
      },
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

describe("monthlyPlanningPlanDocumentP4d.additional plan route body", () => {
  it("accepts empty body for path-based additional plan create", () => {
    assert.doesNotThrow(() => additionalPlanBodySchema.parse({}));
  });
});

describe("monthlyPlanningPlanDocumentP4d.plan 2 isolation", () => {
  it("keeps separate RM snapshots and release MRs per plan document", async () => {
    const db = createP4dDb([
      { id: 1, status: "APPROVED", planSequenceNo: 1, planKind: "INITIAL", releasedRevision: 1 },
      { id: 2, status: "AWAITING_PURCHASE_REVIEW", planSequenceNo: 2, planKind: "ADDITIONAL", lines: [{ id: 2, fgItemId: 65, plannedFgQty: "700", suggestedFgQty: "700", plannedQtyOverridden: false, source: "MANUAL", fgItem: { id: 65, itemName: "Cap", unit: "Pcs" } }] },
    ]);
    const deps = depsFor({ rmNeeded: new Map([[70, 7]]) });
    await purchaseApprovePlan({ db, planId: 2, deps });
    const rm2 = await getRmPlanning({ db, planId: 2 });
    assert.equal(rm2.revision, APPROVED_PLAN_SNAPSHOT_REVISION);
    assert.equal(rm2.lines[0].grossDemandQty, 7);
    const rel = await releaseToProcurement({ db, planId: 2, confirm: true });
    assert.equal(rel.releasedLineCount, 1);
    assert.equal(db.__state.mrs.length, 1);
    assert.match(db.__state.mrs[0].remarks, /October Plan 2/);
  });

  it("purchase planning for plan 2 is isolated from plan 1 released MR", async () => {
    const db = createP4dDb([
      { id: 10, status: "AWAITING_PURCHASE_REVIEW", planSequenceNo: 1, planKind: "INITIAL" },
      {
        id: 11,
        status: "AWAITING_PURCHASE_REVIEW",
        planSequenceNo: 2,
        planKind: "ADDITIONAL",
        lines: [{ id: 2, fgItemId: 65, plannedFgQty: "300", suggestedFgQty: "300", plannedQtyOverridden: false, source: "MANUAL", fgItem: { id: 65, itemName: "Cap", unit: "Pcs" } }],
      },
    ]);
    await purchaseApprovePlan({ db, planId: 10, deps: depsFor({ rmNeeded: new Map([[70, 20]]) }) });
    await releaseToProcurement({ db, planId: 10, confirm: true });
    await purchaseApprovePlan({ db, planId: 11, deps: depsFor({ rmNeeded: new Map([[70, 5]]) }) });
    const pp2 = await getPurchasePlanning({ db, planId: 11 });
    assert.equal(pp2.lines[0].previouslyReleasedQty ?? pp2.lines[0].alreadyRequisitionedQty, 0);
    assert.equal(pp2.lines[0].additionalRequirementQty ?? pp2.lines[0].suggestedPurchaseQty, 5);
  });
});

describe("monthlyPlanningPlanDocumentP4d.procurement labels", () => {
  it("uses plan document labels for APPROVED monthly plan MRs", () => {
    const mr = {
      sourceType: "MONTHLY_PLAN",
      sourceRevision: 1,
      monthlyProductionPlanId: 6,
      monthlyProductionPlan: {
        id: 6,
        periodKey: "2026-10",
        status: "APPROVED",
        planSequenceNo: 1,
        planKind: "INITIAL",
        currentRevision: 0,
      },
    };
    const src = mrSourceDescriptor(mr);
    assert.equal(src.planDocumentLabel, "October Plan 1");
    assert.equal(src.label, "October Plan 1");
    assert.equal(sourceRefForMr(mr), "October Plan 1");
  });

  it("maps trace labels for plan 1 and plan 2 separately", () => {
    const plan1 = mapMonthlyPlanContext({
      sourceRevision: 1,
      monthlyProductionPlan: {
        id: 6,
        periodKey: "2026-10",
        status: "APPROVED",
        planSequenceNo: 1,
        planKind: "INITIAL",
        currentRevision: 0,
      },
    });
    const plan2 = mapMonthlyPlanContext({
      sourceRevision: 1,
      monthlyProductionPlan: {
        id: 7,
        periodKey: "2026-10",
        status: "APPROVED",
        planSequenceNo: 2,
        planKind: "ADDITIONAL",
        currentRevision: 0,
      },
    });
    assert.equal(plan1.label, "October Plan 1");
    assert.equal(plan2.label, "October Plan 2");
  });

  it("uses plan document labels in procurement pool origin sourceRef", () => {
    const mr = {
      sourceType: "MONTHLY_PLAN",
      sourceRevision: 1,
      docNo: "MR-26-0004",
      monthlyProductionPlan: {
        id: 7,
        periodKey: "2026-10",
        status: "APPROVED",
        planSequenceNo: 2,
        planKind: "ADDITIONAL",
        currentRevision: 0,
      },
    };
    assert.equal(sourceRefForRequirement(mr), "October Plan 2");
  });
});

describe("monthlyPlanningPlanDocumentP4d.active plan blocking", () => {
  const loadComposition = async () => ({
    periodKey: "2026-10",
    anchorPeriodKey: "2026-10",
    items: [{ itemId: 65, itemName: "Cap", unit: "Pcs", suggestedProduction: 10000 }],
  });

  it("blocks additional plan create while another plan awaits review", async () => {
    const db = createP4dDb([
      { id: 20, status: "APPROVED", planSequenceNo: 1 },
      { id: 21, status: "AWAITING_PURCHASE_REVIEW", planSequenceNo: 2, planKind: "ADDITIONAL" },
    ]);
    const preview = await previewAdditionalPlan({
      db,
      periodKey: "2026-10",
      loadRequirementComposition: loadComposition,
    });
    assert.equal(preview.canCreate, false);
    assert.equal(preview.blockingCode, "ACTIVE_PLAN_EXISTS");
    await assert.rejects(
      () =>
        createAdditionalPlan({
          db,
          periodKey: "2026-10",
          loadRequirementComposition: loadComposition,
        }),
      (e) => e instanceof MonthlyPlanningError && e.code === "ACTIVE_PLAN_EXISTS",
    );
  });

  it("blocks submit on plan 2 while plan 1 is awaiting review in same period", async () => {
    const db = createP4dDb([
      { id: 30, status: "AWAITING_PURCHASE_REVIEW", planSequenceNo: 1 },
      { id: 31, status: "DRAFT", planSequenceNo: 2, planKind: "ADDITIONAL" },
    ]);
    await assert.rejects(
      () => submitPlanForPurchaseReview({ db, planId: 31, actorUserId: 2 }),
      (e) => e instanceof MonthlyPlanningError && e.code === "ACTIVE_PLAN_EXISTS",
    );
  });
});

describe("monthlyPlanningPlanDocumentP4d.additional preview after release", () => {
  const loadCompositionFull = async () => ({
    periodKey: "2026-10",
    anchorPeriodKey: "2026-10",
    items: [
      { itemId: 65, itemName: "Cap", unit: "Pcs", suggestedProduction: 5000 },
      { itemId: 66, itemName: "Nozzle", unit: "Pcs", suggestedProduction: 10000 },
    ],
  });

  it("shows remaining delta after plan 1 release when composition exceeds approved", async () => {
    const db = createP4dDb([
      {
        id: 1,
        status: "APPROVED",
        planSequenceNo: 1,
        releasedRevision: 1,
        lines: [
          { id: 1, fgItemId: 65, plannedFgQty: "3000", suggestedFgQty: "3000", plannedQtyOverridden: false, source: "MANUAL", fgItem: { id: 65, itemName: "Cap", unit: "Pcs" } },
          { id: 2, fgItemId: 66, plannedFgQty: "10000", suggestedFgQty: "10000", plannedQtyOverridden: false, source: "MANUAL", fgItem: { id: 66, itemName: "Nozzle", unit: "Pcs" } },
        ],
      },
    ]);
    const preview = await previewAdditionalPlan({
      db,
      periodKey: "2026-10",
      loadRequirementComposition: loadCompositionFull,
    });
    assert.equal(preview.canCreate, true);
    assert.equal(preview.nextPlanLabel, "October Plan 2");
    const cap = preview.items.find((i) => i.fgItemId === 65);
    assert.equal(cap.additionalRequirementQty, 2000);
  });

  it("blocks additional preview when both plans fully cover composition", async () => {
    const db = createP4dDb([
      {
        id: 1,
        status: "APPROVED",
        planSequenceNo: 1,
        releasedRevision: 1,
        lines: [
          { id: 1, fgItemId: 65, plannedFgQty: "5000", suggestedFgQty: "5000", plannedQtyOverridden: false, source: "MANUAL", fgItem: { id: 65, itemName: "Cap", unit: "Pcs" } },
          { id: 2, fgItemId: 66, plannedFgQty: "10000", suggestedFgQty: "10000", plannedQtyOverridden: false, source: "MANUAL", fgItem: { id: 66, itemName: "Nozzle", unit: "Pcs" } },
        ],
      },
      {
        id: 2,
        status: "APPROVED",
        planSequenceNo: 2,
        planKind: "ADDITIONAL",
        releasedRevision: 1,
        lines: [{ id: 3, fgItemId: 65, plannedFgQty: "2000", suggestedFgQty: "2000", plannedQtyOverridden: false, source: "MANUAL", fgItem: { id: 65, itemName: "Cap", unit: "Pcs" } }],
      },
    ]);
    const preview = await previewAdditionalPlan({
      db,
      periodKey: "2026-10",
      loadRequirementComposition: loadCompositionFull,
    });
    assert.equal(preview.canCreate, false);
    assert.equal(preview.blockingCode, "NO_ADDITIONAL_REQUIREMENT");
  });
});
