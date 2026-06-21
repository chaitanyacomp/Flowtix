const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getRequirementSheetExecutionSummary,
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
  };
}

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

    const res = await getRequirementSheetExecutionSummary(db, 1);
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

    const res = await getRequirementSheetExecutionSummary(db, 2);
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

    const res = await getRequirementSheetExecutionSummary(db, 3);
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

    const res = await getRequirementSheetExecutionSummary(db, 4);
    assert.equal(res.workOrders.length, 1);
    assert.equal(res.workOrders[0].id, 80);
    assert.equal(res.workOrders[0].totalQty, 2000);
    assert.equal(res.workOrders[0].pmrId, 81);
    assert.equal(res.workOrders[0].pmrDocNo, "PMR-26-0081");
    assert.equal(res.lines[0].rsBalanceQty, 0);
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

    const res = await getRequirementSheetExecutionSummary(db, 5);
    assert.deepEqual(res.workOrders, []);
    assert.equal(res.totals.rsDemandQty, 8000);
    assert.equal(res.totals.woPlacedQty, 0);
    assert.equal(res.totals.rsBalanceQty, 8000);
    assert.equal(res.rmPreview.available, false);
  });

  it("woLinePlacedQty uses planned qty with qty fallback", () => {
    assert.equal(woLinePlacedQty({ qty: 1500, plannedQty: 3000 }), 3000);
    assert.equal(woLinePlacedQty({ qty: 1500 }), 1500);
  });
});
