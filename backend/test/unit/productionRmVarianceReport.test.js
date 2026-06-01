const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseFilters,
  DEFAULT_THRESHOLD_PCT,
  rowsToCsv,
} = require("../../src/services/productionRmVarianceReportService");

describe("productionRmVarianceReportService", () => {
  it("defaults threshold to 5%", () => {
    const f = parseFilters({});
    assert.equal(f.thresholdPct, DEFAULT_THRESHOLD_PCT);
    assert.equal(DEFAULT_THRESHOLD_PCT, 5);
  });

  it("parses variance and consumption type filters", () => {
    const f = parseFilters({
      varianceType: "EXTRA_USAGE",
      consumptionType: "EXTRA_PROCESS_LOSS",
      highVarianceOnly: "true",
      page: "2",
      pageSize: "25",
    });
    assert.equal(f.varianceType, "EXTRA_USAGE");
    assert.equal(f.consumptionType, "EXTRA_PROCESS_LOSS");
    assert.equal(f.highVarianceOnly, true);
    assert.equal(f.page, 2);
    assert.equal(f.pageSize, 25);
  });

  it("rowsToCsv includes header and variance columns", () => {
    const csv = rowsToCsv([
      {
        productionDate: "2026-05-20T10:00:00.000Z",
        workOrderNo: "WO-26-0001",
        salesOrderNo: "SO-26-0001",
        fgItemName: "Cap",
        rmItemName: "PP",
        producedQty: 1000,
        standardQty: 100,
        actualQty: 104,
        varianceQty: 4,
        variancePercent: 4,
        consumptionType: "NORMAL",
        remarks: null,
        approvedByName: "Operator",
      },
    ]);
    assert.match(csv, /Standard Consumption/);
    assert.match(csv, /104/);
    assert.match(csv, /4/);
  });
});
