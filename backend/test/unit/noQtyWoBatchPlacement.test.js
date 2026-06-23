const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildNoQtyWoBatchPlacementPreview,
  createNoQtyWorkOrderFromLockedSheet,
} = require("../../src/services/noQtyExecutionReleaseService");
const { ensurePmrsForCreatedWorkOrders } = require("../../src/routes/requirementSheets");

function round3(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

function createPlacementTx({
  sheet,
  existingWorkOrders = [],
  bomByFgItemId = {},
  rmStockByItemId = {},
  incomingByItemId = {},
} = {}) {
  const workOrders = existingWorkOrders.map((wo) => ({
    id: wo.id,
    docNo: wo.docNo ?? `WO-${String(wo.id).padStart(4, "0")}`,
    cycleId: wo.cycleId,
    status: wo.status,
    lines: (wo.lines || []).map((line) => ({
      fgItemId: line.fgItemId,
      qty: String(line.qty ?? line.plannedQty ?? 0),
      plannedQty: String(line.plannedQty ?? line.qty ?? 0),
    })),
  }));
  let nextWoId = workOrders.reduce((max, wo) => Math.max(max, Number(wo.id) || 0), 0) + 1;
  let nextDocNo = 1;

  const rmItemIds = Object.keys(rmStockByItemId).map(Number).filter((id) => Number.isFinite(id) && id > 0);
  const rmPurchaseOrders = Object.entries(incomingByItemId)
    .filter(([, qty]) => Number(qty) > 0)
    .map(([itemId, qty]) => ({
      status: "PENDING",
      lines: [
        {
          itemId: Number(itemId),
          qty: Number(qty),
          grnLines: [],
        },
      ],
    }));

  return {
    docSequence: {
      upsert: async () => ({ nextNumber: ++nextDocNo, year2: 26, docType: "WORK_ORDER" }),
    },
    bom: {
      findFirst: async ({ where }) => bomByFgItemId[Number(where?.fgItemId)] ?? null,
    },
    item: {
      findMany: async ({ where }) =>
        (where?.id?.in || rmItemIds).map((id) => ({
          id: Number(id),
          itemName: `RM-${id}`,
          itemType: "RM",
        })),
    },
    stockTransaction: {
      groupBy: async ({ where }) =>
        (where?.itemId?.in || rmItemIds).map((itemId) => ({
          itemId: Number(itemId),
          _sum: { qtyIn: Number(rmStockByItemId[itemId] ?? 0), qtyOut: 0 },
        })),
    },
    location: {
      findFirst: async () => ({ id: 1 }),
      findMany: async () => [],
    },
    productionMaterialRequestLine: {
      findMany: async () => [],
    },
    materialAllocation: {
      findMany: async () => [],
    },
    rmPurchaseOrder: {
      findMany: async () => rmPurchaseOrders,
    },
    salesOrderLine: {
      findMany: async () =>
        (sheet?.lines || []).map((line) => ({
          itemId: line.itemId,
          item: { itemType: "FG" },
        })),
    },
    workOrder: {
      findMany: async () =>
        workOrders.map((wo) => ({
          ...wo,
          lines: wo.lines.map((line) => ({
            fgItemId: line.fgItemId,
            qty: line.qty,
            plannedQty: line.plannedQty,
          })),
        })),
      create: async ({ data }) => {
        const id = nextWoId++;
        const docNo = data.docNo ?? `WO-${String(id).padStart(4, "0")}`;
        workOrders.push({
          id,
          docNo,
          cycleId: data.cycleId,
          status: data.status,
          lines: (data.lines?.create || []).map((line) => ({
            fgItemId: line.fgItemId,
            qty: line.qty,
            plannedQty: line.plannedQty,
          })),
        });
        return { id, docNo };
      },
      update: async () => ({}),
    },
    __workOrders: workOrders,
  };
}

function lockedSheet({
  sheetId = 1,
  demand = 10000,
  itemId = 100,
  itemName = "FG-A",
  cycleId = 1,
  lines = null,
} = {}) {
  return {
    id: sheetId,
    salesOrderId: 10,
    cycleId,
    status: "LOCKED",
    salesOrder: { orderType: "NO_QTY", customerReturnId: null },
    lines:
      lines ??
      [
        {
          itemId,
          requirementQty: demand,
          item: { itemName, itemType: "FG" },
        },
      ],
  };
}

function simpleBom(baseQty = 1, rmItemId = 501) {
  return {
    id: rmItemId,
    status: "APPROVED",
    outputQty: 1,
    processLossPercent: 0,
    qcLossPercent: 0,
    normalizationMode: null,
    lines: [
      {
        baseQty,
        rmItemId,
        rmItem: { id: rmItemId, itemName: `RM-${rmItemId}`, itemType: "RM" },
      },
    ],
  };
}

describe("noQtyExecutionReleaseService batch placement", () => {
  it("preview calculates executable qty from RM availability", async () => {
    const sheet = lockedSheet();
    const tx = createPlacementTx({
      sheet,
      bomByFgItemId: {
        100: {
          id: 1,
          status: "APPROVED",
          outputQty: 1,
          processLossPercent: 0,
          qcLossPercent: 0,
          normalizationMode: null,
          lines: [
            {
              baseQty: 2,
              rmItemId: 501,
              rmItem: { id: 501, itemName: "RM-A", itemType: "RM" },
            },
          ],
        },
      },
      rmStockByItemId: { 501: 5000 },
    });

    const preview = await buildNoQtyWoBatchPlacementPreview(tx, sheet);
    assert.equal(preview.status, "PARTIALLY_READY");
    assert.equal(preview.lines[0].suggestedExecutableQty, 2500);
  });

  it("allows partial WO placement when RM is ready", async () => {
    const sheet = lockedSheet({ demand: 10000 });
    const tx = createPlacementTx({
      sheet,
      bomByFgItemId: {
        100: {
          id: 1,
          status: "APPROVED",
          outputQty: 1,
          processLossPercent: 0,
          qcLossPercent: 0,
          normalizationMode: null,
          lines: [
            {
              baseQty: 2,
              rmItemId: 501,
              rmItem: { id: 501, itemName: "RM-A", itemType: "RM" },
            },
          ],
        },
      },
      rmStockByItemId: { 501: 5000 },
    });

    const res = await createNoQtyWorkOrderFromLockedSheet(tx, sheet, {
      requestedLines: [{ itemId: 100, qty: 2500 }],
    });

    assert.equal(res.created, true);
    assert.deepEqual(res.workOrderIds, [1]);
    assert.equal(res.workOrders.length, 1);
    assert.equal(tx.__workOrders.length, 1);
    assert.equal(round3(tx.__workOrders[0].lines[0].plannedQty), 2500);
  });

  it("batch placement creates one WO with one line per requested FG item", async () => {
    const sheet = lockedSheet({
      lines: [
        { itemId: 100, requirementQty: 4000, item: { itemName: "FG-A", itemType: "FG" } },
        { itemId: 101, requirementQty: 3000, item: { itemName: "FG-B", itemType: "FG" } },
        { itemId: 102, requirementQty: 2000, item: { itemName: "FG-C", itemType: "FG" } },
      ],
    });
    const tx = createPlacementTx({
      sheet,
      bomByFgItemId: {
        100: simpleBom(1, 501),
        101: simpleBom(1, 502),
        102: simpleBom(1, 503),
      },
      rmStockByItemId: { 501: 4000, 502: 3000, 503: 2000 },
    });

    const res = await createNoQtyWorkOrderFromLockedSheet(tx, sheet, {
      requestedLines: [
        { itemId: 100, qty: 4000 },
        { itemId: 101, qty: 3000 },
        { itemId: 102, qty: 2000 },
      ],
    });

    assert.equal(res.created, true);
    assert.deepEqual(res.workOrderIds, [1, 2, 3]);
    assert.equal(res.workOrders.length, 3);
    assert.deepEqual(
      res.workOrders.map((wo) => [wo.fgItemId, wo.qty]),
      [
        [100, 4000],
        [101, 3000],
        [102, 2000],
      ],
    );
    assert.equal(tx.__workOrders.length, 3);
    assert.deepEqual(tx.__workOrders.map((wo) => wo.lines.length), [1, 1, 1]);
    assert.deepEqual(
      tx.__workOrders.map((wo) => [wo.lines[0].fgItemId, round3(wo.lines[0].plannedQty)]),
      [
        [100, 4000],
        [101, 3000],
        [102, 2000],
      ],
    );
    assert.deepEqual(
      tx.__workOrders.map((wo) => wo.docNo),
      ["WO-26-0001", "WO-26-0002", "WO-26-0003"],
    );
  });

  it("blocks placement when BOM is missing", async () => {
    const sheet = lockedSheet();
    const tx = createPlacementTx({
      sheet,
      bomByFgItemId: {},
    });

    await assert.rejects(
      () =>
        createNoQtyWorkOrderFromLockedSheet(tx, sheet, {
          requestedLines: [{ itemId: 100, qty: 100 }],
        }),
      /BOM/i,
    );
  });

  it("blocks placement when procurement is still awaited", async () => {
    const sheet = lockedSheet();
    const tx = createPlacementTx({
      sheet,
      bomByFgItemId: {
        100: {
          id: 1,
          status: "APPROVED",
          outputQty: 1,
          processLossPercent: 0,
          qcLossPercent: 0,
          normalizationMode: null,
          lines: [
            {
              baseQty: 2,
              rmItemId: 501,
              rmItem: { id: 501, itemName: "RM-A", itemType: "RM" },
            },
          ],
        },
      },
      rmStockByItemId: { 501: 0 },
    });

    await assert.rejects(
      () =>
        createNoQtyWorkOrderFromLockedSheet(tx, sheet, {
          requestedLines: [{ itemId: 100, qty: 100 }],
        }),
      /not available|editing/i,
    );
  });

  it("blocks quantity that exceeds RS balance", async () => {
    const sheet = lockedSheet({ demand: 10000 });
    const tx = createPlacementTx({
      sheet,
      existingWorkOrders: [
        {
          id: 1,
          cycleId: 1,
          status: "PENDING",
          lines: [{ fgItemId: 100, qty: 9000, plannedQty: 9000 }],
        },
      ],
      bomByFgItemId: {
        100: {
          id: 1,
          status: "APPROVED",
          outputQty: 1,
          processLossPercent: 0,
          qcLossPercent: 0,
          normalizationMode: null,
          lines: [
            {
              baseQty: 1,
              rmItemId: 501,
              rmItem: { id: 501, itemName: "RM-A", itemType: "RM" },
            },
          ],
        },
      },
      rmStockByItemId: { 501: 10000 },
    });

    await assert.rejects(
      () =>
        createNoQtyWorkOrderFromLockedSheet(tx, sheet, {
          requestedLines: [{ itemId: 100, qty: 2000 }],
        }),
      /Refresh and try again/i,
    );
  });

  it("blocks quantity that exceeds executable qty", async () => {
    const sheet = lockedSheet({ demand: 10000 });
    const tx = createPlacementTx({
      sheet,
      bomByFgItemId: {
        100: {
          id: 1,
          status: "APPROVED",
          outputQty: 1,
          processLossPercent: 0,
          qcLossPercent: 0,
          normalizationMode: null,
          lines: [
            {
              baseQty: 2,
              rmItemId: 501,
              rmItem: { id: 501, itemName: "RM-A", itemType: "RM" },
            },
          ],
        },
      },
      rmStockByItemId: { 501: 5000 },
    });

    await assert.rejects(
      () =>
        createNoQtyWorkOrderFromLockedSheet(tx, sheet, {
          requestedLines: [{ itemId: 100, qty: 3000 }],
        }),
      /Refresh and try again/i,
    );
  });

  it("supports multiple WO creation against the same RS", async () => {
    const sheet = lockedSheet({ demand: 10000 });
    const tx = createPlacementTx({
      sheet,
      bomByFgItemId: {
        100: {
          id: 1,
          status: "APPROVED",
          outputQty: 1,
          processLossPercent: 0,
          qcLossPercent: 0,
          normalizationMode: null,
          lines: [
            {
              baseQty: 1,
              rmItemId: 501,
              rmItem: { id: 501, itemName: "RM-A", itemType: "RM" },
            },
          ],
        },
      },
      rmStockByItemId: { 501: 10000 },
    });

    const first = await createNoQtyWorkOrderFromLockedSheet(tx, sheet, {
      requestedLines: [{ itemId: 100, qty: 6000 }],
    });
    const second = await createNoQtyWorkOrderFromLockedSheet(tx, sheet, {
      requestedLines: [{ itemId: 100, qty: 4000 }],
    });

    assert.equal(first.created, true);
    assert.equal(second.created, true);
    assert.equal(tx.__workOrders.length, 2);
    assert.equal(round3(tx.__workOrders.reduce((sum, wo) => sum + Number(wo.lines[0].plannedQty), 0)), 10000);
  });

  it("RS balance after split placement still equals demand minus summed WO qty", async () => {
    const sheet = lockedSheet({
      lines: [
        { itemId: 100, requirementQty: 4000, item: { itemName: "FG-A", itemType: "FG" } },
        { itemId: 101, requirementQty: 3000, item: { itemName: "FG-B", itemType: "FG" } },
      ],
    });
    const tx = createPlacementTx({
      sheet,
      bomByFgItemId: {
        100: simpleBom(1, 501),
        101: simpleBom(1, 502),
      },
      rmStockByItemId: { 501: 4000, 502: 3000 },
    });

    await createNoQtyWorkOrderFromLockedSheet(tx, sheet, {
      requestedLines: [
        { itemId: 100, qty: 2500 },
        { itemId: 101, qty: 1000 },
      ],
    });
    const preview = await buildNoQtyWoBatchPlacementPreview(tx, sheet);

    assert.equal(preview.summary.totalRsDemandQty, 7000);
    assert.equal(preview.summary.totalWoPlacedQty, 3500);
    assert.equal(preview.summary.totalRsBalanceQty, 3500);
    assert.deepEqual(
      preview.lines.map((line) => [line.itemId, line.woPlacedQty, line.rsBalanceQty]),
      [
        [100, 2500, 1500],
        [101, 1000, 2000],
      ],
    );
  });

  it("creates one PMR per created WO", async () => {
    const calls = [];
    const pmrs = await ensurePmrsForCreatedWorkOrders(
      {},
      {
        createdWorkOrders: [
          { workOrderId: 1, workOrderDocNo: "WO-26-0001" },
          { workOrderId: 2, workOrderDocNo: "WO-26-0002" },
          { workOrderId: 3, workOrderDocNo: "WO-26-0003" },
        ],
        actor: { userId: 9, role: "STORE" },
        ensurePmr: async (workOrderId, actor, db) => {
          calls.push({ workOrderId, actor, db });
          return { id: workOrderId + 100, docNo: `PMR-26-000${workOrderId}`, status: "REQUESTED" };
        },
      },
    );

    assert.deepEqual(calls.map((c) => c.workOrderId), [1, 2, 3]);
    assert.deepEqual(calls.map((c) => c.actor), [
      { userId: 9, role: "STORE" },
      { userId: 9, role: "STORE" },
      { userId: 9, role: "STORE" },
    ]);
    assert.deepEqual(
      pmrs.map((p) => [p.workOrderId, p.pmrId, p.status]),
      [
        [1, 101, "REQUESTED"],
        [2, 102, "REQUESTED"],
        [3, 103, "REQUESTED"],
      ],
    );
  });

  it("rolls back split WO placement when PMR creation fails in the transaction", async () => {
    const sheet = lockedSheet({
      lines: [
        { itemId: 100, requirementQty: 4000, item: { itemName: "FG-A", itemType: "FG" } },
        { itemId: 101, requirementQty: 3000, item: { itemName: "FG-B", itemType: "FG" } },
      ],
    });
    const tx = createPlacementTx({
      sheet,
      bomByFgItemId: {
        100: simpleBom(1, 501),
        101: simpleBom(1, 502),
      },
      rmStockByItemId: { 501: 4000, 502: 3000 },
    });
    const db = {
      __workOrders: tx.__workOrders,
      $transaction: async (fn) => {
        const snapshot = tx.__workOrders.map((wo) => ({
          ...wo,
          lines: wo.lines.map((line) => ({ ...line })),
        }));
        try {
          return await fn(tx);
        } catch (err) {
          tx.__workOrders.splice(0, tx.__workOrders.length, ...snapshot);
          throw err;
        }
      },
    };

    await assert.rejects(
      () =>
        db.$transaction(async (trx) => {
          const woResult = await createNoQtyWorkOrderFromLockedSheet(trx, sheet, {
            requestedLines: [
              { itemId: 100, qty: 4000 },
              { itemId: 101, qty: 3000 },
            ],
          });
          await ensurePmrsForCreatedWorkOrders(trx, {
            createdWorkOrders: woResult.workOrders,
            ensurePmr: async (workOrderId) => {
              if (workOrderId === 2) throw new Error("PMR failed");
              return { id: workOrderId + 100, docNo: `PMR-26-000${workOrderId}`, status: "REQUESTED" };
            },
          });
        }),
      /PMR failed/,
    );

    assert.equal(tx.__workOrders.length, 0);
  });
});
