const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  sumAuthoritativeDispositionPendingByItem,
  NO_QTY_PENDING_DISPOSITION_STATUSES,
} = require("../../src/services/noQtyPostCycleApprovalService");

function mockPrismaWithStockNets(netsByDispId) {
  return {
    stockTransaction: {
      async groupBy({ where }) {
        const ids = where.qcRejectedDispositionId?.in || [];
        const bucket = where.stockBucket;
        return ids
          .filter((id) => netsByDispId.has(`${id}:${bucket}`))
          .map((id) => {
            const net = netsByDispId.get(`${id}:${bucket}`) || 0;
            return {
              qcRejectedDispositionId: id,
              _sum: { qtyIn: net > 0 ? net : 0, qtyOut: net < 0 ? -net : 0 },
            };
          });
      },
    },
  };
}

describe("sumAuthoritativeDispositionPendingByItem", () => {
  it("ignores stale remainingQty when rework stock is already zero", async () => {
    const prisma = mockPrismaWithStockNets(new Map([["10:REWORK", 0], ["10:QC_PENDING", 0]]));
    const byItem = await sumAuthoritativeDispositionPendingByItem(prisma, [
      { id: 10, itemId: 7, status: "REWORK_READY_FOR_QC", remainingQty: 898 },
    ]);
    assert.equal(byItem.get(7) ?? 0, 0);
  });

  it("counts stock-owned rework qty instead of remainingQty", async () => {
    const prisma = mockPrismaWithStockNets(new Map([["11:REWORK", 120], ["11:QC_PENDING", 30]]));
    const byItem = await sumAuthoritativeDispositionPendingByItem(prisma, [
      { id: 11, itemId: 7, status: "REWORK_READY_FOR_QC", remainingQty: 898 },
    ]);
    assert.equal(byItem.get(7), 150);
  });

  it("counts HOLD from QC_HOLD stock net", async () => {
    const prisma = mockPrismaWithStockNets(new Map([["12:QC_HOLD", 40]]));
    const byItem = await sumAuthoritativeDispositionPendingByItem(prisma, [
      { id: 12, itemId: 9, status: "HOLD", remainingQty: 40 },
    ]);
    assert.equal(byItem.get(9), 40);
  });

  it("exports expected pending disposition statuses", () => {
    assert.ok(NO_QTY_PENDING_DISPOSITION_STATUSES.includes("REWORK_READY_FOR_QC"));
    assert.ok(NO_QTY_PENDING_DISPOSITION_STATUSES.includes("HOLD"));
    assert.ok(!NO_QTY_PENDING_DISPOSITION_STATUSES.includes("CLOSED"));
  });
});
