const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolvePurchaseSourceState,
  getPurchaseGstMode,
  mapPurchaseCommercialSnapshots,
  mapCommercialViewFromPoRow,
  commercialSnapshotsPresent,
  snapshotStateLabel,
  resolveSupplierLocationFallback,
  REGISTERED_OFFICE_LABEL,
} = require("../../src/services/purchaseCommercialAddress");

const supplier = {
  id: 1,
  name: "Acme Supplies Pvt Ltd",
  address: "Registered Office, Pune",
  gst: "27AAECC1234F1Z5",
  stateName: "Maharashtra",
  stateCode: "27",
  stateRef: { stateName: "Maharashtra", stateCode: "27" },
};

const mumbaiLocation = {
  id: 10,
  supplierId: 1,
  label: "Mumbai Depot",
  address: "Andheri East",
  gst: "27AAECC1234F1Z5",
  isActive: true,
  isDefault: true,
  stateRef: { stateName: "Maharashtra", stateCode: "27" },
};

const gujaratLocation = {
  id: 11,
  supplierId: 1,
  label: "Ahmedabad Plant",
  address: "GIDC",
  gst: "24AABCU9603R1ZM",
  isActive: true,
  isDefault: false,
  stateRef: { stateName: "Gujarat", stateCode: "24" },
};

test("resolvePurchaseSourceState prefers supply location state", () => {
  const out = resolvePurchaseSourceState(
    { id: 10, stateCode: "24", stateName: "Gujarat", gstin: "24AABCU9603R1ZM" },
    { stateCode: "27", stateName: "Maharashtra" },
  );
  assert.equal(out.stateCode, "24");
  assert.equal(out.source, "SUPPLY_LOCATION");
});

test("resolvePurchaseSourceState falls back to registered supplier state", () => {
  const out = resolvePurchaseSourceState({ id: null, stateCode: null, stateName: null, gstin: null }, {
    stateCode: "27",
    stateName: "Maharashtra",
  });
  assert.equal(out.stateCode, "27");
  assert.equal(out.source, "REGISTERED");
});

test("getPurchaseGstMode returns LOCAL, INTERSTATE, UNKNOWN", () => {
  assert.equal(getPurchaseGstMode("27", "27"), "LOCAL");
  assert.equal(getPurchaseGstMode("27", "24"), "INTERSTATE");
  assert.equal(getPurchaseGstMode(null, "27"), "UNKNOWN");
});

test("mapPurchaseCommercialSnapshots freezes registered + supply location fields", () => {
  const out = mapPurchaseCommercialSnapshots({
    supplier,
    location: mumbaiLocation,
    purchaseSource: { stateCode: "27", stateName: "Maharashtra", source: "SUPPLY_LOCATION" },
    gstMode: "LOCAL",
  });
  assert.equal(out.supplierLocationId, 10);
  assert.equal(out.supplierNameSnapshot, "Acme Supplies Pvt Ltd");
  assert.equal(out.supplyLocationLabelSnapshot, "Mumbai Depot");
  assert.equal(out.purchaseSourceStateCodeSnapshot, "27");
  assert.equal(out.purchaseSourceSnapshot, "SUPPLY_LOCATION");
  assert.equal(out.purchaseGstModeSnapshot, "LOCAL");
  assert.equal(out.supplierStateSnapshot, "Maharashtra");
  assert.equal(out.supplierStateCodeSnapshot, "27");
});

test("mapCommercialViewFromPoRow uses frozen snapshots for legacy compat", () => {
  const po = {
    supplierNameSnapshot: "Frozen Supplier",
    supplyLocationLabelSnapshot: "Frozen Depot",
    supplyLocationGstinSnapshot: "24AABCU9603R1ZM",
    supplyLocationStateCodeSnapshot: "24",
    supplyLocationStateNameSnapshot: "Gujarat",
    purchaseSourceStateCodeSnapshot: "24",
    purchaseSourceStateNameSnapshot: "Gujarat",
    purchaseSourceSnapshot: "SUPPLY_LOCATION",
    purchaseGstModeSnapshot: "INTERSTATE",
    supplierRegisteredStateCodeSnapshot: "27",
    supplierRegisteredStateNameSnapshot: "Maharashtra",
    supplier: { name: "Live Supplier", stateCode: "27" },
  };
  const view = mapCommercialViewFromPoRow(po, "27");
  assert.equal(view.registeredSupplier.name, "Frozen Supplier");
  assert.equal(view.supplyLocation.label, "Frozen Depot");
  assert.equal(view.gstMode, "INTERSTATE");
  assert.equal(view.snapshotState, "FROZEN");
});

test("legacy PO without snapshots resolves as LIVE", () => {
  const po = { supplierStateSnapshot: "Maharashtra", supplier: { name: "Legacy" } };
  assert.equal(commercialSnapshotsPresent(po), false);
  assert.equal(snapshotStateLabel(po), "LIVE");
});

test("resolveSupplierLocationFallback picks default active location", async () => {
  const tx = {
    supplierLocation: {
      findFirst: async (args) => {
        if (args.where.isDefault) return mumbaiLocation;
        return null;
      },
    },
  };
  const row = await resolveSupplierLocationFallback(tx, 1, null);
  assert.equal(row.id, 10);
});

test("resolveSupplierLocationFallback returns requested location for supplier", async () => {
  const tx = {
    supplierLocation: {
      findFirst: async (args) => {
        if (args.where.id === 11) return gujaratLocation;
        return null;
      },
    },
  };
  const row = await resolveSupplierLocationFallback(tx, 1, 11);
  assert.equal(row.label, "Ahmedabad Plant");
});

test("resolveSupplierLocationFallback blocks wrong supplier or inactive location", async () => {
  const tx = {
    supplierLocation: {
      findFirst: async () => null,
    },
  };
  await assert.rejects(
    () => resolveSupplierLocationFallback(tx, 1, 999),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /not found or inactive/i);
      return true;
    },
  );
});

test("registered office fallback label is stable", () => {
  assert.equal(REGISTERED_OFFICE_LABEL, "Registered Office");
});
