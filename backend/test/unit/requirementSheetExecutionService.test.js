const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getRequirementSheetExecutionSummary,
  assessNoQtyPlacementStageForCycle,
  deriveReadyToPlaceWo,
  woLinePlacedQty,
} = require("../../src/services/requirementSheetExecutionService");

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
  };
}

function readinessDeps({
  rmNeeded = new Map(),
  missingChildBoms = [],
  availabilityRows = [],
  onFgLines = null,
  loadApprovedBomWithLines = async () => ({ id: 1, lines: [{ id: 1 }] }),
  buildNoQtyWoBatchPlacementPreview = null,
} = {}) {
  return {
    loadApprovedBomWithLines,
    aggregateRmDemandForFgLines: async (_db, fgLines) => {
      if (onFgLines) onFgLines(fgLines);
      return { rmNeeded, missingChildBoms };
    },
    getMaterialAvailabilityByItems: async () => availabilityRows,
    ...(buildNoQtyWoBatchPlacementPreview ? { buildNoQtyWoBatchPlacementPreview } : {}),
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
    buildNoQtyWoBatchPlacementPreview: async () => ({
      canPlace,
      status,
      reason: "test",
      summary: {
        totalRsBalanceQty,
        totalExecutableQty,
        totalWoPlacedQty: 3000,
        totalRsDemandQty: 10000,
      },
      lines: [],
    }),
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
  it("balance uses requirementQty not suggestedWoQtySnapshot", async () => {
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
              requirementQty: 10000,
              suggestedWoQtySnapshot: 25000,
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
          lines: [{ fgItemId: 100, qty: 3000, plannedQty: 3000 }],
        },
      ],
      pmrs: [{ id: 60, workOrderId: 50, docNo: "PMR-26-0001", status: "REQUESTED" }],
    });

    const res = await getRequirementSheetExecutionSummary(db, 1, readinessDeps());
    assert.equal(res.lines[0].rsDemandQty, 10000);
    assert.equal(res.lines[0].woPlacedQty, 3000);
    assert.equal(res.lines[0].rsBalanceQty, 7000);
    assert.equal(res.totals.rsDemandQty, 10000);
    assert.equal(res.totals.woPlacedQty, 3000);
    assert.equal(res.totals.rsBalanceQty, 7000);
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
    assert.equal(res.procurement.status, "RELEASED");
    assert.match(res.procurement.summaryLabel, /Released/);
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

  it("RM readiness is derived from RS balance only", async () => {
    let capturedFgLines = [];
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
              suggestedWoQtySnapshot: 25000,
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

    const res = await getRequirementSheetExecutionSummary(
      db,
      6,
      readinessDeps({
        rmNeeded: new Map([[700, 14000]]),
        availabilityRows: [
          {
            itemId: 700,
            itemName: "RM-X",
            requiredQty: 14000,
            freeStockQty: 10000,
            shortageAfterReservationQty: 4000,
            incomingQty: 1000,
          },
        ],
        onFgLines: (fgLines) => {
          capturedFgLines = fgLines;
        },
      }),
    );

    assert.equal(res.totals.rsBalanceQty, 7000);
    assert.equal(capturedFgLines.length, 1);
    assert.equal(capturedFgLines[0].fgQty, 7000);
    assert.equal(res.rmReadiness.basis, "RS_BALANCE");
    assert.equal(res.rmReadiness.lines[0].requiredQty, 14000);
    assert.equal(res.rmReadiness.lines[0].shortageQty, 4000);
    assert.equal(res.rmReadiness.lines[0].status, "PARTIALLY_READY");
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
    assert.equal(res.rmReadiness.basis, "RS_BALANCE");
    assert.equal(res.rmReadiness.lines.length, 0);
    assert.equal(res.rmReadiness.missingBoms.length, 1);
    assert.equal(res.rmReadiness.missingBoms[0].type, "TOP_LEVEL_MISSING_BOM");
    assert.equal(res.rmReadiness.missingBoms[0].status, "MISSING_BOM");
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

  it("returns readyToPlaceWo true after first WO when RS balance remains and RM is ready", async () => {
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
    assert.equal(res.readyToPlaceWo, true);
    assert.equal(res.suggestedWoQty, 7000);
    assert.equal(res.processStageKey, "NO_QTY_READY_TO_PLACE_WO");
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
  it("requires positive balance and placement capability", () => {
    assert.equal(
      deriveReadyToPlaceWo({ rsBalanceQty: 1000 }, { canPlace: true, summary: { totalExecutableQty: 500 } }),
      true,
    );
    assert.equal(
      deriveReadyToPlaceWo({ rsBalanceQty: 1000 }, { canPlace: false, summary: { totalExecutableQty: 500 } }),
      true,
    );
    assert.equal(
      deriveReadyToPlaceWo({ rsBalanceQty: 0 }, { canPlace: true, summary: { totalExecutableQty: 500 } }),
      false,
    );
    assert.equal(
      deriveReadyToPlaceWo({ rsBalanceQty: 1000 }, { canPlace: false, summary: { totalExecutableQty: 0 } }),
      false,
    );
  });
});
