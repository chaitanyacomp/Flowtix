/**
 * Regression coverage for the Production Report "Confirm & Close WO" P2028
 * partial-commit fix.
 *
 * Proven root cause (see logs/application.log 2026-07-12T07:17): the confirm
 * endpoint ran one interactive transaction, but createMaterialWastageNote()
 * opened its OWN root-client prisma.$transaction — so the wastage note + the
 * RM_WASTAGE stock deduction committed independently and survived an outer
 * rollback (P2028), and a retry could duplicate them.
 *
 * These tests lock in:
 *  - createMaterialWastageNote participates in a supplied transaction client
 *    (no nested transaction, no root-client escape).
 *  - standalone callers keep their own transaction (backward compatible).
 *  - confirmProductionWorkOrderReport({ includeReport: false }) keeps the
 *    heavy read-only report rebuild OUT of the write transaction.
 *  - the already-confirmed idempotency contract the route relies on is stable.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const docNoPath = require.resolve("../../src/services/docNoService");
const stockPath = require.resolve("../../src/services/stockService");
const returnPath = require.resolve("../../src/services/materialReturnService");
const locationPath = require.resolve("../../src/services/locationService");
const wastagePath = require.resolve("../../src/services/materialWastageService");
const reportPath = require.resolve("../../src/services/productionWorkOrderReportService");

function withWastageDepsMocked(fn) {
  const orig = {
    allocateDocNo: require(docNoPath).allocateDocNo,
    assertSufficientStockForQtyOut: require(stockPath).assertSufficientStockForQtyOut,
    buildReturnableLinesForWorkOrder: require(returnPath).buildReturnableLinesForWorkOrder,
    isProductionSourceLocation: require(returnPath).isProductionSourceLocation,
    mapLocationRow: require(locationPath).mapLocationRow,
  };
  require(docNoPath).allocateDocNo = async () => "MWN-1";
  require(stockPath).assertSufficientStockForQtyOut = async () => {};
  require(returnPath).buildReturnableLinesForWorkOrder = async () => ({
    lines: [{ itemId: 7, itemName: "PP", unit: "Kg", returnableQty: 100 }],
  });
  require(returnPath).isProductionSourceLocation = () => true;
  require(locationPath).mapLocationRow = (row) => row;
  delete require.cache[wastagePath];
  const { createMaterialWastageNote } = require(wastagePath);
  return Promise.resolve(fn(createMaterialWastageNote)).finally(() => {
    require(docNoPath).allocateDocNo = orig.allocateDocNo;
    require(stockPath).assertSufficientStockForQtyOut = orig.assertSufficientStockForQtyOut;
    require(returnPath).buildReturnableLinesForWorkOrder = orig.buildReturnableLinesForWorkOrder;
    require(returnPath).isProductionSourceLocation = orig.isProductionSourceLocation;
    require(locationPath).mapLocationRow = orig.mapLocationRow;
    delete require.cache[wastagePath];
    delete require.cache[reportPath];
  });
}

function buildWastageClientMock() {
  const calls = { note: 0, stock: 0 };
  const clients = { note: null, stock: null };
  const client = {
    workOrder: { findUnique: async () => ({ id: 5, salesOrder: { orderType: "NO_QTY" } }) },
    location: { findUnique: async () => ({ id: 1, isActive: true, allowRm: true, locationName: "PROD" }) },
    item: { findUnique: async () => ({ id: 7, itemType: "RM", itemName: "PP", unit: "Kg" }) },
    materialWastageNote: {
      create: async ({ data }) => {
        calls.note += 1;
        clients.note = client;
        return {
          id: 55,
          docNo: "MWN-1",
          ...data,
          fromLocation: { id: 1, locationName: "PROD" },
          workOrder: { docNo: "WO-1" },
          item: { itemName: "PP", unit: "Kg" },
          createdBy: null,
        };
      },
    },
    stockTransaction: {
      create: async ({ data }) => {
        calls.stock += 1;
        clients.stock = client;
        return data;
      },
    },
  };
  return { client, calls, clients };
}

describe("production report confirm & close — atomicity / idempotency", () => {
  it("createMaterialWastageNote runs inline on a supplied tx client (no nested transaction, no root escape)", async () => {
    await withWastageDepsMocked(async (createMaterialWastageNote) => {
      const { client, calls, clients } = buildWastageClientMock();
      // tx clients have NO $transaction method — if the code tried db.$transaction
      // it would throw. Success proves the inline path was used.
      assert.equal(typeof client.$transaction, "undefined");

      const note = await createMaterialWastageNote(
        { workOrderId: 5, fromLocationId: 1, itemId: 7, qty: 5, reason: "PROCESS_LOSS" },
        {},
        client,
      );

      assert.equal(calls.note, 1, "wastage note created exactly once");
      assert.equal(calls.stock, 1, "RM_WASTAGE stock posted exactly once");
      assert.equal(clients.note, client, "wastage note used the supplied tx client");
      assert.equal(clients.stock, client, "RM_WASTAGE stock used the supplied tx client");
      assert.equal(note.docNo, "MWN-1");
    });
  });

  it("createMaterialWastageNote opens its own transaction for standalone callers (backward compatible)", async () => {
    await withWastageDepsMocked(async (createMaterialWastageNote) => {
      const { client, calls } = buildWastageClientMock();
      let txCalls = 0;
      const rootLike = {
        ...client,
        $transaction: async (run) => {
          txCalls += 1;
          return run(client);
        },
      };

      const note = await createMaterialWastageNote(
        { workOrderId: 5, fromLocationId: 1, itemId: 7, qty: 5, reason: "PROCESS_LOSS" },
        {},
        rootLike,
      );

      assert.equal(txCalls, 1, "standalone call opens exactly one transaction");
      assert.equal(calls.note, 1);
      assert.equal(calls.stock, 1);
      assert.equal(note.docNo, "MWN-1");
    });
  });

  it("confirmProductionWorkOrderReport({ includeReport: false }) skips the in-transaction report rebuild but returns decision fields", async () => {
    const origReturn = require(returnPath).buildReturnableLinesForWorkOrder;
    require(returnPath).buildReturnableLinesForWorkOrder = async () => ({
      lines: [
        {
          itemId: 7,
          itemName: "PP",
          unit: "Kg",
          grossIssuedQty: 12,
          consumedQty: 8,
          returnedQty: 0,
          returnableQty: 4,
          unusedQty: 4,
        },
      ],
    });
    delete require.cache[reportPath];
    const { confirmProductionWorkOrderReport: confirmReport } = require(reportPath);

    const db = buildConfirmDbMock();

    try {
      const result = await confirmReport(
        db,
        15,
        { lines: [{ itemId: 7, rmConsumedQty: 8, rmReturnQty: 4, scrapWasteQty: 0 }] },
        { userId: 9, role: "PRODUCTION" },
        { includeReport: false },
      );
      assert.equal(result.report, null, "full report rebuild is skipped inside the transaction");
      assert.equal(result.salesOrderOrderType, "NORMAL", "decision field present");
      assert.ok(result.confirmation, "confirmation row present");
      assert.equal(result.returnPendingCount, 1);
      assert.equal(typeof result.remainderQty, "number");
    } finally {
      require(returnPath).buildReturnableLinesForWorkOrder = origReturn;
      delete require.cache[reportPath];
    }
  });

  it("confirmProductionWorkOrderReport default still returns the full report (backward compatible)", async () => {
    const origReturn = require(returnPath).buildReturnableLinesForWorkOrder;
    require(returnPath).buildReturnableLinesForWorkOrder = async () => ({
      lines: [
        {
          itemId: 7,
          itemName: "PP",
          unit: "Kg",
          grossIssuedQty: 12,
          consumedQty: 8,
          returnedQty: 0,
          returnableQty: 4,
          unusedQty: 4,
        },
      ],
    });
    delete require.cache[reportPath];
    const { confirmProductionWorkOrderReport: confirmReport } = require(reportPath);

    const db = buildConfirmDbMock();

    try {
      const result = await confirmReport(
        db,
        15,
        { lines: [{ itemId: 7, rmConsumedQty: 8, rmReturnQty: 4, scrapWasteQty: 0 }] },
        { userId: 9, role: "PRODUCTION" },
      );
      assert.ok(result.report, "full report returned by default");
      assert.equal(result.report.workOrderId, 15);
    } finally {
      require(returnPath).buildReturnableLinesForWorkOrder = origReturn;
      delete require.cache[reportPath];
    }
  });

  it("confirmProductionWorkOrderReport rejects duplicate confirm with a stable idempotency code", async () => {
    delete require.cache[reportPath];
    const { confirmProductionWorkOrderReport: confirmReport } = require(reportPath);
    const db = {
      productionWorkOrderReport: {
        findUnique: async () => ({
          id: 701,
          status: "CONFIRMED",
          remainingQty: "0",
          lines: [],
          returnPendings: [],
          wastageDetails: [],
        }),
      },
    };
    // The route converts this exact code into an idempotent 200 (alreadyConfirmed).
    await assert.rejects(
      () => confirmReport(db, 15, {}, { userId: 9 }, { includeReport: false }),
      (err) => err.code === "PRODUCTION_REPORT_ALREADY_CONFIRMED" && err.statusCode === 409,
    );
    delete require.cache[reportPath];
  });
});

function buildConfirmDbMock() {
  return {
    workOrder: {
      findUnique: async () => ({
        id: 15,
        docNo: "WO-26-0001",
        status: "IN_PROGRESS",
        lines: [{ id: 150, fgItemId: 5, qty: 10, plannedQty: 10, fgItem: { id: 5, itemName: "FG", unit: "Nos" } }],
        salesOrder: { id: 1, docNo: "SO-1", orderType: "NORMAL", customer: { name: "Acme" } },
        requirementSheet: null,
        cycle: null,
        productionExecution: null,
      }),
      update: async ({ data }) => ({ id: 15, ...data }),
    },
    productionEntry: {
      findMany: async () => [
        {
          id: 501,
          docNo: "PE-501",
          date: new Date("2026-06-01"),
          producedQty: 10,
          workOrderLine: { id: 150, fgItemId: 5, fgItem: { id: 5, itemName: "FG", unit: "Nos" } },
          qcEntries: [],
          rmConsumptions: [
            {
              itemId: 7,
              standardQty: 8,
              actualQty: 8,
              varianceQty: 0,
              variancePercent: 0,
              consumptionType: "NORMAL",
              remarks: null,
              item: { id: 7, itemName: "PP", unit: "Kg" },
            },
          ],
        },
      ],
      groupBy: async () => [{ workOrderLineId: 150, _sum: { producedQty: 10 } }],
    },
    productionWorkOrderReport: {
      findUnique: async () => null,
      create: async ({ data }) => ({ id: 701, ...data }),
    },
    productionRmReturnPending: { create: async ({ data }) => ({ id: 1, ...data }) },
    auditLog: { findMany: async () => [], create: async () => ({ id: 1 }) },
  };
}
