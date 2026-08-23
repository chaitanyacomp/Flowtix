/**
 * BOM purging RM planning — master-data standard × planned purge count.
 * Allocates purging across leaf RM using BOM composition (mix % / baseQty weights).
 * Do NOT multiply by production-run count or physical setup count.
 * Does not change FG qty, runner weight, or production shot RM formulas.
 */

const { approvedBomWhere, approvedBomOrderBy } = require("./bomStatus");
const { componentTypeFromItemType } = require("./bomComponentService");
const {
  physicalRmSupportedProductionQty,
  consumptionPerFg,
} = require("./regularSoRmIssuePlanning");

const EPS = 1e-9;
const PURGING_RECONCILE_EPS = 1e-6;
const MAX_PLANNED_PURGE_COUNT = 9999;
const PLANNED_PURGE_COUNT_LABEL = "Planned Purge Count";
/** @deprecated Not used as purging multiplier. */
const MAX_PLANNED_SETUP_COUNT = 9999;
const PLANNED_SETUP_COUNT_LABEL = "Planned Setup Count";

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

/** Whole number ≥ 0 for planned purge events (may be zero). */
function parsePlannedPurgeCount(value, { allowDefault = true } = {}) {
  if (value == null || value === "") {
    if (allowDefault) return 0;
    const err = new Error(`${PLANNED_PURGE_COUNT_LABEL} is required.`);
    err.statusCode = 400;
    throw err;
  }
  let parsed;
  if (typeof value === "number") parsed = value;
  else if (typeof value === "string" && /^\d+$/.test(value.trim())) parsed = Number(value.trim());
  else {
    const err = new Error(`${PLANNED_PURGE_COUNT_LABEL} must be a whole number.`);
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    const err = new Error(`${PLANNED_PURGE_COUNT_LABEL} must be a whole number ≥ 0.`);
    err.statusCode = 400;
    throw err;
  }
  if (parsed > MAX_PLANNED_PURGE_COUNT) {
    const err = new Error(
      `${PLANNED_PURGE_COUNT_LABEL} cannot exceed ${MAX_PLANNED_PURGE_COUNT}.`,
    );
    err.statusCode = 400;
    throw err;
  }
  return parsed;
}

/** @param {unknown} value */
function parsePlannedSetupCount(value, { allowDefault = true } = {}) {
  if (value == null || value === "") {
    if (allowDefault) return 1;
    const err = new Error(`${PLANNED_SETUP_COUNT_LABEL} is required.`);
    err.statusCode = 400;
    throw err;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      const err = new Error(`${PLANNED_SETUP_COUNT_LABEL} must be a whole number.`);
      err.statusCode = 400;
      throw err;
    }
    if (value < 1) {
      const err = new Error(`${PLANNED_SETUP_COUNT_LABEL} must be at least 1.`);
      err.statusCode = 400;
      throw err;
    }
    if (value > MAX_PLANNED_SETUP_COUNT) {
      const err = new Error(
        `${PLANNED_SETUP_COUNT_LABEL} cannot exceed ${MAX_PLANNED_SETUP_COUNT}.`,
      );
      err.statusCode = 400;
      throw err;
    }
    return value;
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (raw === "") {
      if (allowDefault) return 1;
      const err = new Error(`${PLANNED_SETUP_COUNT_LABEL} is required.`);
      err.statusCode = 400;
      throw err;
    }
    if (!/^\d+$/.test(raw)) {
      const err = new Error(`${PLANNED_SETUP_COUNT_LABEL} must be a whole number.`);
      err.statusCode = 400;
      throw err;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) {
      const err = new Error(`${PLANNED_SETUP_COUNT_LABEL} must be at least 1.`);
      err.statusCode = 400;
      throw err;
    }
    if (parsed > MAX_PLANNED_SETUP_COUNT) {
      const err = new Error(
        `${PLANNED_SETUP_COUNT_LABEL} cannot exceed ${MAX_PLANNED_SETUP_COUNT}.`,
      );
      err.statusCode = 400;
      throw err;
    }
    return parsed;
  }
  const err = new Error(`${PLANNED_SETUP_COUNT_LABEL} must be a whole number.`);
  err.statusCode = 400;
  throw err;
}

function weightUnitKind(unit) {
  const s = String(unit?.unitCode ?? unit?.unitName ?? unit ?? "")
    .trim()
    .toLowerCase();
  if (s === "g" || s === "gm" || s === "gram" || s === "grams") return "gram";
  if (s === "kg" || s === "kilogram" || s === "kilograms") return "kilogram";
  return "other";
}

function fgWeightInGrams(fgWeight, unitKind) {
  const w = n(fgWeight);
  if (w <= EPS) return null;
  if (unitKind === "gram") return w;
  if (unitKind === "kilogram") return w * 1000;
  return null;
}

function bomNormalizationModeValue(value) {
  return String(value ?? "PER_PIECE").toUpperCase() === "LEGACY_BATCH" ? "LEGACY_BATCH" : "PER_PIECE";
}

function bomBaseQtyPerFgKg(baseQtyKg, outputQty, normalizationMode) {
  const base = Math.max(0, n(baseQtyKg));
  if (bomNormalizationModeValue(normalizationMode) === "LEGACY_BATCH") {
    const out = Math.max(EPS, n(outputQty ?? 1));
    return round3(base / out);
  }
  return round3(base);
}

function bomMixPercentFromLine(bom, line) {
  const fgWeight = n(bom.fgWeight);
  const outputQty = Math.max(EPS, n(bom.outputQty ?? 1));
  const runnerWeight = Math.max(0, n(bom.runnerWeight ?? 0));
  const unitKind = weightUnitKind(bom.fgWeightUnit);
  const fgWeightGm = fgWeightInGrams(fgWeight, unitKind);
  if (fgWeightGm == null || fgWeightGm <= EPS) return null;
  const perFgKg = bomBaseQtyPerFgKg(line.baseQty, outputQty, bom.normalizationMode);
  const runnerGm = unitKind === "kilogram" ? runnerWeight * 1000 : runnerWeight;
  const rmPerFgGm = (fgWeightGm * outputQty + runnerGm) / outputQty;
  if (rmPerFgGm <= EPS) return null;
  return round3((perFgKg * 1000 / rmPerFgGm) * 100);
}

function lineMixWeights(bom) {
  const lines = bom?.lines ?? [];
  const weighted = [];
  for (const line of lines) {
    const item = line.rmItem;
    if (!item) continue;
    const mix = bomMixPercentFromLine(bom, line);
    if (mix != null && mix > EPS) {
      weighted.push({ line, weight: mix, mixPercent: mix });
    } else {
      const base = Math.max(0, n(line.baseQty));
      if (base > EPS) weighted.push({ line, weight: base, mixPercent: null });
    }
  }
  const total = weighted.reduce((s, w) => s + w.weight, 0);
  if (total <= EPS) return [];
  return weighted.map((w) => ({
    line: w.line,
    mixPercent: w.mixPercent != null ? w.mixPercent : round3((w.weight / total) * 100),
    share: w.weight / total,
  }));
}

function reconcileRoundedAllocations(allocations, totalKg) {
  const target = round3(Math.max(0, n(totalKg)));
  if (!allocations.length || target <= EPS) return allocations;
  let sum = round3(allocations.reduce((s, row) => s + n(row.qtyKg), 0));
  const drift = round3(target - sum);
  if (Math.abs(drift) <= PURGING_RECONCILE_EPS) return allocations;
  const pick =
    allocations.reduce(
      (best, row) => (n(row.qtyKg) > n(best.qtyKg) ? row : best),
      allocations[0],
    );
  pick.qtyKg = round3(Math.max(0, n(pick.qtyKg) + drift));
  sum = round3(allocations.reduce((s, row) => s + n(row.qtyKg), 0));
  if (Math.abs(target - sum) > PURGING_RECONCILE_EPS + 1e-3) {
    const err = new Error("Purging RM allocation could not reconcile to total planned purging.");
    err.statusCode = 500;
    throw err;
  }
  return allocations;
}

async function loadApprovedBomForPurging(tx, fgItemId) {
  return tx.bom.findFirst({
    where: approvedBomWhere(fgItemId),
    orderBy: approvedBomOrderBy,
    include: {
      fgWeightUnit: true,
      lines: {
        include: { rmItem: true },
        orderBy: { id: "asc" },
      },
    },
  });
}

function addToRmMap(map, rmItemId, qtyKg) {
  const id = Number(rmItemId);
  const add = round3(Math.max(0, n(qtyKg)));
  if (!(id > 0) || add <= EPS) return;
  map.set(id, round3((map.get(id) || 0) + add));
}

async function distributePurgingKgToLeafRm(tx, fgItemId, totalKg, depth = 1, outMap = new Map()) {
  if (depth > 3 || totalKg <= EPS) return outMap;
  const bom = await loadApprovedBomForPurging(tx, fgItemId);
  if (!bom?.lines?.length) return outMap;

  const weights = lineMixWeights(bom);
  if (!weights.length) return outMap;

  const allocations = weights.map((w) => ({
    line: w.line,
    mixPercent: w.mixPercent,
    qtyKg: round3(totalKg * w.share),
  }));
  reconcileRoundedAllocations(allocations, totalKg);

  for (const row of allocations) {
    const line = row.line;
    const item = line.rmItem;
    if (!item) continue;
    const ct = componentTypeFromItemType(item.itemType);
    if (ct === "RM" || ct === "CONSUMABLE") {
      addToRmMap(outMap, item.id, row.qtyKg);
    } else if (ct === "SFG") {
      await distributePurgingKgToLeafRm(tx, item.id, row.qtyKg, depth + 1, outMap);
    }
  }
  return outMap;
}

/**
 * @returns {Promise<{
 *   standardPurgingQtyGramsPerSetup: number,
 *   plannedPurgeCount: number,
 *   totalPlannedPurgingGrams: number,
 *   totalPlannedPurgingKg: number,
 *   purgingRmByItemId: Map<number, number>,
 *   allocationLines: Array<{ rmItemId: number, mixPercent: number, purgingQtyKg: number }>,
 * }>}
 */
async function computePurgingRmForFg(tx, fgItemId, plannedPurgeCountInput) {
  const plannedPurgeCount = parsePlannedPurgeCount(plannedPurgeCountInput);
  const bom = await loadApprovedBomForPurging(tx, fgItemId);
  const standardPurgingQtyGramsPerSetup = bom ? n(bom.standardPurgingQtyGrams) : 0;
  const totalPlannedPurgingGrams = round3(standardPurgingQtyGramsPerSetup * plannedPurgeCount);
  const totalPlannedPurgingKg = round3(totalPlannedPurgingGrams / 1000);

  const purgingRmByItemId = new Map();
  const allocationLines = [];

  if (totalPlannedPurgingKg > EPS && bom) {
    const distributed = await distributePurgingKgToLeafRm(tx, fgItemId, totalPlannedPurgingKg);
    for (const [rmItemId, qtyKg] of distributed.entries()) {
      purgingRmByItemId.set(rmItemId, qtyKg);
      allocationLines.push({
        rmItemId,
        mixPercent: null,
        purgingQtyKg: qtyKg,
      });
    }
  }

  return {
    standardPurgingQtyGramsPerSetup,
    plannedPurgeCount,
    totalPlannedPurgingGrams,
    totalPlannedPurgingKg,
    purgingRmByItemId,
    allocationLines,
  };
}

/**
 * Merge purging RM into production RM map (returns copy of production-only map).
 */
function snapshotProductionRmMap(rmNeeded) {
  const production = new Map();
  if (rmNeeded instanceof Map) {
    for (const [id, qty] of rmNeeded.entries()) production.set(id, round3(n(qty)));
  }
  return production;
}

function mergePurgingIntoRmNeeded(rmNeeded, purgingRmByItemId) {
  if (!(rmNeeded instanceof Map)) return;
  for (const [rmItemId, qtyKg] of purgingRmByItemId.entries()) {
    addToRmMap(rmNeeded, rmItemId, qtyKg);
  }
}

/**
 * Resolve purge count for one FG from options.
 * Prefer per-FG map from detection; fall back to scalar plannedPurgeCount only.
 * Never uses legacy plannedSetupCount.
 */
function resolvePurgeCountForFg(options, fgItemId) {
  if (options == null || typeof options !== "object" || Array.isArray(options)) {
    return parsePlannedPurgeCount(options);
  }
  const byFg = options.purgeCountByFgItemId;
  if (byFg instanceof Map && byFg.has(Number(fgItemId))) {
    return parsePlannedPurgeCount(byFg.get(Number(fgItemId)), { allowDefault: false });
  }
  if (byFg && typeof byFg === "object" && byFg[fgItemId] != null) {
    return parsePlannedPurgeCount(byFg[fgItemId], { allowDefault: false });
  }
  if (byFg && typeof byFg === "object" && byFg[String(fgItemId)] != null) {
    return parsePlannedPurgeCount(byFg[String(fgItemId)], { allowDefault: false });
  }
  return parsePlannedPurgeCount(options.plannedPurgeCount ?? 0);
}

/** @deprecated Use resolvePurgeCountForFg — does not read plannedSetupCount. */
function resolveSetupCountForFg(options, fgItemId) {
  return resolvePurgeCountForFg(options, fgItemId);
}

/**
 * Add purging for each unique FG in fgLines into rmNeeded.
 * @param {number | { plannedPurgeCount?: number, purgeCountByFgItemId?: Map<number, number>|Record<string, number> }} plannedPurgeCountInput
 */
async function addPurgingRmForFgLines(tx, rmNeeded, fgLines, plannedPurgeCountInput) {
  const options =
    plannedPurgeCountInput != null &&
    typeof plannedPurgeCountInput === "object" &&
    !Array.isArray(plannedPurgeCountInput)
      ? plannedPurgeCountInput
      : { plannedPurgeCount: plannedPurgeCountInput };
  const seen = new Set();
  for (const row of fgLines ?? []) {
    const fgItemId = Number(row.fgItemId);
    if (!fgItemId || row.bomMissing || seen.has(fgItemId)) continue;
    seen.add(fgItemId);
    const plannedPurgeCount = resolvePurgeCountForFg(options, fgItemId);
    const purge = await computePurgingRmForFg(tx, fgItemId, plannedPurgeCount);
    mergePurgingIntoRmNeeded(rmNeeded, purge.purgingRmByItemId);
  }
}

/**
 * Build purging planning summary for API/UI (single or multi-FG).
 */
async function buildPurgingPlanningSummary(tx, fgInput, plannedPurgeCountInput) {
  const options =
    plannedPurgeCountInput != null &&
    typeof plannedPurgeCountInput === "object" &&
    !Array.isArray(plannedPurgeCountInput)
      ? plannedPurgeCountInput
      : { plannedPurgeCount: plannedPurgeCountInput };
  const byFgItem = [];
  let totalPlannedPurgingGrams = 0;
  let totalPurgeCount = 0;
  const purgingRmByItemId = new Map();
  const seen = new Set();

  for (const row of fgInput ?? []) {
    const fgItemId = Number(row.fgItemId);
    if (!fgItemId || seen.has(fgItemId)) continue;
    seen.add(fgItemId);
    const plannedPurgeCount = resolvePurgeCountForFg(options, fgItemId);
    totalPurgeCount += plannedPurgeCount;
    const purge = await computePurgingRmForFg(tx, fgItemId, plannedPurgeCount);
    totalPlannedPurgingGrams = round3(totalPlannedPurgingGrams + purge.totalPlannedPurgingGrams);
    mergePurgingIntoRmNeeded(purgingRmByItemId, purge.purgingRmByItemId);
    byFgItem.push({
      fgItemId,
      fgName: row.fgName ?? "",
      ...purge,
      purgingRmByItemId: Object.fromEntries(purge.purgingRmByItemId),
    });
  }

  const standardPurgingQtyGramsPerSetup =
    byFgItem.length === 1 ? byFgItem[0].standardPurgingQtyGramsPerSetup : null;

  const plannedPurgeCount =
    options.purgeCountByFgItemId != null
      ? totalPurgeCount
      : parsePlannedPurgeCount(options.plannedPurgeCount ?? totalPurgeCount);

  return {
    plannedPurgeCount,
    productionRunCount: options.productionRunCount ?? null,
    plannedMachineSetupCount: options.plannedMachineSetupCount ?? null,
    physicalSetupConfirmationRequired: options.physicalSetupConfirmationRequired ?? true,
    purgingDetectionSource: options.purgingDetectionSource ?? "DETECTION",
    purgingDetectionLabel: options.purgingDetectionLabel ?? null,
    standardPurgingQtyGramsPerSetup,
    totalPlannedPurgingGrams,
    totalPlannedPurgingKg: round3(totalPlannedPurgingGrams / 1000),
    purgingRmByItemId,
    byFgItem,
  };
}

/**
 * RM-supported FG capacity after reserving purging RM (production shot only).
 */
function rmSupportedProductionQtyAfterPurging({
  freeStockKg,
  productionTheoreticalRmKg,
  woTargetQty,
  purgingRmKg = 0,
}) {
  const free = Math.max(0, n(freeStockKg));
  const purging = Math.max(0, n(purgingRmKg));
  const netForProduction = round3(Math.max(0, free - purging));
  const perFg = consumptionPerFg(productionTheoreticalRmKg, woTargetQty);
  return physicalRmSupportedProductionQty(netForProduction, perFg);
}

module.exports = {
  MAX_PLANNED_SETUP_COUNT,
  MAX_PLANNED_PURGE_COUNT,
  PLANNED_SETUP_COUNT_LABEL,
  PLANNED_PURGE_COUNT_LABEL,
  parsePlannedSetupCount,
  parsePlannedPurgeCount,
  resolveSetupCountForFg,
  resolvePurgeCountForFg,
  computePurgingRmForFg,
  addPurgingRmForFgLines,
  buildPurgingPlanningSummary,
  mergePurgingIntoRmNeeded,
  snapshotProductionRmMap,
  rmSupportedProductionQtyAfterPurging,
  round3: round3,
};
