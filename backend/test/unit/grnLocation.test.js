const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  suggestReceivingLocationId,
  locationAllowsItemType,
  UNASSIGNED_LOCATION_LABEL,
  locationDisplayLabel,
} = require("../../src/services/grnLocationService");

const baseLocations = [
  {
    id: 1,
    locationCode: "LOC-RM-STORE",
    locationName: "RM Store",
    locationType: "RM_STORE",
    allowRm: true,
    allowConsumable: true,
    isActive: true,
    isSystem: true,
  },
  {
    id: 2,
    locationCode: "LOC-CONSUMABLE-STORE",
    locationName: "Consumable Store",
    locationType: "CONSUMABLE",
    allowRm: false,
    allowConsumable: true,
    isActive: true,
    isSystem: true,
  },
  {
    id: 3,
    locationCode: "LOC-THIRD-PARTY-RM",
    locationName: "Third Party RM Store",
    locationType: "VENDOR",
    allowRm: true,
    allowConsumable: false,
    isActive: true,
    isSystem: true,
  },
];

describe("grnLocationService", () => {
  it("suggests RM Store for normal RM", () => {
    const id = suggestReceivingLocationId(baseLocations, { itemType: "RM", itemName: "HDPE" });
    assert.equal(id, 1);
  });

  it("suggests Consumable Store for consumable items", () => {
    const id = suggestReceivingLocationId(baseLocations, { itemType: "CONSUMABLE", itemName: "Grease" });
    assert.equal(id, 2);
  });

  it("suggests third party store when item name hints third party", () => {
    const id = suggestReceivingLocationId(baseLocations, {
      itemType: "RM",
      itemName: "Third Party HDPE Granules",
    });
    assert.equal(id, 3);
  });

  it("locationAllowsItemType respects flags", () => {
    assert.equal(locationAllowsItemType(baseLocations[1], "CONSUMABLE"), true);
    assert.equal(locationAllowsItemType(baseLocations[1], "RM"), false);
  });

  it("locationDisplayLabel handles missing row", () => {
    assert.equal(locationDisplayLabel(null), UNASSIGNED_LOCATION_LABEL);
    assert.equal(locationDisplayLabel({ locationName: "RM Store" }), "RM Store");
  });
});
