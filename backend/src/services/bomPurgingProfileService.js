/**
 * Deterministic purging profile from approved BOM leaf-RM composition.
 * Fingerprint is based on RM identity + normalized mix % only (not FG identity).
 */
const crypto = require("crypto");
const { approvedBomWhere, approvedBomOrderBy } = require("./bomStatus");
const { componentTypeFromItemType } = require("./bomComponentService");

const EPS = 1e-9;
const MIX_DP = 4; // normalized mix % precision for fingerprint stability

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function roundTo(v, dp) {
  const f = 10 ** dp;
  return Math.round(n(v) * f) / f;
}

function weightUnitKind(unit) {
  const s = String(unit?.unitCode ?? unit?.unitName ?? unit ?? "")
    .trim()
    .toLowerCase();
  if (s === "g" || s === "gm" || s === "gram" || s === "grams") return "gram";
  if (s === "kg" || s === "kilogram" || s === "kilograms") return "kilogram";
  return "other";
}

function bomNormalizationModeValue(value) {
  return String(value ?? "PER_PIECE").toUpperCase() === "LEGACY_BATCH" ? "LEGACY_BATCH" : "PER_PIECE";
}

function bomBaseQtyPerFgKg(baseQtyKg, outputQty, normalizationMode) {
  const base = Math.max(0, n(baseQtyKg));
  if (bomNormalizationModeValue(normalizationMode) === "LEGACY_BATCH") {
    const out = Math.max(EPS, n(outputQty ?? 1));
    return base / out;
  }
  return base;
}

function bomMixPercentFromLine(bom, line) {
  const fgWeight = n(bom.fgWeight);
  const unitKind = weightUnitKind(bom.fgWeightUnit);
  if (line.mixPercent != null && Number.isFinite(n(line.mixPercent)) && n(line.mixPercent) > 0) {
    return n(line.mixPercent);
  }
  // Fall back to baseQty share of FG weight when mix % missing.
  const base = bomBaseQtyPerFgKg(line.baseQty, bom.outputQty, bom.normalizationMode);
  if (fgWeight > EPS && unitKind === "kilogram") return (base / fgWeight) * 100;
  if (fgWeight > EPS && unitKind === "gram") return (base / (fgWeight / 1000)) * 100;
  return null;
}

async function loadApprovedBom(tx, itemId) {
  return tx.bom.findFirst({
    where: approvedBomWhere(itemId),
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

/**
 * Accumulate leaf RM mix weights (unnormalized) for an FG/SFG item.
 * @returns {Promise<Map<number, number>>} rmItemId → weight
 */
async function accumulateLeafRmWeights(tx, itemId, parentShare = 1, depth = 1, out = new Map()) {
  if (depth > 8 || !(parentShare > EPS)) return out;
  const bom = await loadApprovedBom(tx, itemId);
  if (!bom?.lines?.length) return out;

  const rows = [];
  for (const line of bom.lines) {
    const item = line.rmItem;
    if (!item) continue;
    const mix = bomMixPercentFromLine(bom, line);
    let weight;
    if (mix != null && mix > EPS) {
      weight = mix;
    } else {
      weight = bomBaseQtyPerFgKg(line.baseQty, bom.outputQty, bom.normalizationMode);
    }
    if (!(weight > EPS)) continue;
    rows.push({ item, weight });
  }
  const total = rows.reduce((s, r) => s + r.weight, 0);
  if (!(total > EPS)) return out;

  for (const row of rows) {
    const share = parentShare * (row.weight / total);
    const ct = componentTypeFromItemType(row.item.itemType);
    if (ct === "RM" || ct === "CONSUMABLE") {
      const id = Number(row.item.id);
      out.set(id, (out.get(id) || 0) + share);
    } else if (ct === "SFG") {
      await accumulateLeafRmWeights(tx, row.item.id, share, depth + 1, out);
    }
  }
  return out;
}

/**
 * Build normalized leaf-RM purging profile for an FG (or SFG) item.
 * @returns {Promise<{
 *   fingerprint: string,
 *   components: Array<{ rmItemId: number, mixPercent: number }>,
 *   empty: boolean,
 * }>}
 */
async function buildPurgingProfileForFg(tx, fgItemId) {
  const weights = await accumulateLeafRmWeights(tx, Number(fgItemId));
  const total = [...weights.values()].reduce((s, v) => s + v, 0);
  if (!(total > EPS)) {
    return { fingerprint: "empty", components: [], empty: true };
  }

  const components = [...weights.entries()]
    .map(([rmItemId, w]) => ({
      rmItemId: Number(rmItemId),
      mixPercent: roundTo((w / total) * 100, MIX_DP),
    }))
    .filter((c) => c.rmItemId > 0 && c.mixPercent > EPS)
    .sort((a, b) => a.rmItemId - b.rmItemId);

  // Re-normalize after rounding so percentages sum to 100 within tolerance.
  const sumPct = components.reduce((s, c) => s + c.mixPercent, 0);
  if (components.length && Math.abs(sumPct - 100) > 1e-6) {
    const last = components[components.length - 1];
    last.mixPercent = roundTo(last.mixPercent + (100 - sumPct), MIX_DP);
  }

  const fingerprint = fingerprintFromComponents(components);
  return { fingerprint, components, empty: components.length === 0 };
}

function fingerprintFromComponents(components) {
  const sorted = [...(components ?? [])]
    .map((c) => ({
      rmItemId: Number(c.rmItemId),
      mixPercent: roundTo(c.mixPercent, MIX_DP),
    }))
    .filter((c) => c.rmItemId > 0 && c.mixPercent > EPS)
    .sort((a, b) => a.rmItemId - b.rmItemId);
  if (!sorted.length) return "empty";
  const canonical = sorted.map((c) => `${c.rmItemId}:${c.mixPercent.toFixed(MIX_DP)}`).join("|");
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 40);
}

function profilesEqual(a, b) {
  const fa = a?.fingerprint ?? a ?? null;
  const fb = b?.fingerprint ?? b ?? null;
  if (!fa || !fb) return false;
  return String(fa) === String(fb);
}

module.exports = {
  MIX_DP,
  buildPurgingProfileForFg,
  fingerprintFromComponents,
  profilesEqual,
  accumulateLeafRmWeights,
  roundTo,
};
