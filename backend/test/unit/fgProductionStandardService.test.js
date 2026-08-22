const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeExpectedShiftQty,
  validateStandardInputs,
} = require("../../src/services/fgProductionStandardCalc");

const {
  createFgProductionStandard,
  updateFgProductionStandard,
  listFgProductionStandards,
  previewFgProductionStandard,
} = require("../../src/services/fgProductionStandardService");

function makeDb({
  items = [],
  machines = [],
  shifts = [],
  standards = [],
} = {}) {
  const itemRows = items.map((r, i) => ({
    id: r.id ?? i + 1,
    itemName: r.itemName ?? `FG-${i + 1}`,
    itemType: r.itemType ?? "FG",
    unit: r.unit ?? "Nos",
    isActive: r.isActive ?? true,
  }));
  const machineRows = machines.map((r, i) => ({
    id: r.id ?? i + 1,
    machineCode: r.machineCode ?? `M${i + 1}`,
    machineName: r.machineName ?? `Machine ${i + 1}`,
    machineType: r.machineType ?? "OTHER",
    isActive: r.isActive ?? true,
  }));
  const shiftRows = shifts.map((r, i) => ({
    id: r.id ?? i + 1,
    shiftCode: r.shiftCode ?? `S${i + 1}`,
    shiftName: r.shiftName ?? `Shift ${i + 1}`,
    startTime: r.startTime ?? "06:00",
    endTime: r.endTime ?? "14:00",
    plannedBreakMinutes: r.plannedBreakMinutes ?? 0,
    isActive: r.isActive ?? true,
  }));
  const standardRows = standards.map((r, i) => ({
    id: r.id ?? i + 1,
    itemId: r.itemId,
    machineId: r.machineId,
    cycleTimeSeconds: r.cycleTimeSeconds,
    piecesPerCycle: r.piecesPerCycle ?? 1,
    standardEfficiencyPercent: r.standardEfficiencyPercent ?? 95,
    remarks: r.remarks ?? null,
    isActive: r.isActive ?? true,
    createdAt: r.createdAt ?? new Date(),
    updatedAt: r.updatedAt ?? new Date(),
  }));

  function withJoins(row) {
    return {
      ...row,
      item: itemRows.find((i) => i.id === row.itemId) ?? null,
      machine: machineRows.find((m) => m.id === row.machineId) ?? null,
    };
  }

  return {
    item: {
      findUnique: async ({ where }) => itemRows.find((r) => r.id === where.id) ?? null,
    },
    machine: {
      findUnique: async ({ where }) => machineRows.find((r) => r.id === where.id) ?? null,
    },
    shift: {
      findUnique: async ({ where }) => shiftRows.find((r) => r.id === where.id) ?? null,
    },
    fgProductionStandard: {
      findMany: async ({ where } = {}) => {
        let rows = standardRows.map(withJoins);
        if (where?.isActive === true) rows = rows.filter((r) => r.isActive);
        return rows;
      },
      findFirst: async ({ where } = {}) => {
        return (
          standardRows.find((r) => {
            if (where.itemId != null && r.itemId !== where.itemId) return false;
            if (where.machineId != null && r.machineId !== where.machineId) return false;
            if (where.id?.not != null && r.id === where.id.not) return false;
            return true;
          }) ?? null
        );
      },
      findUnique: async ({ where }) => {
        const row = standardRows.find((r) => r.id === where.id);
        return row ? withJoins(row) : null;
      },
      create: async ({ data, select }) => {
        const row = {
          id: standardRows.length ? Math.max(...standardRows.map((o) => o.id)) + 1 : 1,
          piecesPerCycle: 1,
          standardEfficiencyPercent: 95,
          remarks: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        standardRows.push(row);
        const joined = withJoins(row);
        if (!select) return joined;
        return joined;
      },
      update: async ({ where, data, select }) => {
        const row = standardRows.find((r) => r.id === where.id);
        Object.assign(row, data, { updatedAt: new Date() });
        const joined = withJoins(row);
        if (!select) return joined;
        return joined;
      },
    },
  };
}

describe("fgProductionStandardCalc", () => {
  it("computes expected qty for the documented example (~500)", () => {
    const preview = computeExpectedShiftQty({
      cycleTimeSeconds: 51.3,
      piecesPerCycle: 1,
      standardEfficiencyPercent: 95,
      netShiftMinutes: 450,
    });
    assert.equal(preview.netShiftSeconds, 27000);
    assert.equal(preview.theoreticalQuantity, 526);
    assert.equal(preview.expectedQuantity, 500);
  });

  it("rejects invalid cycle, pieces, and efficiency", () => {
    assert.throws(
      () => validateStandardInputs({ cycleTimeSeconds: 0, piecesPerCycle: 1, standardEfficiencyPercent: 95 }),
      (err) => err.statusCode === 400 && /Cycle time/i.test(err.message),
    );
    assert.throws(
      () => validateStandardInputs({ cycleTimeSeconds: 10, piecesPerCycle: 1.5, standardEfficiencyPercent: 95 }),
      (err) => err.statusCode === 400 && /positive whole number/i.test(err.message),
    );
    assert.throws(
      () => validateStandardInputs({ cycleTimeSeconds: 10, piecesPerCycle: 1, standardEfficiencyPercent: 0 }),
      (err) => err.statusCode === 400 && /efficiency/i.test(err.message),
    );
    assert.throws(
      () => validateStandardInputs({ cycleTimeSeconds: 10, piecesPerCycle: 1, standardEfficiencyPercent: 101 }),
      (err) => err.statusCode === 400,
    );
  });
});

describe("fgProductionStandardService (Step 4)", () => {
  it("creates standard and blocks duplicate FG+Machine", async () => {
    const db = makeDb({
      items: [{ id: 1, itemName: "Bottle", itemType: "FG", isActive: true }],
      machines: [
        { id: 10, machineCode: "INJ_01", machineName: "Inj 1", isActive: true },
        { id: 11, machineCode: "INJ_02", machineName: "Inj 2", isActive: true },
      ],
      standards: [
        {
          id: 1,
          itemId: 1,
          machineId: 10,
          cycleTimeSeconds: 50,
          piecesPerCycle: 1,
          standardEfficiencyPercent: 95,
        },
      ],
    });

    await assert.rejects(
      () =>
        createFgProductionStandard(db, {
          itemId: 1,
          machineId: 10,
          cycleTimeSeconds: 51.3,
        }),
      (err) => err.statusCode === 409 && /already exists for this FG and machine/i.test(err.message),
    );

    const ok = await createFgProductionStandard(db, {
      itemId: 1,
      machineId: 11,
      cycleTimeSeconds: 51.3,
      piecesPerCycle: 1,
      standardEfficiencyPercent: 95,
    });
    assert.equal(ok.itemId, 1);
    assert.equal(ok.machineId, 11);
    assert.equal(ok.cycleTimeSeconds, 51.3);
  });

  it("rejects inactive FG or machine; supports activate/deactivate", async () => {
    const db = makeDb({
      items: [
        { id: 1, itemType: "FG", isActive: true },
        { id: 2, itemType: "FG", isActive: false },
        { id: 3, itemType: "RM", isActive: true },
      ],
      machines: [
        { id: 10, isActive: true },
        { id: 11, isActive: false },
      ],
    });
    const dbList = makeDb({
      items: [{ id: 1, itemType: "FG", isActive: true }],
      machines: [
        { id: 10, isActive: true },
        { id: 12, isActive: true },
      ],
      standards: [
        { id: 1, itemId: 1, machineId: 10, cycleTimeSeconds: 40, isActive: true },
        { id: 2, itemId: 1, machineId: 12, cycleTimeSeconds: 40, isActive: false },
      ],
    });

    await assert.rejects(
      () => createFgProductionStandard(db, { itemId: 2, machineId: 10, cycleTimeSeconds: 50 }),
      (err) => err.statusCode === 400 && /active Finished Goods/i.test(err.message),
    );
    await assert.rejects(
      () => createFgProductionStandard(db, { itemId: 3, machineId: 10, cycleTimeSeconds: 50 }),
      (err) => err.statusCode === 400 && /Finished Goods/i.test(err.message),
    );
    await assert.rejects(
      () => createFgProductionStandard(db, { itemId: 1, machineId: 11, cycleTimeSeconds: 50 }),
      (err) => err.statusCode === 400 && /active machines/i.test(err.message),
    );

    assert.equal((await listFgProductionStandards(dbList, { includeInactive: false })).length, 1);
    assert.equal((await listFgProductionStandards(dbList, { includeInactive: true })).length, 2);
    const updated = await updateFgProductionStandard(dbList, 1, { isActive: false });
    assert.equal(updated.isActive, false);
  });

  it("previews qty from an active shift net minutes", async () => {
    const db = makeDb({
      shifts: [
        {
          id: 5,
          shiftCode: "SHIFT_A",
          startTime: "06:00",
          endTime: "14:00",
          plannedBreakMinutes: 30,
          isActive: true,
        },
      ],
    });
    const preview = await previewFgProductionStandard(db, {
      cycleTimeSeconds: 51.3,
      piecesPerCycle: 1,
      standardEfficiencyPercent: 95,
      shiftId: 5,
    });
    assert.equal(preview.netShiftMinutes, 450);
    assert.equal(preview.expectedQuantity, 500);
    assert.equal(preview.shift.shiftCode, "SHIFT_A");
  });
});

describe("FgProductionStandard cleanup preservation", () => {
  it("preserves on transaction reset; wipes on Full Demo before Item", () => {
    const {
      PRESERVED_MASTER_MODELS,
      FULL_DEMO_WIPED_MASTERS,
      FULL_DEMO_PRESERVED_MODELS,
    } = require("../../src/services/cleanup/cleanupRegistry");
    assert.ok(PRESERVED_MASTER_MODELS.includes("FgProductionStandard"));
    assert.ok(FULL_DEMO_WIPED_MASTERS.includes("FgProductionStandard"));
    assert.equal(FULL_DEMO_PRESERVED_MODELS.includes("FgProductionStandard"), false);
  });
});
