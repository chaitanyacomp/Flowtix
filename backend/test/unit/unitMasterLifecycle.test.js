const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeUnitKey,
  normalizeUnitCode,
  isUnitTallyLinked,
  findUnitDuplicateConflict,
  getUnitUsageCounts,
  getUnitUsageCountsById,
  UNIT_EDIT_BLOCKED,
  UNIT_DELETE_IN_USE,
  UNIT_DELETE_TALLY_LINKED,
} = require("../../src/services/unitMaster");

function makeDb({ itemCounts = {}, bomCounts = {} } = {}) {
  return {
    item: {
      async count({ where }) {
        return itemCounts[where.unitId] || 0;
      },
      async groupBy() {
        return Object.entries(itemCounts).map(([unitId, n]) => ({
          unitId: Number(unitId),
          _count: { _all: n },
        }));
      },
    },
    bom: {
      async count({ where }) {
        return bomCounts[where.fgWeightUnitId] || 0;
      },
      async groupBy() {
        return Object.entries(bomCounts).map(([fgWeightUnitId, n]) => ({
          fgWeightUnitId: Number(fgWeightUnitId),
          _count: { _all: n },
        }));
      },
    },
  };
}

describe("unitMaster lifecycle helpers", () => {
  it("normalizes name keys case/space-insensitively", () => {
    assert.equal(normalizeUnitKey("  Nos "), "nos");
    assert.equal(normalizeUnitKey("NOS"), "nos");
    assert.equal(normalizeUnitCode(" nos "), "NOS");
  });

  it("detects Tally-linked units from identity fields", () => {
    assert.equal(isUnitTallyLinked({}), false);
    assert.equal(isUnitTallyLinked({ tallyName: "Nos" }), true);
    assert.equal(isUnitTallyLinked({ tallyGuid: "abc" }), true);
    assert.equal(isUnitTallyLinked({ tallyUnitSymbol: "NOS" }), true);
    assert.equal(isUnitTallyLinked({ tallyImportedAt: new Date() }), true);
    assert.equal(isUnitTallyLinked({ tallyName: "  " }), false);
  });

  it("blocks duplicate names and codes (except self)", () => {
    const rows = [
      { id: 1, unitName: "Nos", unitCode: "NOS" },
      { id: 2, unitName: "Kg", unitCode: "KG" },
    ];
    assert.equal(findUnitDuplicateConflict(rows, { unitName: "nos" }), "Unit already exists");
    assert.equal(findUnitDuplicateConflict(rows, { unitName: "Gram", unitCode: "kg" }), "Unit code already exists");
    assert.equal(findUnitDuplicateConflict(rows, { unitName: "Nos", unitCode: "NOS", exceptId: 1 }), null);
    assert.equal(findUnitDuplicateConflict(rows, { unitName: "Gram", unitCode: null }), null);
  });

  it("counts Item and BOM usage for edit/delete gates", async () => {
    const unused = await getUnitUsageCounts(makeDb(), 10);
    assert.deepEqual(unused, { itemCount: 0, bomCount: 0, inUse: false });

    const itemUsed = await getUnitUsageCounts(makeDb({ itemCounts: { 5: 3 } }), 5);
    assert.equal(itemUsed.inUse, true);
    assert.equal(itemUsed.itemCount, 3);
    assert.equal(itemUsed.bomCount, 0);

    const bomUsed = await getUnitUsageCounts(makeDb({ bomCounts: { 7: 2 } }), 7);
    assert.equal(bomUsed.inUse, true);
    assert.equal(bomUsed.bomCount, 2);

    const map = await getUnitUsageCountsById(
      makeDb({ itemCounts: { 1: 2 }, bomCounts: { 1: 1, 2: 4 } }),
    );
    assert.deepEqual(map.get(1), { itemCount: 2, bomCount: 1, inUse: true });
    assert.deepEqual(map.get(2), { itemCount: 0, bomCount: 4, inUse: true });
  });

  it("exposes clear lifecycle block messages", () => {
    assert.match(UNIT_EDIT_BLOCKED, /in use/i);
    assert.match(UNIT_EDIT_BLOCKED, /deactivate/i);
    assert.match(UNIT_DELETE_IN_USE, /cannot be deleted/i);
    assert.match(UNIT_DELETE_TALLY_LINKED, /Tally/i);
    assert.match(UNIT_DELETE_TALLY_LINKED, /Deactivate/i);
  });

  it("applies edit/delete decision matrix for unused, Item-used, BOM-used, and Tally-linked", async () => {
    async function decide(unit, db) {
      const usage = await getUnitUsageCounts(db, unit.id);
      const tallyLinked = isUnitTallyLinked(unit);
      return {
        canEdit: !usage.inUse,
        canDelete: !usage.inUse && !tallyLinked,
        editError: usage.inUse ? UNIT_EDIT_BLOCKED : null,
        deleteError: tallyLinked ? UNIT_DELETE_TALLY_LINKED : usage.inUse ? UNIT_DELETE_IN_USE : null,
      };
    }

    const unused = await decide({ id: 1 }, makeDb());
    assert.equal(unused.canEdit, true);
    assert.equal(unused.canDelete, true);
    assert.equal(unused.editError, null);
    assert.equal(unused.deleteError, null);

    const itemUsed = await decide({ id: 2 }, makeDb({ itemCounts: { 2: 1 } }));
    assert.equal(itemUsed.canEdit, false);
    assert.equal(itemUsed.canDelete, false);
    assert.equal(itemUsed.editError, UNIT_EDIT_BLOCKED);
    assert.equal(itemUsed.deleteError, UNIT_DELETE_IN_USE);

    const bomUsed = await decide({ id: 3 }, makeDb({ bomCounts: { 3: 1 } }));
    assert.equal(bomUsed.canEdit, false);
    assert.equal(bomUsed.canDelete, false);
    assert.equal(bomUsed.editError, UNIT_EDIT_BLOCKED);
    assert.equal(bomUsed.deleteError, UNIT_DELETE_IN_USE);

    const tallyUnused = await decide({ id: 4, tallyName: "Gm" }, makeDb());
    assert.equal(tallyUnused.canEdit, true);
    assert.equal(tallyUnused.canDelete, false);
    assert.equal(tallyUnused.deleteError, UNIT_DELETE_TALLY_LINKED);
  });
});

describe("units route lifecycle policy (source contract)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../../src/routes/units.js"), "utf8");

  it("supports edit, deactivate, activate, hardened delete, and includeInactive list", () => {
    assert.match(src, /unitsRouter\.patch\("\/:id"/);
    assert.match(src, /unitsRouter\.post\("\/:id\/deactivate"/);
    assert.match(src, /unitsRouter\.post\("\/:id\/activate"/);
    assert.match(src, /includeInactive/);
    assert.match(src, /getUnitUsageCounts/);
    assert.match(src, /isUnitTallyLinked/);
    assert.match(src, /UNIT_EDIT_BLOCKED/);
    assert.match(src, /UNIT_DELETE_IN_USE/);
    assert.match(src, /UNIT_DELETE_TALLY_LINKED/);
    assert.match(src, /findUnitDuplicateConflict/);
  });

  it("blocks edit when in use and delete when in use or Tally-linked", () => {
    assert.match(src, /if \(usage\.inUse\) throw httpError\(409, UNIT_EDIT_BLOCKED\)/);
    assert.match(src, /if \(isUnitTallyLinked\(existing\)\) throw httpError\(409, UNIT_DELETE_TALLY_LINKED\)/);
    assert.match(src, /if \(usage\.inUse\) throw httpError\(409, UNIT_DELETE_IN_USE\)/);
  });

  it("does not patch Tally identity fields on edit", () => {
    assert.match(src, /data: \{ unitName, unitCode \}/);
    assert.doesNotMatch(src, /data: \{[^}]*tallyName/);
  });

  it("keeps default GET active-only for selectors", () => {
    assert.match(src, /where: \{ isActive: true \}/);
    assert.match(src, /select: \{ id: true, unitName: true, unitCode: true \}/);
  });
});
