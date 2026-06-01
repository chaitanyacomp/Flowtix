import { describe, expect, it } from "vitest";
import {
  clampRegularSoBufferPercent,
  computeProductionPlanningMetrics,
} from "../../src/lib/regularSoProductionPlanning";

describe("regularSoProductionPlanning", () => {
  it("clamps buffer percent to 0–10", () => {
    expect(clampRegularSoBufferPercent(-3)).toBe(0);
    expect(clampRegularSoBufferPercent(5.4)).toBe(5);
    expect(clampRegularSoBufferPercent(12)).toBe(10);
  });

  it("computes planned and RM planning qty from customer commitment and FG stock", () => {
    const m = computeProductionPlanningMetrics(12000, 5, 0);
    expect(m.productionBufferQty).toBe(600);
    expect(m.plannedProductionQty).toBe(12600);
    expect(m.rmPlanningQty).toBe(12600);
  });

  it("does not reduce RM planning qty for FG stock in store", () => {
    const m = computeProductionPlanningMetrics(12000, 5, 200);
    expect(m.plannedProductionQty).toBe(12600);
    expect(m.rmPlanningQty).toBe(12600);
    expect(m.fgStockAdjustmentQty).toBe(200);
  });

  it("uses customer qty + buffer for planned production (8000 + 2% = 8160)", () => {
    const m = computeProductionPlanningMetrics(8000, 2, 0);
    expect(m.productionBufferQty).toBe(160);
    expect(m.plannedProductionQty).toBe(8160);
    expect(m.rmPlanningQty).toBe(8160);
  });
});
