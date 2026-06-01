const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_RM_STORE_CODE,
  itemTypeFlagsFromCheckboxes,
  assertAtLeastOneItemType,
} = require("../../src/services/locationService");

describe("locationService helpers", () => {
  it("DEFAULT_RM_STORE_CODE is LOC-RM-STORE", () => {
    assert.equal(DEFAULT_RM_STORE_CODE, "LOC-RM-STORE");
  });

  it("requires at least one allowed item type", () => {
    assert.throws(() => assertAtLeastOneItemType(itemTypeFlagsFromCheckboxes({})), /at least one/i);
    assert.doesNotThrow(() =>
      assertAtLeastOneItemType(itemTypeFlagsFromCheckboxes({ allowRm: true })),
    );
  });
});

describe("stockService location scope (unit)", () => {
  const { resolveLocationReadScope } = require("../../src/services/locationService");

  it("allLocations returns empty scope object", async () => {
    const scope = await resolveLocationReadScope(
      { location: { findFirst: async () => ({ id: 1 }) } },
      { allLocations: true },
    );
    assert.deepEqual(scope, {});
  });
});
