const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { prefixForDocType } = require("../../src/services/docNoService");
const { DocType } = require("../../src/prismaClientPackage");
const {
  pendingQty,
  STORE_ISSUE_STATUSES,
  computeFreeStoreStockLine,
  loadReservedForOtherOpenPmrsByItem,
  buildPmrIssueContext,
  ensureSubmittedProductionMaterialRequestForWorkOrder,
} = require("../../src/services/productionMaterialRequestService");

describe("productionMaterialRequestService helpers", () => {
  it("uses PMR doc prefix", () => {
    assert.equal(prefixForDocType(DocType.PRODUCTION_MATERIAL_REQUEST), "PMR");
  });

  it("computes pending qty from required minus issued", () => {
    assert.equal(pendingQty({ requiredQty: 100, issuedQty: 70 }), 30);
    assert.equal(pendingQty({ requiredQty: 50, issuedQty: 50 }), 0);
  });

  it("store issue statuses include REQUESTED and PARTIALLY_ISSUED", () => {
    assert.ok(STORE_ISSUE_STATUSES.includes("REQUESTED"));
    assert.ok(STORE_ISSUE_STATUSES.includes("PARTIALLY_ISSUED"));
    assert.equal(STORE_ISSUE_STATUSES.includes("DRAFT"), false);
  });

  it("computes free stock after reserving stock for other open PMRs", () => {
    assert.deepEqual(
      computeFreeStoreStockLine({ totalStoreStock: 10400, reservedForOtherOrdersQty: 10400 }),
      { totalStoreStock: 10400, reservedForOtherOrdersQty: 10400, freeStoreStock: 0 },
    );
    assert.deepEqual(
      computeFreeStoreStockLine({ totalStoreStock: 10400, reservedForOtherOrdersQty: 9000 }),
      { totalStoreStock: 10400, reservedForOtherOrdersQty: 9000, freeStoreStock: 1400 },
    );
    assert.deepEqual(
      computeFreeStoreStockLine({ totalStoreStock: 1000, reservedForOtherOrdersQty: 1500 }),
      { totalStoreStock: 1000, reservedForOtherOrdersQty: 1500, freeStoreStock: 0 },
    );
  });

  it("derives reserved quantities from pending lines on other open PMRs", async () => {
    const db = {
      item: {
        findMany: async (query) => query.where.id.in.map((id) => ({ id, itemType: "RM", unit: "KG" })),
      },
      location: {
        findFirst: async () => ({ id: 1 }),
        findMany: async () => [],
      },
      stockTransaction: {
        groupBy: async () => [],
      },
      productionMaterialRequestLine: {
        findMany: async (query) => {
          assert.deepEqual(query.where.itemId.in, [10, 20]);
          assert.deepEqual(query.where.productionMaterialRequest.status.in, STORE_ISSUE_STATUSES);
          assert.deepEqual(query.where.productionMaterialRequest.id, { not: 7 });
          assert.deepEqual(query.where.productionMaterialRequest.materialAllocations, { none: {} });
          return [
            { itemId: 10, requiredQty: 5000, issuedQty: 1000, productionMaterialRequest: { id: 1, status: "REQUESTED" } },
            { itemId: 10, requiredQty: 3000, issuedQty: 3000, productionMaterialRequest: { id: 2, status: "REQUESTED" } },
            { itemId: 20, requiredQty: 2500, issuedQty: 500, productionMaterialRequest: { id: 3, status: "PARTIALLY_ISSUED" } },
          ];
        },
      },
      materialAllocation: {
        findMany: async () => [],
      },
      rmPurchaseOrder: {
        findMany: async () => [],
      },
    };

    const reserved = await loadReservedForOtherOpenPmrsByItem(db, {
      itemIds: [10, 20, 10],
      excludePmrId: 7,
    });

    assert.equal(reserved.get(10), 4000);
    assert.equal(reserved.get(20), 2000);
  });

  it("PMR issue context returns central read-only availability fields without changing legacy aliases", async () => {
    const db = {
      workOrder: {
        findUnique: async () => ({
          id: 22,
          docNo: "WO-22",
          status: "PENDING",
          salesOrder: { orderType: "NO_QTY", id: 1, docNo: "SO-22" },
          lines: [],
        }),
      },
      productionEntry: {
        groupBy: async () => [],
        findMany: async () => [],
      },
      materialIssueNote: {
        findMany: async () => [],
      },
      materialReturnNote: {
        findMany: async () => [],
      },
      productionMaterialRequest: {
        findUnique: async (query) => {
          if (query.select) {
            return {
              workOrder: {
                salesOrder: { orderType: "NO_QTY" },
                lines: [{ fgItem: { itemName: "Nozzle" } }],
              },
            };
          }
          return {
            id: 7,
            docNo: "PMR-7",
            status: "REQUESTED",
            remarks: null,
            workOrderId: 22,
            workOrder: { docNo: "WO-22", salesOrder: { docNo: "SO-22" } },
            createdAt: new Date("2026-05-01T00:00:00Z"),
            updatedAt: new Date("2026-05-01T00:00:00Z"),
            lines: [
              {
                id: 70,
                itemId: 10,
                item: { id: 10, itemName: "HDPE", unit: "KG" },
                requiredQty: 100,
                issuedQty: 20,
                unitSnapshot: "KG",
              },
            ],
            materialIssueNotes: [],
          };
        },
      },
      item: {
        findMany: async () => [{ id: 10, itemType: "RM", itemName: "HDPE", unit: "KG" }],
      },
      productionMaterialRequestLine: {
        findMany: async () => [{ itemId: 10, requiredQty: 40, issuedQty: 0 }],
      },
      rmPurchaseOrder: {
        findMany: async () => [
          {
            lines: [
              { itemId: 10, qty: 60, grnLines: [] },
            ],
          },
        ],
      },
      location: {
        findMany: async () => [{ id: 3 }],
      },
      stockTransaction: {
        groupBy: async (query) => {
          if (query.by.includes("stockBucket")) return [];
          if (query.where.locationId && query.where.locationId.in) {
            return [{ itemId: 10, _sum: { qtyIn: 12, qtyOut: 0 } }];
          }
          return [{ itemId: 10, _sum: { qtyIn: 100, qtyOut: 0 } }];
        },
      },
    };

    const ctx = await buildPmrIssueContext(7, 1, db);
    const line = ctx.lines[0];

    assert.equal(line.physicalUsableStockQty, 100);
    assert.equal(line.legacyReservedQty, 40);
    assert.equal(line.freeStockQty, 60);
    assert.equal(line.incomingQty, 60);
    assert.equal(line.issuedToProductionQty, 12);
    assert.equal(line.shortageAfterReservationQty, 20);
    assert.equal(line.totalStoreStock, 100);
    assert.equal(line.reservedForOtherOrdersQty, 40);
    assert.equal(line.freeStoreStock, 60);
    assert.equal(line.availableStoreQty, 60);
    assert.equal(line.available, 60);
  });

  it("ensures an existing draft PMR using a transaction client without starting a nested transaction", async () => {
    const calls = { updated: 0 };
    const tx = {
      workOrder: {
        findUnique: async () => ({
          id: 22,
          salesOrderId: 1,
          cycleId: 1,
          requirementSheetId: null,
          salesOrder: { orderType: "REGULAR" },
        }),
      },
      productionMaterialRequest: {
        findFirst: async (query) => {
          if (query.where.status === "DRAFT") return { id: 7 };
          return null;
        },
        findUnique: async (query) => {
          if (query.include?.lines && !query.include?.workOrder) {
            return { id: 7, docNo: "PMR-7", status: "DRAFT", lines: [{ id: 1 }] };
          }
          return {
            id: 7,
            docNo: "PMR-7",
            status: "REQUESTED",
            remarks: null,
            workOrderId: 22,
            workOrder: { docNo: "WO-22", salesOrder: { docNo: "SO-22" } },
            createdAt: new Date("2026-05-01T00:00:00Z"),
            updatedAt: new Date("2026-05-01T00:00:00Z"),
            lines: [],
            materialIssueNotes: [],
          };
        },
        update: async () => {
          calls.updated += 1;
        },
      },
    };

    const pmr = await ensureSubmittedProductionMaterialRequestForWorkOrder(22, {}, tx);

    assert.equal(pmr.id, 7);
    assert.equal(pmr.status, "REQUESTED");
    assert.equal(calls.updated, 1);
  });

  it("is idempotent — returns the existing submitted PMR without creating or submitting another", async () => {
    const calls = { created: 0, updated: 0 };
    const db = {
      workOrder: {
        findUnique: async () => ({
          id: 22,
          salesOrderId: 1,
          cycleId: 1,
          requirementSheetId: null,
          salesOrder: { orderType: "REGULAR" },
        }),
      },
      productionMaterialRequest: {
        findFirst: async (query) => {
          // First lookup is for an already-submitted (store-visible) PMR.
          if (query.where.status?.in) {
            assert.deepEqual(query.where.status.in, STORE_ISSUE_STATUSES);
            return { id: 9 };
          }
          return null;
        },
        findUnique: async () => ({
          id: 9,
          docNo: "PMR-9",
          status: "REQUESTED",
          remarks: null,
          workOrderId: 22,
          workOrder: { docNo: "WO-22", salesOrder: { docNo: "SO-22" } },
          createdAt: new Date("2026-05-01T00:00:00Z"),
          updatedAt: new Date("2026-05-01T00:00:00Z"),
          lines: [],
          materialIssueNotes: [],
        }),
        create: async () => {
          calls.created += 1;
          return {};
        },
        update: async () => {
          calls.updated += 1;
        },
      },
    };

    const pmr = await ensureSubmittedProductionMaterialRequestForWorkOrder(22, {}, db);

    assert.equal(pmr.id, 9);
    assert.equal(pmr.status, "REQUESTED");
    assert.equal(calls.created, 0);
    assert.equal(calls.updated, 0);
  });
});
