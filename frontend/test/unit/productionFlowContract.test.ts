import { describe, expect, it } from "vitest";

import {
  GREEN_LEVEL_REPLENISHMENT_SOURCE_TYPE,
  isGreenLevelReplenishmentSourceType,
  parseProductionFlowParam,
  productionFlowFromOrderType,
  PRODUCTION_FLOW_GREEN_LEVEL,
} from "../../src/lib/productionFlowContract";
import { isProductionScopedEntry, isProductionWorkspaceEntry } from "../../src/lib/operationalPageEntry";

describe("productionFlowContract green level", () => {
  it("recognizes green level replenishment source type", () => {
    expect(isGreenLevelReplenishmentSourceType(GREEN_LEVEL_REPLENISHMENT_SOURCE_TYPE)).toBe(true);
    expect(isGreenLevelReplenishmentSourceType("green_level_replenishment")).toBe(true);
    expect(isGreenLevelReplenishmentSourceType("NORMAL")).toBe(false);
  });

  it("does not map green level to NO_QTY production flow", () => {
    expect(productionFlowFromOrderType(GREEN_LEVEL_REPLENISHMENT_SOURCE_TYPE)).toBeNull();
    expect(productionFlowFromOrderType("GREEN_LEVEL")).toBe(PRODUCTION_FLOW_GREEN_LEVEL);
  });

  it("parses GREEN_LEVEL flow param", () => {
    expect(parseProductionFlowParam("GREEN_LEVEL")).toBe(PRODUCTION_FLOW_GREEN_LEVEL);
    expect(parseProductionFlowParam("green_level")).toBe(PRODUCTION_FLOW_GREEN_LEVEL);
  });
});

describe("production workspace entry routing", () => {
  it("keeps bare menu entry on Production Workspace dashboard", () => {
    expect(
      isProductionWorkspaceEntry({
        fromNoQtySo: false,
        focusSoIdValid: false,
        woIdFromUrlValid: false,
        workOrderLineIdFromUrlValid: false,
        fromDashboardWithTarget: false,
      }),
    ).toBe(true);
  });

  it("scopes REGULAR / GL WO deep-links away from workspace dashboard", () => {
    expect(
      isProductionScopedEntry({
        fromNoQtySo: false,
        focusSoIdValid: false,
        woIdFromUrlValid: true,
        workOrderLineIdFromUrlValid: false,
        fromDashboardWithTarget: false,
      }),
    ).toBe(true);
    expect(
      isProductionWorkspaceEntry({
        fromNoQtySo: false,
        focusSoIdValid: false,
        woIdFromUrlValid: true,
        workOrderLineIdFromUrlValid: false,
        fromDashboardWithTarget: false,
      }),
    ).toBe(false);
  });
});
