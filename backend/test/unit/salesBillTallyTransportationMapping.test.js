const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mapSalesBillToTallyExportPayload,
} = require("../../src/services/salesBillTallyExportPayload");
const { buildSalesBillTallyXml } = require("../../src/services/salesBillTallyXml");
const {
  assessSalesBillTallyExportReadiness,
  formatMissingTransportationLedgerError,
  resolveConfiguredTransportationLedger,
} = require("../../src/services/salesBillTallyExportReadiness");

const companyState = {
  companyGstin: "27AABCD1234E1Z5",
  companyStateRef: { stateName: "Maharashtra", stateCode: "27" },
  tallyTransportationLedger: null,
};

function baseLine(overrides = {}) {
  return {
    itemId: 1,
    itemNameSnapshot: "Widget",
    hsnCodeSnapshot: "1234",
    unitSnapshot: "Nos",
    qty: "10",
    rate: "100",
    basicAmount: "1000.00",
    goodsTaxableAmount: "1000.00",
    gstRate: "18",
    cgstAmount: "90.00",
    sgstAmount: "90.00",
    igstAmount: "0.00",
    lineTotal: "1180.00",
    item: { itemName: "Widget", hsnCode: "1234", unit: "Nos" },
    ...overrides,
  };
}

function baseBill(overrides = {}) {
  return {
    id: 177,
    billNo: "SB-26-0001",
    billDate: new Date("2026-05-27T00:00:00.000Z"),
    customerId: 5,
    dispatchId: 20,
    dispatchNoSnapshot: "DISP-20",
    soIdSnapshot: 12,
    cycleId: null,
    totalBasic: "2500.00",
    totalCgst: "225.00",
    totalSgst: "225.00",
    totalIgst: "0.00",
    totalTax: "450.00",
    netAmount: "2950.00",
    transportationAmount: "1500.00",
    transportationTaxableValue: "1500.00",
    transportationChargedBy: "OUR_COMPANY",
    transporterName: "Swift Logistics",
    roundOffAmount: "0.00",
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
      gst: "27AABCU9603R1ZM",
      address: "Pune",
      stateRef: { stateName: "Maharashtra", stateCode: "27" },
    },
    dispatch: { soId: 12, cycleId: null, salesOrder: { orderType: "NORMAL" } },
    lines: [baseLine({ basicAmount: "1000.00", goodsTaxableAmount: "1000.00", cgstAmount: "90.00", sgstAmount: "90.00", lineTotal: "1180.00" })],
    ...overrides,
  };
}

test("resolveConfiguredTransportationLedger prefers AppSetting over env", () => {
  assert.equal(
    resolveConfiguredTransportationLedger({
      tallyTransportationLedger: "Freight Outward",
      envLedger: "Env Freight",
    }),
    "Freight Outward",
  );
  assert.equal(
    resolveConfiguredTransportationLedger({
      tallyTransportationLedger: null,
      envLedger: "Env Freight",
    }),
    "Env Freight",
  );
  assert.equal(resolveConfiguredTransportationLedger({}), null);
});

test("missing transportation mapping error names the charge and never only the sales-bill id", () => {
  const payload = mapSalesBillToTallyExportPayload({ bill: baseBill(), companyState });
  assert.equal(payload.transportation.ledger, null);
  const msg = formatMissingTransportationLedgerError(payload);
  assert.match(msg, /Transportation Charges is not mapped to a Tally ledger/);
  assert.match(msg, /SB-26-0001/);
  assert.match(msg, /₹1500\.00/);
  assert.match(msg, /Swift Logistics/);
  assert.doesNotMatch(msg, /mapping is missing for 177/);
  assert.doesNotMatch(msg, /^177$/m);
});

test("transportation included + missing mapping blocks readiness and XML", () => {
  const payload = mapSalesBillToTallyExportPayload({ bill: baseBill(), companyState });
  const readiness = assessSalesBillTallyExportReadiness(payload);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.status, "MISSING_TRANSPORTATION_LEDGER_MAPPING");
  assert.throws(() => buildSalesBillTallyXml(payload), /Transportation Charges is not mapped/);
});

test("transportation included + valid mapping downloads freight ledger in XML", () => {
  const payload = mapSalesBillToTallyExportPayload({
    bill: baseBill({
      totalBasic: "2500.00",
      totalCgst: "225.00",
      totalSgst: "225.00",
      totalTax: "450.00",
      netAmount: "2950.00",
      lines: [
        baseLine({
          basicAmount: "1000.00",
          goodsTaxableAmount: "1000.00",
          cgstAmount: "90.00",
          sgstAmount: "90.00",
          lineTotal: "1180.00",
        }),
      ],
    }),
    companyState: { ...companyState, tallyTransportationLedger: "Freight Outward" },
  });
  assert.equal(payload.transportation.ledger, "Freight Outward");
  // Align tax totals with goods+freight for voucher balance in this unit fixture.
  payload.tax.subtotal = "2500.00";
  payload.tax.totalCgst = "225.00";
  payload.tax.totalSgst = "225.00";
  payload.tax.totalIgst = "0.00";
  payload.tax.gstTotal = "450.00";
  payload.tax.totalAmount = "2950.00";
  payload.tax.roundOffAmount = "0.00";
  payload.lines[0].baseAmount = "1000.00";
  // Freight taxable 1500 + goods 1000 = 2500 taxable
  const xml = buildSalesBillTallyXml(payload);
  assert.match(xml, /<LEDGERNAME>Freight Outward<\/LEDGERNAME>/);
  assert.match(xml, /<AMOUNT>1500\.00<\/AMOUNT>/);
  assert.equal(assessSalesBillTallyExportReadiness(payload).ready, true);
});

test("mapping after finalization is picked up on retry without changing bill totals", () => {
  const bill = baseBill();
  const before = mapSalesBillToTallyExportPayload({ bill, companyState });
  assert.equal(before.tax.totalAmount, "2950.00");
  assert.equal(before.transportation.amount, "1500.00");
  assert.equal(before.transportation.ledger, null);

  const after = mapSalesBillToTallyExportPayload({
    bill,
    companyState: { ...companyState, tallyTransportationLedger: "Carriage Outward" },
  });
  assert.equal(after.tax.totalAmount, "2950.00");
  assert.equal(after.transportation.amount, "1500.00");
  assert.equal(after.transportation.ledger, "Carriage Outward");
  assert.notEqual(before.transportation.ledger, after.transportation.ledger);
});

test("Transporter Directly does not require freight ledger and does not emit freight ledger", () => {
  const bill = baseBill({
    transportationChargedBy: "TRANSPORTER_DIRECTLY",
    transportationTaxableValue: "0.00",
    transportationAmount: "1500.00",
    totalBasic: "1000.00",
    totalCgst: "90.00",
    totalSgst: "90.00",
    totalTax: "180.00",
    netAmount: "1180.00",
  });
  const payload = mapSalesBillToTallyExportPayload({ bill, companyState });
  assert.equal(Number(payload.transportation.taxableAmount), 0);
  const readiness = assessSalesBillTallyExportReadiness(payload);
  assert.equal(readiness.status, "READY");
  const xml = buildSalesBillTallyXml(payload);
  assert.doesNotMatch(xml, /Freight Outward|Transportation Charges|Carriage Outward/);
});

test("non-transport Sales Bill export remains unchanged when mapping is absent", () => {
  const bill = baseBill({
    transportationAmount: "0.00",
    transportationTaxableValue: "0.00",
    transportationChargedBy: "OUR_COMPANY",
    transporterName: null,
    totalBasic: "1000.00",
    totalCgst: "90.00",
    totalSgst: "90.00",
    totalTax: "180.00",
    netAmount: "1180.00",
  });
  const payload = mapSalesBillToTallyExportPayload({ bill, companyState });
  assert.equal(assessSalesBillTallyExportReadiness(payload).ready, true);
  const xml = buildSalesBillTallyXml(payload);
  assert.match(xml, /Local Sales @18%/);
  assert.doesNotMatch(xml, /Freight Outward/);
});
