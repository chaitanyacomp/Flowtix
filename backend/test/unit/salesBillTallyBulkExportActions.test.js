const test = require("node:test");
const assert = require("node:assert/strict");
const { exportSalesBillsToTallyBulk } = require("../../src/services/salesBillTallyExportActions");

test("exportSalesBillsToTallyBulk — rejects empty selection", async () => {
  await assert.rejects(() => exportSalesBillsToTallyBulk({}, []), (err) => {
    assert.equal(err.statusCode, 400);
    assert.match(String(err.message), /at least one/i);
    return true;
  });
});

test("exportSalesBillsToTallyBulk — rejects already-exported bill (idempotent guard)", async () => {
  const prisma = {
    salesBill: {
      findUnique: async () => ({
        id: 9,
        billNo: "SB-9",
        docNo: null,
        status: "FINALIZED",
        cancelledAt: null,
        isExported: true,
        customer: { stateRef: { stateCode: "27" } },
        lines: [],
        dispatch: { salesOrder: { orderType: "NORMAL" } },
      }),
    },
    appSetting: {
      findUnique: async () => ({
        companyGstin: "27AABCD1234E1Z5",
        companyStateRef: { stateName: "Maharashtra", stateCode: "27" },
      }),
    },
  };

  await assert.rejects(() => exportSalesBillsToTallyBulk(prisma, [9]), (err) => {
    assert.equal(err.statusCode, 400);
    assert.match(String(err.message), /already been confirmed exported/i);
    return true;
  });
});
