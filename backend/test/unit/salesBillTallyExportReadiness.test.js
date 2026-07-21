const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assessSalesBillTallyExportReadiness,
  buildSalesBillTallyMasterReferences,
  MAPPING_STATUS,
} = require("../../src/services/salesBillTallyExportReadiness");
const { mapSalesBillToTallyExportPayload } = require("../../src/services/salesBillTallyExportPayload");

const companyState = {
  companyGstin: "27AABCD1234E1Z5",
  companyStateRef: { stateName: "Maharashtra", stateCode: "27" },
  tallyTransportationLedger: "Freight Outward",
};

function baseBill(overrides = {}) {
  return {
    id: 101,
    billNo: "SB-26-0001",
    billDate: new Date("2026-05-27T00:00:00.000Z"),
    customerId: 5,
    dispatchId: 20,
    dispatchNoSnapshot: "DISP-20",
    soIdSnapshot: 12,
    cycleId: null,
    totalBasic: "1000.00",
    totalCgst: "90.00",
    totalSgst: "90.00",
    totalIgst: "0.00",
    totalTax: "180.00",
    netAmount: "1180.00",
    roundOffAmount: "0.00",
    transportationAmount: "0.00",
    transportationTaxableValue: "0.00",
    transportationChargedBy: "OUR_COMPANY",
    customerNameSnapshot: "Acme Pvt Ltd",
    customerStateNameSnapshot: "Maharashtra",
    customerStateCodeSnapshot: "27",
    billToAddressSnapshot: "Pune",
    billToGstinSnapshot: "27AABCU9603R1ZM",
    shipToLabelSnapshot: "",
    shipToAddressSnapshot: "",
    shipToGstinSnapshot: "",
    shipToStateNameSnapshot: "",
    shipToStateCodeSnapshot: "",
    posStateNameSnapshot: "Maharashtra",
    posStateCodeSnapshot: "27",
    posSourceSnapshot: "BILL_TO",
    customer: {
      id: 5,
      name: "Acme Pvt Ltd",
      tallyName: "Acme Pvt Ltd",
      tallyGuid: "guid-1",
      gst: "27AABCU9603R1ZM",
      address: "Pune",
      stateRef: { stateName: "Maharashtra", stateCode: "27" },
    },
    dispatch: { soId: 12, cycleId: null, salesOrder: { orderType: "NORMAL" } },
    lines: [
      {
        itemId: 1,
        itemNameSnapshot: "Widget",
        hsnCodeSnapshot: "1234",
        unitSnapshot: "Nos",
        qty: "10",
        rate: "100",
        basicAmount: "1000.00",
        gstRate: "18",
        cgstAmount: "90.00",
        sgstAmount: "90.00",
        igstAmount: "0.00",
        lineTotal: "1180.00",
        item: {
          itemName: "Widget",
          tallyName: "Widget",
          tallyGuid: "item-guid",
          tallyImportedAt: new Date(),
          hsnCode: "1234",
          unit: "Nos",
          unitRef: { unitName: "Nos", tallyName: "Nos" },
        },
      },
    ],
    ...overrides,
  };
}

test("assessSalesBillTallyExportReadiness — ready when masters resolve", () => {
  const payload = mapSalesBillToTallyExportPayload({ bill: baseBill(), companyState });
  const readiness = assessSalesBillTallyExportReadiness(payload);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.status, "READY");
  assert.ok(Array.isArray(readiness.masterReferences));
  assert.ok(readiness.masterReferences.some((r) => r.type === "PARTY_LEDGER"));
  assert.ok(readiness.masterReferences.some((r) => r.type === "STOCK_ITEM"));
  assert.ok(readiness.masterReferences.some((r) => r.type === "SALES_LEDGER"));
  assert.ok(readiness.masterReferences.some((r) => r.type === "CGST_LEDGER"));
});

test("buildSalesBillTallyMasterReferences — blocks missing party ledger", () => {
  const payload = mapSalesBillToTallyExportPayload({
    bill: baseBill({
      customerNameSnapshot: "",
      customer: { id: 5, name: "", gst: null, address: null, stateRef: null },
    }),
    companyState,
  });
  const refs = buildSalesBillTallyMasterReferences(payload);
  const party = refs.find((r) => r.type === "PARTY_LEDGER");
  assert.equal(party.mappingStatus, MAPPING_STATUS.MISSING);
  const readiness = assessSalesBillTallyExportReadiness(payload);
  assert.equal(readiness.ready, false);
});
