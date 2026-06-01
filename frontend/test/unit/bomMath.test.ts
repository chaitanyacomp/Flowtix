import { describe, it, expect } from "vitest";

import {

  computeBomWeightPlanning,

  rmRequiredForFgCount,

  effectiveQtyWithHeaderLosses,

  lossMultiplier,

} from "../../src/lib/bomMath";



describe("lossMultiplier", () => {

  it("adds process and QC percentages", () => {

    expect(lossMultiplier(2, 3)).toBeCloseTo(1.05, 5);

  });

});



describe("computeBomWeightPlanning", () => {

  it("FG per KG = 1000 / grams (8g → 125)", () => {

    const r = computeBomWeightPlanning({

      fgWeight: 8,

      fgWeightUnit: { unitName: "Gram", unitCode: "G" },

      outputQty: 1,

      processLossPercent: 2,

      qcLossPercent: 3,

    });

    expect(r.weightConfigured).toBe(true);

    expect(r.possibleFgPerKg).toBe(125);

    expect(r.message).toBeNull();

  });



  it("hides FG per KG when weight not set", () => {

    const r = computeBomWeightPlanning({ fgWeight: null });

    expect(r.weightConfigured).toBe(false);

    expect(r.possibleFgPerKg).toBeNull();

    expect(r.message).toBeNull();

  });

});



describe("rmRequiredForFgCount", () => {

  it("uses additive loss formula", () => {

    const qty = rmRequiredForFgCount(0.5, 100, 1, 2, 3);

    expect(qty).toBeCloseTo(52.5, 1);

  });

});



describe("effectiveQtyWithHeaderLosses", () => {

  it("applies additive losses", () => {

    expect(effectiveQtyWithHeaderLosses(10, 2, 3)).toBeCloseTo(10.5, 3);

  });

});


