const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { CONTROL_TOWER_ROW_MODES, paginateRows } = require("../../src/services/controlTowerNormalizedRowsService");
const {
  resolveBoardReadMode,
  applyBoardRowPageFilter,
} = require("../../src/services/controlTowerBoardService");
const { groupControlTowerRows } = require("../../src/services/controlTowerBoardGroups");
const { normalizeProductionRow } = require("../../src/services/controlTowerRowNormalizer");
const { attachRowIdentity } = require("../../src/services/controlTowerRowIdentity");

function productionRow(woId) {
  return attachRowIdentity(
    normalizeProductionRow({
      workOrderId: woId,
      workOrderLineId: 1,
      nextAction: "PRODUCTION_PENDING",
      orderType: "NORMAL",
      status: "OPEN",
    }),
  );
}

describe("resolveBoardReadMode", () => {
  it("defaults to full mode", () => {
    assert.equal(resolveBoardReadMode({}), CONTROL_TOWER_ROW_MODES.FULL);
    assert.equal(resolveBoardReadMode(undefined), CONTROL_TOWER_ROW_MODES.FULL);
  });

  it("honors explicit sample mode", () => {
    assert.equal(resolveBoardReadMode({ mode: "sample" }), CONTROL_TOWER_ROW_MODES.SAMPLE);
  });
});

describe("applyBoardRowPageFilter", () => {
  it("keeps full group counts while returning only paged rows", () => {
    const rows = Array.from({ length: 5 }, (_, i) => productionRow(i + 1));
    const { groups, ungrouped } = groupControlTowerRows(rows);
    const pageRows = paginateRows(rows, 1, 2);
    const pageRowKeys = new Set(pageRows.map((r) => r.rowKey));
    const paged = applyBoardRowPageFilter(groups, ungrouped, pageRowKeys);

    const productionGroup = paged.groups.find((g) => g.groupKey === "PRODUCTION");
    assert.equal(productionGroup.count, 5);
    assert.equal(productionGroup.rows.length, 2);
    assert.equal(paged.ungrouped.length, 0);
  });
});
