const test = require("node:test");
const assert = require("node:assert/strict");
const { mapSupplierRow, mapSupplierLocationRow } = require("../../src/services/supplierMasterService");
const {
  normalizeGstinOnSave,
  validateGstinFormatMessage,
  validateGstinAgainstState,
} = require("../../src/services/gstinNormalize");

test("mapSupplierRow maps locations and active flag", () => {
  const row = {
    id: 1,
    name: "Acme Supplies",
    contact: "999",
    email: null,
    address: "Pune",
    gst: "27AAECC1234F1Z5",
    state: "Maharashtra",
    stateId: 1,
    stateName: "Maharashtra",
    stateCode: "27",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    stateRef: { stateName: "Maharashtra", stateCode: "27" },
    locations: [
      {
        id: 10,
        supplierId: 1,
        label: "Mumbai Depot",
        address: "Mumbai",
        city: "Mumbai",
        stateId: 1,
        gst: null,
        contactPerson: null,
        phone: null,
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        stateRef: { stateName: "Maharashtra", stateCode: "27" },
      },
    ],
  };
  const out = mapSupplierRow(row);
  assert.equal(out.name, "Acme Supplies");
  assert.equal(out.gstin, "27AAECC1234F1Z5");
  assert.equal(out.isActive, true);
  assert.equal(out.locations.length, 1);
  assert.equal(out.locations[0].label, "Mumbai Depot");
  assert.equal(out.locationCount, 1);
});

test("mapSupplierLocationRow exposes gstin alias", () => {
  const out = mapSupplierLocationRow({
    id: 2,
    supplierId: 1,
    label: "Plant",
    address: null,
    city: null,
    stateId: null,
    gst: "24AABCU9603R1ZM",
    contactPerson: null,
    phone: null,
    isDefault: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    stateRef: null,
  });
  assert.equal(out.gstin, "24AABCU9603R1ZM");
  assert.equal(out.isDefault, false);
});

test("mapSupplierRow treats missing isActive as active", () => {
  const out = mapSupplierRow({
    id: 3,
    name: "Legacy",
    isActive: undefined,
    locations: [],
  });
  assert.equal(out.isActive, true);
});

test("supplier GST: empty GSTIN allowed for unregistered suppliers", () => {
  assert.equal(normalizeGstinOnSave(""), null);
  assert.equal(validateGstinFormatMessage(""), null);
});

test("supplier GST: valid GSTIN normalizes to uppercase 15 chars", () => {
  const gst = normalizeGstinOnSave("  27aaecc1234f1z5  ");
  assert.equal(gst, "27AAECC1234F1Z5");
  assert.equal(validateGstinFormatMessage(gst), null);
});

test("supplier GST: invalid GSTIN blocked", () => {
  assert.equal(validateGstinFormatMessage("27ABC"), "GSTIN must be exactly 15 characters.");
});

test("supplier GST: state mismatch blocked", () => {
  const msg = validateGstinAgainstState("27AAECC1234F1Z5", { stateCode: "24" });
  assert.equal(msg, "Selected state does not match the GSTIN state code.");
});

test("mapSupplierRow supports multiple supply locations", () => {
  const out = mapSupplierRow({
    id: 4,
    name: "Multi Branch Co",
    isActive: true,
    locations: [
      { id: 1, supplierId: 4, label: "Mumbai Depot", isDefault: true, isActive: true },
      { id: 2, supplierId: 4, label: "Gujarat Plant", isDefault: false, isActive: true },
    ],
  });
  assert.equal(out.locationCount, 2);
  assert.equal(out.locations[1].label, "Gujarat Plant");
});
