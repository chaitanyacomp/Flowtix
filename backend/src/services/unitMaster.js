const { prisma } = require("../utils/prisma");

function normalizeUnitKey(raw) {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return t.length ? t : "";
}

const DEFAULT_UNITS = [
  { unitName: "Nos", unitCode: "NOS" },
  { unitName: "Kg", unitCode: "KG" },
  { unitName: "Meter", unitCode: "MTR" },
  { unitName: "Box", unitCode: "BOX" },
  { unitName: "Ltr", unitCode: "LTR" },
];

async function ensureDefaultUnitsSeeded() {
  for (const u of DEFAULT_UNITS) {
    await prisma.unit.upsert({
      where: { unitName: u.unitName },
      update: { unitCode: u.unitCode, isActive: true },
      create: { unitName: u.unitName, unitCode: u.unitCode, isActive: true },
    });
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
  ensureDefaultUnitsSeeded,
  backfillLegacyItemUnitLinks,
};

