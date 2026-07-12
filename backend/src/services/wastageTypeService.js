const { prisma } = require("../utils/prisma");

const WASTAGE_TYPE_CATEGORIES = Object.freeze([
  "PROCESS",
  "SETUP",
  "QUALITY",
  "MACHINE",
  "MATERIAL",
  "TRIAL",
  "BREAKDOWN",
  "MISC",
]);

const DEFAULT_WASTAGE_TYPES = [
  { name: "Purging", category: "PROCESS" },
  { name: "Machine Setting", category: "SETUP" },
  { name: "Material Handling", category: "MATERIAL" },
  { name: "Colour Change", category: "SETUP" },
  { name: "Trial Production", category: "TRIAL" },
  { name: "Machine Breakdown", category: "BREAKDOWN" },
  { name: "QC Rejection", category: "QUALITY" },
  { name: "Runner / Sprue", category: "PROCESS" },
  { name: "Spillage", category: "PROCESS" },
  { name: "Moisture Loss", category: "MATERIAL" },
  { name: "Other", category: "MISC" },
];

const WASTAGE_TYPE_SELECT = Object.freeze({
  id: true,
  code: true,
  name: true,
  category: true,
  description: true,
  sortOrder: true,
  isActive: true,
});

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCode(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  return raw.replace(/\s+/g, "_").slice(0, 32);
}

function normalizeCategory(value) {
  const cat = String(value ?? "MISC").trim().toUpperCase();
  if (!WASTAGE_TYPE_CATEGORIES.includes(cat)) {
    const err = new Error(`Invalid wastage category. Use one of: ${WASTAGE_TYPE_CATEGORIES.join(", ")}.`);
    err.statusCode = 400;
    throw err;
  }
  return cat;
}

function normalizeDescription(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 500) : null;
}

async function ensureDefaultWastageTypes(db = prisma) {
  if (!db.wastageType?.findMany) return;
  const existing = await db.wastageType.findMany({ select: { name: true, category: true } });
  const keys = new Set(existing.map((row) => normalizeName(row.name).toLowerCase()));
  let sortOrder = existing.length > 0 ? Math.max(...existing.map((_, i) => (i + 1) * 10)) : 0;
  for (const def of DEFAULT_WASTAGE_TYPES) {
    const key = normalizeName(def.name).toLowerCase();
    if (keys.has(key)) continue;
    sortOrder += 10;
    await db.wastageType.create({
      data: {
        name: def.name,
        category: def.category,
        sortOrder,
        isActive: true,
      },
    });
    keys.add(key);
  }
}

async function listWastageTypes(db = prisma, { includeInactive = false } = {}) {
  await ensureDefaultWastageTypes(db);
  return db.wastageType.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: WASTAGE_TYPE_SELECT,
  });
}

async function assertUniqueCode(db, code, excludeId = null) {
  if (!code) return;
  const dup = await db.wastageType.findFirst({
    where: {
      code,
      ...(excludeId != null ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (dup) {
    const err = new Error("Wastage type code already exists.");
    err.statusCode = 409;
    throw err;
  }
}

async function createWastageType(db, input) {
  const name = normalizeName(input.name);
  if (!name) {
    const err = new Error("Wastage type name is required.");
    err.statusCode = 400;
    throw err;
  }
  const code = normalizeCode(input.code);
  const category = normalizeCategory(input.category ?? "MISC");
  const description = normalizeDescription(input.description);

  const dup = await db.wastageType.findFirst({
    where: { name: { equals: name } },
    select: { id: true },
  });
  if (dup) {
    const err = new Error("Wastage type already exists.");
    err.statusCode = 409;
    throw err;
  }
  await assertUniqueCode(db, code);

  const maxSort = await db.wastageType.aggregate({ _max: { sortOrder: true } });
  const sortOrder = Number(maxSort._max.sortOrder ?? 0) + 10;
  return db.wastageType.create({
    data: { name, code, category, description, sortOrder, isActive: true },
    select: WASTAGE_TYPE_SELECT,
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
      where: { id: { not: id }, name: { equals: name } },
      select: { id: true },
    });
    if (dup) {
      const err = new Error("Wastage type already exists.");
      err.statusCode = 409;
      throw err;
    }
    data.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(input, "code")) {
    const code = normalizeCode(input.code);
    await assertUniqueCode(db, code, id);
    data.code = code;
  }
  if (input.category != null) data.category = normalizeCategory(input.category);
  if (Object.prototype.hasOwnProperty.call(input, "description")) {
    data.description = normalizeDescription(input.description);
  }
  if (input.isActive != null) data.isActive = Boolean(input.isActive);
  return db.wastageType.update({
    where: { id },
    data,
    select: WASTAGE_TYPE_SELECT,
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
  WASTAGE_TYPE_CATEGORIES,
  DEFAULT_WASTAGE_TYPES,
  ensureDefaultWastageTypes,
  listWastageTypes,
  createWastageType,
  updateWastageType,
  reorderWastageTypes,
  normalizeCode,
  normalizeCategory,
  normalizeName,
};
