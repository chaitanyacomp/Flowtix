const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getRequirementSheetExecutionSummary,
  assessNoQtyPlacementStageForCycle,
  deriveReadyToPlaceWo,
  deriveNoQtyPlacementProcessStage,
  NO_QTY_PLACEMENT_STAGE,
  woLinePlacedQty,
} = require("../../src/services/requirementSheetExecutionService");
const { assessNoQtyBatchPlacement: realAssessNoQtyBatchPlacement } = require("../../src/services/noQtyBatchPlacementEngine");

function createMockDb(state) {
  return {
    requirementSheet: {
      findUnique: async ({ where }) => state.sheets.find((s) => s.id === where.id) ?? null,
    },
    monthlyProductionPlan: {
      findFirst: async ({ where }) => {
        const pk = where.periodKey;
        const released = where.releasedAt?.not != null;
        return (
          state.plans.find(
            (p) =>
              p.periodKey === pk &&
              (!released || p.releasedAt != null),
          ) ?? null
        );
      },
    },
    materialRequirement: {
      findFirst: async ({ where }) =>
        state.mrs.find(
          (m) =>
            m.monthlyProductionPlanId === where.monthlyProductionPlanId &&
            m.sourceType === where.sourceType &&
            m.reversedAt == null,
        ) ?? null,
    },
    workOrder: {
      findMany: async ({ where }) =>
        state.workOrders
          .filter((wo) => wo.requirementSheetId === where.requirementSheetId)
          .map((wo) => ({
            ...wo,
            productionMaterialRequests: state.pmrs
              .filter((p) => p.workOrderId === wo.id)
              .sort((a, b) => b.id - a.id)
              .slice(0, 1),
          })),
    },
    purchaseRequestLineSourceLink: {
      findMany: async () => state.purchaseRequestLineSourceLinks ?? [],
    },
    rmPoLineProcurementLink: {
      findMany: async () => state.rmPoLineProcurementLinks ?? [],
    },
    bom: { findFirst: async () => null },
    stockTransaction: { groupBy: async () => [] },
    item: { findMany: async () => [], findFirst: async () => null },
    productionMaterialRequestLine: { findMany: async () => [] },
    rmPurchaseOrder: { findMany: async () => [] },
    location: { findFirst: async () => ({ id: 1 }), findMany: async () => [] },
    materialAllocation: { findMany: async () => [] },
  };
}

function readinessDeps({
  rmNeeded = new Map(),
  missingChildBoms = [],
  availabilityRows = [],
  onFgLines = null,
  loadApprovedBomWithLines = async () => ({ id: 1, lines: [{ id: 1 }] }),
  assessNoQtyBatchPlacement = null,
  assessNoQtyMonthlyPlanningGate = async () => ({ gate: "READY_FOR_EXECUTION" }),
} = {}) {
  const aggregateFn = async (_db, fgLines) => {
    if (onFgLines) onFgLines(fgLines);
    return { rmNeeded, missingChildBoms };
  };
  const availabilityFn = async () => availabilityRows;
  const engineDeps = {
    loadApprovedBomWithLines,
    aggregateRmDemandForFgLines: aggregateFn,
    getMaterialAvailabilityByItems: availabilityFn,
  };

  return {
    ...engineDeps,
    assessNoQtyMonthlyPlanningGate,
    assessNoQtyBatchPlacement:
      assessNoQtyBatchPlacement ??
      ((db, sheet, innerDeps = {}) =>
        realAssessNoQtyBatchPlacement(db, sheet, {
          ...engineDeps,
          ...innerDeps,
        })),
  };
}

function createAssessorMockDb(state) {
  const enrichSheet = (top) => {
    if (!top) return null;
    return {
      ...top,
      salesOrder: top.salesOrder ?? { id: top.salesOrderId, orderType: "NO_QTY" },
      lines: (top.lines ?? []).map((ln) => ({
        ...ln,
        item: ln.item ?? { id: ln.itemId, itemName: ln.itemName ?? `Item ${ln.itemId}`, itemType: "FG" },
      })),
    };
  };
  const base = createMockDb(state);
  return {
    ...base,
    requirementSheet: {
      findUnique: async ({ where }) => enrichSheet(state.sheets.find((s) => s.id === where.id) ?? null),
      findFirst: async ({ where, orderBy, select }) => {
        let rows = state.sheets.filter((s) => {
          if (where.salesOrderId != null && s.salesOrderId !== where.salesOrderId) return false;
          if (where.cycleId != null && s.cycleId !== where.cycleId) return false;
          if (where.status != null && s.status !== where.status) return false;
          return true;
        });
        if (orderBy) {
          rows = [...rows].sort((a, b) => {
            const va = Number(a.version ?? 1);
            const vb = Number(b.version ?? 1);
            if (vb !== va) return vb - va;
            return Number(b.id) - Number(a.id);
          });
        }
        const top = rows[0] ?? null;
        if (!top) return null;
        if (select?.id) return { id: top.id };
        return enrichSheet(top);
      },
    },
  };
}

function placementPreviewDeps({
  canPlace = true,
  totalExecutableQty = 7000,
  totalRsBalanceQty = 7000,
  status = "PARTIALLY_READY",
  assessNoQtyMonthlyPlanningGate,
} = {}) {
  return readinessDeps({
    rmNeeded: new Map([[700, 0.5]]),
    availabilityRows: [
      {
        itemId: 700,
        itemName: "RM-A",
        requiredQty: 5000,
        freeStockQty: 10000,
        shortageAfterReservationQty: 0,
        incomingQty: 0,
      },
    ],
    assessNoQtyMonthlyPlanningGate,
    assessNoQtyBatchPlacement: async (_db, sheet, deps = {}) => {
      const placedByItem = deps.placedByItem ?? new Map();
      const lines = (sheet?.lines ?? []).map((ln) => {
        const itemId = Number(ln.itemId);
        const rsDemandQty = Number(ln.requirementQty ?? 0);
        const woPlacedQty = Number(placedByItem.get(itemId) ?? 0);
        const rsBalanceQty = Math.max(0, rsDemandQty - woPlacedQty);
        return {
          itemId,
          itemName: ln.item?.itemName ?? `Item ${itemId}`,
          rsDemandQty,
          woPlacedQty,
          rsBalanceQty,
          suggestedExecutableQty: totalExecutableQty,
          executableQty: totalExecutableQty,
          status,
          reason: "test",
          rmLines: [],
        };
      });
      return {
        balanceLines: lines,
        totals: {
          rsDemandQty: lines.reduce((s, l) => s + l.rsDemandQty, 0),
          woPlacedQty: lines.reduce((s, l) => s + l.woPlacedQty, 0),
          rsBalanceQty: totalRsBalanceQty,
        },
        placement: {
          canPlace,
          status,
          reason: "test",
          summary: {
            totalRsBalanceQty,
            totalExecutableQty,
            totalWoPlacedQty: 3000,
            totalRsDemandQty: 10000,
          },
          lines,
          sharedRmConflict: false,
        },
        rmReadiness: {
          basis: "PROPOSED_WO_QTY",
          fgBalanceLines: [],
          lines: [
            {
              rmItemId: 700,
              rmItemName: "RM-A",
              requiredQty: 5000,
              availableQty: 10000,
              shortageQty: 0,
              incomingQty: 0,
              status: "READY",
            },
          ],
          missingBoms: [],
          summary: {
            requiredQty: 5000,
            availableQty: 10000,
            shortageQty: 0,
            incomingQty: 0,
            readyLineCount: 1,
            partialLineCount: 0,
            awaitingProcurementLineCount: 0,
            missingBomCount: 0,
            proposedFgQty: totalExecutableQty,
          },
        },
        snapshot: {
          totalWoPlacedQty: 3000,
          totalRsBalanceQty,
          totalExecutableQty,
          placementStatus: status,
          woPlacedByItem: Object.fromEntries(placedByItem.entries()),
          lines: lines.map((line) => ({
            itemId: line.itemId,
            rsBalanceQty: line.rsBalanceQty,
            suggestedExecutableQty: totalExecutableQty,
          })),
        },
        fgUnitByItemId: new Map(),
        placedByItem,
      };
    },
  });
}

const lockedSheetFixture = {
  id: 1,
  salesOrderId: 10,
  cycleId: 2,
  periodKey: "2026-06",
  status: "LOCKED",
  version: 1,
  docNo: "RS-26-0001",
  salesOrder: { id: 10, orderType: "NO_QTY" },
  lines: [
    {
      itemId: 100,
      requirementQty: 10000,
      item: { id: 100, itemName: "FG-A", itemType: "FG" },
    },
  ],
};

describe("requirementSheetExecutionService", () => {
  it("balance uses locked Final RS Qty (totalRsQty / suggestedWoQtySnapshot), not base requirementQty", async () => {
    const db = createMockDb({
      sheets: [
        {
          id: 1,
          salesOrderId: 10,
          cycleId: 2,
          periodKey: "2026-06",
          status: "LOCKED",
          salesOrder: { id: 10, orderType: "NO_QTY" },
          lines: [
            {
              itemId: 100,
              requirementQty: 1000,
              baseDemandQty: 1000,
              totalRsQty: 1025,
              suggestedWoQtySnapshot: 1025,
              productionShortfallQty: 20,
              qcRejectionRecoveryQty: 5,
              item: { id: 100, itemName: "FG-A", itemType: "FG" },
            },
          ],
        },
      ],
      plans: [{ id: 5, periodKey: "2026-06", releasedAt: new Date("2026-06-01"), releasedRevision: 1, planSequenceNo: 1 }],
      mrs: [{ id: 9, monthlyProductionPlanId: 5, sourceType: "MONTHLY_PLAN", reversedAt: null, docNo: "MR-26-0001", status: "APPROVED" }],
      workOrders: [
        {
          id: 50,
          requirementSheetId: 1,
          docNo: "WO-26-0001",
          status: "PENDING",
          createdAt: new Date("2026-06-02"),
          lines: [{ fgItemId: 100, qty: 300, plannedQty: 300 }],
        },
      ],
      pmrs: [{ id: 60, workOrderId: 50, docNo: "PMR-26-0001", status: "REQUESTED" }],
    });

    const res = await getRequirementSheetExecutionSummary(db, 1, readinessDeps());
    assert.equal(res.lines[0].rsDemandQty, 1025);
    assert.equal(res.lines[0].woPlacedQty, 300);
    assert.equal(res.lines[0].rsBalanceQty, 725);
    assert.equal(res.totals.rsDemandQty, 1025);
    assert.equal(res.totals.woPlacedQty, 300);
    assert.equal(res.totals.rsBalanceQty, 725);
    assert.equal(res.processStageKey, res.placementStage.processStageKey);
    assert.ok(typeof res.processStageKey === "string" || res.processStageKey === null);
  });

  it("Waive locked sheet balance stays at customer demand only", async () => {
    const db = createMockDb({
      sheets: [
        {
          id: 1,
          salesOrderId: 10,
          cycleId: 2,
          periodKey: "2026-06",
          status: "LOCKED",
          salesOrder: { id: 10, orderType: "NO_QTY" },
          lines: [
            {
              itemId: 100,
              requirementQty: 1000,
              baseDemandQty: 1000,
              totalRsQty: 1000,
              suggestedWoQtySnapshot: 1000,
              productionShortfallQty: 0,
              qcRejectionRecoveryQty: 0,
              item: { id: 100, itemName: "FG-A", itemType: "FG" },
            },
          ],
        },
      ],
      plans: [{ id: 5, periodKey: "2026-06", releasedAt: new Date("2026-06-01"), releasedRevision: 1, planSequenceNo: 1 }],
      mrs: [{ id: 9, monthlyProductionPlanId: 5, sourceType: "MONTHLY_PLAN", reversedAt: null, docNo: "MR-26-0001", status: "APPROVED" }],
      workOrders: [],
      pmrs: [],
    });

    const res = await getRequirementSheetExecutionSummary(db, 1, readinessDeps());
    assert.equal(res.lines[0].rsDemandQty, 1000);
    assert.equal(res.lines[0].rsBalanceQty, 1000);
    assert.equal(res.totals.rsDemandQty, 1000);
    assert.equal(res.kpis.customerDemandQty, 1000);
    assert.equal(res.kpis.productionShortageQty, 0);
    assert.equal(res.kpis.qcFinalRejectionQty, 0);
    assert.equal(res.kpis.totalRecoveryQty, 0);
    assert.equal(res.kpis.woQuantityPlaced, 0);
    assert.equal(res.kpis.numberOfWos, 0);
    assert.equal(res.kpis.remainingToPlace, 1000);
  });

  it("Planning Context KPIs expose Keep composition without treating demand as WO qty", async () => {
    const db = createMockDb({
      sheets: [
        {
          id: 1,
          salesOrderId: 10,
          cycleId: 2,
          periodKey: "2026-06",
          status: "LOCKED",
          salesOrder: { id: 10, orderType: "NO_QTY" },
          lines: [
            {
              itemId: 100,
              requirementQty: 1000,
              baseDemandQty: 1000,
              totalRsQty: 1025,
              suggestedWoQtySnapshot: 1025,
              productionShortfallQty: 20,
              qcRejectionRecoveryQty: 5,
              item: { id: 100, itemName: "FG-A", itemType: "FG" },
            },
          ],
        },
      ],
      plans: [{ id: 5, periodKey: "2026-06", releasedAt: new Date("2026-06-01"), releasedRevision: 1, planSequenceNo: 1 }],
      mrs: [{ id: 9, monthlyProductionPlanId: 5, sourceType: "MONTHLY_PLAN", reversedAt: null, docNo: "MR-26-0001", status: "APPROVED" }],
      workOrders: [],
      pmrs: [],
    });

    const res = await getRequirementSheetExecutionSummary(db, 1, readinessDeps());
    assert.equal(res.kpis.customerDemandQty, 1000);
    assert.equal(res.kpis.productionShortageQty, 20);
    assert.equal(res.kpis.qcFinalRejectionQty, 5);
    assert.equal(res.kpis.totalRecoveryQty, 25);
    assert.equal(res.kpis.totalRsRequirement, 1025);
    assert.equal(res.kpis.woQuantityPlaced, 0);
    assert.equal(res.kpis.remainingToPlace, 1025);
    assert.equal(res.kpis.numberOfWos, 0);
  });

  it("shows release state when period plan is released", async () => {
    const db = createMockDb({
      sheets: [
        {
          id: 2,
          salesOrderId: 11,
          cycleId: 1,
          periodKey: "2026-07",
          status: "LOCKED",
          salesOrder: { id: 11, orderType: "NO_QTY" },
          lines: [{ itemId: 101, requirementQty: 500, item: { id: 101, itemName: "FG-B", itemType: "FG" } }],
        },
      ],
      plans: [{ id: 6, periodKey: "2026-07", releasedAt: new Date(), releasedRevision: 2, planSequenceNo: 1 }],
      mrs: [],
      workOrders: [],
      pmrs: [],
    });

    const res = await getRequirementSheetExecutionSummary(db, 2, readinessDeps());
    assert.equal(res.release.released, true);
    assert.equal(res.release.monthlyPlanId, 6);
    // Released with no MR = procurement not required (zero net handoff).
    assert.equal(res.procurement.status, "PROCUREMENT_NOT_REQUIRED");
    assert.match(res.procurement.summaryLabel, /Procurement not required/);
  });

  it("returns not released when plan period has no release", async () => {
    const db = createMockDb({
      sheets: [
        {
          id: 3,
          salesOrderId: 12,
          cycleId: 1,
          periodKey: "2026-08",
          status: "LOCKED",
          salesOrder: { id: 12, orderType: "NO_QTY" },
          lines: [{ itemId: 102, requirementQty: 100, item: { id: 102, itemName: "FG-C", itemType: "FG" } }],
        },
      ],
      plans: [],
      mrs: [],
      workOrders: [],
      pmrs: [],
    });

    const res = await getRequirementSheetExecutionSummary(db, 3, readinessDeps());
    assert.equal(res.release.released, false);
    assert.equal(res.procurement.status, "NOT_RELEASED");
    assert.equal(res.procurement.summaryLabel, "Not released to procurement");
  });

  it("includes linked WO in workOrders array with PMR", async () => {
    const db = createMockDb({
      sheets: [
        {
          id: 4,
          salesOrderId: 13,
          cycleId: 3,
          periodKey: "2026-06",
          status: "LOCKED",
          salesOrder: { id: 13, orderType: "NO_QTY" },
          lines: [{ itemId: 103, requirementQty: 2000, item: { id: 103, itemName: "FG-D", itemType: "FG" } }],
        },
      ],
      plans: [{ id: 7, periodKey: "2026-06", releasedAt: new Date(), releasedRevision: 1, planSequenceNo: 1 }],
      mrs: [],
      workOrders: [
        {
          id: 80,
          requirementSheetId: 4,
          docNo: "WO-26-0080",
          status: "IN_PROGRESS",
          createdAt: new Date("2026-06-03"),
          lines: [{ fgItemId: 103, qty: 2000 }],
        },
      ],
      pmrs: [{ id: 81, workOrderId: 80, docNo: "PMR-26-0081", status: "PARTIALLY_ISSUED" }],
    });

    const res = await getRequirementSheetExecutionSummary(db, 4, readinessDeps());
    assert.equal(res.workOrders.length, 1);
    assert.equal(res.workOrders[0].id, 80);
    assert.equal(res.workOrders[0].totalQty, 2000);
    assert.equal(res.workOrders[0].pmrId, 81);
    assert.equal(res.workOrders[0].pmrDocNo, "PMR-26-0081");
    assert.equal(res.lines[0].rsBalanceQty, 0);
  });

  it("sums multiple counted linked WOs and displays rejected WOs without reducing RS balance", async () => {
    const db = createMockDb({
      sheets: [
        {
          id: 8,
          salesOrderId: 17,
          cycleId: 7,
          periodKey: "2026-06",
          status: "LOCKED",
          salesOrder: { id: 17, orderType: "NO_QTY" },
          lines: [{ itemId: 107, requirementQty: 10000, item: { id: 107, itemName: "FG-H", itemType: "FG" } }],
        },
      ],
      plans: [{ id: 11, periodKey: "2026-06", releasedAt: new Date(), releasedRevision: 1, planSequenceNo: 1 }],
      mrs: [],
      workOrders: [
        {
          id: 101,
          requirementSheetId: 8,
          docNo: "WO-26-0101",
          status: "PENDING",
          createdAt: new Date("2026-06-04"),
          lines: [{ fgItemId: 107, qty: 3000, plannedQty: 3000 }],
        },
        {
          id: 102,
          requirementSheetId: 8,
          docNo: "WO-26-0102",
          status: "IN_PROGRESS",
          createdAt: new Date("2026-06-05"),
          lines: [{ fgItemId: 107, qty: 2500, plannedQty: 2500 }],
        },
        {
          id: 103,
          requirementSheetId: 8,
          docNo: "WO-26-0103",
          status: "REJECTED",
          createdAt: new Date("2026-06-06"),
          lines: [{ fgItemId: 107, qty: 1000, plannedQty: 1000 }],
        },
      ],
      pmrs: [],
    });

    const res = await getRequirementSheetExecutionSummary(db, 8, readinessDeps());

    assert.equal(res.workOrders.length, 3);
    assert.equal(res.existingWoSummary.length, 3);
    assert.equal(res.lines[0].woPlacedQty, 5500);
    assert.equal(res.lines[0].rsBalanceQty, 4500);
    assert.equal(res.totals.woPlacedQty, 5500);
    assert.equal(res.totals.rsBalanceQty, 4500);
  });

  it("no WO returns empty workOrders and full balance equals requirementQty", async () => {
    const db = createMockDb({
      sheets: [
        {
          id: 5,
          salesOrderId: 14,
          cycleId: 4,
          periodKey: "2026-06",
          status: "LOCKED",
          salesOrder: { id: 14, orderType: "NO_QTY" },
          lines: [{ itemId: 104, requirementQty: 8000, item: { id: 104, itemName: "FG-E", itemType: "FG" } }],
        },
      ],
      plans: [{ id: 8, periodKey: "2026-06", releasedAt: new Date(), releasedRevision: 1, planSequenceNo: 1 }],
      mrs: [],
      workOrders: [],
      pmrs: [],
    });

    const res = await getRequirementSheetExecutionSummary(db, 5, readinessDeps());
    assert.deepEqual(res.workOrders, []);
    assert.equal(res.totals.rsDemandQty, 8000);
    assert.equal(res.totals.woPlacedQty, 0);
    assert.equal(res.totals.rsBalanceQty, 8000);
    assert.equal(res.rmPreview.available, true);
  });

  it("RM readiness reflects proposed WO qty (not full RS balance)", async () => {
    const capturedCalls = [];
    const db = createMockDb({
      sheets: [
        {
          id: 6,
          salesOrderId: 15,
          cycleId: 5,
          periodKey: "2026-06",
          status: "LOCKED",
          salesOrder: { id: 15, orderType: "NO_QTY" },
          lines: [
            {
              itemId: 105,
              requirementQty: 10000,
              baseDemandQty: 10000,
              totalRsQty: 10000,
              suggestedWoQtySnapshot: 10000,
              item: { id: 105, itemName: "FG-F", itemType: "FG" },
            },
          ],
        },
      ],
      plans: [{ id: 9, periodKey: "2026-06", releasedAt: new Date(), releasedRevision: 1, planSequenceNo: 1 }],
      mrs: [
        {
          id: 90,
          monthlyProductionPlanId: 9,
          sourceType: "MONTHLY_PLAN",
          reversedAt: null,
          docNo: "MR-26-0090",
          status: "APPROVED",
          lines: [{ id: 901, rmItemId: 700, requiredQty: 14000, shortageQty: 4000, procuredQty: 0 }],
        },
      ],
      workOrders: [
        {
          id: 91,
          requirementSheetId: 6,
          docNo: "WO-26-0091",
          status: "PENDING",
          createdAt: new Date("2026-06-04"),
          lines: [{ fgItemId: 105, qty: 3000, plannedQty: 3000 }],
        },
      ],
      pmrs: [{ id: 92, workOrderId: 91, docNo: "PMR-26-0092", status: "FULLY_ISSUED", lines: [{ requiredQty: 500, issuedQty: 500 }] }],
    });

    const res = await getRequirementSheetExecutionSummary(db, 6, {
      loadApprovedBomWithLines: async () => ({ id: 1, lines: [{ id: 1 }] }),
      aggregateRmDemandForFgLines: async (_db, fgLines) => {
        capturedCalls.push(fgLines.map((l) => ({ fgItemId: l.fgItemId, fgQty: l.fgQty })));
        const totalFg = (fgLines ?? []).reduce((s, l) => s + Number(l.fgQty || 0), 0);
        return { rmNeeded: new Map([[700, totalFg * 2]]), missingChildBoms: [] };
      },
      getMaterialAvailabilityByItems: async () => [
        {
          itemId: 700,
          itemName: "RM-X",
          freeStockQty: 10000,
          shortageAfterReservationQty: 0,
          incomingQty: 1000,
        },
      ],
      assessNoQtyMonthlyPlanningGate: async () => ({ gate: "READY_FOR_EXECUTION" }),
    });

    assert.equal(res.totals.rsBalanceQty, 7000);
    assert.ok(res.placement.summary.totalExecutableQty < 7000);
    assert.equal(res.rmReadiness.basis, "PROPOSED_WO_QTY");
    assert.ok(capturedCalls.some((call) => call[0]?.fgQty === 7000));
    const proposedQty = res.placement.summary.totalExecutableQty;
    assert.ok(
      res.rmReadiness.summary.proposedFgQty === proposedQty ||
        res.rmReadiness.lines[0].requiredQty === proposedQty * 2,
    );
    assert.equal(res.kpis.suggestedNextWoQty, proposedQty);
    assert.equal(res.kpis.remainingRequirement, 7000);
    assert.ok(
      res.placement.lines[0].operatorGuidance?.code === "PARTIAL_COVER" ||
        res.placement.lines[0].suggestedExecutableQty < 7000,
    );
  });

  it("surfaces missing top-level FG BOM when RS balance exists but no RM lines are produced", async () => {
    const db = createMockDb({
      sheets: [
        {
          id: 7,
          salesOrderId: 16,
          cycleId: 6,
          periodKey: "2026-06",
          status: "LOCKED",
          salesOrder: { id: 16, orderType: "NO_QTY" },
          lines: [{ itemId: 106, requirementQty: 1200, item: { id: 106, itemName: "FG-G", itemType: "FG" } }],
        },
      ],
      plans: [{ id: 10, periodKey: "2026-06", releasedAt: new Date(), releasedRevision: 1, planSequenceNo: 1 }],
      mrs: [
        {
          id: 100,
          monthlyProductionPlanId: 10,
          sourceType: "MONTHLY_PLAN",
          reversedAt: null,
          docNo: "MR-26-0100",
          status: "APPROVED",
          lines: [],
        },
      ],
      workOrders: [],
      pmrs: [],
    });

    const res = await getRequirementSheetExecutionSummary(
      db,
      7,
      readinessDeps({
        rmNeeded: new Map(),
        availabilityRows: [],
        loadApprovedBomWithLines: async () => null,
      }),
    );

    assert.equal(res.totals.rsBalanceQty, 1200);
    assert.equal(res.rmReadiness.basis, "PROPOSED_WO_QTY");
    assert.equal(res.rmReadiness.lines.length, 0);
    assert.equal(res.rmReadiness.missingBoms.length, 1);
    assert.equal(res.placement.lines[0].status, "MISSING_BOM");
    assert.equal(res.rmReadiness.missingBoms[0].fgItemName, "FG-G");
    assert.equal(res.readiness.status, "BLOCKED");
    assert.match(res.readiness.reason, /missing BOM data/i);
  });

  it("woLinePlacedQty uses planned qty with qty fallback", () => {
    assert.equal(woLinePlacedQty({ qty: 1500, plannedQty: 3000 }), 3000);
    assert.equal(woLinePlacedQty({ qty: 1500 }), 1500);
  });

  it("returns procurement progress when Monthly Plan MR has PR/PO/GRN chain (RMPO id display)", async () => {
    const db = createMockDb({
      sheets: [
        {
          id: 260,
          salesOrderId: 170,
          cycleId: 301,
          periodKey: "2026-06",
          status: "LOCKED",
          salesOrder: { id: 170, orderType: "NO_QTY" },
          lines: [{ itemId: 200, requirementQty: 10000, item: { id: 200, itemName: "FG-PostGRN", itemType: "FG" } }],
        },
      ],
      plans: [{ id: 17, periodKey: "2026-06", releasedAt: new Date("2026-06-22"), releasedRevision: 1, planSequenceNo: 1 }],
      mrs: [
        {
          id: 87,
          monthlyProductionPlanId: 17,
          sourceType: "MONTHLY_PLAN",
          reversedAt: null,
          docNo: "MR-26-0001",
          status: "FULLY_PROCURED",
          lines: [{ id: 179, rmItemId: 700, requiredQty: 5000, shortageQty: 0, procuredQty: 5000 }],
        },
      ],
      workOrders: [],
      pmrs: [],
      purchaseRequestLineSourceLinks: [
        {
          materialRequirementLineId: 179,
          purchaseRequestLine: {
            purchaseRequest: { id: 41, status: "APPROVED", docNo: "PR-26-0001" },
            poLinks: [
              {
                rmPoLine: {
                  id: 501,
                  qty: 5000,
                  rmPo: { id: 113, status: "COMPLETED" },
                  grnLines: [{ receivedQty: 5000, grn: { id: 113, reversedAt: null } }],
                },
              },
            ],
          },
        },
      ],
      rmPoLineProcurementLinks: [],
    });

    const res = await getRequirementSheetExecutionSummary(
      db,
      260,
      readinessDeps({
        rmNeeded: new Map([[700, 0.5]]),
        availabilityRows: [
          {
            itemId: 700,
            itemName: "RM-A",
            requiredQty: 5000,
            freeStockQty: 10000,
            shortageAfterReservationQty: 0,
            incomingQty: 0,
          },
        ],
      }),
    );

    assert.equal(res.procurementProgress.steps.length, 5);
    const stepByKey = Object.fromEntries(res.procurementProgress.steps.map((s) => [s.key, s.status]));
    assert.equal(stepByKey.MONTHLY_PLAN_RELEASED, "COMPLETE");
    assert.equal(stepByKey.MR_CREATED, "COMPLETE");
    assert.equal(stepByKey.PR_CREATED, "COMPLETE");
    assert.equal(stepByKey.PO_CREATED, "COMPLETE");
    assert.equal(stepByKey.GRN_RECEIVED, "COMPLETE");
    assert.equal(res.procurementProgress.counts.poCount, 1);
    assert.equal(res.procurementProgress.counts.grnCount, 1);
    assert.equal(res.procurementProgress.counts.grnReceivedQty, 5000);
    assert.equal(res.readiness.status, "READY_TO_PLACE_WO");
  });
});

describe("deriveNoQtyPlacementProcessStage", () => {
  it("maps readyToPlaceWo to NO_QTY_READY_TO_PLACE_WO", () => {
    const stage = deriveNoQtyPlacementProcessStage({
      readyToPlaceWo: true,
      rsBalanceQty: 100,
      executionPlanReady: true,
      materialRequirement: { id: 1 },
    });
    assert.equal(stage.processStageKey, NO_QTY_PLACEMENT_STAGE.READY_TO_PLACE_WO);
    assert.equal(stage.processStageLabel, "Ready to place WO");
  });

  it("returns null processStageKey when RS balance is zero", () => {
    const stage = deriveNoQtyPlacementProcessStage({
      readyToPlaceWo: false,
      rsBalanceQty: 0,
      executionPlanReady: true,
      materialRequirement: { id: 1 },
    });
    assert.equal(stage.processStageKey, null);
  });

  it("returns procurement in progress when plan and MR exist but not ready to place", () => {
    const stage = deriveNoQtyPlacementProcessStage({
      readyToPlaceWo: false,
      rsBalanceQty: 500,
      executionPlanReady: true,
      materialRequirement: { id: 9 },
    });
    assert.equal(stage.processStageKey, NO_QTY_PLACEMENT_STAGE.PROCUREMENT_IN_PROGRESS);
  });
});

describe("assessNoQtyPlacementStageForCycle", () => {
  it("returns readyToPlaceWo true when no WO exists and RM allows placement", async () => {
    const db = createAssessorMockDb({
      sheets: [lockedSheetFixture],
      plans: [{ id: 5, periodKey: "2026-06", releasedAt: new Date("2026-06-01"), releasedRevision: 1, planSequenceNo: 1 }],
      mrs: [{ id: 9, monthlyProductionPlanId: 5, sourceType: "MONTHLY_PLAN", reversedAt: null, docNo: "MR-26-0001", status: "APPROVED" }],
      workOrders: [],
      pmrs: [],
    });

    const res = await assessNoQtyPlacementStageForCycle(
      db,
      { salesOrderId: 10, cycleId: 2 },
      placementPreviewDeps({ canPlace: true, totalExecutableQty: 10000, totalRsBalanceQty: 10000, status: "READY" }),
    );

    assert.equal(res.readyToPlaceWo, true);
    assert.equal(res.rsBalanceQty, 10000);
    assert.equal(res.suggestedWoQty, 10000);
    assert.equal(res.processStageKey, "NO_QTY_READY_TO_PLACE_WO");
  });

  it("does not unlock Place WO after first WO while Store RM issue is still pending", async () => {
    const db = createAssessorMockDb({
      sheets: [lockedSheetFixture],
      plans: [{ id: 5, periodKey: "2026-06", releasedAt: new Date("2026-06-01"), releasedRevision: 1, planSequenceNo: 1 }],
      mrs: [{ id: 9, monthlyProductionPlanId: 5, sourceType: "MONTHLY_PLAN", reversedAt: null, docNo: "MR-26-0001", status: "APPROVED" }],
      workOrders: [
        {
          id: 50,
          requirementSheetId: 1,
          docNo: "WO-26-0001",
          status: "PENDING",
          createdAt: new Date("2026-06-02"),
          lines: [{ fgItemId: 100, qty: 3000, plannedQty: 3000 }],
        },
      ],
      pmrs: [{ id: 60, workOrderId: 50, docNo: "PMR-26-0001", status: "REQUESTED", lines: [{ requiredQty: 1500, issuedQty: 0 }] }],
    });

    const res = await assessNoQtyPlacementStageForCycle(
      db,
      { salesOrderId: 10, cycleId: 2 },
      placementPreviewDeps({ canPlace: true, totalExecutableQty: 7000, totalRsBalanceQty: 7000 }),
    );

    assert.equal(res.rsBalanceQty, 7000);
    assert.equal(res.readyToPlaceWo, false);
    assert.equal(res.suggestedWoQty, 7000);
    assert.equal(res.readinessStatus, "EXISTING_WO_PENDING_RM_ISSUE");
    assert.equal(res.processStageKey, "NO_QTY_PROCUREMENT_IN_PROGRESS");
  });

  it("returns readyToPlaceWo true with partial RM when suggested executable qty is positive", async () => {
    const db = createAssessorMockDb({
      sheets: [lockedSheetFixture],
      plans: [{ id: 5, periodKey: "2026-06", releasedAt: new Date("2026-06-01"), releasedRevision: 1, planSequenceNo: 1 }],
      mrs: [{ id: 9, monthlyProductionPlanId: 5, sourceType: "MONTHLY_PLAN", reversedAt: null, docNo: "MR-26-0001", status: "APPROVED" }],
      workOrders: [
        {
          id: 51,
          requirementSheetId: 1,
          docNo: "WO-26-0001",
          status: "PENDING",
          createdAt: new Date("2026-06-02"),
          lines: [{ fgItemId: 100, qty: 3000, plannedQty: 3000 }],
        },
      ],
      pmrs: [],
    });

    const res = await assessNoQtyPlacementStageForCycle(
      db,
      { salesOrderId: 10, cycleId: 2 },
      placementPreviewDeps({ canPlace: true, totalExecutableQty: 2500, totalRsBalanceQty: 7000, status: "PARTIALLY_READY" }),
    );

    assert.equal(res.rsBalanceQty, 7000);
    assert.equal(res.suggestedWoQty, 2500);
    assert.equal(res.readyToPlaceWo, true);
    assert.equal(res.placementStatus, "PARTIALLY_READY");
  });

  it("unlocks Place WO when locked RS has Net RM = 0 even without a Monthly Plan (PROCUREMENT_NOT_REQUIRED)", async () => {
    const db = createAssessorMockDb({
      sheets: [lockedSheetFixture],
      plans: [],
      mrs: [],
      workOrders: [],
      pmrs: [],
    });

    const res = await assessNoQtyPlacementStageForCycle(
      db,
      { salesOrderId: 10, cycleId: 2 },
      placementPreviewDeps({ canPlace: true, totalExecutableQty: 10000, totalRsBalanceQty: 10000, status: "READY" }),
    );

    assert.equal(res.readyToPlaceWo, true);
    assert.equal(res.released, true);
    assert.equal(res.skipMonthlyPlanning, true);
    assert.equal(res.readinessStatus, "READY_TO_PLACE_WO");
    assert.equal(res.processStageKey, "NO_QTY_READY_TO_PLACE_WO");
  });

  it("unlocks Place WO for stock-ready FG while other FG still need Monthly Planning (mixed RS)", async () => {
    const db = createAssessorMockDb({
      sheets: [
        {
          ...lockedSheetFixture,
          lines: [
            { itemId: 101, requirementQty: 1000, item: { id: 101, itemName: "Dummy Plug", itemType: "FG", unit: "Nos" } },
            { itemId: 102, requirementQty: 500, item: { id: 102, itemName: "Nozzle", itemType: "FG", unit: "Nos" } },
          ],
        },
      ],
      plans: [],
      mrs: [],
      workOrders: [],
      pmrs: [],
    });

    const res = await assessNoQtyPlacementStageForCycle(
      db,
      { salesOrderId: 10, cycleId: 2 },
      readinessDeps({
        rmNeeded: new Map([
          [700, 1],
          [701, 1],
        ]),
        availabilityRows: [
          {
            itemId: 700,
            itemName: "RM-A",
            requiredQty: 1000,
            freeStockQty: 1000,
            shortageAfterReservationQty: 0,
            incomingQty: 0,
          },
          {
            itemId: 701,
            itemName: "RM-B",
            requiredQty: 500,
            freeStockQty: 0,
            shortageAfterReservationQty: 500,
            incomingQty: 0,
          },
        ],
        assessNoQtyBatchPlacement: async (_db, sheet, deps = {}) => {
          const placedByItem = deps.placedByItem ?? new Map();
          const balanceLines = (sheet?.lines ?? []).map((ln) => {
            const itemId = Number(ln.itemId);
            const rsDemandQty = Number(ln.requirementQty ?? 0);
            const woPlacedQty = Number(placedByItem.get(itemId) ?? 0);
            const rsBalanceQty = Math.max(0, rsDemandQty - woPlacedQty);
            const executable = itemId === 101 ? rsBalanceQty : 0;
            return {
              itemId,
              itemName: ln.item?.itemName ?? `Item ${itemId}`,
              rsDemandQty,
              woPlacedQty,
              rsBalanceQty,
              suggestedExecutableQty: executable,
              executableQty: executable,
              status: executable > 0 ? "READY" : "AWAITING_PROCUREMENT",
              reason: executable > 0 ? "stock ready" : "shortage",
              rmLines: [],
            };
          });
          return {
            balanceLines,
            totals: {
              rsDemandQty: 1500,
              woPlacedQty: 0,
              rsBalanceQty: 1500,
              rmLimitedCapacityQty: 1000,
            },
            placement: {
              canPlace: true,
              status: "PARTIALLY_READY",
              reason: "mixed",
              summary: {
                totalRsBalanceQty: 1500,
                totalExecutableQty: 1000,
                totalWoPlacedQty: 0,
                totalRsDemandQty: 1500,
              },
              lines: balanceLines,
              sharedRmConflict: false,
            },
            rmReadiness: {
              basis: "PROPOSED_WO_QTY",
              fgBalanceLines: [],
              lines: [
                {
                  rmItemId: 700,
                  rmItemName: "RM-A",
                  requiredQty: 1000,
                  availableQty: 1000,
                  shortageQty: 0,
                  incomingQty: 0,
                  status: "READY",
                },
                {
                  rmItemId: 701,
                  rmItemName: "RM-B",
                  requiredQty: 500,
                  availableQty: 0,
                  shortageQty: 500,
                  incomingQty: 0,
                  status: "SHORT",
                },
              ],
              summary: {
                requiredQty: 1500,
                availableQty: 1000,
                shortageQty: 500,
                incomingQty: 0,
                readyLineCount: 1,
                partialLineCount: 0,
                awaitingProcurementLineCount: 1,
                missingBomCount: 0,
              },
            },
            snapshot: {},
            fgUnitByItemId: new Map(),
          };
        },
      }),
    );

    assert.equal(res.readyToPlaceWo, true);
    assert.equal(res.released, true);
    assert.equal(res.skipMonthlyPlanning, false);
    assert.equal(res.allowWoWithoutPlanRelease, true);
    assert.equal(res.readinessStatus, "PARTIALLY_READY");
    assert.equal(res.processStageKey, "NO_QTY_READY_TO_PLACE_WO");
  });

  it("keeps Monthly Planning pending when locked RS has RM shortage and no Monthly Plan", async () => {
    const db = createAssessorMockDb({
      sheets: [lockedSheetFixture],
      plans: [],
      mrs: [],
      workOrders: [],
      pmrs: [],
    });

    const res = await assessNoQtyPlacementStageForCycle(
      db,
      { salesOrderId: 10, cycleId: 2 },
      readinessDeps({
        rmNeeded: new Map([[700, 1]]),
        availabilityRows: [
          {
            itemId: 700,
            itemName: "RM-A",
            requiredQty: 5000,
            freeStockQty: 0,
            shortageAfterReservationQty: 5000,
            incomingQty: 0,
          },
        ],
        assessNoQtyBatchPlacement: async (_db, sheet, deps = {}) => {
          const placedByItem = deps.placedByItem ?? new Map();
          const lines = (sheet?.lines ?? []).map((ln) => {
            const itemId = Number(ln.itemId);
            const rsDemandQty = Number(ln.requirementQty ?? 0);
            const woPlacedQty = Number(placedByItem.get(itemId) ?? 0);
            return {
              itemId,
              itemName: ln.item?.itemName ?? `Item ${itemId}`,
              rsDemandQty,
              woPlacedQty,
              rsBalanceQty: Math.max(0, rsDemandQty - woPlacedQty),
              suggestedExecutableQty: 0,
              executableQty: 0,
              status: "AWAITING_PROCUREMENT",
              reason: "shortage",
              rmLines: [],
            };
          });
          return {
            balanceLines: lines,
            totals: {
              rsDemandQty: 10000,
              woPlacedQty: 0,
              rsBalanceQty: 10000,
            },
            placement: {
              canPlace: false,
              status: "AWAITING_PROCUREMENT",
              reason: "shortage",
              summary: {
                totalRsBalanceQty: 10000,
                totalExecutableQty: 0,
                totalWoPlacedQty: 0,
                totalRsDemandQty: 10000,
              },
              lines,
              sharedRmConflict: false,
            },
            rmReadiness: {
              basis: "PROPOSED_WO_QTY",
              fgBalanceLines: [],
              lines: [
                {
                  rmItemId: 700,
                  rmItemName: "RM-A",
                  requiredQty: 5000,
                  availableQty: 0,
                  shortageQty: 5000,
                  incomingQty: 0,
                  status: "SHORT",
                },
              ],
              missingBoms: [],
              summary: {
                requiredQty: 5000,
                availableQty: 0,
                shortageQty: 5000,
                incomingQty: 0,
                missingBomCount: 0,
              },
            },
          };
        },
      }),
    );

    assert.equal(res.readyToPlaceWo, false);
    assert.equal(res.readinessStatus, "AWAITING_PROCUREMENT");
    assert.equal(res.processStageKey, "NO_QTY_REQUIREMENT_READY");
  });

  it("does not unlock Place WO when Monthly Plan is draft or approved but unreleased and RM still short", async () => {
    for (const status of ["DRAFT", "APPROVED"]) {
      const db = createAssessorMockDb({
        sheets: [lockedSheetFixture],
        plans: [{ id: 5, periodKey: "2026-06", status, releasedAt: null, planSequenceNo: 1 }],
        mrs: [],
        workOrders: [],
        pmrs: [],
      });

      const res = await assessNoQtyPlacementStageForCycle(
        db,
        { salesOrderId: 10, cycleId: 2 },
        readinessDeps({
          rmNeeded: new Map([[700, 1]]),
          availabilityRows: [
            {
              itemId: 700,
              itemName: "RM-A",
              requiredQty: 5000,
              freeStockQty: 0,
              shortageAfterReservationQty: 5000,
              incomingQty: 0,
            },
          ],
          assessNoQtyBatchPlacement: async (_db, sheet, deps = {}) => {
            const placedByItem = deps.placedByItem ?? new Map();
            const lines = (sheet?.lines ?? []).map((ln) => {
              const itemId = Number(ln.itemId);
              const rsDemandQty = Number(ln.requirementQty ?? 0);
              const woPlacedQty = Number(placedByItem.get(itemId) ?? 0);
              return {
                itemId,
                itemName: ln.item?.itemName ?? `Item ${itemId}`,
                rsDemandQty,
                woPlacedQty,
                rsBalanceQty: Math.max(0, rsDemandQty - woPlacedQty),
                suggestedExecutableQty: 0,
                executableQty: 0,
                status: "AWAITING_PROCUREMENT",
                reason: "shortage",
                rmLines: [],
              };
            });
            return {
              balanceLines: lines,
              totals: { rsDemandQty: 10000, woPlacedQty: 0, rsBalanceQty: 10000 },
              placement: {
                canPlace: false,
                status: "AWAITING_PROCUREMENT",
                reason: "shortage",
                summary: {
                  totalRsBalanceQty: 10000,
                  totalExecutableQty: 0,
                  totalWoPlacedQty: 0,
                  totalRsDemandQty: 10000,
                },
                lines,
                sharedRmConflict: false,
              },
              rmReadiness: {
                basis: "PROPOSED_WO_QTY",
                fgBalanceLines: [],
                lines: [
                  {
                    rmItemId: 700,
                    rmItemName: "RM-A",
                    requiredQty: 5000,
                    availableQty: 0,
                    shortageQty: 5000,
                    incomingQty: 0,
                    status: "SHORT",
                  },
                ],
                missingBoms: [],
                summary: {
                  requiredQty: 5000,
                  availableQty: 0,
                  shortageQty: 5000,
                  incomingQty: 0,
                  missingBomCount: 0,
                },
              },
            };
          },
        }),
      );

      assert.equal(res.readyToPlaceWo, false);
      assert.equal(res.processStageKey, "NO_QTY_REQUIREMENT_READY");
    }
  });

  it("unlocks Place WO when Plan 1 is released even if Additional Plan is still required", async () => {
    const db = createAssessorMockDb({
      sheets: [lockedSheetFixture],
      plans: [{ id: 5, periodKey: "2026-06", releasedAt: new Date("2026-06-01"), releasedRevision: 1, planSequenceNo: 1 }],
      mrs: [{ id: 9, monthlyProductionPlanId: 5, sourceType: "MONTHLY_PLAN", reversedAt: null, docNo: "MR-26-0001", status: "APPROVED" }],
      workOrders: [],
      pmrs: [],
    });

    const res = await assessNoQtyPlacementStageForCycle(
      db,
      { salesOrderId: 10, cycleId: 2 },
      placementPreviewDeps({
        canPlace: true,
        totalExecutableQty: 10000,
        totalRsBalanceQty: 10000,
        status: "READY",
        assessNoQtyMonthlyPlanningGate: async () => ({ gate: "ADDITIONAL_PLAN_REQUIRED" }),
      }),
    );

    assert.equal(res.readyToPlaceWo, true);
    assert.equal(res.released, true);
    assert.equal(res.materialRequirementId, 9);
    assert.equal(res.processStageKey, "NO_QTY_READY_TO_PLACE_WO");
  });

  it("returns readyToPlaceWo false when RS balance is zero", async () => {
    const db = createAssessorMockDb({
      sheets: [
        {
          ...lockedSheetFixture,
          lines: [{ itemId: 100, requirementQty: 3000, item: { id: 100, itemName: "FG-A", itemType: "FG" } }],
        },
      ],
      plans: [{ id: 5, periodKey: "2026-06", releasedAt: new Date("2026-06-01"), releasedRevision: 1, planSequenceNo: 1 }],
      mrs: [{ id: 9, monthlyProductionPlanId: 5, sourceType: "MONTHLY_PLAN", reversedAt: null, docNo: "MR-26-0001", status: "APPROVED" }],
      workOrders: [
        {
          id: 52,
          requirementSheetId: 1,
          docNo: "WO-26-0001",
          status: "PENDING",
          createdAt: new Date("2026-06-02"),
          lines: [{ fgItemId: 100, qty: 3000, plannedQty: 3000 }],
        },
      ],
      pmrs: [],
    });

    const res = await assessNoQtyPlacementStageForCycle(
      db,
      { salesOrderId: 10, cycleId: 2 },
      placementPreviewDeps({ canPlace: false, totalExecutableQty: 0, totalRsBalanceQty: 0, status: "ZERO_BALANCE" }),
    );

    assert.equal(res.rsBalanceQty, 0);
    assert.equal(res.readyToPlaceWo, false);
    assert.equal(res.processStageKey, null);
  });
});

describe("deriveReadyToPlaceWo", () => {
  it("requires positive balance, placement capability, and released-plan readiness", () => {
    assert.equal(
      deriveReadyToPlaceWo({ rsBalanceQty: 1000 }, { canPlace: true, summary: { totalExecutableQty: 500 } }, "READY_TO_PLACE_WO"),
      true,
    );
    assert.equal(
      deriveReadyToPlaceWo({ rsBalanceQty: 1000 }, { canPlace: false, summary: { totalExecutableQty: 500 } }, "READY_TO_PLACE_WO"),
      true,
    );
    assert.equal(
      deriveReadyToPlaceWo({ rsBalanceQty: 0 }, { canPlace: true, summary: { totalExecutableQty: 500 } }, "READY_TO_PLACE_WO"),
      false,
    );
    assert.equal(
      deriveReadyToPlaceWo({ rsBalanceQty: 1000 }, { canPlace: false, summary: { totalExecutableQty: 0 } }, "READY_TO_PLACE_WO"),
      false,
    );
    assert.equal(
      deriveReadyToPlaceWo({ rsBalanceQty: 1000 }, { canPlace: true, summary: { totalExecutableQty: 500 } }, "AWAITING_PROCUREMENT"),
      false,
    );
  });
});
