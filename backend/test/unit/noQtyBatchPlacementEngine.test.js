const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  assessNoQtyBatchPlacement,
  validateNoQtyPlacementRequest,
  NO_QTY_PLACEMENT_ERROR,
  createPlacementConflictError,
} = require("../../src/services/noQtyBatchPlacementEngine");
const {
  buildNoQtyWoBatchPlacementPreview,
  createNoQtyWorkOrderFromLockedSheet,
} = require("../../src/services/noQtyExecutionReleaseService");

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
      lines: [{ itemId: Number(itemId), qty: Number(qty), grnLines: [] }],
    }));

  return {
    docSequence: {
      upsert: async () => ({ nextNumber: ++nextDocNo, year2: 26, docType: "WORK_ORDER" }),
    },
    bom: {
      findFirst: async ({ where }) => bomByFgItemId[Number(where?.fgItemId)] ?? null,
    },
    item: {
      findMany: async ({ where }) => {
        const ids = where?.id?.in || rmItemIds;
        return ids.map((id) => {
          const numId = Number(id);
          if (numId === 100 || numId === 101 || numId === 102) {
            return {
              id: numId,
              itemName: `FG-${numId}`,
              itemType: "FG",
              unit: "Nos",
              unitRef: { unitCode: "NOS", unitName: "Nos" },
            };
          }
          return { id: numId, itemName: `RM-${id}`, itemType: "RM", unit: "Kg" };
        });
      },
      findFirst: async ({ where }) => {
        const numId = Number(where?.id);
        if (numId === 100 || numId === 101 || numId === 102) {
          return { id: numId, unit: "Nos", unitRef: { unitCode: "NOS", unitName: "Nos" } };
        }
        if (Number.isFinite(numId) && numId > 0) return { id: numId, unit: "Kg", unitRef: null };
        return null;
      },
    },
    stockTransaction: {
      groupBy: async ({ where }) =>
        (where?.itemId?.in || rmItemIds).map((itemId) => ({
          itemId: Number(itemId),
          _sum: { qtyIn: Number(rmStockByItemId[itemId] ?? 0), qtyOut: 0 },
        })),
    },
    location: { findFirst: async () => ({ id: 1 }), findMany: async () => [] },
    productionMaterialRequestLine: { findMany: async () => [] },
    materialAllocation: { findMany: async () => [] },
    rmPurchaseOrder: { findMany: async () => rmPurchaseOrders },
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

describe("noQtyBatchPlacementEngine", () => {
  it("preview and create agree when FG lines share RM pool", async () => {
    const sheet = lockedSheet({
      cycleId: 2,
      lines: [
        { itemId: 100, requirementQty: 5000, item: { itemName: "FG-A", itemType: "FG" } },
        { itemId: 101, requirementQty: 3500, item: { itemName: "FG-B", itemType: "FG" } },
      ],
    });
    const tx = createPlacementTx({
      sheet,
      bomByFgItemId: { 100: simpleBom(1, 501), 101: simpleBom(1, 501) },
      rmStockByItemId: { 501: 8499 },
    });

    const preview = await buildNoQtyWoBatchPlacementPreview(tx, sheet);
    assert.equal(preview.status, "PARTIALLY_READY");
    assert.ok(preview.summary.totalExecutableQty < 8500);
    assert.ok(preview.sharedRmConflict);

    const requestedLines = preview.lines
      .filter((line) => line.suggestedExecutableQty > 0)
      .map((line) => ({ itemId: line.itemId, qty: line.suggestedExecutableQty }));

    const res = await createNoQtyWorkOrderFromLockedSheet(tx, sheet, { requestedLines });
    assert.equal(res.created, true);
    assert.equal(tx.__workOrders.length, requestedLines.length);
  });

  it("rejects requested qty above executable with RM shortage code", () => {
    const assessment = {
      placement: {
        sharedRmConflict: true,
        lines: [{ itemId: 100, rsBalanceQty: 5000, suggestedExecutableQty: 4994, status: "PARTIALLY_READY" }],
      },
      fgUnitByItemId: new Map([[100, "NOS"]]),
    };
    assert.throws(
      () => validateNoQtyPlacementRequest(assessment, [{ itemId: 100, qty: 5000 }]),
      (err) => err.code === NO_QTY_PLACEMENT_ERROR.RM_SHORTAGE || err.code === NO_QTY_PLACEMENT_ERROR.SHARED_RM_CONFLICT,
    );
  });

  it("uses RS changed only when requested qty exceeds balance cap", () => {
    const assessment = {
      placement: {
        sharedRmConflict: false,
        lines: [{ itemId: 100, rsBalanceQty: 4000, suggestedExecutableQty: 4000, status: "READY" }],
      },
      fgUnitByItemId: new Map([[100, "NOS"]]),
    };
    assert.throws(
      () => validateNoQtyPlacementRequest(assessment, [{ itemId: 100, qty: 4500 }]),
      (err) => err.code === NO_QTY_PLACEMENT_ERROR.RS_CHANGED,
    );
  });

  it("detects RM availability change against client snapshot", () => {
    const assessment = {
      placement: {
        sharedRmConflict: true,
        lines: [{ itemId: 100, rsBalanceQty: 5000, suggestedExecutableQty: 4994, status: "PARTIALLY_READY" }],
      },
      fgUnitByItemId: new Map([[100, "NOS"]]),
    };
    assert.throws(
      () =>
        validateNoQtyPlacementRequest(assessment, [{ itemId: 100, qty: 5000 }], {
          snapshot: {
            lines: [{ itemId: 100, rsBalanceQty: 5000, suggestedExecutableQty: 5000 }],
          },
        }),
      (err) => err.code === NO_QTY_PLACEMENT_ERROR.RM_AVAILABILITY_CHANGED,
    );
  });

  it("createPlacementConflictError exposes code for API handler", () => {
    const err = createPlacementConflictError(NO_QTY_PLACEMENT_ERROR.RM_SHORTAGE, "Insufficient RM");
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, NO_QTY_PLACEMENT_ERROR.RM_SHORTAGE);
  });
});
