const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  componentTypeFromItemType,
  summarizeComponentLines,
  enrichLinesWithComponentMeta,
} = require("../../src/services/bomComponentService");

describe("bomComponentService", () => {
  it("maps item types to component types", () => {
    assert.equal(componentTypeFromItemType("RM"), "RM");
    assert.equal(componentTypeFromItemType("SFG"), "SFG");
    assert.equal(componentTypeFromItemType("CONSUMABLE"), "CONSUMABLE");
  });

  it("summarizes RM and SFG counts", () => {
    const lines = [
      { componentType: "RM", rmItem: { itemName: "Label" } },
      { componentType: "SFG", rmItem: { itemName: "Cap" }, childBomAvailable: true },
      { componentType: "SFG", rmItem: { itemName: "Body" }, childBomAvailable: false },
    ];
    const s = summarizeComponentLines(lines);
    assert.equal(s.rmCount, 1);
    assert.equal(s.sfgCount, 2);
    assert.equal(s.childBomsLinked, 1);
    assert.equal(s.sfgWarnings.length, 1);
    assert.match(s.sfgWarnings[0], /Body/);
  });

  it("enriches lines with child BOM meta", () => {
    const childBomByFgId = new Map([
      [10, { id: 5, docNo: "BOM-26-0002", revisionNo: 1 }],
    ]);
    const out = enrichLinesWithComponentMeta(
      [{ rmItemId: 10, rmItem: { id: 10, itemType: "SFG", itemName: "Cap" } }],
      childBomByFgId,
    );
    assert.equal(out[0].componentType, "SFG");
    assert.equal(out[0].childBomAvailable, true);
  });
});
