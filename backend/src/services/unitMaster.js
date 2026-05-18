const { prisma } = require("../utils/prisma");

function normalizeUnitKey(raw) {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return t.length ? t : "";
}

function normalizeUnitCode(raw) {
  const t = String(raw ?? "").trim().toUpperCase();
  return t.length ? t : null;
}

function normalizeUnitName(raw) {
  const t = String(raw ?? "").trim();
  return t.length ? t : null;
}

function normalizeSymbol(raw) {
  const t = String(raw ?? "").trim();
  return t.length ? t : null;
}

const DEFAULT_UNITS = [
  { unitName: "Nos", unitCode: "NOS" },
  { unitName: "Kg", unitCode: "KG" },
  { unitName: "Meter", unitCode: "MTR" },
  { unitName: "Box", unitCode: "BOX" },
  { unitName: "Ltr", unitCode: "LTR" },
];

function unitCodeMatches(rowCode, targetCode) {
  const a = normalizeUnitCode(rowCode);
  const b = normalizeUnitCode(targetCode);
  return Boolean(a && b && a === b);
}

function unitNameMatches(rowName, targetName) {
  const a = normalizeUnitName(rowName);
  const b = normalizeUnitName(targetName);
  if (!a || !b) return false;
  return normalizeUnitKey(a) === normalizeUnitKey(b);
}

function symbolMatches(rowSymbol, targetSymbol) {
  const a = normalizeSymbol(rowSymbol);
  const b = normalizeSymbol(targetSymbol);
  return Boolean(a && b && a === b);
}

/** Find rows matching default spec by unitCode, unitName, or symbol (when provided). */
function findUnitsMatchingSpec(allUnits, spec) {
  const targetCode = normalizeUnitCode(spec.unitCode);
  const targetName = normalizeUnitName(spec.unitName);
  const targetSymbol = spec.symbol != null ? normalizeSymbol(spec.symbol) : null;

  return allUnits.filter((row) => {
    if (targetCode && unitCodeMatches(row.unitCode, targetCode)) return true;
    if (targetName && unitNameMatches(row.unitName, targetName)) return true;
    if (targetSymbol && row.symbol != null && symbolMatches(row.symbol, targetSymbol)) return true;
    return false;
  });
}

function isUnitCodeTaken(allUnits, unitCode, exceptId) {
  const key = normalizeUnitCode(unitCode);
  if (!key) return false;
  return allUnits.some(
    (u) => u.id !== exceptId && u.unitCode != null && normalizeUnitCode(u.unitCode) === key,
  );
}

function isUnitNameTaken(allUnits, unitName, exceptId) {
  const key = normalizeUnitKey(unitName);
  if (!key) return false;
  return allUnits.some((u) => u.id !== exceptId && normalizeUnitKey(u.unitName) === key);
}

function buildSafeUnitPatch(existing, spec, allUnits) {
  const patch = {};
  const targetCode = normalizeUnitCode(spec.unitCode);

  if (!existing.isActive) {
    patch.isActive = true;
  }

  const hasCode =
    existing.unitCode != null && String(existing.unitCode).trim() !== "";
  if (!hasCode && targetCode) {
    if (isUnitCodeTaken(allUnits, targetCode, existing.id)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[unitMaster] Unit id=${existing.id} (${existing.unitName}): cannot set unitCode=${targetCode} — already used by another row`,
      );
    } else {
      patch.unitCode = targetCode;
    }
  }

  return patch;
}

function warnSeedSkip(label, detail) {
  // eslint-disable-next-line no-console
  console.warn(`[unitMaster] ${label}: ${detail} — skipping seed for this default`);
}

/**
 * Ensure default units exist. Idempotent: reuses existing rows matched by code/name/symbol
 * and only fills missing fields; never deletes rows or overwrites conflicting uniques.
 */
async function ensureDefaultUnitsSeeded() {
  const allUnits = await prisma.unit.findMany();

  for (const spec of DEFAULT_UNITS) {
    const targetCode = normalizeUnitCode(spec.unitCode);
    const targetName = normalizeUnitName(spec.unitName);
    const label = `${targetName ?? "?"}/${targetCode ?? "?"}`;

    const candidates = findUnitsMatchingSpec(allUnits, spec);

    if (candidates.length > 1) {
      warnSeedSkip(
        "Duplicate/conflicting Unit rows",
        `${label} matched ids ${candidates.map((u) => u.id).join(", ")}`,
      );
      continue;
    }

    if (candidates.length === 1) {
      const row = candidates[0];
      const patch = buildSafeUnitPatch(row, spec, allUnits);
      if (Object.keys(patch).length > 0) {
        const updated = await prisma.unit.update({
          where: { id: row.id },
          data: patch,
        });
        Object.assign(row, updated);
      }
      continue;
    }

    const codeConflict = targetCode && isUnitCodeTaken(allUnits, targetCode, null);
    const nameConflict = targetName && isUnitNameTaken(allUnits, targetName, null);

    if (codeConflict || nameConflict) {
      const parts = [];
      if (codeConflict) parts.push(`unitCode ${targetCode} already exists`);
      if (nameConflict) parts.push(`unitName ${targetName} already exists`);
      warnSeedSkip("Cannot create default unit", `${label} (${parts.join("; ")})`);
      continue;
    }

    const created = await prisma.unit.create({
      data: {
        unitName: targetName,
        unitCode: targetCode,
        isActive: true,
      },
    });
    allUnits.push(created);
  }
}

async function backfillLegacyItemUnitLinks() {
  const units = await prisma.unit.findMany({ where: { isActive: true } });
  const byKey = new Map(units.map((u) => [normalizeUnitKey(u.unitName), u]));
  const byCode = new Map(
    units
      .filter((u) => u.unitCode)
      .map((u) => [normalizeUnitKey(u.unitCode), u]),
  );

  const items = await prisma.item.findMany({
    where: { unitId: null },
    select: { id: true, unit: true },
  });

  for (const it of items) {
    const key = normalizeUnitKey(it.unit);
    if (!key) continue;
    const match = byKey.get(key) || byCode.get(key);
    if (!match) continue;
    await prisma.item.update({ where: { id: it.id }, data: { unitId: match.id } });
  }
}

module.exports = {
  DEFAULT_UNITS,
  normalizeUnitKey,
  normalizeUnitCode,
  normalizeUnitName,
  ensureDefaultUnitsSeeded,
  backfillLegacyItemUnitLinks,
};
