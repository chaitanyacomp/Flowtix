import { describe, expect, it } from "vitest";

import {
  hasSoWoRmBlockerAttention,
  minimumStockReplenishmentAffectsOperationsClear,
} from "../../src/lib/dashboardRmClassification";

describe("dashboardRmClassification", () => {
  it("a) no SO/WO blockers — rm-risk count zero does not flag operational blocker attention", () => {
    expect(hasSoWoRmBlockerAttention(0, true)).toBe(false);
    expect(hasSoWoRmBlockerAttention(0, false)).toBe(false);
  });

  it("b) minimum stock critical does not affect operations-clear policy", () => {
    expect(minimumStockReplenishmentAffectsOperationsClear()).toBe(false);
  });

  it("SO/WO rm-risk rows still flag operational blocker attention", () => {
    expect(hasSoWoRmBlockerAttention(3, true)).toBe(true);
    expect(hasSoWoRmBlockerAttention(3, false)).toBe(false);
  });
});
