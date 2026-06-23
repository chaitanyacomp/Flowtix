const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  clampGreenLevelHistoryMonths,
  ALLOWED_GREEN_LEVEL_HISTORY_MONTHS,
  DEFAULT_GREEN_LEVEL_HISTORY_MONTHS,
  normalizeGreenLevelSource,
  resolveActiveGreenBaseQty,
  DEFAULT_GREEN_LEVEL_SOURCE,
  GREEN_LEVEL_SOURCE_MANUAL,
  GREEN_LEVEL_SOURCE_AUTOMATIC,
} = require("../../src/services/greenLevelPlanningSettings");

describe("greenLevelPlanningSettings", () => {
  it("allows 3, 6, and 12 months only", () => {
    assert.deepEqual(ALLOWED_GREEN_LEVEL_HISTORY_MONTHS, [3, 6, 12]);
    assert.equal(DEFAULT_GREEN_LEVEL_HISTORY_MONTHS, 6);
    assert.equal(clampGreenLevelHistoryMonths(3), 3);
    assert.equal(clampGreenLevelHistoryMonths(6), 6);
    assert.equal(clampGreenLevelHistoryMonths(12), 12);
  });

  it("falls back to default for invalid values", () => {
    assert.equal(clampGreenLevelHistoryMonths(0), 6);
    assert.equal(clampGreenLevelHistoryMonths(9), 6);
    assert.equal(clampGreenLevelHistoryMonths(null), 6);
  });

  it("normalizes green level source with MANUAL default", () => {
    assert.equal(DEFAULT_GREEN_LEVEL_SOURCE, GREEN_LEVEL_SOURCE_MANUAL);
    assert.equal(normalizeGreenLevelSource("automatic"), GREEN_LEVEL_SOURCE_AUTOMATIC);
    assert.equal(normalizeGreenLevelSource("MANUAL"), GREEN_LEVEL_SOURCE_MANUAL);
    assert.equal(normalizeGreenLevelSource(""), GREEN_LEVEL_SOURCE_MANUAL);
  });

  it("resolveActiveGreenBaseQty picks manual or auto per source", () => {
    assert.equal(
      resolveActiveGreenBaseQty({
        greenLevelSource: "MANUAL",
        manualGreenLevelQty: 5000,
        autoSuggestedBaseQty: 9000,
      }),
      5000,
    );
    assert.equal(
      resolveActiveGreenBaseQty({
        greenLevelSource: "AUTOMATIC",
        manualGreenLevelQty: 5000,
        autoSuggestedBaseQty: 9000,
      }),
      9000,
    );
  });
});
