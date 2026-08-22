const { prisma } = require("../utils/prisma");
const { validateStandardInputs, computeExpectedShiftQty } = require("./fgProductionStandardCalc");
const { computeShiftDurations } = require("./shiftDuration");

const STANDARD_SELECT = Object.freeze({
  id: true,
  itemId: true,
  machineId: true,
  cycleTimeSeconds: true,
  piecesPerCycle: true,
  standardEfficiencyPercent: true,
  remarks: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  item: { select: { id: true, itemName: true, itemType: true, unit: true, isActive: true } },
  machine: {
    select: { id: true, machineCode: true, machineName: true, machineType: true, isActive: true },
  },
});

function normalizeOptionalText(value, maxLen) {
  if (value == null) return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  return text ? text.slice(0, maxLen) : null;
}

function decimalToNumber(value) {
  if (value == null) return value;
  if (typeof value === "number") return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : Number(String(value));
}

function mapStandardRow(row) {
  if (!row) return row;
  return {
    id: row.id,
    itemId: row.itemId,
    machineId: row.machineId,
    cycleTimeSeconds: decimalToNumber(row.cycleTimeSeconds),
    piecesPerCycle: row.piecesPerCycle,
    standardEfficiencyPercent: decimalToNumber(row.standardEfficiencyPercent),
    remarks: row.remarks ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    itemName: row.item?.itemName ?? null,
    itemUnit: row.item?.unit ?? null,
    itemIsActive: row.item?.isActive ?? null,
    machineCode: row.machine?.machineCode ?? null,
    machineName: row.machine?.machineName ?? null,
    machineIsActive: row.machine?.isActive ?? null,
  };
}

async function assertUniqueFgMachine(db, itemId, machineId, excludeId = null) {
  const dup = await db.fgProductionStandard.findFirst({
    where: {
      itemId,
      machineId,
      ...(excludeId != null ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (dup) {
    const err = new Error("An FG production standard already exists for this FG and machine.");
    err.statusCode = 409;
    throw err;
  }
}

async function assertActiveFgItem(db, itemId) {
  const item = await db.item.findUnique({
    where: { id: itemId },
    select: { id: true, itemType: true, isActive: true, itemName: true },
  });
  if (!item) {
    const err = new Error("Finished goods item not found.");
    err.statusCode = 400;
    throw err;
  }
  if (item.itemType !== "FG") {
    const err = new Error("Only Finished Goods (FG) items can be selected.");
    err.statusCode = 400;
    throw err;
  }
  if (!item.isActive) {
    const err = new Error("Only active Finished Goods items can be selected.");
    err.statusCode = 400;
    throw err;
  }
  return item;
}

async function assertActiveMachine(db, machineId) {
  const machine = await db.machine.findUnique({
    where: { id: machineId },
    select: { id: true, isActive: true, machineCode: true, machineName: true },
  });
  if (!machine) {
    const err = new Error("Machine not found.");
    err.statusCode = 400;
    throw err;
  }
  if (!machine.isActive) {
    const err = new Error("Only active machines can be selected.");
    err.statusCode = 400;
    throw err;
  }
  return machine;
}

async function listFgProductionStandards(db = prisma, { includeInactive = false } = {}) {
  const rows = await db.fgProductionStandard.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ item: { itemName: "asc" } }, { machine: { machineName: "asc" } }, { id: "asc" }],
    select: STANDARD_SELECT,
  });
  return rows.map(mapStandardRow);
}

async function getFgProductionStandardById(db = prisma, id) {
  const row = await db.fgProductionStandard.findUnique({ where: { id }, select: STANDARD_SELECT });
  if (!row) {
    const err = new Error("FG production standard not found.");
    err.statusCode = 404;
    throw err;
  }
  return mapStandardRow(row);
}

async function createFgProductionStandard(db = prisma, input) {
  const itemId = Number(input.itemId);
  const machineId = Number(input.machineId);
  if (!Number.isInteger(itemId) || itemId < 1) {
    const err = new Error("Finished goods item is required.");
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isInteger(machineId) || machineId < 1) {
    const err = new Error("Machine is required.");
    err.statusCode = 400;
    throw err;
  }

  await assertActiveFgItem(db, itemId);
  await assertActiveMachine(db, machineId);

  const piecesPerCycle =
    input.piecesPerCycle == null || input.piecesPerCycle === "" ? 1 : input.piecesPerCycle;
  const standardEfficiencyPercent =
    input.standardEfficiencyPercent == null || input.standardEfficiencyPercent === ""
      ? 95
      : input.standardEfficiencyPercent;

  const validated = validateStandardInputs({
    cycleTimeSeconds: input.cycleTimeSeconds,
    piecesPerCycle,
    standardEfficiencyPercent,
  });
  const remarks = normalizeOptionalText(input.remarks, 500);

  await assertUniqueFgMachine(db, itemId, machineId);

  const row = await db.fgProductionStandard.create({
    data: {
      itemId,
      machineId,
      cycleTimeSeconds: validated.cycleTimeSeconds,
      piecesPerCycle: validated.piecesPerCycle,
      standardEfficiencyPercent: validated.standardEfficiencyPercent,
      remarks,
    },
    select: STANDARD_SELECT,
  });
  return mapStandardRow(row);
}

async function updateFgProductionStandard(db = prisma, id, input) {
  const existing = await db.fgProductionStandard.findUnique({
    where: { id },
    select: {
      id: true,
      itemId: true,
      machineId: true,
      cycleTimeSeconds: true,
      piecesPerCycle: true,
      standardEfficiencyPercent: true,
    },
  });
  if (!existing) {
    const err = new Error("FG production standard not found.");
    err.statusCode = 404;
    throw err;
  }

  const data = {};

  if (input.itemId !== undefined) {
    const itemId = Number(input.itemId);
    if (!Number.isInteger(itemId) || itemId < 1) {
      const err = new Error("Finished goods item is required.");
      err.statusCode = 400;
      throw err;
    }
    await assertActiveFgItem(db, itemId);
    data.itemId = itemId;
  }

  if (input.machineId !== undefined) {
    const machineId = Number(input.machineId);
    if (!Number.isInteger(machineId) || machineId < 1) {
      const err = new Error("Machine is required.");
      err.statusCode = 400;
      throw err;
    }
    await assertActiveMachine(db, machineId);
    data.machineId = machineId;
  }

  const nextItemId = data.itemId ?? existing.itemId;
  const nextMachineId = data.machineId ?? existing.machineId;
  if (nextItemId !== existing.itemId || nextMachineId !== existing.machineId) {
    await assertUniqueFgMachine(db, nextItemId, nextMachineId, id);
  }

  const cycleTouched =
    input.cycleTimeSeconds !== undefined ||
    input.piecesPerCycle !== undefined ||
    input.standardEfficiencyPercent !== undefined;

  if (cycleTouched) {
    const validated = validateStandardInputs({
      cycleTimeSeconds:
        input.cycleTimeSeconds !== undefined
          ? input.cycleTimeSeconds
          : decimalToNumber(existing.cycleTimeSeconds),
      piecesPerCycle:
        input.piecesPerCycle !== undefined ? input.piecesPerCycle : existing.piecesPerCycle,
      standardEfficiencyPercent:
        input.standardEfficiencyPercent !== undefined
          ? input.standardEfficiencyPercent
          : decimalToNumber(existing.standardEfficiencyPercent),
    });
    if (input.cycleTimeSeconds !== undefined) data.cycleTimeSeconds = validated.cycleTimeSeconds;
    if (input.piecesPerCycle !== undefined) data.piecesPerCycle = validated.piecesPerCycle;
    if (input.standardEfficiencyPercent !== undefined) {
      data.standardEfficiencyPercent = validated.standardEfficiencyPercent;
    }
  }

  if (input.remarks !== undefined) data.remarks = normalizeOptionalText(input.remarks, 500);
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);

  const row = await db.fgProductionStandard.update({
    where: { id },
    data,
    select: STANDARD_SELECT,
  });
  return mapStandardRow(row);
}

/**
 * Preview expected qty using an active Shift's net production minutes (not stored).
 */
async function previewFgProductionStandard(db = prisma, input) {
  const validated = validateStandardInputs({
    cycleTimeSeconds: input.cycleTimeSeconds,
    piecesPerCycle: input.piecesPerCycle == null || input.piecesPerCycle === "" ? 1 : input.piecesPerCycle,
    standardEfficiencyPercent:
      input.standardEfficiencyPercent == null || input.standardEfficiencyPercent === ""
        ? 95
        : input.standardEfficiencyPercent,
  });

  let netShiftMinutes = input.netShiftMinutes;
  let shiftMeta = null;

  if (input.shiftId != null && input.shiftId !== "") {
    const shiftId = Number(input.shiftId);
    if (!Number.isInteger(shiftId) || shiftId < 1) {
      const err = new Error("Preview shift is invalid.");
      err.statusCode = 400;
      throw err;
    }
    const shift = await db.shift.findUnique({
      where: { id: shiftId },
      select: {
        id: true,
        shiftCode: true,
        shiftName: true,
        startTime: true,
        endTime: true,
        plannedBreakMinutes: true,
        isActive: true,
      },
    });
    if (!shift || !shift.isActive) {
      const err = new Error("Only an active shift can be used for preview.");
      err.statusCode = 400;
      throw err;
    }
    const durations = computeShiftDurations(
      shift.startTime,
      shift.endTime,
      shift.plannedBreakMinutes ?? 0,
    );
    netShiftMinutes = durations.netProductionDurationMinutes;
    shiftMeta = {
      shiftId: shift.id,
      shiftCode: shift.shiftCode,
      shiftName: shift.shiftName,
      isOvernight: durations.isOvernight,
      grossDurationMinutes: durations.grossDurationMinutes,
      netProductionDurationMinutes: durations.netProductionDurationMinutes,
    };
  }

  const preview = computeExpectedShiftQty({
    ...validated,
    netShiftMinutes,
  });

  return { ...preview, shift: shiftMeta };
}

module.exports = {
  mapStandardRow,
  listFgProductionStandards,
  getFgProductionStandardById,
  createFgProductionStandard,
  updateFgProductionStandard,
  previewFgProductionStandard,
  assertActiveFgItem,
  assertActiveMachine,
};
