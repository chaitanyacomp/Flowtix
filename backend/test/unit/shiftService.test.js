const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeShiftDurations,
  normalizeTimeOfDay,
  formatDurationMinutes,
} = require("../../src/services/shiftDuration");

const {
  normalizeShiftCode,
  createShift,
  updateShift,
  listShifts,
} = require("../../src/services/shiftService");

function makeDb({ shifts = [] } = {}) {
  const rows = shifts.map((r, i) => ({
    id: r.id ?? i + 1,
    shiftCode: r.shiftCode,
    shiftName: r.shiftName,
    startTime: r.startTime,
    endTime: r.endTime,
    plannedBreakMinutes: r.plannedBreakMinutes ?? 0,
    remarks: r.remarks ?? null,
    isActive: r.isActive ?? true,
    createdAt: r.createdAt ?? new Date(),
    updatedAt: r.updatedAt ?? new Date(),
  }));

  function filter(where = {}) {
    return rows.filter((r) => {
      if (where.isActive === true && !r.isActive) return false;
      if (where.shiftCode != null && r.shiftCode !== where.shiftCode) return false;
      if (where.id?.not != null && r.id === where.id.not) return false;
      if (typeof where.id === "number" && r.id !== where.id) return false;
      return true;
    });
  }

  return {
    shift: {
      findMany: async ({ where } = {}) => filter(where || {}),
      findFirst: async ({ where } = {}) => filter(where || {})[0] ?? null,
      findUnique: async ({ where }) => rows.find((r) => r.id === where.id) ?? null,
      create: async ({ data, select }) => {
        const row = {
          id: rows.length ? Math.max(...rows.map((o) => o.id)) + 1 : 1,
          plannedBreakMinutes: 0,
          remarks: null,
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

describe("shiftDuration", () => {
  it("normalizes HH:mm and rejects bad times", () => {
    assert.equal(normalizeTimeOfDay("6:00"), "06:00");
    assert.equal(normalizeTimeOfDay("22:00:00"), "22:00");
    assert.throws(() => normalizeTimeOfDay("25:00"), (err) => err.statusCode === 400);
  });

  it("computes day-shift and overnight gross durations (examples)", () => {
    const a = computeShiftDurations("06:00", "14:00", 0);
    assert.equal(a.grossDurationMinutes, 480);
    assert.equal(a.netProductionDurationMinutes, 480);
    assert.equal(a.isOvernight, false);

    const b = computeShiftDurations("14:00", "22:00", 0);
    assert.equal(b.grossDurationMinutes, 480);
    assert.equal(b.isOvernight, false);

    const c = computeShiftDurations("22:00", "06:00", 0);
    assert.equal(c.grossDurationMinutes, 480);
    assert.equal(c.isOvernight, true);
    assert.equal(c.netProductionDurationMinutes, 480);

    const d = computeShiftDurations("08:00", "20:00", 0);
    assert.equal(d.grossDurationMinutes, 720);
    assert.equal(d.isOvernight, false);

    assert.equal(formatDurationMinutes(480), "8h 0m");
    assert.equal(formatDurationMinutes(720), "12h 0m");
  });

  it("rejects identical start/end and invalid break minutes", () => {
    assert.throws(
      () => computeShiftDurations("08:00", "08:00", 0),
      (err) => err.statusCode === 400 && /identical/i.test(err.message),
    );
    assert.throws(
      () => computeShiftDurations("06:00", "14:00", -5),
      (err) => err.statusCode === 400 && /zero or positive/i.test(err.message),
    );
    assert.throws(
      () => computeShiftDurations("06:00", "14:00", 480),
      (err) => err.statusCode === 400 && /less than gross/i.test(err.message),
    );
    assert.throws(
      () => computeShiftDurations("06:00", "14:00", 500),
      (err) => err.statusCode === 400,
    );

    const withBreak = computeShiftDurations("06:00", "14:00", 30);
    assert.equal(withBreak.grossDurationMinutes, 480);
    assert.equal(withBreak.netProductionDurationMinutes, 450);
  });
});

describe("shiftService (Step 3 Shift Master)", () => {
  it("normalizes shift code like Machine/Operator", () => {
    assert.equal(normalizeShiftCode("  shift a "), "SHIFT_A");
    assert.equal(normalizeShiftCode("shift-12"), "SHIFT-12");
    assert.equal(normalizeShiftCode("   "), null);
  });

  it("creates shift with durations and blocks duplicate code", async () => {
    const db = makeDb({
      shifts: [{ id: 1, shiftCode: "SHIFT_A", shiftName: "A", startTime: "06:00", endTime: "14:00" }],
    });
    const created = await createShift(db, {
      shiftCode: "  shift c ",
      shiftName: " Night ",
      startTime: "22:00",
      endTime: "06:00",
      plannedBreakMinutes: 30,
      remarks: " overnight ",
    });
    assert.equal(created.shiftCode, "SHIFT_C");
    assert.equal(created.shiftName, "Night");
    assert.equal(created.startTime, "22:00");
    assert.equal(created.endTime, "06:00");
    assert.equal(created.isOvernight, true);
    assert.equal(created.grossDurationMinutes, 480);
    assert.equal(created.netProductionDurationMinutes, 450);
    assert.equal(created.plannedBreakMinutes, 30);

    await assert.rejects(
      () =>
        createShift(db, {
          shiftCode: "shift a",
          shiftName: "X",
          startTime: "06:00",
          endTime: "14:00",
        }),
      (err) => err.statusCode === 409 && /Shift code already exists/i.test(err.message),
    );
  });

  it("lists inactive when requested; supports activate/deactivate", async () => {
    const db = makeDb({
      shifts: [
        { id: 1, shiftCode: "A", shiftName: "Active", startTime: "06:00", endTime: "14:00", isActive: true },
        { id: 2, shiftCode: "B", shiftName: "Inactive", startTime: "14:00", endTime: "22:00", isActive: false },
      ],
    });
    assert.equal((await listShifts(db, { includeInactive: false })).length, 1);
    assert.equal((await listShifts(db, { includeInactive: true })).length, 2);
    const updated = await updateShift(db, 1, { isActive: false });
    assert.equal(updated.isActive, false);
  });
});

describe("Shift Master cleanup preservation", () => {
  it("keeps Shift in preserved master lists", () => {
    const {
      PRESERVED_MASTER_MODELS,
      FULL_DEMO_PRESERVED_MODELS,
    } = require("../../src/services/cleanup/cleanupRegistry");
    assert.ok(PRESERVED_MASTER_MODELS.includes("Shift"));
    assert.ok(FULL_DEMO_PRESERVED_MODELS.includes("Shift"));
  });
});
