const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  MACHINE_TYPES,
  normalizeMachineCode,
  normalizeMachineType,
  normalizeName,
  createMachine,
  updateMachine,
  listMachines,
} = require("../../src/services/machineService");

function makeDb(seed = []) {
  const rows = seed.map((r, i) => ({
    id: r.id ?? i + 1,
    machineCode: r.machineCode,
    machineName: r.machineName,
    machineType: r.machineType ?? "OTHER",
    make: r.make ?? null,
    model: r.model ?? null,
    serialNumber: r.serialNumber ?? null,
    departmentLocation: r.departmentLocation ?? null,
    description: r.description ?? null,
    isActive: r.isActive ?? true,
    createdAt: r.createdAt ?? new Date(),
    updatedAt: r.updatedAt ?? new Date(),
  }));

  function matches(where = {}) {
    return rows.filter((r) => {
      if (where.isActive === true && !r.isActive) return false;
      if (where.machineCode != null && r.machineCode !== where.machineCode) return false;
      if (where.id?.not != null && r.id === where.id.not) return false;
      if (typeof where.id === "number" && r.id !== where.id) return false;
      return true;
    });
  }

  return {
    machine: {
      findMany: async ({ where } = {}) =>
        matches(where || {}).sort((a, b) => a.machineName.localeCompare(b.machineName) || a.id - b.id),
      findFirst: async ({ where } = {}) => matches(where || {})[0] ?? null,
      findUnique: async ({ where }) => rows.find((r) => r.id === where.id) ?? null,
      create: async ({ data, select }) => {
        const row = {
          id: rows.length + 1,
          make: null,
          model: null,
          serialNumber: null,
          departmentLocation: null,
          description: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        rows.push(row);
        if (!select) return row;
        const out = {};
        for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
        return out;
      },
      update: async ({ where, data, select }) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data, { updatedAt: new Date() });
        if (!select) return row;
        const out = {};
        for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
        return out;
      },
    },
  };
}

describe("machineService (Step 1 Machine Master)", () => {
  it("exposes machine types", () => {
    assert.ok(MACHINE_TYPES.includes("INJECTION_MOULDING"));
    assert.ok(MACHINE_TYPES.includes("OTHER"));
  });

  it("trims and normalizes machine code case-insensitively", () => {
    assert.equal(normalizeName("  Press  01 "), "Press 01");
    assert.equal(normalizeMachineCode("  inj 01 "), "INJ_01");
    assert.equal(normalizeMachineCode("inj-01"), "INJ-01");
    assert.equal(normalizeMachineCode("   "), null);
    assert.equal(normalizeMachineType("cnc"), "CNC");
  });

  it("rejects invalid machine type", () => {
    assert.throws(() => normalizeMachineType("NOPE"), (err) => err.statusCode === 400);
  });

  it("creates machine and blocks duplicate code (normalized)", async () => {
    const db = makeDb([{ id: 1, machineCode: "INJ_01", machineName: "Press A", machineType: "INJECTION_MOULDING" }]);
    const created = await createMachine(db, {
      machineCode: "  blow 02 ",
      machineName: " Blow press ",
      machineType: "blow_moulding",
      make: " Acme ",
      description: " Line 2 ",
    });
    assert.equal(created.machineCode, "BLOW_02");
    assert.equal(created.machineName, "Blow press");
    assert.equal(created.machineType, "BLOW_MOULDING");
    assert.equal(created.make, "Acme");
    assert.equal(created.description, "Line 2");
    assert.equal(created.isActive, true);
    assert.equal(created.machineTypeLabel, "Blow Moulding");

    await assert.rejects(
      () =>
        createMachine(db, {
          machineCode: "inj 01",
          machineName: "Other",
          machineType: "OTHER",
        }),
      (err) => err.statusCode === 409 && /Machine code already exists/i.test(err.message),
    );

    await assert.rejects(
      () => createMachine(db, { machineCode: "  ", machineName: "X", machineType: "OTHER" }),
      (err) => err.statusCode === 400,
    );
  });

  it("lists inactive when requested; active-only by default", async () => {
    const db = makeDb([
      { id: 1, machineCode: "A1", machineName: "Active", machineType: "OTHER", isActive: true },
      { id: 2, machineCode: "B1", machineName: "Inactive", machineType: "CNC", isActive: false },
    ]);
    const activeOnly = await listMachines(db, { includeInactive: false });
    assert.equal(activeOnly.length, 1);
    assert.equal(activeOnly[0].machineCode, "A1");

    const all = await listMachines(db, { includeInactive: true });
    assert.equal(all.length, 2);
  });

  it("updates fields and supports activate/deactivate without delete", async () => {
    const db = makeDb([
      { id: 1, machineCode: "M1", machineName: "One", machineType: "CNC", isActive: true },
    ]);
    const updated = await updateMachine(db, 1, {
      machineName: " One renamed ",
      isActive: false,
      departmentLocation: " Bay 3 ",
    });
    assert.equal(updated.machineName, "One renamed");
    assert.equal(updated.isActive, false);
    assert.equal(updated.departmentLocation, "Bay 3");

    await assert.rejects(
      () => updateMachine(db, 1, { machineCode: "  " }),
      (err) => err.statusCode === 400,
    );
  });
});
