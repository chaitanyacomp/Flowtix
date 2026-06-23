const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRequirementSheetHref,
  resolveRsStatus,
  resolveLockedPeriodKey,
} = require("../../src/services/noQtyPlanningInboxService");

describe("noQtyPlanningInboxService helpers", () => {
  it("resolveRsStatus prefers latest version on guided cycle", () => {
    const sheets = [
      { id: 1, cycleId: 10, version: 1, status: "LOCKED" },
      { id: 2, cycleId: 10, version: 2, status: "DRAFT" },
      { id: 3, cycleId: 11, version: 1, status: "LOCKED" },
    ];
    assert.equal(resolveRsStatus(sheets, 10), "Draft");
    assert.equal(resolveRsStatus(sheets, 11), "Locked");
    assert.equal(resolveRsStatus([], 10), "No RS");
  });

  it("resolveLockedPeriodKey returns periodKey from locked sheet on cycle", () => {
    const sheets = [
      { id: 1, cycleId: 10, version: 1, status: "DRAFT", periodKey: "2026-05" },
      { id: 2, cycleId: 10, version: 2, status: "LOCKED", periodKey: "2026-06" },
    ];
    assert.equal(resolveLockedPeriodKey(sheets, 10), "2026-06");
  });

  it("buildRequirementSheetHref adds execution focus query params", () => {
    const href = buildRequirementSheetHref(171, {
      sheetId: 261,
      cycleId: 301,
      focusExecution: true,
    });
    assert.match(href, /^\/sales-orders\/171\/requirement-sheets\?/);
    assert.match(href, /source=no_qty_so/);
    assert.match(href, /salesOrderId=171/);
    assert.match(href, /sheetId=261/);
    assert.match(href, /cycleId=301/);
    assert.match(href, /focus=execution/);
  });
});
