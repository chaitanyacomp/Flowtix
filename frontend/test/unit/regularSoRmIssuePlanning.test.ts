import { describe, expect, it } from "vitest";
import {
  scaleRmRequiredToWoTarget,
  computeRoundedDownToleranceQty,
  physicalRmSupportedProductionQty,
  computeRegularSoProductionMaximum,
} from "../../src/lib/regularSoRmIssuePlanning";

describe("regularSoRmIssuePlanning (frontend)", () => {
  it("buffers RM required to 211.05 Kg for 15,075 Nos WO target", () => {
    expect(scaleRmRequiredToWoTarget(210, 15000, 15075)).toBe(211.05);
  });

  it("rounding tolerance caps at 0.5 Kg for 211.05 theoretical", () => {
    expect(computeRoundedDownToleranceQty(211.05)).toBe(0.5);
  });

  it("capacity examples at 0.014 Kg/Nos", () => {
    const perFg = 0.014;
    expect(physicalRmSupportedProductionQty(100, perFg)).toBe(7142);
    expect(physicalRmSupportedProductionQty(211, perFg)).toBe(15071);
    expect(physicalRmSupportedProductionQty(212, perFg)).toBe(15142);
    expect(physicalRmSupportedProductionQty(213, perFg)).toBe(15214);
    expect(
      computeRegularSoProductionMaximum({
        netRmIssuedQty: 211,
        bomConsumptionPerFg: perFg,
        woTargetQty: 15075,
        roundingToleranceAcknowledged: true,
      }),
    ).toBe(15075);
  });
});
