const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolvePlannedFgQtyForSave,
  findGreenShortagePlannedBelowSuggested,
  syncNonOverriddenPlanLinesToSuggested,
  backfillNonOverriddenPlannedQtyForPlan,
} = require("../../src/services/monthlyPlanningProductionLinePlannedQty");
const { updateProductionLines, MonthlyPlanningError } = require("../../src/services/monthlyPlanningService");
const { submitPlanForPurchaseReview, purchaseApprovePlan } = require("../../src/services/monthlyPlanningPlanLifecycleService");

const PVC_COMPOSITION = {
  periodKey: "2026-06",
  items: [
    {
      itemId: 101,
      itemName: "PVC Angle",
      rsRequirement: 8100,
      carryForward: 0,
      greenShortage: 6000,
      suggestedProduction: 14100,
    },
  ],
};

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
      update: async ({ where, data }) => {
        const line = state.lines.find((l) => l.id === where.id);
        if (line) Object.assign(line, data);
        return line;
      },
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

const emptyGreenLoader = async () => ({ anchorPeriodKey: "2026-06", items: [] });

describe("monthlyPlanningProductionLinePlannedQty.resolvePlannedFgQtyForSave", () => {
  it("defaults planned to suggested when not overridden", () => {
    assert.equal(
      resolvePlannedFgQtyForSave({
        clientPlannedFgQty: 8100,
        plannedQtyOverridden: false,
        suggestedFgQty: 14100,
      }),
      14100,
    );
  });

  it("keeps manual planned qty when overridden", () => {
    assert.equal(
      resolvePlannedFgQtyForSave({
        clientPlannedFgQty: 8100,
        plannedQtyOverridden: true,
        suggestedFgQty: 14100,
      }),
      8100,
    );
  });
});

describe("monthlyPlanningProductionLinePlannedQty.updateProductionLines integration", () => {
  it("PVC Angle: save refreshes planned to suggested when Green Level changes and not overridden", async () => {
    const db = createLinesMockDb({
      status: "DRAFT",
      items: [{ id: 101, itemType: "FG" }],
      existingLines: [
        {
          id: 1,
          fgItemId: 101,
          plannedFgQty: 8100,
          suggestedFgQty: 8100,
          plannedQtyOverridden: false,
          source: "REQUIREMENT_SHEET",
        },
      ],
    });
    const res = await updateProductionLines({
      db,
      planId: 1,
      upserts: [{ fgItemId: 101, plannedFgQty: 8100, plannedQtyOverridden: false, source: "REQUIREMENT_SHEET" }],
      loadComposition: async () => PVC_COMPOSITION,
      loadGreenLevelsFn: emptyGreenLoader,
    });
    assert.equal(res.lines[0].plannedFgQty, 14100);
    assert.equal(res.lines[0].suggestedFgQty, 14100);
    assert.equal(db.__state.lines[0].plannedFgQty, 14100);
  });

  it("manual override remains allowed on save", async () => {
    const db = createLinesMockDb({
      status: "DRAFT",
      items: [{ id: 101, itemType: "FG" }],
    });
    const res = await updateProductionLines({
      db,
      planId: 1,
      upserts: [
        {
          fgItemId: 101,
          plannedFgQty: 8100,
          plannedQtyOverridden: true,
          source: "REQUIREMENT_SHEET",
        },
      ],
      loadComposition: async () => PVC_COMPOSITION,
      loadGreenLevelsFn: emptyGreenLoader,
    });
    assert.equal(res.lines[0].plannedFgQty, 8100);
    assert.equal(db.__state.lines[0].plannedFgQty, 8100);
    assert.equal(db.__state.lines[0].plannedQtyOverridden, true);
  });
});

function createSubmitDb({ lines, status = "DRAFT" }) {
  const state = { lines: lines.map((l) => ({ ...l })), plan: { id: 10, periodKey: "2026-06", status, planSequenceNo: 1 }, rmPlans: [], rmPlanLines: [], nextRmPlanId: 501 };
  const db = {
    monthlyProductionPlan: {
      findUnique: async ({ where }) => (where.id === state.plan.id ? { ...state.plan } : null),
      findMany: async () => [],
      update: async ({ data }) => {
        state.plan = { ...state.plan, ...data };
        return state.plan;
      },
    },
    monthlyProductionPlanLine: {
      findMany: async () =>
        state.lines.map((l) => ({
          id: l.id,
          fgItemId: l.fgItemId,
          plannedFgQty: l.plannedFgQty,
          suggestedFgQty: l.suggestedFgQty ?? l.plannedFgQty,
          plannedQtyOverridden: Boolean(l.plannedQtyOverridden),
          source: l.source ?? "REQUIREMENT_SHEET",
          remarks: l.remarks ?? null,
          fgItem: { id: l.fgItemId, itemName: `Item ${l.fgItemId}`, unit: "NOS" },
        })),
      update: async ({ where, data }) => {
        const line = state.lines.find((l) => l.id === where.id);
        Object.assign(line, data);
        return line;
      },
    },
    item: { findMany: async () => [{ id: 70, itemName: "PP", unit: "KG" }] },
    rmPlan: {
      findUnique: async ({ where }) => {
        const r = state.rmPlans.find(
          (x) => x.planId === where.planId_revision.planId && x.revision === where.planId_revision.revision,
        );
        if (!r) return null;
        return { ...r, lines: state.rmPlanLines.filter((l) => l.rmPlanId === r.id) };
      },
      create: async ({ data }) => {
        const row = { id: state.nextRmPlanId++, ...data };
        state.rmPlans.push(row);
        return row;
      },
    },
    rmPlanLine: { createMany: async ({ data }) => { state.rmPlanLines.push(...data); return { count: data.length }; } },
    $transaction: async (fn) => fn(db),
    __state: state,
  };
  return db;
}

const approveDeps = () => ({
  loadFgGreenShortageInputs: async () => [{ fgItemId: 101, fgItemName: "PVC Angle", greenShortage: 6000 }],
  loadApprovedBomWithLines: async () => ({ id: 1, lines: [{ id: 1 }] }),
  aggregateRmDemandForFgLines: async () => ({ rmNeeded: new Map([[70, 126]]), missingChildBoms: [] }),
  getMaterialAvailabilityByItems: async () => [
    { itemId: 70, freeStockQty: 0, effectiveReservedQty: 0, incomingQty: 0, netShortageAfterIncomingQty: 126, warnings: [] },
  ],
});

describe("monthlyPlanningProductionLinePlannedQty.submit guards", () => {
  it("auto-refreshes non-overridden lines on submit then succeeds", async () => {
    const db = createSubmitDb({
      lines: [{ id: 1, fgItemId: 101, plannedFgQty: 8100, plannedQtyOverridden: false }],
    });
    const res = await submitPlanForPurchaseReview({
      db,
      planId: 10,
      loadComposition: async () => PVC_COMPOSITION,
    });
    assert.equal(res.status, "AWAITING_PURCHASE_REVIEW");
    assert.equal(db.__state.lines[0].plannedFgQty, 14100);
  });

  it("blocks submit when overridden planned is below suggested without confirm", async () => {
    const db = createSubmitDb({
      lines: [{ id: 1, fgItemId: 101, plannedFgQty: 8100, plannedQtyOverridden: true }],
    });
    await assert.rejects(
      () =>
        submitPlanForPurchaseReview({
          db,
          planId: 10,
          loadComposition: async () => PVC_COMPOSITION,
        }),
      (e) =>
        e instanceof MonthlyPlanningError && e.code === "PLANNED_BELOW_SUGGESTED_CONFIRM_REQUIRED",
    );
  });

  it("allows submit with override when confirmPlannedBelowSuggested is true", async () => {
    const db = createSubmitDb({
      lines: [{ id: 1, fgItemId: 101, plannedFgQty: 8100, plannedQtyOverridden: true }],
    });
    const res = await submitPlanForPurchaseReview({
      db,
      planId: 10,
      confirmPlannedBelowSuggested: true,
      loadComposition: async () => PVC_COMPOSITION,
    });
    assert.equal(res.status, "AWAITING_PURCHASE_REVIEW");
    assert.equal(db.__state.lines[0].plannedFgQty, 8100);
  });
});

describe("monthlyPlanningProductionLinePlannedQty.purchase approve guards", () => {
  it("auto-refreshes non-overridden lines on approve then succeeds", async () => {
    const db = createSubmitDb({
      status: "AWAITING_PURCHASE_REVIEW",
      lines: [{ id: 1, fgItemId: 101, plannedFgQty: 8100, plannedQtyOverridden: false }],
    });
    const res = await purchaseApprovePlan({
      db,
      planId: 10,
      loadComposition: async () => PVC_COMPOSITION,
      deps: approveDeps(),
    });
    assert.equal(res.status, "APPROVED");
    assert.equal(db.__state.lines[0].plannedFgQty, 14100);
    assert.equal(db.__state.lines[0].suggestedFgQty, 14100);
    assert.equal(db.__state.rmPlanLines[0]?.grossDemandQty, 126);
  });

  it("blocks approve when overridden planned is below suggested without confirm", async () => {
    const db = createSubmitDb({
      status: "AWAITING_PURCHASE_REVIEW",
      lines: [{ id: 1, fgItemId: 101, plannedFgQty: 8100, plannedQtyOverridden: true }],
    });
    await assert.rejects(
      () =>
        purchaseApprovePlan({
          db,
          planId: 10,
          loadComposition: async () => PVC_COMPOSITION,
          deps: { loadGreenShortages: async () => [{ fgItemId: 101, greenShortage: 6000 }] },
        }),
      (e) =>
        e instanceof MonthlyPlanningError && e.code === "PLANNED_BELOW_SUGGESTED_CONFIRM_REQUIRED",
    );
  });
});

describe("monthlyPlanningProductionLinePlannedQty.findGreenShortagePlannedBelowSuggested", () => {
  it("detects PVC Angle gap", () => {
    const violations = findGreenShortagePlannedBelowSuggested({
      lines: [{ fgItemId: 101, plannedFgQty: 8100, plannedQtyOverridden: true }],
      composition: PVC_COMPOSITION,
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].suggestedProduction, 14100);
    assert.equal(violations[0].greenShortage, 6000);
  });
});

describe("monthlyPlanningProductionLinePlannedQty.syncNonOverriddenPlanLinesToSuggested", () => {
  it("updates only non-overridden lines", async () => {
    const state = {
      lines: [
        { id: 1, fgItemId: 101, plannedQtyOverridden: false, plannedFgQty: 8100, suggestedFgQty: 8100 },
        { id: 2, fgItemId: 102, plannedQtyOverridden: true, plannedFgQty: 500, suggestedFgQty: 500 },
      ],
    };
    const tx = {
      monthlyProductionPlanLine: {
        findMany: async () => state.lines,
        update: async ({ where, data }) => {
          const line = state.lines.find((l) => l.id === where.id);
          Object.assign(line, data);
        },
      },
    };
    await syncNonOverriddenPlanLinesToSuggested(tx, 10, PVC_COMPOSITION);
    assert.equal(state.lines[0].plannedFgQty, 14100);
    assert.equal(state.lines[1].plannedFgQty, 500);
  });
});

describe("monthlyPlanningProductionLinePlannedQty.backfillNonOverriddenPlannedQtyForPlan", () => {
  it("dry-run reports PVC Angle planned uplift without writing", async () => {
    const state = {
      plan: { id: 18, docNo: "DOC-26-0001", periodKey: "2026-06", status: "APPROVED" },
      lines: [
        {
          id: 1,
          fgItemId: 101,
          plannedFgQty: 8100,
          suggestedFgQty: 14100,
          plannedQtyOverridden: false,
          fgItem: { itemName: "PVC Angle" },
        },
      ],
    };
    const db = {
      monthlyProductionPlan: {
        findFirst: async () => state.plan,
      },
      monthlyProductionPlanLine: {
        findMany: async () => state.lines,
        update: async ({ where, data }) => {
          Object.assign(state.lines.find((l) => l.id === where.id), data);
        },
      },
    };
    const res = await backfillNonOverriddenPlannedQtyForPlan({
      db,
      docNo: "DOC-26-0001",
      dryRun: true,
      loadComposition: async () => PVC_COMPOSITION,
    });
    assert.equal(res.dryRun, true);
    assert.equal(res.pending.length, 1);
    assert.equal(res.pending[0].fromPlannedFgQty, 8100);
    assert.equal(res.pending[0].toPlannedFgQty, 14100);
    assert.equal(state.lines[0].plannedFgQty, 8100);
  });
});
