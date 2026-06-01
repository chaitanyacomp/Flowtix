const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  createAllocationsForPmr,
  cancelAllocationsForPmr,
  syncAllocationsForPmrIssueStatus,
} = require("../../src/services/materialAllocationService");

function createAvailabilityTx({ physicalQty = 60, existingAllocations = [] } = {}) {
  const created = [];
  const updated = [];
  const tx = {
    stockTransaction: {
      groupBy: async (query) => {
        if (query.where.stockBucket === "USABLE" && query.where.itemId.in.includes(1)) {
          return [{ itemId: 1, locationId: null, _sum: { qtyIn: physicalQty, qtyOut: 0 } }];
        }
        return [];
      },
    },
    productionMaterialRequestLine: { findMany: async () => [] },
    rmPurchaseOrder: { findMany: async () => [] },
    location: {
      findFirst: async () => ({ id: 1 }),
      findMany: async () => [],
    },
    item: {
      findMany: async () => [{ id: 1, itemType: "RM", unit: "KG" }],
    },
    materialAllocation: {
      findMany: async (query) =>
        existingAllocations.filter((row) => {
          if (query.where.rmItemId?.in && !query.where.rmItemId.in.includes(row.rmItemId)) return false;
          if (query.where.productionMaterialRequestId?.not === row.productionMaterialRequestId) return false;
          if (query.where.productionMaterialRequestId && typeof query.where.productionMaterialRequestId === "number") {
            return row.productionMaterialRequestId === query.where.productionMaterialRequestId;
          }
          if (query.where.status?.in && !query.where.status.in.includes(row.status)) return false;
          return true;
        }),
      createMany: async ({ data }) => {
        created.push(...data);
        return { count: data.length };
      },
      updateMany: async ({ where, data }) => {
        updated.push({ where, data });
        return { count: 1 };
      },
      update: async ({ where, data }) => {
        updated.push({ where, data });
        return { id: where.id, ...data };
      },
    },
    productionMaterialRequest: {
      findUnique: async () => ({
        id: 11,
        status: "PARTIALLY_ISSUED",
        lines: [{ itemId: 1, requiredQty: 100, issuedQty: 25 }],
      }),
    },
    __created: created,
    __updated: updated,
  };
  return tx;
}

describe("materialAllocationService", () => {
  it("creates partial PMR allocations only for currently free stock", async () => {
    const tx = createAvailabilityTx({ physicalQty: 60 });
    const rows = await createAllocationsForPmr(
      tx,
      { id: 11, workOrderId: 21, salesOrderId: 31 },
      [{ itemId: 1, requiredQty: 100 }],
      { userId: 7 },
    );

    assert.equal(rows.length, 1);
    assert.equal(tx.__created.length, 1);
    assert.equal(tx.__created[0].allocationNo, "MAL-11-1");
    assert.equal(tx.__created[0].qtyAllocated, "60");
    assert.equal(tx.__created[0].allocationType, "PMR_CREATED");
    assert.equal(tx.__created[0].workOrderId, 21);
    assert.equal(tx.__created[0].salesOrderId, 31);
  });

  it("does not allocate incoming or production-only stock when no free store stock exists", async () => {
    const tx = createAvailabilityTx({ physicalQty: 0 });
    const rows = await createAllocationsForPmr(tx, { id: 12, workOrderId: 21 }, [{ itemId: 1, requiredQty: 50 }]);
    assert.deepEqual(rows, []);
    assert.equal(tx.__created.length, 0);
  });

  it("cancels active PMR allocations without deleting history", async () => {
    const tx = createAvailabilityTx();
    await cancelAllocationsForPmr(tx, 11, { userId: 9 });
    assert.equal(tx.__updated[0].data.status, "CANCELLED");
    assert.equal(tx.__updated[0].data.releasedByUserId, 9);
  });

  it("syncs allocation issue status from PMR line issued qty", async () => {
    const tx = createAvailabilityTx({
      existingAllocations: [{ id: 5, rmItemId: 1, productionMaterialRequestId: 11, qtyAllocated: 60, qtyIssued: 0, status: "ACTIVE" }],
    });
    await syncAllocationsForPmrIssueStatus(tx, 11);
    assert.equal(tx.__updated[0].data.qtyIssued, "25");
    assert.equal(tx.__updated[0].data.status, "PARTIALLY_ISSUED");
  });
});
