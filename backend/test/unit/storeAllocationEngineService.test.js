const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { allocateForWorkOrder, releaseForWorkOrder } = require("../../src/services/storeAllocationEngineService");

function makeDb({ wo, pmr, pmrLines, existingAllocs = [], allocRow = null } = {}) {
  const calls = { create: [], update: [], findMany: 0 };
  const tx = {
    workOrder: {
      findUnique: async () => wo,
    },
    productionMaterialRequest: {
      findUnique: async () => ({ ...(pmr || { id: 100 }), lines: pmrLines || [] }),
    },
    materialAllocation: {
      findMany: async () => {
        calls.findMany += 1;
        return existingAllocs;
      },
      create: async (args) => {
        calls.create.push(args);
        return { id: 1, ...args.data };
      },
      update: async (args) => {
        calls.update.push(args);
        return { id: args.where.id, ...args.data };
      },
      findUnique: async () => allocRow,
      findFirst: async () => allocRow,
    },
  };
  const db = {
    $transaction: async (fn) => fn(tx),
    // for ensurePmr, mocked in deps
  };
  return { db, calls };
}

describe("storeAllocationEngineService.allocateForWorkOrder", () => {
  it("rejects qty > free stock", async () => {
    const { db } = makeDb({
      wo: { id: 1, status: "PENDING", salesOrder: { id: 9, orderType: "REGULAR" } },
      pmr: { id: 100 },
      pmrLines: [{ itemId: 55, requiredQty: "10", issuedQty: "0" }],
    });

    const ensurePmr = async () => ({ id: 100 });
    const availability = async () => [{ freeStockQty: 5 }];
    await assert.rejects(
      () =>
        allocateForWorkOrder(
          { workOrderId: 1, rmItemId: 55, qty: 6 },
          { userId: 1 },
          db,
          {
            ensureSubmittedProductionMaterialRequestForWorkOrder: ensurePmr,
            getMaterialAvailabilityByItems: availability,
            refreshRmControlCenterCase: async () => ({ selectedDetail: { workOrder: { id: 1 } } }),
          },
        ),
      /Free stock is 5/,
    );
  });

  it("rejects qty > pending requirement", async () => {
    const { db } = makeDb({
      wo: { id: 1, status: "PENDING", salesOrder: { id: 9, orderType: "REGULAR" } },
      pmr: { id: 100 },
      pmrLines: [{ itemId: 55, requiredQty: "10", issuedQty: "9" }],
    });

    const ensurePmr = async () => ({ id: 100 });
    const availability = async () => [{ freeStockQty: 100 }];
    await assert.rejects(
      () =>
        allocateForWorkOrder(
          { workOrderId: 1, rmItemId: 55, qty: 2 },
          { userId: 1 },
          db,
          {
            ensureSubmittedProductionMaterialRequestForWorkOrder: ensurePmr,
            getMaterialAvailabilityByItems: availability,
            refreshRmControlCenterCase: async () => ({ selectedDetail: { workOrder: { id: 1 } } }),
          },
        ),
      /Pending requirement is 1/,
    );
  });

  it("creates MANUAL allocation when valid", async () => {
    const { db, calls } = makeDb({
      wo: { id: 1, status: "PENDING", salesOrder: { id: 9, orderType: "REGULAR" } },
      pmr: { id: 100 },
      pmrLines: [{ itemId: 55, requiredQty: "10", issuedQty: "0" }],
    });

    const ensurePmr = async () => ({ id: 100 });
    const availability = async () => [{ freeStockQty: 100 }];
    const out = await allocateForWorkOrder(
      { workOrderId: 1, rmItemId: 55, qty: 3, note: "ok" },
      { userId: 7 },
      db,
      {
        ensureSubmittedProductionMaterialRequestForWorkOrder: ensurePmr,
        getMaterialAvailabilityByItems: availability,
        refreshRmControlCenterCase: async () => ({ selectedDetail: { workOrder: { id: 1 } } }),
      },
    );

    assert.equal(out.pmrId, 100);
    assert.equal(calls.create.length, 1);
    assert.equal(calls.create[0].data.allocationType, "MANUAL");
    assert.equal(calls.create[0].data.qtyAllocated, "3");
    assert.equal(calls.create[0].data.createdByUserId, 7);
  });
});

describe("storeAllocationEngineService.releaseForWorkOrder", () => {
  it("rejects releasing more than unissued", async () => {
    const allocRow = {
      id: 5,
      status: "ACTIVE",
      allocationType: "MANUAL",
      workOrderId: 1,
      rmItemId: 55,
      qtyAllocated: "5",
      qtyIssued: "2",
      productionMaterialRequestId: 100,
    };
    const { db } = makeDb({ allocRow });
    await assert.rejects(
      () =>
        releaseForWorkOrder(
          { allocationId: 5, qty: 4 },
          { userId: 1 },
          db,
          { refreshRmControlCenterCase: async () => ({}) },
        ),
      /Unissued allocation is 3/,
    );
  });

  it("marks RELEASED when fully released and no issued qty", async () => {
    const allocRow = {
      id: 5,
      status: "ACTIVE",
      allocationType: "MANUAL",
      workOrderId: 1,
      rmItemId: 55,
      qtyAllocated: "5",
      qtyIssued: "0",
      productionMaterialRequestId: 100,
    };
    const { db, calls } = makeDb({ allocRow });
    await releaseForWorkOrder(
      { allocationId: 5, qty: 5, reason: "release" },
      { userId: 9 },
      db,
      { refreshRmControlCenterCase: async () => ({}) },
    );
    assert.equal(calls.update.length, 1);
    assert.equal(calls.update[0].data.status, "RELEASED");
    assert.equal(calls.update[0].data.releasedByUserId, 9);
  });
});

