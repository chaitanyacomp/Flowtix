const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mapPurchaseBillToTallyExportPayload,
  resolvePurchaseBillCommercialForTallyExport,
} = require("../../src/services/purchaseBillTallyExportPayload");
const { buildPurchaseBillTallyXml, buildCommercialVoucherXml, buildPurchaseBillTallyBulkXml } = require("../../src/services/purchaseBillTallyXml");

const companyState = {
  companyGstin: "27AABCD1234E1Z5",
  companyStateRef: { stateName: "Maharashtra", stateCode: "27" },
};

function baseLine(overrides = {}) {
  return {
    itemId: 1,
    itemNameSnapshot: "RM Steel",
    hsnCodeSnapshot: "7208",
    unitSnapshot: "Kg",
    qty: "100",
    rate: "10",
    basicAmount: "1000.00",
    gstRate: "18",
    cgstAmount: "90.00",
    sgstAmount: "90.00",
    igstAmount: "0.00",
    lineTotal: "1180.00",
    item: { itemName: "RM Steel", hsnCode: "7208", unit: "Kg" },
    ...overrides,
  };
}

function baseBill(overrides = {}) {
  return {
    id: 501,
    billNo: "INV-501",
    billDate: new Date("2026-05-27T00:00:00.000Z"),
    supplierId: 9,
    grnId: 40,
    totalBasic: "1000.00",
    totalCgst: "90.00",
    totalSgst: "90.00",
    totalIgst: "0.00",
    totalTax: "180.00",
    netAmount: "1180.00",
    supplierStateSnapshot: "Maharashtra",
    supplierStateCodeSnapshot: "27",
    supplierNameSnapshot: "Acme Supplies Pvt Ltd",
    supplierRegisteredGstinSnapshot: "27AAECC1234F1Z5",
    supplierRegisteredAddressSnapshot: "Registered Office\nPune 411001",
    supplierRegisteredStateNameSnapshot: "Maharashtra",
    supplierRegisteredStateCodeSnapshot: "27",
    supplyLocationLabelSnapshot: "Mumbai Depot",
    supplyLocationAddressSnapshot: "Andheri East\n400069",
    supplyLocationGstinSnapshot: "27AAECC1234F1Z5",
    supplyLocationStateNameSnapshot: "Maharashtra",
    supplyLocationStateCodeSnapshot: "27",
    purchaseSourceStateNameSnapshot: "Maharashtra",
    purchaseSourceStateCodeSnapshot: "27",
    purchaseSourceSnapshot: "SUPPLY_LOCATION",
    purchaseGstModeSnapshot: "LOCAL",
    supplier: {
      id: 9,
      name: "Acme Live Supplier Name",
      gst: "27LIVEGST0000",
      address: "Live supplier address",
      stateRef: { stateName: "Maharashtra", stateCode: "27" },
    },
    lines: [baseLine()],
    ...overrides,
  };
}

test("resolvePurchaseBillCommercialForTallyExport prefers frozen snapshots over live supplier", () => {
  const commercial = resolvePurchaseBillCommercialForTallyExport(baseBill(), baseBill().supplier);
  assert.equal(commercial.partyName, "Acme Supplies Pvt Ltd");
  assert.equal(commercial.registeredSupplier.gstin, "27AAECC1234F1Z5");
  assert.equal(commercial.registeredSupplier.address.includes("Registered Office"), true);
  assert.equal(commercial.supplyFrom.label, "Mumbai Depot");
  assert.equal(commercial.purchaseSource.stateCode, "27");
});

test("resolvePurchaseBillCommercialForTallyExport falls back for legacy bill", () => {
  const bill = baseBill({
    supplierNameSnapshot: "",
    supplierRegisteredGstinSnapshot: "",
    supplierRegisteredAddressSnapshot: "",
    supplierRegisteredStateNameSnapshot: "",
    supplierRegisteredStateCodeSnapshot: "",
    supplyLocationLabelSnapshot: "",
    supplyLocationAddressSnapshot: "",
    supplyLocationGstinSnapshot: "",
    supplyLocationStateNameSnapshot: "",
    supplyLocationStateCodeSnapshot: "",
    purchaseSourceStateNameSnapshot: "",
    purchaseSourceStateCodeSnapshot: "",
    purchaseSourceSnapshot: "",
    purchaseGstModeSnapshot: "",
  });
  const commercial = resolvePurchaseBillCommercialForTallyExport(bill, bill.supplier);
  assert.equal(commercial.partyName, "Acme Live Supplier Name");
  assert.equal(commercial.registeredSupplier.gstin, "27LIVEGST0000");
  assert.equal(commercial.supplyFrom.sameAsRegistered, true);
  assert.equal(commercial.purchaseSource.stateCode, "27");
});

test("mapPurchaseBillToTallyExportPayload — same-state uses local purchase ledger", () => {
  const payload = mapPurchaseBillToTallyExportPayload({ bill: baseBill(), companyState });
  assert.equal(payload.supplier.supplierName, "Acme Supplies Pvt Ltd");
  assert.equal(payload.supplier.supplierGstin, "27AAECC1234F1Z5");
  assert.equal(payload.tax.taxIntraState, true);
  assert.equal(payload.tally.ledgers.purchase, "Local Purchase @18%");
  assert.equal(payload.tally.ledgers.igst, null);
  assert.equal(payload.purchaseSource.stateCode, "27");
});

test("mapPurchaseBillToTallyExportPayload — out-of-state supply location uses interstate ledger", () => {
  const bill = baseBill({
    supplyLocationLabelSnapshot: "Ahmedabad Plant",
    supplyLocationStateNameSnapshot: "Gujarat",
    supplyLocationStateCodeSnapshot: "24",
    supplyLocationGstinSnapshot: "24AABCU9603R1ZM",
    purchaseSourceStateNameSnapshot: "Gujarat",
    purchaseSourceStateCodeSnapshot: "24",
    purchaseGstModeSnapshot: "INTERSTATE",
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
  const payload = mapPurchaseBillToTallyExportPayload({ bill, companyState });
  assert.equal(payload.tax.taxIntraState, false);
  assert.equal(payload.tally.ledgers.purchase, "Interstate Purchase @18%");
  assert.equal(payload.tally.ledgers.igst, "Input IGST @18%");
  assert.equal(payload.purchaseSource.stateCode, "24");
  assert.equal(payload.purchaseTaxBasis, "PURCHASE_SOURCE_SNAPSHOT");
});

test("mapPurchaseBillToTallyExportPayload — registered vs supply state differ for tax basis", () => {
  const bill = baseBill({
    supplierRegisteredStateNameSnapshot: "Maharashtra",
    supplierRegisteredStateCodeSnapshot: "27",
    supplierStateSnapshot: "Maharashtra",
    supplierStateCodeSnapshot: "27",
    supplyLocationStateNameSnapshot: "Gujarat",
    supplyLocationStateCodeSnapshot: "24",
    purchaseSourceStateNameSnapshot: "Gujarat",
    purchaseSourceStateCodeSnapshot: "24",
    purchaseGstModeSnapshot: "INTERSTATE",
    totalCgst: "0.00",
    totalSgst: "0.00",
    totalIgst: "180.00",
    lines: [baseLine({ cgstAmount: "0.00", sgstAmount: "0.00", igstAmount: "180.00" })],
  });
  const payload = mapPurchaseBillToTallyExportPayload({ bill, companyState });
  assert.equal(payload.supplier.supplierStateCode, "27");
  assert.equal(payload.purchaseSource.stateCode, "24");
  assert.equal(payload.tax.taxIntraState, false);
});

test("frozen GST remains on export after live supplier GST would differ", () => {
  const bill = baseBill({
    supplier: {
      id: 9,
      name: "Acme Live Supplier Name",
      gst: "27EDITEDGST9999",
      address: "Changed address",
      stateRef: { stateName: "Gujarat", stateCode: "24" },
    },
  });
  const payload = mapPurchaseBillToTallyExportPayload({ bill, companyState });
  assert.equal(payload.supplier.supplierGstin, "27AAECC1234F1Z5");
  assert.equal(payload.supplier.supplierName, "Acme Supplies Pvt Ltd");
  assert.equal(payload.supplier.supplierStateCode, "27");
});

test("buildCommercialVoucherXml includes supplier, POS, and supply-from tags", () => {
  const payload = mapPurchaseBillToTallyExportPayload({ bill: baseBill(), companyState });
  const xml = buildCommercialVoucherXml(payload);
  assert.match(xml, /<PARTYNAME>Acme Supplies Pvt Ltd<\/PARTYNAME>/);
  assert.match(xml, /<PARTYGSTIN>27AAECC1234F1Z5<\/PARTYGSTIN>/);
  assert.match(xml, /<BASICBUYERADDRESS>Registered Office<\/BASICBUYERADDRESS>/);
  assert.match(xml, /<STATENAME>Maharashtra<\/STATENAME>/);
  assert.match(xml, /<PLACEOFSUPPLY>Maharashtra<\/PLACEOFSUPPLY>/);
  assert.match(xml, /<DISPATCHFROMNAME>Mumbai Depot<\/DISPATCHFROMNAME>/);
  assert.match(xml, /<DISPATCHFROMGSTIN>27AAECC1234F1Z5<\/DISPATCHFROMGSTIN>/);
});

test("buildCommercialVoucherXml omits dispatch block for legacy bill without supply snapshots", () => {
  const bill = baseBill({
    supplyLocationLabelSnapshot: "",
    supplyLocationAddressSnapshot: "",
    supplyLocationGstinSnapshot: "",
    supplyLocationStateNameSnapshot: "",
    supplyLocationStateCodeSnapshot: "",
  });
  const payload = mapPurchaseBillToTallyExportPayload({ bill, companyState });
  const xml = buildCommercialVoucherXml(payload);
  assert.doesNotMatch(xml, /DISPATCHFROMNAME/);
  assert.match(xml, /<PARTYGSTIN>27AAECC1234F1Z5<\/PARTYGSTIN>/);
});

test("buildPurchaseBillTallyXml — party ledger remains supplier legal name", () => {
  const payload = mapPurchaseBillToTallyExportPayload({ bill: baseBill(), companyState });
  const xml = buildPurchaseBillTallyXml(payload);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<VOUCHER VCHTYPE="Purchase" ACTION="Create">/);
  assert.match(xml, /<PARTYLEDGERNAME>Acme Supplies Pvt Ltd<\/PARTYLEDGERNAME>/);
  assert.match(xml, /<PLACEOFSUPPLY>Maharashtra<\/PLACEOFSUPPLY>/);
  assert.match(xml, /<LEDGERNAME>Local Purchase @18%<\/LEDGERNAME>/);
  assert.doesNotMatch(xml, /Mumbai Depot<\/LEDGERNAME>/);
  assert.doesNotMatch(xml, /GST Total \(Info\)/i);
});

test("buildPurchaseBillTallyXml — legacy bill without new snapshots still exports", () => {
  const bill = baseBill({
    supplierNameSnapshot: "",
    supplierRegisteredGstinSnapshot: "",
    supplierRegisteredAddressSnapshot: "",
    supplierRegisteredStateNameSnapshot: "",
    supplierRegisteredStateCodeSnapshot: "",
    supplyLocationLabelSnapshot: "",
    supplyLocationAddressSnapshot: "",
    supplyLocationGstinSnapshot: "",
    supplyLocationStateNameSnapshot: "",
    supplyLocationStateCodeSnapshot: "",
    purchaseSourceStateNameSnapshot: "",
    purchaseSourceStateCodeSnapshot: "",
    purchaseSourceSnapshot: "",
    purchaseGstModeSnapshot: "",
  });
  const payload = mapPurchaseBillToTallyExportPayload({ bill, companyState });
  assert.equal(payload.supplier.supplierName, "Acme Live Supplier Name");
  assert.equal(payload.supplier.supplierGstin, "27LIVEGST0000");
  const xml = buildPurchaseBillTallyXml(payload);
  assert.match(xml, /<PARTYLEDGERNAME>Acme Live Supplier Name<\/PARTYLEDGERNAME>/);
});

test("buildPurchaseBillTallyBulkXml — combines multiple vouchers in one envelope", () => {
  const payloadA = mapPurchaseBillToTallyExportPayload({ bill: baseBill({ id: 501, billNo: "INV-A" }), companyState });
  const payloadB = mapPurchaseBillToTallyExportPayload({
    bill: baseBill({ id: 502, billNo: "INV-B", lines: [baseLine({ itemNameSnapshot: "RM Copper", item: { itemName: "RM Copper", hsnCode: "7208", unit: "Kg" } })] }),
    companyState,
  });
  const xml = buildPurchaseBillTallyBulkXml([payloadA, payloadB]);
  assert.match(xml, /<TALLYMESSAGE>/);
  assert.equal((xml.match(/<TALLYMESSAGE>/g) || []).length, 2);
  assert.match(xml, /INV-A/);
  assert.match(xml, /INV-B/);
});
