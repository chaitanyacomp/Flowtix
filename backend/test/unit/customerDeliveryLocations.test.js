/**
 * Customer Delivery Locations (canonical: CustomerDeliveryAddress) + Dispatch snapshot.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDispatchDeliverySnapshot,
  mapDeliveryAddressRow,
  normalizeLocationType,
} = require("../../src/services/customerMasterService");
const {
  resolveDeliveryLocationForDispatch,
  shipToFromDispatchOrSo,
  listActiveDeliveryLocationsForCustomer,
} = require("../../src/services/dispatchDeliveryLocation");

describe("Customer Delivery Locations", () => {
  it("mapDeliveryAddressRow exposes locationLabel alias and locationType", () => {
    const mapped = mapDeliveryAddressRow({
      id: 7,
      customerId: 3,
      label: "Pune Plant",
      locationType: "PLANT",
      address: "MIDC",
      city: "Pune",
      district: null,
      stateId: 1,
      stateRef: { stateName: "Maharashtra", stateCode: "27" },
      pincode: "411001",
      country: "India",
      gst: "27AAAAA0000A1Z5",
      contactPerson: "A",
      phone: "91",
      email: null,
      notes: null,
      isDefault: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    assert.equal(mapped.locationLabel, "Pune Plant");
    assert.equal(mapped.locationType, "PLANT");
    assert.equal(mapped.gstin, "27AAAAA0000A1Z5");
  });

  it("normalizeLocationType defaults Registered Office label", () => {
    assert.equal(normalizeLocationType(null, "Registered Office"), "REGISTERED_OFFICE");
    assert.equal(normalizeLocationType("WAREHOUSE", "X"), "WAREHOUSE");
    assert.equal(normalizeLocationType("nope", "Other"), "OTHER");
  });

  it("buildDispatchDeliverySnapshot freezes ship-to fields", () => {
    const snap = buildDispatchDeliverySnapshot({
      id: 11,
      locationLabel: "Gujarat Plant",
      address: "Plot 1",
      city: "Vadodara",
      stateName: "Gujarat",
      stateCode: "24",
      pincode: "390001",
      country: "India",
      gstin: "24BBBBB0000B1Z5",
      contactPerson: "B",
      phone: "99",
      email: "b@x.com",
    });
    assert.equal(snap.deliveryLocationId, 11);
    assert.equal(snap.deliveryLocationLabelSnapshot, "Gujarat Plant");
    assert.equal(snap.deliveryGstinSnapshot, "24BBBBB0000B1Z5");
    assert.equal(snap.deliveryEmailSnapshot, "b@x.com");
  });

  it("legacy dispatch without snapshot remains readable via SO ship-to fallback", () => {
    const soShip = { label: "SO Ship", address: "SO Addr", gstin: "27X", stateName: "MH", stateCode: "27" };
    const fromLegacy = shipToFromDispatchOrSo({ deliveryLocationId: null }, soShip);
    assert.equal(fromLegacy.label, "SO Ship");
    assert.equal(fromLegacy.fromDispatchSnapshot, undefined);

    const fromSnap = shipToFromDispatchOrSo(
      {
        deliveryLocationLabelSnapshot: "Warehouse",
        deliveryAddressSnapshot: "W1",
        deliveryGstinSnapshot: "27Y",
        deliveryStateNameSnapshot: "Maharashtra",
        deliveryStateCodeSnapshot: "27",
      },
      soShip,
    );
    assert.equal(fromSnap.fromDispatchSnapshot, true);
    assert.equal(fromSnap.label, "Warehouse");
    assert.equal(fromSnap.address, "W1");
  });

  it("resolveDeliveryLocationForDispatch prefers default and excludes inactive", async () => {
    const rows = [
      {
        id: 1,
        customerId: 9,
        label: "Plant",
        locationType: "PLANT",
        address: "A",
        city: null,
        district: null,
        stateId: null,
        stateRef: null,
        pincode: null,
        country: null,
        gst: null,
        contactPerson: null,
        phone: null,
        email: null,
        notes: null,
        isDefault: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        customerId: 9,
        label: "Registered Office",
        locationType: "REGISTERED_OFFICE",
        address: "HQ",
        city: null,
        district: null,
        stateId: null,
        stateRef: null,
        pincode: null,
        country: null,
        gst: "27AAAAA0000A1Z5",
        contactPerson: null,
        phone: null,
        email: null,
        notes: null,
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const db = {
      customerDeliveryAddress: {
        findMany: async ({ where }) => {
          assert.equal(where.isActive, true);
          assert.equal(where.customerId, 9);
          return rows;
        },
      },
    };
    const def = await resolveDeliveryLocationForDispatch(db, 9, null);
    assert.equal(def.deliveryLocationId, 2);
    assert.equal(def.deliveryLocationLabelSnapshot, "Registered Office");

    const chosen = await resolveDeliveryLocationForDispatch(db, 9, 1);
    assert.equal(chosen.deliveryLocationId, 1);

    await assert.rejects(() => resolveDeliveryLocationForDispatch(db, 9, 99), /not active/);
  });

  it("listActiveDeliveryLocationsForCustomer is customer-scoped", async () => {
    const db = {
      customerDeliveryAddress: {
        findMany: async ({ where }) => {
          assert.equal(where.customerId, 44);
          assert.equal(where.isActive, true);
          return [];
        },
      },
    };
    const locs = await listActiveDeliveryLocationsForCustomer(db, 44);
    assert.deepEqual(locs, []);
  });

  it("master edit after snapshot does not mutate frozen fields (immutability contract)", () => {
    const loc = {
      id: 5,
      locationLabel: "Old Label",
      address: "Old Addr",
      city: "Pune",
      stateName: "Maharashtra",
      stateCode: "27",
      pincode: "411001",
      country: "India",
      gstin: "27AAAAA0000A1Z5",
      contactPerson: "Old",
      phone: "1",
      email: null,
    };
    const frozen = buildDispatchDeliverySnapshot(loc);
    loc.locationLabel = "Edited Label";
    loc.address = "Edited Addr";
    loc.gstin = "27BBBBB0000B1Z5";
    assert.equal(frozen.deliveryLocationLabelSnapshot, "Old Label");
    assert.equal(frozen.deliveryAddressSnapshot, "Old Addr");
    assert.equal(frozen.deliveryGstinSnapshot, "27AAAAA0000A1Z5");
  });
});
