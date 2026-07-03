const test = require("node:test");
const assert = require("node:assert/strict");
const {
  shipToSnapshotsEqual,
  readDispatchShipToFromBill,
  mapCustomerDeliveryAddressToShipTo,
  buildPosFromShipAndBillTo,
} = require("../../src/services/salesOrderCommercialAddress");

test("shipToSnapshotsEqual compares normalized ship-to fields", () => {
  const a = { label: "Plant A", address: "Addr", gstin: "27AAA", stateCode: "27", stateName: "MH" };
  const b = { label: "Plant A", address: "addr", gstin: "27aaa", stateCode: "27", stateName: "mh" };
  assert.equal(shipToSnapshotsEqual(a, b), true);
  assert.equal(shipToSnapshotsEqual(a, { ...b, stateCode: "24" }), false);
});

test("readDispatchShipToFromBill prefers dispatch snapshots", () => {
  const bill = {
    dispatchShipToLabelSnapshot: "Dispatch Site",
    dispatchShipToAddressSnapshot: "Warehouse 1",
    dispatchShipToStateCodeSnapshot: "27",
    shipToLabelSnapshot: "Invoice Site",
    shipToAddressSnapshot: "Office",
    shipToStateCodeSnapshot: "24",
  };
  const dispatch = readDispatchShipToFromBill(bill);
  assert.equal(dispatch.label, "Dispatch Site");
  assert.equal(dispatch.stateCode, "27");
});

test("mapCustomerDeliveryAddressToShipTo maps master row", () => {
  const ship = mapCustomerDeliveryAddressToShipTo({
    label: "Nashik",
    address: "MIDC",
    gst: "27AABCU9603R1ZM",
    stateRef: { stateName: "Maharashtra", stateCode: "27" },
  });
  assert.equal(ship.label, "Nashik");
  assert.equal(ship.stateCode, "27");
});

test("buildPosFromShipAndBillTo prefers ship-to state", () => {
  const pos = buildPosFromShipAndBillTo({
    shipTo: { stateCode: "24", stateName: "Gujarat" },
    billTo: { stateCode: "27", stateName: "Maharashtra" },
    companyStateCode: "27",
  });
  assert.equal(pos.stateCode, "24");
  assert.equal(pos.source, "SHIP_TO");
  assert.equal(pos.gstMode, "INTERSTATE");
});
