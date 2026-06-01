const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mapCommercialViewToSalesBillSnapshots,
  gstModeFromCompanyVsPos,
  resolvePlaceOfSupply,
} = require("../../src/services/salesOrderCommercialAddress");

test("mapCommercialViewToSalesBillSnapshots copies Bill To / Ship To / POS", () => {
  const out = mapCommercialViewToSalesBillSnapshots({
    resolvedBillTo: {
      name: "Acme Pvt Ltd",
      address: "Registered Office, Pune",
      gstin: "27AABCU9603R1ZM",
      stateName: "Maharashtra",
      stateCode: "27",
    },
    resolvedShipTo: {
      label: "Nashik Plant",
      address: "MIDC Nashik",
      gstin: "27AABCU9603R1ZM",
      stateName: "Maharashtra",
      stateCode: "27",
    },
    resolvedPOS: {
      stateName: "Maharashtra",
      stateCode: "27",
      source: "SHIP_TO",
      gstMode: "LOCAL",
    },
  });

  assert.equal(out.customerNameSnapshot, "Acme Pvt Ltd");
  assert.equal(out.billToAddressSnapshot, "Registered Office, Pune");
  assert.equal(out.billToGstinSnapshot, "27AABCU9603R1ZM");
  assert.equal(out.shipToLabelSnapshot, "Nashik Plant");
  assert.equal(out.shipToAddressSnapshot, "MIDC Nashik");
  assert.equal(out.posStateCodeSnapshot, "27");
  assert.equal(out.posSourceSnapshot, "SHIP_TO");
});

test("mapCommercialViewToSalesBillSnapshots handles null view safely", () => {
  const out = mapCommercialViewToSalesBillSnapshots(null);
  assert.equal(out.customerNameSnapshot, "");
  assert.equal(out.shipToLabelSnapshot, "");
  assert.equal(out.posStateCodeSnapshot, "");
});

test("resolvePlaceOfSupply prefers ship-to state over bill-to", () => {
  const pos = resolvePlaceOfSupply({
    shipTo: { stateCode: "24", stateName: "Gujarat" },
    billTo: { stateCode: "27", stateName: "Maharashtra" },
  });
  assert.equal(pos.stateCode, "24");
  assert.equal(pos.source, "SHIP_TO");
});

test("gstModeFromCompanyVsPos returns LOCAL vs INTERSTATE", () => {
  assert.equal(gstModeFromCompanyVsPos({ companyStateCode: "27", posStateCode: "27" }), "LOCAL");
  assert.equal(gstModeFromCompanyVsPos({ companyStateCode: "27", posStateCode: "24" }), "INTERSTATE");
  assert.equal(gstModeFromCompanyVsPos({ companyStateCode: null, posStateCode: "27" }), null);
});
