const { prisma } = require("../utils/prisma");

const DEFAULT_WASTAGE_TYPES = [
  "Purging",
  "Machine Setting",
  "Material Handling",
  "Colour Change",
  "Trial Production",
  "Machine Breakdown",
  "QC Rejection",
  "Runner / Sprue",
  "Spillage",
  "Moisture Loss",
  "Other",
];

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

async function ensureDefaultWastageTypes(db = prisma) {
  if (!db.wastageType?.findMany) return;
  const existing = await db.wastageType.findMany({ select: { name: true } });
  const keys = new Set(existing.map((row) => normalizeName(row.name).toLowerCase()));
  let sortOrder = existing.length > 0 ? Math.max(...existing.map((_, i) => (i + 1) * 10)) : 0;
  for (const name of DEFAULT_WASTAGE_TYPES) {
    const key = normalizeName(name).toLowerCase();
    if (keys.has(key)) continue;
    sortOrder += 10;
    await db.wastageType.create({
      data: { name, sortOrder, isActive: true },
    });
    keys.add(key);
  }
}

async function listWastageTypes(db = prisma, { includeInactive = false } = {}) {
  await ensureDefaultWastageTypes(db);
  return db.wastageType.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, name: true, sortOrder: true, isActive: true },
  });
}

async function createWastageType(db, input) {
  const name = normalizeName(input.name);
  if (!name) {
    const err = new Error("Wastage type name is required.");
    err.statusCode = 400;
    throw err;
  }
  const dup = await db.wastageType.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (dup) {
    const err = new Error("Wastage type already exists.");
    err.statusCode = 409;
    throw err;
  }
  const maxSort = await db.wastageType.aggregate({ _max: { sortOrder: true } });
  const sortOrder = Number(maxSort._max.sortOrder ?? 0) + 10;
  return db.wastageType.create({
    data: { name, sortOrder, isActive: true },
    select: { id: true, name: true, sortOrder: true, isActive: true },
  });
}

async function updateWastageType(db, id, input) {
  const row = await db.wastageType.findUnique({ where: { id } });
  if (!row) {
    const err = new Error("Wastage type not found.");
    err.statusCode = 404;
    throw err;
  }
  const data = {};
  if (input.name != null) {
    const name = normalizeName(input.name);
    if (!name) {
      const err = new Error("Wastage type name is required.");
      err.statusCode = 400;
      throw err;
    }
    const dup = await db.wastageType.findFirst({
      where: { id: { not: id }, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (dup) {
      const err = new Error("Wastage type already exists.");
      err.statusCode = 409;
      throw err;
    }
    data.name = name;
  }
  if (input.isActive != null) data.isActive = Boolean(input.isActive);
  return db.wastageType.update({
    where: { id },
    data,
    select: { id: true, name: true, sortOrder: true, isActive: true },
  });
}

async function reorderWastageTypes(db, orderedIds) {
  const ids = [...new Set((Array.isArray(orderedIds) ? orderedIds : []).map(Number).filter((id) => id > 0))];
  if (!ids.length) {
    const err = new Error("Provide at least one wastage type id to reorder.");
    err.statusCode = 400;
    throw err;
  }
  await db.$transaction(
    ids.map((id, index) =>
      db.wastageType.update({
        where: { id },
        data: { sortOrder: (index + 1) * 10 },
      }),
    ),
  );
  return listWastageTypes(db, { includeInactive: true });
}

module.exports = {
  DEFAULT_WASTAGE_TYPES,
  ensureDefaultWastageTypes,
  listWastageTypes,
  createWastageType,
  updateWastageType,
  reorderWastageTypes,
};
