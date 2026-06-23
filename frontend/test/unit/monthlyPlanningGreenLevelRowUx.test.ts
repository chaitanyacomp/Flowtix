import { describe, expect, it } from "vitest";

import {
  greenLevelBasisTooltip,
  greenLevelNoHistoryHelper,
  buildFgGreenPlanningRowMap,
  greenLevelQtyCellContent,
  productionPlanGreenLevelFieldsVisible,
  resolveFgGreenPlanningRow,
} from "../../src/lib/monthlyPlanningGreenLevelRowUx";

describe("monthlyPlanningGreenLevelRowUx", () => {
  it("exposes green basis tooltip wording", () => {
    expect(greenLevelBasisTooltip(6)).toBe(
      "Green Level = highest monthly locked RS demand from last 6 months",
    );
    expect(greenLevelBasisTooltip(3)).toContain("last 3 months");
  });

  it("buildFgGreenPlanningRowMap prefers API fields without recomputing shortage", () => {
    const map = buildFgGreenPlanningRowMap({
      period: "2026-06",
      compositionPeriodKey: "2026-06",
      compositionItems: [
        {
          itemId: 10,
          greenShortage: 500,
          suggestedProduction: 2500,
          greenTarget: 2000,
          freeFgStock: 1500,
        },
      ],
      greenAnchorPeriodKey: "2026-06",
      greenItems: [
        {
          itemId: 10,
          baseQty: 2000,
          greenQty: 2000,
          activeGreenLevelQty: 2000,
          manualGreenLevelQty: 2000,
          autoSuggestedGreenLevelQty: 1800,
          freeFgStock: 1500,
          shortageForGreenTarget: 500,
        },
      ],
      greenLevelSource: "MANUAL",
    });

    expect(productionPlanGreenLevelFieldsVisible(map.get(10)!)).toEqual({
      greenLevelQty: 2000,
      manualGreenLevelQty: 2000,
      autoSuggestedGreenLevelQty: 1800,
      greenLevelSource: "MANUAL",
      freeFgStock: 1500,
      greenShortage: 500,
      suggestedProduction: 2500,
      noHistoryHelper: null,
    });
  });

  it("no-history state shows Green Level 0 and helper message in AUTOMATIC mode", () => {
    const map = buildFgGreenPlanningRowMap({
      period: "2026-06",
      compositionPeriodKey: "2026-06",
      compositionItems: [{ itemId: 20, greenShortage: 0, suggestedProduction: 100, greenTarget: 0 }],
      greenAnchorPeriodKey: "2026-06",
      greenItems: [{ itemId: 20, baseQty: 0, greenQty: 0, freeFgStock: 50, shortageForGreenTarget: 0 }],
      greenLevelSource: "AUTOMATIC",
      extraFgItemIds: [20],
    });

    const row = map.get(20)!;
    expect(greenLevelQtyCellContent(row, 6)).toEqual({
      display: "0",
      helper: greenLevelNoHistoryHelper(6),
    });
    expect(productionPlanGreenLevelFieldsVisible(row, 6).noHistoryHelper).toBe(
      greenLevelNoHistoryHelper(6),
    );
  });

  it("MANUAL mode without item qty shows manual missing helper", () => {
    const map = buildFgGreenPlanningRowMap({
      period: "2026-06",
      compositionPeriodKey: "2026-06",
      compositionItems: [{ itemId: 30, greenShortage: 0, suggestedProduction: 0, greenTarget: 0 }],
      greenAnchorPeriodKey: "2026-06",
      greenItems: [
        {
          itemId: 30,
          manualGreenLevelQty: 0,
          autoSuggestedGreenLevelQty: 5000,
          activeGreenLevelQty: 0,
          freeFgStock: 100,
          shortageForGreenTarget: 0,
        },
      ],
      greenLevelSource: "MANUAL",
    });
    const row = map.get(30)!;
    expect(greenLevelQtyCellContent(row, 6).helper).toContain("manual Green Level");
  });

  it("resolveFgGreenPlanningRow marks loading until context is ready", () => {
    const map = buildFgGreenPlanningRowMap({
      period: "2026-06",
      compositionPeriodKey: "2026-06",
      compositionItems: [],
      greenAnchorPeriodKey: "2026-06",
      greenItems: [],
    });
    expect(resolveFgGreenPlanningRow(99, map, false).loading).toBe(true);
    expect(resolveFgGreenPlanningRow(99, map, true).loading).toBe(false);
    expect(resolveFgGreenPlanningRow(99, map, true).greenLevelQty).toBe(0);
  });
});
