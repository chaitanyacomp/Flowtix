const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  WASTAGE_TYPE_CATEGORIES,
  normalizeCode,
  normalizeCategory,
  normalizeName,
  createWastageType,
  updateWastageType,
  listWastageTypes,
} = require("../../src/services/wastageTypeService");

function makeDb(seed = []) {
  const rows = seed.map((r, i) => ({
    id: r.id ?? i + 1,
    code: r.code ?? null,
    name: r.name,
    category: r.category ?? "MISC",
    description: r.description ?? null,
    sortOrder: r.sortOrder ?? (i + 1) * 10,
    isActive: r.isActive ?? true,
  }));

  function matches(where = {}) {
    return rows.filter((r) => {
      if (where.isActive === true && !r.isActive) return false;
      if (where.code != null && r.code !== where.code) return false;
      if (where.name?.equals != null && r.name !== where.name.equals) return false;
      if (where.id?.not != null && r.id === where.id.not) return false;
      if (typeof where.id === "number" && r.id !== where.id) return false;
      return true;
    });
  }

  return {
    wastageType: {
      findMany: async ({ where } = {}) =>
        matches(where || {}).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
      findFirst: async ({ where } = {}) => matches(where || {})[0] ?? null,
      findUnique: async ({ where }) => rows.find((r) => r.id === where.id) ?? null,
      aggregate: async () => ({ _max: { sortOrder: rows.reduce((m, r) => Math.max(m, r.sortOrder), 0) } }),
      create: async ({ data, select }) => {
        const row = { id: rows.length + 1, ...data };
        rows.push(row);
        if (!select) return row;
        const out = {};
        for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
        return out;
      },
      update: async ({ where, data, select }) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        if (!select) return row;
        const out = {};
        for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
        return out;
      },
    },
  };
}

describe("wastageTypeService (Phase 2)", () => {
  it("exposes required categories", () => {
    assert.deepEqual(WASTAGE_TYPE_CATEGORIES, [
      "PROCESS",
      "SETUP",
      "QUALITY",
      "MACHINE",
      "MATERIAL",
      "TRIAL",
      "BREAKDOWN",
      "MISC",
    ]);
  });

  it("trims and normalizes code/name", () => {
    assert.equal(normalizeName("  Purging  "), "Purging");
    assert.equal(normalizeCode("  purge code "), "PURGE_CODE");
    assert.equal(normalizeCode("   "), null);
    assert.equal(normalizeCategory("process"), "PROCESS");
  });

  it("rejects invalid category", () => {
    assert.throws(() => normalizeCategory("NOPE"), (err) => err.statusCode === 400);
  });

  it("creates with code/category/description and blocks duplicate code", async () => {
    const db = makeDb([{ id: 1, name: "Purging", code: "PURGE", category: "PROCESS" }]);
    const created = await createWastageType(db, {
      name: " Spillage ",
      code: "spill",
      category: "PROCESS",
      description: " Floor loss ",
    });
    assert.equal(created.name, "Spillage");
    assert.equal(created.code, "SPILL");
    assert.equal(created.category, "PROCESS");
    assert.equal(created.description, "Floor loss");

    await assert.rejects(
      () => createWastageType(db, { name: "Other Spill", code: "SPILL" }),
      (err) => err.statusCode === 409,
    );
  });

  it("lists inactive when requested; active-only by default", async () => {
    const db = makeDb([
      { id: 1, name: "Active", isActive: true, category: "MISC" },
      { id: 2, name: "Inactive", isActive: false, category: "QUALITY" },
    ]);
    // bypass ensureDefault by providing findMany only path — ensureDefault will try create missing defaults
    // Seed enough names so ensureDefault skips creates for our assertion focus:
    const full = makeDb([
      { id: 1, name: "Purging", isActive: true },
      { id: 2, name: "Machine Setting", isActive: true },
      { id: 3, name: "Material Handling", isActive: true },
      { id: 4, name: "Colour Change", isActive: true },
      { id: 5, name: "Trial Production", isActive: true },
      { id: 6, name: "Machine Breakdown", isActive: true },
      { id: 7, name: "QC Rejection", isActive: false },
      { id: 8, name: "Runner / Sprue", isActive: true },
      { id: 9, name: "Spillage", isActive: true },
      { id: 10, name: "Moisture Loss", isActive: true },
      { id: 11, name: "Other", isActive: true },
    ]);
    const active = await listWastageTypes(full, { includeInactive: false });
    assert.ok(active.every((r) => r.isActive));
    const all = await listWastageTypes(full, { includeInactive: true });
    assert.ok(all.some((r) => !r.isActive));
    void db;
  });

  it("can deactivate without deleting historical identity", async () => {
    const db = makeDb([{ id: 1, name: "Purging", code: "PURGE", category: "PROCESS", isActive: true }]);
    const updated = await updateWastageType(db, 1, { isActive: false });
    assert.equal(updated.isActive, false);
    assert.equal(updated.code, "PURGE");
  });
});
