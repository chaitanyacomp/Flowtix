import { describe, expect, it } from "vitest";
import { blockNumericStepperKey, defaultBillNow, selectAllEligible, selectAllState } from "../../src/lib/salesBillSelection";

const rows = [{ dispatchId: 1, availableQty: "5.250" }, { dispatchId: 2, availableQty: "3" }, { dispatchId: 3, availableQty: "0" }];

describe("Sales Bill dispatch selection", () => {
  it("defaults Bill Now to current Available and excludes unavailable rows", () => {
    expect(defaultBillNow(rows)).toEqual({ 1: "5.250", 2: "3" });
  });
  it("selects and clears every eligible row", () => {
    expect(selectAllEligible(rows, true)).toEqual({ 1: true, 2: true });
    expect(selectAllEligible(rows, false)).toEqual({});
  });
  it("reports checked and indeterminate states", () => {
    expect(selectAllState(rows, { 1: true })).toEqual({ checked: false, indeterminate: true });
    expect(selectAllState(rows, { 1: true, 2: true })).toEqual({ checked: true, indeterminate: false });
  });
  it("blocks stepper arrow keys while retaining decimal text entry", () => {
    expect(blockNumericStepperKey("ArrowUp")).toBe(true);
    expect(blockNumericStepperKey("ArrowDown")).toBe(true);
    expect(blockNumericStepperKey(".")).toBe(false);
    expect(blockNumericStepperKey("5")).toBe(false);
  });
});
