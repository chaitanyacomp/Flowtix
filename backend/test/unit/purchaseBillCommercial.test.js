const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mapPoCommercialToPurchaseBillSnapshots,
  resolvePurchaseBillIntraState,
  resolvePurchaseBillCommercialView,
  purchaseBillCommercialSnapshotsPresent,
  getPurchaseGstMode,
} = require("../../src/services/purchaseCommercialAddress");

test("mapPoCommercialToPurchaseBillSnapshots copies PO frozen fields", () => {
  const out = mapPoCommercialToPurchaseBillSnapshots({
    supplierNameSnapshot: "Acme Supplies",
    supplierRegisteredGstinSnapshot: "27AAECC1234F1Z5",
    supplierRegisteredAddressSnapshot: "Pune HO",
    supplierRegisteredStateNameSnapshot: "Maharashtra",
    supplierRegisteredStateCodeSnapshot: "27",
    supplyLocationLabelSnapshot: "Ahmedabad Plant",
    supplyLocationAddressSnapshot: "GIDC",
    supplyLocationGstinSnapshot: "24AABCU9603R1ZM",
    supplyLocationStateNameSnapshot: "Gujarat",
    supplyLocationStateCodeSnapshot: "24",
    purchaseSourceStateNameSnapshot: "Gujarat",
    purchaseSourceStateCodeSnapshot: "24",
    purchaseSourceSnapshot: "SUPPLY_LOCATION",
    purchaseGstModeSnapshot: "INTERSTATE",
    supplierStateSnapshot: "Maharashtra",
    supplierStateCodeSnapshot: "27",
  });
  assert.equal(out.supplierNameSnapshot, "Acme Supplies");
  assert.equal(out.supplyLocationLabelSnapshot, "Ahmedabad Plant");
  assert.equal(out.purchaseSourceStateCodeSnapshot, "24");
  assert.equal(out.purchaseGstModeSnapshot, "INTERSTATE");
  assert.equal(out.supplierStateCodeSnapshot, "27");
});

test("resolvePurchaseBillIntraState prefers purchase source over registered supplier state", () => {
  const bill = {
    purchaseSourceStateCodeSnapshot: "24",
    supplierStateCodeSnapshot: "27",
    supplier: { stateCode: "27", stateRef: { stateCode: "27" } },
  };
  const companyState = { companyStateRef: { stateCode: "27" } };
  const out = resolvePurchaseBillIntraState(bill, companyState);
  assert.equal(out.intraState, false);
  assert.equal(out.basis, "PURCHASE_SOURCE_SNAPSHOT");
});

test("resolvePurchaseBillIntraState falls back to legacy supplierStateCodeSnapshot", () => {
  const bill = {
    purchaseSourceStateCodeSnapshot: "",
    supplierStateCodeSnapshot: "27",
  };
  const companyState = { companyStateRef: { stateCode: "27" } };
  const out = resolvePurchaseBillIntraState(bill, companyState);
  assert.equal(out.intraState, true);
  assert.equal(out.basis, "LEGACY_SUPPLIER_SNAPSHOT");
});

test("resolvePurchaseBillCommercialView uses frozen bill snapshots", () => {
  const view = resolvePurchaseBillCommercialView(
    {
      supplierNameSnapshot: "Frozen Supplier",
      supplyLocationLabelSnapshot: "Mumbai Depot",
      supplyLocationGstinSnapshot: "27AAECC1234F1Z5",
      supplyLocationStateCodeSnapshot: "27",
      supplyLocationStateNameSnapshot: "Maharashtra",
      purchaseSourceStateCodeSnapshot: "27",
      purchaseSourceStateNameSnapshot: "Maharashtra",
      purchaseSourceSnapshot: "SUPPLY_LOCATION",
      purchaseGstModeSnapshot: "LOCAL",
    },
    "27",
  );
  assert.equal(view.snapshotState, "FROZEN");
  assert.equal(view.registeredSupplier.name, "Frozen Supplier");
  assert.equal(view.supplyLocation.label, "Mumbai Depot");
  assert.equal(view.gstMode, "LOCAL");
});

test("legacy bill without new snapshots still resolves safely", () => {
  const view = resolvePurchaseBillCommercialView(
    {
      supplierStateSnapshot: "Maharashtra",
      supplierStateCodeSnapshot: "27",
      supplier: { name: "Legacy Supplier", gst: "27AAECC1234F1Z5", stateCode: "27" },
    },
    "27",
  );
  assert.equal(view.snapshotState, "LEGACY");
  assert.equal(view.registeredSupplier?.name, "Legacy Supplier");
  assert.equal(view.gstMode, "LOCAL");
});

test("purchaseBillCommercialSnapshotsPresent detects frozen bill", () => {
  assert.equal(
    purchaseBillCommercialSnapshotsPresent({ purchaseSourceStateCodeSnapshot: "24" }),
    true,
  );
  assert.equal(
    purchaseBillCommercialSnapshotsPresent({ supplierStateCodeSnapshot: "27" }),
    false,
  );
});

test("registered vs supply location state drives interstate GST mode", () => {
  assert.equal(getPurchaseGstMode("27", "24"), "INTERSTATE");
  assert.equal(getPurchaseGstMode("27", "27"), "LOCAL");
});
