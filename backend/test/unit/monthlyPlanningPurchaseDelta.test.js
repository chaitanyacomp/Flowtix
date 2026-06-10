const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getPurchasePlanning,
  getRmPlanning,
  mapPurchasePlanningLine,
  MonthlyPlanningError,
} = require("../../src/services/monthlyPlanningService");

function num(v) {
  return Number(v);
}

function createPurchaseDeltaDb({
  status = "LOCKED",
  currentRevision = 1,
  rmPlanLinesByRevision = {},
  monthlyPlanMrLines = [],
} = {}) {
  const state = {
    plan: { id: 1, status, currentRevision, periodKey: "2026-07", lockedAt: new Date() },
    rmPlans: [],
    rmPlanLines: [],
  };

  for (const [revision, lines] of Object.entries(rmPlanLinesByRevision)) {
    const rev = Number(revision);
    const rmPlanId = 500 + rev;
    state.rmPlans.push({
      id: rmPlanId,
      planId: 1,
      revision: rev,
      totalFgPlannedQty: lines.reduce((a, l) => a + num(l.netRequirementQty), 0),
      recalculatedAt: new Date(),
    });
    for (const line of lines) {
      state.rmPlanLines.push({
        rmPlanId,
        rmItemId: line.rmItemId,
        rmItem: { id: line.rmItemId, itemName: line.rmItemName ?? `RM ${line.rmItemId}`, unit: line.unit ?? "KG" },
        grossDemandQty: line.grossDemandQty ?? line.netRequirementQty,
        freeStockSnapshot: 0,
        reservedSnapshot: 0,
        incomingPoSnapshot: 0,
        minStockTopUpQty: 0,
        netRequirementQty: line.netRequirementQty,
        unitSnapshot: line.unit ?? "KG",
        belowMinStockFlag: false,
        leadTimeRiskFlag: false,
        warningsJson: null,
      });
    }
  }

  const db = {
    monthlyProductionPlan: {
      findUnique: async ({ where }) => (where.id === 1 ? { ...state.plan } : null),
    },
    rmPlan: {
      findMany: async () =>
        state.rmPlans.map((r) => ({ revision: r.revision, recalculatedAt: r.recalculatedAt })),
      findUnique: async ({ where }) => {
        const r = state.rmPlans.find(
          (x) => x.planId === where.planId_revision.planId && x.revision === where.planId_revision.revision,
        );
        if (!r) return null;
        return {
          ...r,
          lines: state.rmPlanLines
            .filter((l) => l.rmPlanId === r.id)
            .map((l) => ({
              id: l.rmItemId,
              rmItemId: l.rmItemId,
              rmItem: l.rmItem,
              grossDemandQty: l.grossDemandQty,
              freeStockSnapshot: l.freeStockSnapshot,
              reservedSnapshot: l.reservedSnapshot,
              incomingPoSnapshot: l.incomingPoSnapshot,
              minStockTopUpQty: l.minStockTopUpQty,
              netRequirementQty: l.netRequirementQty,
              unitSnapshot: l.unitSnapshot,
              belowMinStockFlag: l.belowMinStockFlag,
              leadTimeRiskFlag: l.leadTimeRiskFlag,
              warningsJson: l.warningsJson,
            })),
        };
      },
    },
    materialRequirementLine: {
      groupBy: async () => {
        const byItem = new Map();
        for (const l of monthlyPlanMrLines) {
          const cur = byItem.get(l.rmItemId) || { requiredQty: 0, procuredQty: 0 };
          cur.requiredQty += num(l.requiredQty);
          cur.procuredQty += num(l.procuredQty);
          byItem.set(l.rmItemId, cur);
        }
        return [...byItem.entries()].map(([rmItemId, sums]) => ({
          rmItemId,
          _sum: { requiredQty: sums.requiredQty, procuredQty: sums.procuredQty },
        }));
      },
    },
  };
  return db;
}

describe("monthlyPlanningPurchaseDelta.mapPurchasePlanningLine", () => {
  it("maps positive delta to additionalRequirementQty", () => {
    const row = mapPurchasePlanningLine(
      {
        rmItemId: 70,
        rmItemName: "HDPE",
        unit: "KG",
        grossDemandQty: 125,
        freeStockSnapshot: 0,
        reservedSnapshot: 0,
        incomingPoSnapshot: 0,
        netRequirementQty: 125,
        belowMinStockFlag: false,
        leadTimeRiskFlag: false,
        warnings: [],
      },
      { requisitioned: 100, procured: 0 },
    );
    assert.equal(row.currentRequirementQty, 125);
    assert.equal(row.previouslyReleasedQty, 100);
    assert.equal(row.deltaQty, 25);
    assert.equal(row.additionalRequirementQty, 25);
    assert.equal(row.reductionQty, 0);
    assert.equal(row.suggestedPurchaseQty, 25);
    assert.equal(row.varianceQty, 25);
    assert.equal(row.alreadyRequisitionedQty, 100);
    assert.equal(row.netRequirementQty, 125);
  });

  it("maps negative delta to reductionQty", () => {
    const row = mapPurchasePlanningLine(
      {
        rmItemId: 70,
        rmItemName: "HDPE",
        unit: "KG",
        grossDemandQty: 110,
        freeStockSnapshot: 0,
        reservedSnapshot: 0,
        incomingPoSnapshot: 0,
        netRequirementQty: 110,
        belowMinStockFlag: false,
        leadTimeRiskFlag: false,
        warnings: [],
      },
      { requisitioned: 125, procured: 0 },
    );
    assert.equal(row.deltaQty, -15);
    assert.equal(row.additionalRequirementQty, 0);
    assert.equal(row.reductionQty, 15);
    assert.equal(row.suggestedPurchaseQty, 0);
    assert.equal(row.procurementStatus, "OVER_RELEASED");
  });
});

describe("monthlyPlanningPurchaseDelta.getPurchasePlanning", () => {
  it("Rev 1: current 100, released 0 → additional 100", async () => {
    const db = createPurchaseDeltaDb({
      currentRevision: 1,
      rmPlanLinesByRevision: {
        1: [{ rmItemId: 70, rmItemName: "HDPE", netRequirementQty: 100 }],
      },
    });
    const res = await getPurchasePlanning({ db, planId: 1 });
    const line = res.lines[0];
    assert.equal(res.revision, 1);
    assert.equal(res.usesCurrentRevisionOnly, true);
    assert.equal(line.currentRequirementQty, 100);
    assert.equal(line.previouslyReleasedQty, 0);
    assert.equal(line.additionalRequirementQty, 100);
    assert.equal(line.reductionQty, 0);
    assert.equal(res.totals.additionalRequirementTotal, 100);
  });

  it("Rev 2: current 125, released 100 → additional 25", async () => {
    const db = createPurchaseDeltaDb({
      currentRevision: 2,
      rmPlanLinesByRevision: {
        1: [{ rmItemId: 70, netRequirementQty: 100 }],
        2: [{ rmItemId: 70, netRequirementQty: 125 }],
      },
      monthlyPlanMrLines: [{ rmItemId: 70, requiredQty: 100, procuredQty: 0 }],
    });
    const res = await getPurchasePlanning({ db, planId: 1 });
    assert.equal(res.revision, 2);
    const line = res.lines[0];
    assert.equal(line.currentRequirementQty, 125);
    assert.equal(line.previouslyReleasedQty, 100);
    assert.equal(line.additionalRequirementQty, 25);
    assert.equal(line.reductionQty, 0);
  });

  it("Rev 3: current 110, released 125 → reduction 15", async () => {
    const db = createPurchaseDeltaDb({
      currentRevision: 3,
      rmPlanLinesByRevision: {
        1: [{ rmItemId: 70, netRequirementQty: 100 }],
        2: [{ rmItemId: 70, netRequirementQty: 125 }],
        3: [{ rmItemId: 70, netRequirementQty: 110 }],
      },
      monthlyPlanMrLines: [{ rmItemId: 70, requiredQty: 125, procuredQty: 0 }],
    });
    const res = await getPurchasePlanning({ db, planId: 1 });
    assert.equal(res.revision, 3);
    const line = res.lines[0];
    assert.equal(line.currentRequirementQty, 110);
    assert.equal(line.previouslyReleasedQty, 125);
    assert.equal(line.deltaQty, -15);
    assert.equal(line.additionalRequirementQty, 0);
    assert.equal(line.reductionQty, 15);
    assert.equal(res.totals.reductionTotal, 15);
  });

  it("mixed RM: positive, negative, and zero delta", async () => {
    const db = createPurchaseDeltaDb({
      currentRevision: 2,
      rmPlanLinesByRevision: {
        2: [
          { rmItemId: 70, rmItemName: "HDPE", netRequirementQty: 125 },
          { rmItemId: 71, rmItemName: "Powder", netRequirementQty: 8 },
          { rmItemId: 72, rmItemName: "PP", netRequirementQty: 50 },
        ],
      },
      monthlyPlanMrLines: [
        { rmItemId: 70, requiredQty: 100, procuredQty: 0 },
        { rmItemId: 71, requiredQty: 10, procuredQty: 0 },
        { rmItemId: 72, requiredQty: 50, procuredQty: 0 },
      ],
    });
    const res = await getPurchasePlanning({ db, planId: 1 });
    const byId = new Map(res.lines.map((l) => [l.rmItemId, l]));
    assert.equal(byId.get(70).additionalRequirementQty, 25);
    assert.equal(byId.get(70).reductionQty, 0);
    assert.equal(byId.get(71).additionalRequirementQty, 0);
    assert.equal(byId.get(71).reductionQty, 2);
    assert.equal(byId.get(72).additionalRequirementQty, 0);
    assert.equal(byId.get(72).reductionQty, 0);
    assert.equal(res.totals.additionalRequirementTotal, 25);
    assert.equal(res.totals.reductionTotal, 2);
  });

  it("rejects explicit revision query param", async () => {
    const db = createPurchaseDeltaDb({
      currentRevision: 2,
      rmPlanLinesByRevision: { 2: [{ rmItemId: 70, netRequirementQty: 125 }] },
    });
    await assert.rejects(
      () => getPurchasePlanning({ db, planId: 1, revision: 1 }),
      (e) => e instanceof MonthlyPlanningError && e.code === "PURCHASE_REVISION_NOT_SUPPORTED",
    );
  });

  it("uses current revision even when older RM snapshots exist", async () => {
    const db = createPurchaseDeltaDb({
      currentRevision: 2,
      rmPlanLinesByRevision: {
        1: [{ rmItemId: 70, netRequirementQty: 100 }],
        2: [{ rmItemId: 70, netRequirementQty: 125 }],
      },
      monthlyPlanMrLines: [{ rmItemId: 70, requiredQty: 100, procuredQty: 0 }],
    });
    const purchase = await getPurchasePlanning({ db, planId: 1 });
    const rmOld = await getRmPlanning({ db, planId: 1, revision: 1 });
    assert.equal(purchase.revision, 2);
    assert.equal(purchase.lines[0].currentRequirementQty, 125);
    assert.equal(rmOld.revision, 1);
    assert.equal(num(rmOld.lines[0].netRequirementQty), 100);
  });
});
