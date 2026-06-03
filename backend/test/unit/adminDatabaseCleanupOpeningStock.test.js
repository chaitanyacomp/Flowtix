const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

describe("Reset Transaction Data — opening stock revert (Option B)", () => {
  it("revertApprovedOpeningStockAfterLedgerWipe demotes APPROVED rows only", async () => {
    const updates = [];
    const tx = {
      openingStockEntry: {
        updateMany: async (args) => {
          updates.push(args);
          return { count: 2 };
        },
        count: async (args) => {
          if (args?.where?.status === "APPROVED") return 0;
          return 3;
        },
      },
    };

    const revertApprovedOpeningStockAfterLedgerWipe = async (db) =>
      db.openingStockEntry.updateMany({
        where: { status: "APPROVED" },
        data: {
          status: "DRAFT",
          approvedAt: null,
          approvedByUserId: null,
        },
      });

    const res = await revertApprovedOpeningStockAfterLedgerWipe(tx);
    assert.equal(res.count, 2);
    assert.deepEqual(updates[0].where, { status: "APPROVED" });
    assert.equal(updates[0].data.status, "DRAFT");
    assert.equal(updates[0].data.approvedAt, null);
    assert.equal(updates[0].data.approvedByUserId, null);

    const remainingApproved = await tx.openingStockEntry.count({ where: { status: "APPROVED" } });
    assert.equal(remainingApproved, 0);
  });
});
