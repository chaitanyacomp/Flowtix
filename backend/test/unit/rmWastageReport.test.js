/**
 * RM Wastage Report — service wiring / filter parse (no calculation changes).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildRmWastageReport, parseFilters } = require("../../src/services/rmWastageReportService");

describe("rmWastageReportService", () => {
  it("exports buildRmWastageReport as a function", () => {
    assert.equal(typeof buildRmWastageReport, "function");
  });

  it("parseFilters defaults page and pageSize", () => {
    const f = parseFilters({});
    assert.equal(f.page, 1);
    assert.equal(f.pageSize, 50);
    assert.equal(f.reason, null);
    assert.equal(f.exportMode, "");
  });

  it("buildRmWastageReport returns empty payload when no notes", async () => {
    const db = {
      materialWastageNote: {
        count: async () => 0,
        findMany: async () => [],
      },
    };
    const data = await buildRmWastageReport({}, db);
    assert.equal(data.meta.total, 0);
    assert.deepEqual(data.rows, []);
    assert.equal(data.kpis.totalNotes, 0);
    assert.equal(data.kpis.totalWastageQty, 0);
    assert.equal(data.kpis.totalWastageValue, 0);
  });
});
