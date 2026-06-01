/**

 * FG weight-based BOM manufacturing planning (additive process + QC loss).

 * Operational helpers only — not accounting/costing.

 */



const EPS = 1e-9;



function n(v) {

  const x = typeof v === "number" ? v : Number(v);

  return Number.isFinite(x) ? x : 0;

}



function round3(v) {

  return Math.round(n(v) * 1000000) / 1000000;

}



/** Normalize unit name/code to gram | kilogram | other */

function weightUnitKind(unit) {

  const s = String(unit?.unitCode ?? unit?.unitName ?? unit ?? "")

    .trim()

    .toLowerCase();

  if (s === "g" || s === "gm" || s === "gram" || s === "grams") return "gram";

  if (s === "kg" || s === "kilogram" || s === "kilograms") return "kilogram";

  return "other";

}



/** FG weight expressed in grams for FG-per-KG helper. */

function fgWeightInGrams(fgWeight, unitKind) {

  const w = n(fgWeight);

  if (w <= EPS) return null;

  if (unitKind === "gram") return w;

  if (unitKind === "kilogram") return w * 1000;

  return null;

}



/**

 * Additive loss multiplier:

 * Base × (1 + Process% / 100 + QC% / 100)

 */

function lossMultiplier(processLossPercent, qcLossPercent) {

  const pl = Math.max(0, Math.min(100, n(processLossPercent)));

  const ql = Math.max(0, Math.min(100, n(qcLossPercent)));

  return 1 + pl / 100 + ql / 100;

}

function bomNormalizationModeValue(value) {
  return String(value ?? "PER_PIECE").toUpperCase() === "LEGACY_BATCH" ? "LEGACY_BATCH" : "PER_PIECE";
}

function normalizedBaseQtyPerFg(baseQty, outputQty, normalizationMode) {
  const base = Math.max(0, n(baseQty));
  const mode = bomNormalizationModeValue(normalizationMode);
  if (mode === "LEGACY_BATCH") {
    const out = Math.max(EPS, n(outputQty ?? 1));
    return base / out;
  }
  return base;
}



/**

 * Effective RM qty per FG output unit (header-level losses).

 */

function effectiveQtyPerUnitWithHeaderLosses(baseQty, processLossPercent, qcLossPercent) {

  return round3(Math.max(0, n(baseQty)) * lossMultiplier(processLossPercent, qcLossPercent));

}



/**

 * @param {{

 *   fgWeight?: number | string | null;

 *   fgWeightUnit?: { unitName?: string | null; unitCode?: string | null } | string | null;

 *   outputQty?: number | string | null;

 *   processLossPercent?: number | string | null;

 *   qcLossPercent?: number | string | null;

 * }} input

 */

function computeBomWeightPlanning(input) {

  const fgWeight = n(input?.fgWeight);

  const outputQty = Math.max(EPS, n(input?.outputQty ?? 1));

  const processLossPercent = Math.max(0, Math.min(100, n(input?.processLossPercent)));

  const qcLossPercent = Math.max(0, Math.min(100, n(input?.qcLossPercent)));

  const unitKind = weightUnitKind(input?.fgWeightUnit);

  const weightGrams = fgWeightInGrams(fgWeight, unitKind);

  const weightConfigured = weightGrams != null && weightGrams > EPS;



  if (!weightConfigured) {

    return {

      weightConfigured: false,

      message: null,

      outputQty,

      processLossPercent,

      qcLossPercent,

      netFgWeight: null,

      possibleFgPerKg: null,

      weightUnitLabel: null,

      weightUnitKind: unitKind === "other" ? null : unitKind,

      rmRequiredSamples: [],

    };

  }



  const possibleFgPerKg = 1000 / weightGrams;

  const unitLabel =

    unitKind === "gram" ? "g" : unitKind === "kilogram" ? "kg" : String(input?.fgWeightUnit?.unitName ?? "unit");



  return {

    weightConfigured: true,

    message: null,

    outputQty,

    processLossPercent,

    qcLossPercent,

    netFgWeight: round3(fgWeight),

    possibleFgPerKg: round3(possibleFgPerKg),

    weightUnitLabel: unitLabel,

    weightUnitKind: unitKind,

    rmRequiredSamples: [],

  };

}



/**

 * RM qty required for a target FG output count.

 * Required RM = FG qty × (base per output batch) × loss multiplier, scaled by outputQty.

 */

function rmRequiredForFgCount(baseQty, fgCount, outputQty, processLossPercent, qcLossPercent, normalizationMode) {

  const count = Math.max(0, n(fgCount));
  const perFgBase = normalizedBaseQtyPerFg(baseQty, outputQty, normalizationMode);
  return round3(count * perFgBase * lossMultiplier(processLossPercent, qcLossPercent));

}



/**

 * Attach planning analytics + per-line RM projections to a BOM row (Prisma shape).

 */

function enrichBomWithPlanning(bom) {

  if (!bom || typeof bom !== "object") return bom;

  const unit = bom.fgWeightUnit ?? null;

  const planning = computeBomWeightPlanning({

    fgWeight: bom.fgWeight,

    fgWeightUnit: unit,

    outputQty: bom.outputQty,

    processLossPercent: bom.processLossPercent,

    qcLossPercent: bom.qcLossPercent,

  });



  const lines = (bom.lines ?? []).map((ln) => {

    const perFgBase = normalizedBaseQtyPerFg(ln.baseQty, bom.outputQty, bom.normalizationMode);

    const perFg = rmRequiredForFgCount(

      ln.baseQty,

      1,

      bom.outputQty,

      bom.processLossPercent,

      bom.qcLossPercent,

      bom.normalizationMode,

    );

    const for1000 = rmRequiredForFgCount(

      ln.baseQty,

      1000,

      bom.outputQty,

      bom.processLossPercent,

      bom.qcLossPercent,

      bom.normalizationMode,

    );

    const for10000 = rmRequiredForFgCount(

      ln.baseQty,

      10000,

      bom.outputQty,

      bom.processLossPercent,

      bom.qcLossPercent,

      bom.normalizationMode,

    );

    const eff = effectiveQtyPerUnitWithHeaderLosses(

      perFgBase,

      bom.processLossPercent,

      bom.qcLossPercent,

    );

    return {

      ...ln,

      baseQtyPerFg: round3(perFgBase),

      effectiveQty: eff,

      rmRequiredPerFg: perFg,

      rmRequiredFor1000Fg: for1000,

      rmRequiredFor10000Fg: for10000,

    };

  });



  return {

    ...bom,

    planning,

    lines,

  };

}



module.exports = {

  computeBomWeightPlanning,

  rmRequiredForFgCount,

  enrichBomWithPlanning,

  weightUnitKind,

  bomBaseQtyPerFgKg: normalizedBaseQtyPerFg,

  bomNormalizationModeValue,

  normalizedBaseQtyPerFg,

  fgWeightInGrams,

  lossMultiplier,

  effectiveQtyPerUnitWithHeaderLosses,

};


