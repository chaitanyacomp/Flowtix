const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  assertWorkOrderLinesAgainstSalesOrder,
  getSalesOrderFgWorkOrderBalances,
} = require("../../src/services/workOrderSoValidation");

function statusMatches(status, cond) {
  if (cond == null) return true;
  if (typeof cond === "string") return status === cond;
  if (cond.not != null) return status !== cond.not;
  if (Array.isArray(cond.in)) return cond.in.includes(status);
  return true;
}

function buildNoQtyWoCapDb({ requirementQty = 10000, suggestedSnap = 20000, openWoLines = [] } = {}) {
  const so = {
    id: 1,
    orderType: "NO_QTY",
    internalStatus: "APPROVED",
    currentCycleId: 20,
    customerReturnId: null,
    lines: [{ itemId: 10, qty: 0, item: { id: 10, itemName: "FG-A", itemType: "FG" } }],
    dispatch: [],
  };
  const fg = { id: 10, itemName: "FG-A", itemType: "FG" };
  const lockedSheet = {
    id: 100,
    salesOrderId: 1,
    cycleId: 20,
    status: "LOCKED",
    createdAt: new Date(),
    lines: [
      {
        itemId: 10,
        requirementQty: String(requirementQty),
        suggestedWoQtySnapshot: String(suggestedSnap),
        shortfallQtySnapshot: String(suggestedSnap - requirementQty),
      },
    ],
  };

  const woLines = openWoLines.map((l, i) => ({
    id: 300 + i,
    workOrderId: 200 + i,
    fgItemId: 10,
    qty: String(l.qty),
    plannedQty: String(l.plannedQty ?? l.qty),
    workOrder: { status: l.status ?? "PENDING", shortfallQty: null },
  }));

  function linesForWhere(where = {}) {
    const woCond = where.workOrder ?? {};
    return woLines.filter((line) => {
      const wo = line.workOrder;
      if (woCond.salesOrderId != null && woCond.salesOrderId !== 1) return false;
      if (!statusMatches(wo.status, woCond.status)) return false;
      if (woCond.id?.not != null && line.workOrderId === woCond.id.not) return false;
      return true;
    });
  }

  return {
    salesOrder: {
      findUnique: async () => so,
    },
    requirementSheet: {
      findFirst: async () => lockedSheet,
    },
    item: {
      findMany: async () => [fg],
    },
    workOrderLine: {
      findMany: async ({ where } = {}) => linesForWhere(where),
    },
    productionEntry: {
      findMany: async () => [],
      groupBy: async () => [],
    },
    qcEntry: {
      groupBy: async () => [],
      aggregate: async () => ({ _sum: { acceptedQty: 0 } }),
    },
    stockAdjustmentQcEntry: {
      aggregate: async () => ({ _sum: { acceptedQty: 0 } }),
    },
    stockTransaction: {
      aggregate: async () => ({ _sum: { qtyIn: 0, qtyOut: 0 } }),
    },
    location: {
      findFirst: async () => ({ id: 1 }),
    },
  };
}

describe("workOrderSoValidation NO_QTY per-cycle WO ceiling", () => {
  it("allows 10k new WO when cumulative snap is 20k and prior-cycle WO holds 10k", async () => {
    const db = buildNoQtyWoCapDb({
      openWoLines: [{ qty: 10000, status: "PENDING" }],
    });
    await assertWorkOrderLinesAgainstSalesOrder(db, {
      salesOrderId: 1,
      lineRequests: [{ fgItemId: 10, qty: 10000 }],
      excludeWorkOrderId: null,
    });
  });

  it("blocks WO above current-cycle requirementQty even when cumulative headroom remains", async () => {
    const db = buildNoQtyWoCapDb({ openWoLines: [] });
    await assert.rejects(
      () =>
        assertWorkOrderLinesAgainstSalesOrder(db, {
          salesOrderId: 1,
          lineRequests: [{ fgItemId: 10, qty: 15000 }],
          excludeWorkOrderId: null,
        }),
      /Maximum allowed now: 10000/,
    );
  });

  it("keeps cumulative balanceQty from suggestedWoQtySnapshot minus open WO planned", async () => {
    const db = buildNoQtyWoCapDb({
      openWoLines: [{ qty: 10000, status: "PENDING" }],
    });
    const bal = await getSalesOrderFgWorkOrderBalances(db, { salesOrderId: 1 });
    assert.equal(bal.items[0].balanceQty, 10000);
  });
});

describe("workOrderSoValidation REGULAR SO unchanged", () => {
  it("allows split WOs until SO qty is reached (not NO_QTY requirementQty ceiling)", async () => {
    const so = {
      id: 1,
      orderType: "NORMAL",
      internalStatus: "APPROVED",
      currentCycleId: null,
      customerReturnId: null,
      lines: [{ itemId: 10, qty: 10000, item: { id: 10, itemName: "FG-A", itemType: "FG" } }],
      dispatch: [],
    };
    const fg = { id: 10, itemName: "FG-A", itemType: "FG" };
    const existingWoLines = [{ id: 301, workOrderId: 201, fgItemId: 10, qty: "5000", plannedQty: "5000", workOrder: { status: "PENDING" } }];
    const db = {
      salesOrder: { findUnique: async () => so },
      item: { findMany: async () => [fg] },
      workOrderLine: {
        findMany: async ({ where } = {}) => {
          const woCond = where.workOrder ?? {};
          return existingWoLines.filter((l) => {
            if (woCond.salesOrderId != null && woCond.salesOrderId !== 1) return false;
            if (woCond.status?.in && !woCond.status.in.includes(l.workOrder.status)) return false;
            return true;
          });
        },
      },
      productionEntry: { findMany: async () => [], groupBy: async () => [] },
      qcEntry: { groupBy: async () => [], aggregate: async () => ({ _sum: { acceptedQty: 0 } }) },
      stockAdjustmentQcEntry: { aggregate: async () => ({ _sum: { acceptedQty: 0 } }) },
      stockTransaction: { aggregate: async () => ({ _sum: { qtyIn: 0, qtyOut: 0 } }) },
      location: { findFirst: async () => ({ id: 1 }) },
    };
    await assertWorkOrderLinesAgainstSalesOrder(db, {
      salesOrderId: 1,
      lineRequests: [{ fgItemId: 10, qty: 5000 }],
      excludeWorkOrderId: null,
    });
  });
});
