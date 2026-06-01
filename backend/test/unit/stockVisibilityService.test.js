const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  godownColumnForLocationType,
  godownRowTotal,
  emptyGodownQty,
} = require("../../src/services/stockVisibilityService");

describe("stockVisibilityService godown mapping", () => {
  it("maps location types to godown columns", () => {
    assert.equal(godownColumnForLocationType("RM_STORE"), "rmStore");
    assert.equal(godownColumnForLocationType("CONSUMABLE"), "rmStore");
    assert.equal(godownColumnForLocationType("PRODUCTION"), "production");
    assert.equal(godownColumnForLocationType("WIP"), "wip");
    assert.equal(godownColumnForLocationType("FG_STORE"), "fgStore");
    assert.equal(godownColumnForLocationType("DISPATCH"), "unassignedUsable");
  });

  it("totals reconcile across godown columns", () => {
    const cols = {
      ...emptyGodownQty(),
      rmStore: 1000,
      production: 1080,
      wip: 0,
      fgStore: 0,
      qcHold: 0,
      scrap: 0,
    };
    assert.equal(godownRowTotal(cols), 2080);
  });
});
