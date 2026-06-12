const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  formatDemandSourceLabel,
  summarizePoProcurementSourceFromTrace,
  LEGACY_HISTORICAL_DEMAND,
} = require("../../src/services/procurementDemandSourcePresentation");

describe("procurementDemandSourcePresentation", () => {
  it("formatDemandSourceLabel prefers monthly plan document label", () => {
    assert.equal(
      formatDemandSourceLabel({
        demandSourceType: "MONTHLY_PLAN",
        monthlyPlan: { label: "Monthly Plan Jun 2026" },
        mr: { docNo: "MR-26-0001" },
      }),
      "Monthly Plan Jun 2026",
    );
  });

  it("formatDemandSourceLabel maps sales order MR trace", () => {
    assert.equal(
      formatDemandSourceLabel({
        demandSourceType: "SALES_ORDER",
        salesOrder: { docNo: "SO-26-0002" },
        mr: { docNo: "MR-26-0003" },
      }),
      "SO-26-0002",
    );
  });

  it("formatDemandSourceLabel never returns Unknown demand", () => {
    assert.equal(
      formatDemandSourceLabel({
        demandSourceType: "MONTHLY_PLAN",
        mr: { docNo: "MR-26-0001" },
      }),
      "MR-26-0001",
    );
    assert.equal(formatDemandSourceLabel(null), LEGACY_HISTORICAL_DEMAND);
  });

  it("summarizePoProcurementSourceFromTrace aggregates PO line sources", () => {
    assert.equal(
      summarizePoProcurementSourceFromTrace({
        lines: [
          {
            demandSources: [
              {
                demandSourceType: "MONTHLY_PLAN",
                monthlyPlan: { label: "Monthly Plan Jun 2026" },
                mr: { docNo: "MR-26-0001" },
              },
            ],
          },
        ],
      }),
      "Monthly Plan Jun 2026",
    );
  });
});
