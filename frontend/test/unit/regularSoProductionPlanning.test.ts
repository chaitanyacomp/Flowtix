import { describe, expect, it } from "vitest";
import {
  applyFgUomPrecisionToPlannedQty,
  capPlannedQtyByRmSupportedMax,
  clampRegularSoBufferPercent,
  classifyRegularSoBufferPercent,
  computeProductionPlanningMetrics,
  parseRegularSoBufferPercentInput,
  regularSoBufferPercentExceedsFractionDigits,
  roundRegularSoBufferPercent,
} from "../../src/lib/regularSoProductionPlanning";

describe("regularSoProductionPlanning — decimal buffer %", () => {
  it("accepts 0.5% and calculates additional / planned qty correctly", () => {
    expect(clampRegularSoBufferPercent(0.5)).toBe(0.5);
    const m = computeProductionPlanningMetrics(15000, 0.5, 0);
    expect(m.productionBufferPercent).toBe(0.5);
    expect(m.productionBufferQty).toBe(75);
    expect(m.plannedProductionQty).toBe(15075);
  });

  it("accepts 1.25%", () => {
    expect(clampRegularSoBufferPercent(1.25)).toBe(1.25);
    const m = computeProductionPlanningMetrics(15000, 1.25, 0);
    expect(m.plannedProductionQty).toBe(15187); // floor UOM precision on 15187.5
    expect(m.productionBufferQty).toBe(187);
  });

  it("normalizes more than 2 decimal places consistently", () => {
    expect(roundRegularSoBufferPercent(1.234)).toBe(1.23);
    expect(roundRegularSoBufferPercent(1.235)).toBe(1.24);
    expect(clampRegularSoBufferPercent(7.141)).toBe(7.14);
    expect(regularSoBufferPercentExceedsFractionDigits("1.234")).toBe(true);
    expect(regularSoBufferPercentExceedsFractionDigits("1.23")).toBe(false);
    expect(parseRegularSoBufferPercentInput("0.5")).toBe(0.5);
  });

  it("allows 5% normally", () => {
    expect(classifyRegularSoBufferPercent(5)).toBe("ALLOWED");
    const m = computeProductionPlanningMetrics(12000, 5, 0);
    expect(m.productionBufferQty).toBe(600);
    expect(m.plannedProductionQty).toBe(12600);
  });

  it("5.01% requires reason and Admin approval", () => {
    expect(classifyRegularSoBufferPercent(5.01)).toBe("REQUIRES_ADMIN_APPROVAL");
    expect(classifyRegularSoBufferPercent(7.14)).toBe("REQUIRES_ADMIN_APPROVAL");
    expect(classifyRegularSoBufferPercent(10)).toBe("REQUIRES_ADMIN_APPROVAL");
  });

  it("above 10% is blocked", () => {
    expect(classifyRegularSoBufferPercent(10.01)).toBe("BLOCKED");
    expect(classifyRegularSoBufferPercent(12)).toBe("BLOCKED");
    expect(clampRegularSoBufferPercent(12)).toBe(10);
  });

  it("RM-supported maximum still blocks excessive WO quantity", () => {
    const uncapped = computeProductionPlanningMetrics(15000, 0.5, 0);
    expect(uncapped.plannedProductionQty).toBe(15075);
    const capped = computeProductionPlanningMetrics(15000, 0.5, 0, { rmSupportedMaxQty: 15050 });
    expect(capped.plannedProductionQty).toBe(15050);
    expect(capped.productionBufferQty).toBe(50);
    expect(capPlannedQtyByRmSupportedMax(15075, 15000)).toBe(15000);
    expect(applyFgUomPrecisionToPlannedQty(15075.9, 0)).toBe(15075);
  });

  it("does not reduce RM planning qty for FG stock in store", () => {
    const m = computeProductionPlanningMetrics(12000, 5, 200);
    expect(m.plannedProductionQty).toBe(12600);
    expect(m.rmPlanningQty).toBe(12600);
    expect(m.fgStockAdjustmentQty).toBe(200);
  });
});
