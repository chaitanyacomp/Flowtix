/**

 * BOM FG weight planning calculations.

 * Run: npm test

 */



const { describe, it } = require("node:test");

const assert = require("node:assert/strict");

const {

  computeBomWeightPlanning,

  bomBaseQtyPerFgKg,

  rmRequiredForFgCount,

  effectiveQtyPerUnitWithHeaderLosses,

  lossMultiplier,

  fgWeightInGrams,

} = require("../../src/services/bomWeightPlanning");



describe("lossMultiplier — additive process + QC", () => {

  it("combines percentages additively", () => {

    assert.equal(lossMultiplier(2, 3), 1.05);

  });

});



describe("effectiveQtyPerUnitWithHeaderLosses", () => {

  it("applies additive formula", () => {

    const q = effectiveQtyPerUnitWithHeaderLosses(10, 2, 3);

    assert.equal(q, 10.5);

  });

});



describe("computeBomWeightPlanning — FG per KG", () => {

  it("FG per KG = 1000 / weight in grams (8g → 125 Nos/kg)", () => {

    const r = computeBomWeightPlanning({

      fgWeight: 8,

      fgWeightUnit: { unitName: "Gram", unitCode: "G" },

      outputQty: 1,

      processLossPercent: 2,

      qcLossPercent: 3,

    });

    assert.equal(r.weightConfigured, true);

    assert.equal(r.possibleFgPerKg, 125);

    assert.equal(r.message, null);

  });



  it("converts KG weight to grams for FG per KG", () => {

    const r = computeBomWeightPlanning({

      fgWeight: 1,

      fgWeightUnit: { unitName: "Kilogram", unitCode: "KG" },

      outputQty: 1,

      processLossPercent: 0,

      qcLossPercent: 0,

    });

    assert.equal(r.possibleFgPerKg, 1);

  });



  it("hides helper when FG weight missing", () => {

    const r = computeBomWeightPlanning({

      fgWeight: null,

      processLossPercent: 2,

      qcLossPercent: 3,

    });

    assert.equal(r.weightConfigured, false);

    assert.equal(r.possibleFgPerKg, null);

    assert.equal(r.message, null);

  });

});



describe("rmRequiredForFgCount", () => {

  it("scales base qty with additive losses", () => {

    const qty = rmRequiredForFgCount(0.5, 100, 1, 2, 3);

    assert.ok(Math.abs(qty - 52.5) < 0.01);

  });

  it("treats legacy batch qty as per-piece only after normalization", () => {
    const qty = rmRequiredForFgCount(0.392, 100, 100, 0, 0, "LEGACY_BATCH");
    assert.ok(Math.abs(qty - 0.392) < 1e-6);
  });

  it("keeps per-piece base qty unchanged", () => {
    const qty = rmRequiredForFgCount(0.00392, 100, 1, 0, 0, "PER_PIECE");
    assert.ok(Math.abs(qty - 0.392) < 1e-6);
  });

});


describe("bomBaseQtyPerFgKg", () => {

  it("normalizes legacy batch qty to per-piece kg", () => {
    assert.equal(bomBaseQtyPerFgKg(0.392, 100, "LEGACY_BATCH"), 0.00392);
  });

  it("preserves per-piece kg qty", () => {
    assert.equal(bomBaseQtyPerFgKg(0.00392, 100, "PER_PIECE"), 0.00392);
  });

});



describe("fgWeightInGrams", () => {

  it("converts kg to grams", () => {

    assert.equal(fgWeightInGrams(1, "kilogram"), 1000);

  });

});


