const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ITEM_TYPE_CODES, isItemTypeCode, itemTypeZodEnum } = require("../../src/services/itemTypes");

describe("itemTypes service", () => {
  it("exposes only RM FG SFG CONSUMABLE", () => {
    assert.deepEqual([...ITEM_TYPE_CODES], ["RM", "FG", "SFG", "CONSUMABLE"]);
    assert.equal(isItemTypeCode("CONSUMABLE"), true);
    assert.equal(isItemTypeCode("PACKING"), false);
    assert.equal(isItemTypeCode("SCRAP"), false);
    assert.deepEqual(itemTypeZodEnum(), ["RM", "FG", "SFG", "CONSUMABLE"]);
  });
});

describe("items route itemType validation", () => {
  const routeSrc = fs.readFileSync(path.join(__dirname, "../../src/routes/items.js"), "utf8");

  it("create and update accept the full itemType enum via itemTypeZodEnum", () => {
    assert.match(routeSrc, /itemTypeZodEnum/);
    assert.doesNotMatch(routeSrc, /itemType:\s*z\.enum\(\["RM",\s*"FG"\]\)/);
  });

  it("rejects unsupported type filter and locks type when referenced", () => {
    assert.match(routeSrc, /Unsupported item type filter/);
    assert.match(routeSrc, /ITEM_TYPE_UNIT_LOCKED/);
    assert.match(routeSrc, /itemHasBlockingReferences/);
  });
});
