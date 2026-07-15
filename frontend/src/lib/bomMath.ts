/** FG weight-based BOM manufacturing planning (mirrors backend bomWeightPlanning.js). */

export type WeightUnitRef = { unitName?: string | null; unitCode?: string | null } | string | null;
export type BomNormalizationMode = "PER_PIECE" | "LEGACY_BATCH";

export type BomPlanningInput = {
  fgWeight?: number | string | null;
  fgWeightUnit?: WeightUnitRef;
  outputQty?: number | string | null;
  runnerWeight?: number | string | null;
  processLossPercent?: number | string | null;
  qcLossPercent?: number | string | null;
  normalizationMode?: BomNormalizationMode | null;
};

export type BomPlanningResult = {
  weightConfigured: boolean;
  message: string | null;
  outputQty: number;
  processLossPercent: number;
  qcLossPercent: number;
  runnerWeight: number;
  shotWeight: number | null;
  rmPerFg: number | null;
  netFgWeight: number | null;
  possibleFgPerKg: number | null;
  weightUnitLabel: string | null;
  weightUnitKind: "gram" | "kilogram" | "other" | null;
};

export type BomComputedLineInput = {
  rmItemId: number;
  mixPercent: number | "" | null | undefined;
};

export type BomComputedLineSummary = {
  rmItemId: number;
  mixPercent: number | null;
  rmWeightGm: number | null;
  effectiveRmGm: number | null;
  internalQtyKg: number | null;
};

export type BomComputedSummary = {
  weightConfigured: boolean;
  message: string | null;
  fgWeightGm: number | null;
  weightUnitLabel: string | null;
  possibleFgPerKg: number | null;
  shotWeight: number | null;
  rmPerFg: number | null;
  totalCompositionPercent: number;
  totalRmAfterWastageGm: number;
  lineSummaries: BomComputedLineSummary[];
};

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v: number) {
  return Math.round(n(v) * 1000000) / 1000000;
}

export function weightUnitKind(unit: WeightUnitRef): "gram" | "kilogram" | "other" {
  const s = String(
    typeof unit === "object" && unit != null ? unit.unitCode ?? unit.unitName ?? "" : unit ?? "",
  )
    .trim()
    .toLowerCase();
  if (s === "g" || s === "gm" || s === "gram" || s === "grams") return "gram";
  if (s === "kg" || s === "kilogram" || s === "kilograms") return "kilogram";
  return "other";
}

export function fgWeightInGrams(fgWeight: number, unitKind: ReturnType<typeof weightUnitKind>): number | null {
  const w = n(fgWeight);
  if (w <= 1e-9) return null;
  if (unitKind === "gram") return w;
  if (unitKind === "kilogram") return w * 1000;
  return null;
}

export function bomBaseQtyPerFgKg(baseQtyKg: number, outputQty: number, normalizationMode?: BomNormalizationMode | null) {
  const base = Math.max(0, n(baseQtyKg));
  if (String(normalizationMode ?? "PER_PIECE").toUpperCase() === "LEGACY_BATCH") {
    const out = Math.max(1e-9, n(outputQty ?? 1));
    return round3(base / out);
  }
  return round3(base);
}

export function bomMixPercentFromKg(baseQtyKg: number, fgWeight: number, fgWeightUnit: WeightUnitRef, outputQty: number, normalizationMode?: BomNormalizationMode | null, runnerWeight = 0) {
  const unitKind = weightUnitKind(fgWeightUnit ?? null);
  const fgWeightGm = fgWeightInGrams(fgWeight, unitKind);
  if (fgWeightGm == null || fgWeightGm <= 1e-9) return null;
  const perFgKg = bomBaseQtyPerFgKg(baseQtyKg, outputQty, normalizationMode);
  const runnerGm = weightUnitKind(fgWeightUnit) === "kilogram" ? n(runnerWeight) * 1000 : n(runnerWeight);
  const rmPerFgGm = (fgWeightGm * Math.max(1e-9, n(outputQty)) + runnerGm) / Math.max(1e-9, n(outputQty));
  return round3((perFgKg * 1000 / rmPerFgGm) * 100);
}

export function bomLineQuantitiesFromMixPercent(
  fgWeight: number,
  fgWeightUnit: WeightUnitRef,
  mixPercent: number,
  runnerWeight = 0,
  outputQty = 1,
) {
  const unitKind = weightUnitKind(fgWeightUnit ?? null);
  const fgWeightGm = fgWeightInGrams(fgWeight, unitKind);
  const mix = Math.max(0, Math.min(100, n(mixPercent)));
  if (fgWeightGm == null || fgWeightGm <= 1e-9) {
    return { rmWeightGm: null, internalQtyKg: null, effectiveQtyKg: null };
  }
  const runnerGm = unitKind === "kilogram" ? n(runnerWeight) * 1000 : n(runnerWeight);
  const shotWeightGm = fgWeightGm * Math.max(1e-9, n(outputQty)) + runnerGm;
  const rmWeightGm = round3((shotWeightGm * mix) / 100);
  const internalQtyKg = round3(rmWeightGm / Math.max(1e-9, n(outputQty)) / 1000);
  const effectiveQtyKg = internalQtyKg;
  return { rmWeightGm, internalQtyKg, effectiveQtyKg };
}

/** Compatibility export: legacy loss fields are intentionally inert. */
export function lossMultiplier(processLossPercent: number, qcLossPercent: number) {
  void processLossPercent;
  void qcLossPercent;
  return 1;
}

export function computeBomWeightPlanning(input: BomPlanningInput): BomPlanningResult {
  const fgWeight = n(input.fgWeight);
  const outputQty = Math.max(1e-9, n(input.outputQty ?? 1));
  const runnerWeight = Math.max(0, n(input.runnerWeight));
  const processLossPercent = 0;
  const qcLossPercent = 0;
  const unitKind = weightUnitKind(input.fgWeightUnit ?? null);
  const weightGrams = fgWeightInGrams(fgWeight, unitKind);
  const weightConfigured = weightGrams != null && weightGrams > 1e-9;

  if (!weightConfigured) {
    return {
      weightConfigured: false,
      message: null,
      outputQty,
      processLossPercent,
      qcLossPercent,
      runnerWeight,
      shotWeight: null,
      rmPerFg: null,
      netFgWeight: null,
      possibleFgPerKg: null,
      weightUnitLabel: null,
      weightUnitKind: unitKind === "other" ? null : unitKind,
    };
  }

  const runnerGrams = unitKind === "kilogram" ? runnerWeight * 1000 : runnerWeight;
  const shotWeightGrams = weightGrams * outputQty + runnerGrams;
  const rmPerFgGrams = shotWeightGrams / outputQty;
  const possibleFgPerKg = 1000 / rmPerFgGrams;
  const unitLabel =
    unitKind === "gram"
      ? "g"
      : unitKind === "kilogram"
        ? "kg"
        : String(
            typeof input.fgWeightUnit === "object" && input.fgWeightUnit != null
              ? input.fgWeightUnit.unitName ?? "unit"
              : "unit",
          );

  return {
    weightConfigured: true,
    message: null,
    outputQty,
    processLossPercent,
    qcLossPercent,
    runnerWeight,
    shotWeight: round3(unitKind === "kilogram" ? shotWeightGrams / 1000 : shotWeightGrams),
    rmPerFg: round3(unitKind === "kilogram" ? rmPerFgGrams / 1000 : rmPerFgGrams),
    netFgWeight: round3(fgWeight),
    possibleFgPerKg: round3(possibleFgPerKg),
    weightUnitLabel: unitLabel,
    weightUnitKind: unitKind,
  };
}

export function computedBomSummary(
  input: BomPlanningInput & {
    lines: BomComputedLineInput[];
  },
): BomComputedSummary {
  const planning = computeBomWeightPlanning(input);
  const lineSummaries: BomComputedLineSummary[] = [];

  for (const line of input.lines ?? []) {
    const mix = line.mixPercent === "" || line.mixPercent == null ? null : Number(line.mixPercent);
    if (mix == null || !Number.isFinite(mix) || !planning.weightConfigured) {
      lineSummaries.push({
        rmItemId: line.rmItemId,
        mixPercent: mix != null && Number.isFinite(mix) ? round3(mix) : null,
        rmWeightGm: null,
        effectiveRmGm: null,
        internalQtyKg: null,
      });
      continue;
    }

    const qty = bomLineQuantitiesFromMixPercent(
      Number(input.fgWeight ?? 0),
      input.fgWeightUnit ?? null,
      mix,
      Number(input.runnerWeight ?? 0),
      Number(input.outputQty ?? 1),
    );

    lineSummaries.push({
      rmItemId: line.rmItemId,
      mixPercent: round3(mix),
      rmWeightGm: qty.rmWeightGm,
      effectiveRmGm: qty.effectiveQtyKg == null ? null : round3(qty.effectiveQtyKg * 1000),
      internalQtyKg: qty.internalQtyKg,
    });
  }

  return {
    weightConfigured: planning.weightConfigured,
    message: planning.message,
    fgWeightGm: planning.netFgWeight == null ? null : planning.netFgWeight,
    weightUnitLabel: planning.weightUnitLabel,
    possibleFgPerKg: planning.possibleFgPerKg,
    shotWeight: planning.shotWeight,
    rmPerFg: planning.rmPerFg,
    totalCompositionPercent: round3(
      lineSummaries.reduce((sum, line) => sum + (line.mixPercent ?? 0), 0),
    ),
    totalRmAfterWastageGm: round3(
      lineSummaries.reduce((sum, line) => sum + (line.effectiveRmGm ?? 0), 0),
    ),
    lineSummaries,
  };
}

/** Engineering RM qty per FG; legacy loss arguments are ignored. */
export function effectiveQtyWithHeaderLosses(
  baseQty: number,
  processLossPercent: number,
  qcLossPercent = 0,
) {
  void processLossPercent;
  void qcLossPercent;
  return round3(Math.max(0, n(baseQty)));
}

export function rmRequiredForFgCount(
  baseQty: number,
  fgCount: number,
  outputQty: number,
  processLossPercent: number,
  qcLossPercent: number,
) {
  void processLossPercent;
  void qcLossPercent;
  const base = Math.max(0, n(baseQty));
  const out = Math.max(1e-9, n(outputQty ?? 1));
  const count = Math.max(0, n(fgCount));
  const perFgBase = base / out;
  return round3(count * perFgBase);
}

/** @deprecated Use effectiveQtyWithHeaderLosses — kept for any legacy imports. */
export function effectiveQty(baseQty: number, processLossPercent: number, qcAllowancePercent = 0) {
  return effectiveQtyWithHeaderLosses(baseQty, processLossPercent, qcAllowancePercent);
}
