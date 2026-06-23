const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  isPeriodReleasedForExecution,
  filterNoQtyExecutionReleasedWorkOrders,
  assertNoQtyWorkOrderExecutionReleased,
  NO_QTY_EXECUTION_NOT_RELEASED_MESSAGE,
} = require("../../src/services/noQtyExecutionBoundaryService");
const { createNoQtyWorkOrderFromLockedSheet } = require("../../src/services/noQtyExecutionReleaseService");

function createBoundaryDb({ releasedPeriods = [], sheets = [] } = {}) {
  const db = {
    monthlyProductionPlan: {
      findFirst: async ({ where }) => {
        const pk = where?.periodKey;
        const needsRelease = where?.releasedAt?.not === null;
        if (pk && needsRelease && releasedPeriods.includes(pk)) {
          return { id: 1, periodKey: pk };
        }
        return null;
      },
      findMany: async ({ where }) => {
        const keys = where?.periodKey?.in || [];
        return keys.filter((k) => releasedPeriods.includes(k)).map((k) => ({ periodKey: k }));
      },
    },
    requirementSheet: {
      findMany: async ({ where }) => {
        if (where?.id?.in) {
          return sheets.filter((s) => where.id.in.includes(s.id));
        }
        if (where?.status === "LOCKED" && where?.OR) {
          return sheets.filter((s) =>
            where.OR.some((o) => o.salesOrderId === s.salesOrderId && o.cycleId === s.cycleId),
          );
        }
        return sheets;
      },
      findUnique: async ({ where }) => sheets.find((s) => s.id === where.id) ?? null,
      findFirst: async ({ where }) => {
        let rows = sheets.filter((s) => s.status === (where.status ?? s.status));
        if (where.salesOrderId) rows = rows.filter((s) => s.salesOrderId === where.salesOrderId);
        if (where.cycleId) rows = rows.filter((s) => s.cycleId === where.cycleId);
        return rows[0] ?? null;
      },
    },
    workOrder: {
      findUnique: async ({ where }) => {
        const all = db.__workOrders || [];
        return all.find((w) => w.id === where.id) ?? null;
      },
    },
    __workOrders: [],
  };
  return db;
}

describe("noQtyExecutionBoundaryService", () => {
  it("isPeriodReleasedForExecution is false until plan released", async () => {
    const db = createBoundaryDb({ releasedPeriods: [] });
    assert.equal(await isPeriodReleasedForExecution(db, "2026-06"), false);
    db.monthlyProductionPlan.findFirst = async () => ({ id: 9, periodKey: "2026-06" });
    assert.equal(await isPeriodReleasedForExecution(db, "2026-06"), true);
  });

  it("filterNoQtyExecutionReleasedWorkOrders hides pre-release NO_QTY WOs", async () => {
    const db = createBoundaryDb({
      releasedPeriods: [],
      sheets: [{ id: 10, salesOrderId: 1, cycleId: 2, periodKey: "2026-06", status: "LOCKED" }],
    });
    const rows = [
      { id: 1, salesOrderId: 1, cycleId: 2, requirementSheetId: 10, salesOrder: { orderType: "NO_QTY" } },
      { id: 2, salesOrderId: 2, cycleId: 1, requirementSheetId: null, salesOrder: { orderType: "NORMAL" } },
    ];
    const out = await filterNoQtyExecutionReleasedWorkOrders(db, rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 2);
  });

  it("assertNoQtyWorkOrderExecutionReleased blocks pre-release execution", async () => {
    const db = createBoundaryDb({
      releasedPeriods: [],
      sheets: [{ id: 10, salesOrderId: 1, cycleId: 2, periodKey: "2026-06", status: "LOCKED" }],
    });
    db.workOrder.findUnique = async () => ({
      id: 5,
      salesOrderId: 1,
      cycleId: 2,
      requirementSheetId: 10,
      salesOrder: { orderType: "NO_QTY" },
    });
    await assert.rejects(
      () => assertNoQtyWorkOrderExecutionReleased(db, 5),
      (e) => e.code === "NO_QTY_EXECUTION_NOT_RELEASED" && e.message.includes(NO_QTY_EXECUTION_NOT_RELEASED_MESSAGE),
    );
  });
});

describe("noQtyExecutionReleaseService.createNoQtyWorkOrderFromLockedSheet", () => {
  it("creates WO from locked sheet lines using requirementQty only", async () => {
    let created = null;
    const tx = {
      docSequence: {
        upsert: async () => ({ nextNumber: 1, year2: 26, docType: "WORK_ORDER" }),
      },
      workOrder: {
        findMany: async () => [],
        create: async ({ data }) => {
          created = data;
          return { id: 99, docNo: "WO-26-0099" };
        },
        update: async () => ({}),
      },
      salesOrderLine: {
        findMany: async () => [{ itemId: 65, item: { itemType: "FG" } }],
      },
    };
    const sheet = {
      id: 1,
      salesOrderId: 10,
      cycleId: 3,
      salesOrder: { orderType: "NO_QTY", customerReturnId: null },
      lines: [{ itemId: 65, requirementQty: "5000", suggestedWoQtySnapshot: "15000" }],
    };
    const res = await createNoQtyWorkOrderFromLockedSheet(tx, sheet);
    assert.equal(res.created, true);
    assert.equal(res.workOrderId, 99);
    assert.equal(Number(created.lines.create[0].qty), 5000);
  });

  it("creates only remaining RS balance when linked WOs already exist", async () => {
    let created = null;
    const tx = {
      docSequence: {
        upsert: async () => ({ nextNumber: 2, year2: 26, docType: "WORK_ORDER" }),
      },
      workOrder: {
        findMany: async () => [
          {
            id: 90,
            cycleId: 3,
            status: "PENDING",
            lines: [{ fgItemId: 65, qty: "4000", plannedQty: "4000" }],
          },
          {
            id: 91,
            cycleId: 3,
            status: "REJECTED",
            lines: [{ fgItemId: 65, qty: "2000", plannedQty: "2000" }],
          },
        ],
        create: async ({ data }) => {
          created = data;
          return { id: 100, docNo: "WO-26-0100" };
        },
        update: async () => ({}),
      },
      salesOrderLine: {
        findMany: async () => [{ itemId: 65, item: { itemType: "FG" } }],
      },
    };
    const sheet = {
      id: 1,
      salesOrderId: 10,
      cycleId: 3,
      salesOrder: { orderType: "NO_QTY", customerReturnId: null },
      lines: [{ itemId: 65, requirementQty: "10000", suggestedWoQtySnapshot: "25000" }],
    };

    const res = await createNoQtyWorkOrderFromLockedSheet(tx, sheet);

    assert.equal(res.created, true);
    assert.equal(res.workOrderId, 100);
    assert.equal(Number(created.lines.create[0].qty), 6000);
  });

  it("skips creation when counted linked WOs already cover RS demand", async () => {
    const tx = {
      workOrder: {
        findMany: async () => [
          {
            id: 90,
            cycleId: 3,
            status: "PENDING",
            lines: [{ fgItemId: 65, qty: "5000", plannedQty: "5000" }],
          },
        ],
        update: async () => ({}),
      },
      salesOrderLine: {
        findMany: async () => [{ itemId: 65, item: { itemType: "FG" } }],
      },
    };
    const sheet = {
      id: 1,
      salesOrderId: 10,
      cycleId: 3,
      salesOrder: { orderType: "NO_QTY", customerReturnId: null },
      lines: [{ itemId: 65, requirementQty: "5000", suggestedWoQtySnapshot: "15000" }],
    };

    const res = await createNoQtyWorkOrderFromLockedSheet(tx, sheet);

    assert.equal(res.created, false);
    assert.equal(res.workOrderId, null);
    assert.equal(res.skippedReason, "ZERO_EXECUTABLE_QTY");
  });

  it("serializes concurrent placements so total WO qty never exceeds RS demand", async () => {
    const workOrders = [];
    let nextWoId = 200;
    let lockTail = Promise.resolve();
    let unlockCurrent = null;

    const tx = {
      $queryRaw: async (_strings, sheetId) => {
        let unlock;
        const previous = lockTail;
        lockTail = new Promise((resolve) => {
          unlock = resolve;
        });
        await previous;
        unlockCurrent = unlock;
        return [{ id: sheetId }];
      },
      docSequence: {
        upsert: async () => ({ nextNumber: nextWoId, year2: 26, docType: "WORK_ORDER" }),
      },
      workOrder: {
        findMany: async () =>
          workOrders.map((wo) => ({
            id: wo.id,
            cycleId: wo.cycleId,
            status: wo.status,
            lines: wo.lines.map((line) => ({ ...line })),
          })),
        create: async ({ data }) => {
          await new Promise((resolve) => setImmediate(resolve));
          const id = nextWoId++;
          workOrders.push({
            id,
            cycleId: data.cycleId,
            status: data.status,
            lines: data.lines.create.map((line) => ({
              fgItemId: line.fgItemId,
              qty: line.qty,
              plannedQty: line.plannedQty,
            })),
          });
          return { id, docNo: `WO-26-${String(id).padStart(4, "0")}` };
        },
        update: async () => ({}),
      },
      salesOrderLine: {
        findMany: async () => [{ itemId: 65, item: { itemType: "FG" } }],
      },
    };
    const sheet = {
      id: 1,
      salesOrderId: 10,
      cycleId: 3,
      salesOrder: { orderType: "NO_QTY", customerReturnId: null },
      lines: [{ itemId: 65, requirementQty: "10000", suggestedWoQtySnapshot: "25000" }],
    };

    async function placeWithCommit() {
      try {
        return await createNoQtyWorkOrderFromLockedSheet(tx, sheet);
      } finally {
        const unlock = unlockCurrent;
        unlockCurrent = null;
        if (unlock) unlock();
      }
    }

    const [a, b] = await Promise.all([placeWithCommit(), placeWithCommit()]);
    const totalPlaced = workOrders.reduce(
      (sum, wo) => sum + wo.lines.reduce((lineSum, line) => lineSum + Number(line.plannedQty), 0),
      0,
    );

    assert.equal(totalPlaced, 10000);
    assert.equal(workOrders.length, 1);
    assert.deepEqual(
      [a.created, b.created].sort(),
      [false, true],
    );
  });
});
