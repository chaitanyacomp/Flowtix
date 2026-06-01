const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mapSalesBillToTallyExportPayload,
  resolveSalesBillCommercialForTallyExport,
} = require("../../src/services/salesBillTallyExportPayload");
const { buildSalesBillTallyXml, buildCommercialVoucherXml } = require("../../src/services/salesBillTallyXml");

const companyState = {
  companyGstin: "27AABCD1234E1Z5",
  companyStateRef: { stateName: "Maharashtra", stateCode: "27" },
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
    customerNameSnapshot: "Acme Pvt Ltd",
    customerStateNameSnapshot: "Maharashtra",
    customerStateCodeSnapshot: "27",
    billToAddressSnapshot: "Registered Office\nPune 411001",
    billToGstinSnapshot: "27AABCU9603R1ZM",
    shipToLabelSnapshot: "Nashik Plant",
    shipToAddressSnapshot: "MIDC Nashik\n422001",
    shipToGstinSnapshot: "27AABCU9603R1ZM",
    shipToStateNameSnapshot: "Maharashtra",
    shipToStateCodeSnapshot: "27",
    posStateNameSnapshot: "Maharashtra",
    posStateCodeSnapshot: "27",
    posSourceSnapshot: "SHIP_TO",
    customer: {
      id: 5,
      name: "Acme Live Name",
      gst: "27LIVEGST0000",
      address: "Live address",
      stateRef: { stateName: "Maharashtra", stateCode: "27" },
    },
    dispatch: { soId: 12, cycleId: null, salesOrder: { orderType: "NORMAL" } },
    lines: [baseLine()],
    ...overrides,
  };
}

test("resolveSalesBillCommercialForTallyExport prefers frozen snapshots over live customer", () => {
  const bill = baseBill();
  const commercial = resolveSalesBillCommercialForTallyExport(bill, bill.customer);
  assert.equal(commercial.billTo.name, "Acme Pvt Ltd");
  assert.equal(commercial.billTo.gstin, "27AABCU9603R1ZM");
  assert.equal(commercial.billTo.address.includes("Registered Office"), true);
  assert.equal(commercial.shipTo.label, "Nashik Plant");
  assert.equal(commercial.shipTo.sameAsBillTo, false);
  assert.equal(commercial.placeOfSupply.stateCode, "27");
});

test("resolveSalesBillCommercialForTallyExport falls back for legacy bill without ship-to snapshots", () => {
  const bill = baseBill({
    shipToLabelSnapshot: "",
    shipToAddressSnapshot: "",
    shipToGstinSnapshot: "",
    shipToStateNameSnapshot: "",
    shipToStateCodeSnapshot: "",
    posStateNameSnapshot: "",
    posStateCodeSnapshot: "",
    posSourceSnapshot: "",
    billToAddressSnapshot: "",
    billToGstinSnapshot: "",
  });
  const commercial = resolveSalesBillCommercialForTallyExport(bill, bill.customer);
  assert.equal(commercial.billTo.gstin, "27LIVEGST0000");
  assert.equal(commercial.billTo.address, "Live address");
  assert.equal(commercial.shipTo.sameAsBillTo, true);
  assert.equal(commercial.shipTo.label, "Same as Bill To");
  assert.equal(commercial.shipTo.stateCode, "27");
  assert.equal(commercial.placeOfSupply.stateCode, "27");
});

test("mapSalesBillToTallyExportPayload — same-state regular bill uses local sales ledger", () => {
  const payload = mapSalesBillToTallyExportPayload({ bill: baseBill(), companyState });
  assert.equal(payload.customer.customerName, "Acme Pvt Ltd");
  assert.equal(payload.customer.customerGstin, "27AABCU9603R1ZM");
  assert.equal(payload.tax.taxIntraState, true);
  assert.equal(payload.tally.ledgers.sales, "Local Sales @18%");
  assert.equal(payload.tally.ledgers.igst, null);
  assert.equal(payload.placeOfSupply.stateCode, "27");
});

test("mapSalesBillToTallyExportPayload — different-state ship-to uses interstate ledger", () => {
  const bill = baseBill({
    shipToStateNameSnapshot: "Gujarat",
    shipToStateCodeSnapshot: "24",
    posStateNameSnapshot: "Gujarat",
    posStateCodeSnapshot: "24",
    totalCgst: "0.00",
    totalSgst: "0.00",
    totalIgst: "180.00",
    lines: [
      baseLine({
        cgstAmount: "0.00",
        sgstAmount: "0.00",
        igstAmount: "180.00",
      }),
    ],
  });
  const payload = mapSalesBillToTallyExportPayload({ bill, companyState });
  assert.equal(payload.tax.taxIntraState, false);
  assert.equal(payload.tally.ledgers.sales, "Interstate Sales @18%");
  assert.equal(payload.tally.ledgers.igst, "Output IGST @18%");
  assert.equal(payload.placeOfSupply.stateCode, "24");
});

test("mapSalesBillToTallyExportPayload — NO_QTY bill with ship-to retains party ledger as customer", () => {
  const bill = baseBill({
    dispatch: { soId: 12, cycleId: 3, salesOrder: { orderType: "NO_QTY" } },
    cycleId: 3,
  });
  const payload = mapSalesBillToTallyExportPayload({ bill, companyState });
  assert.equal(payload.meta.orderType, "NO_QTY");
  assert.equal(payload.customer.customerName, "Acme Pvt Ltd");
  assert.equal(payload.shipTo.label, "Nashik Plant");
});

test("buildCommercialVoucherXml includes buyer, consignee, POS tags", () => {
  const payload = mapSalesBillToTallyExportPayload({ bill: baseBill(), companyState });
  const xml = buildCommercialVoucherXml(payload);
  assert.match(xml, /<PARTYNAME>Acme Pvt Ltd<\/PARTYNAME>/);
  assert.match(xml, /<PARTYGSTIN>27AABCU9603R1ZM<\/PARTYGSTIN>/);
  assert.match(xml, /<BASICBUYERADDRESS>Registered Office<\/BASICBUYERADDRESS>/);
  assert.match(xml, /<PLACEOFSUPPLY>Maharashtra<\/PLACEOFSUPPLY>/);
  assert.match(xml, /<CONSIGNEEMAILINGNAME>Nashik Plant<\/CONSIGNEEMAILINGNAME>/);
  assert.match(xml, /<CONSIGNEEGSTIN>27AABCU9603R1ZM<\/CONSIGNEEGSTIN>/);
  assert.match(xml, /<BASICFINALDESTINATION>MIDC Nashik<\/BASICFINALDESTINATION>/);
});

test("buildCommercialVoucherXml omits consignee block when ship-to same as bill-to", () => {
  const bill = baseBill({
    shipToLabelSnapshot: "",
    shipToAddressSnapshot: "",
    shipToGstinSnapshot: "",
    shipToStateNameSnapshot: "",
    shipToStateCodeSnapshot: "",
  });
  const payload = mapSalesBillToTallyExportPayload({ bill, companyState });
  const xml = buildCommercialVoucherXml(payload);
  assert.doesNotMatch(xml, /CONSIGNEEMAILINGNAME/);
  assert.match(xml, /<PARTYGSTIN>27AABCU9603R1ZM<\/PARTYGSTIN>/);
});

test("buildSalesBillTallyXml — party ledger remains customer and XML is structurally valid", () => {
  const payload = mapSalesBillToTallyExportPayload({ bill: baseBill(), companyState });
  const xml = buildSalesBillTallyXml(payload);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<VOUCHER VCHTYPE="Sales" ACTION="Create">/);
  assert.match(xml, /<PARTYLEDGERNAME>Acme Pvt Ltd<\/PARTYLEDGERNAME>/);
  assert.match(xml, /<PLACEOFSUPPLY>Maharashtra<\/PLACEOFSUPPLY>/);
  assert.match(xml, /<LEDGERNAME>Local Sales @18%<\/LEDGERNAME>/);
  assert.doesNotMatch(xml, /GST Total \(Info\)/i);
});

test("buildSalesBillTallyXml — legacy bill without snapshots still exports", () => {
  const bill = baseBill({
    customerNameSnapshot: "",
    customerStateNameSnapshot: "",
    customerStateCodeSnapshot: "",
    billToAddressSnapshot: "",
    billToGstinSnapshot: "",
    shipToLabelSnapshot: "",
    shipToAddressSnapshot: "",
    shipToGstinSnapshot: "",
    shipToStateNameSnapshot: "",
    shipToStateCodeSnapshot: "",
    posStateNameSnapshot: "",
    posStateCodeSnapshot: "",
    posSourceSnapshot: "",
  });
  const payload = mapSalesBillToTallyExportPayload({ bill, companyState });
  assert.equal(payload.customer.customerName, "Acme Live Name");
  assert.equal(payload.customer.customerGstin, "27LIVEGST0000");
  const xml = buildSalesBillTallyXml(payload);
  assert.match(xml, /<PARTYLEDGERNAME>Acme Live Name<\/PARTYLEDGERNAME>/);
});
