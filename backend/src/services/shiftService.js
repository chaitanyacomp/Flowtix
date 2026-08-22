const { prisma } = require("../utils/prisma");
const { computeShiftDurations, formatDurationMinutes } = require("./shiftDuration");

const SHIFT_SELECT = Object.freeze({
  id: true,
  shiftCode: true,
  shiftName: true,
  startTime: true,
  endTime: true,
  plannedBreakMinutes: true,
  remarks: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Trim, uppercase, collapse spaces to underscores — same as Machine/Operator Code. */
function normalizeShiftCode(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  return raw.replace(/\s+/g, "_").slice(0, 32);
}

function normalizeOptionalText(value, maxLen) {
  if (value == null) return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  return text ? text.slice(0, maxLen) : null;
}

function mapShiftRow(row) {
  if (!row) return row;
  const durations = computeShiftDurations(row.startTime, row.endTime, row.plannedBreakMinutes ?? 0);
  return {
    ...row,
    startTime: durations.startTime,
    endTime: durations.endTime,
    plannedBreakMinutes: durations.plannedBreakMinutes,
    isOvernight: durations.isOvernight,
    grossDurationMinutes: durations.grossDurationMinutes,
    netProductionDurationMinutes: durations.netProductionDurationMinutes,
    grossDurationLabel: formatDurationMinutes(durations.grossDurationMinutes),
    netProductionDurationLabel: formatDurationMinutes(durations.netProductionDurationMinutes),
  };
}

async function assertUniqueShiftCode(db, shiftCode, excludeId = null) {
  const dup = await db.shift.findFirst({
    where: {
      shiftCode,
      ...(excludeId != null ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (dup) {
    const err = new Error("Shift code already exists.");
    err.statusCode = 409;
    throw err;
  }
}

async function listShifts(db = prisma, { includeInactive = false } = {}) {
  const rows = await db.shift.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ shiftName: "asc" }, { id: "asc" }],
    select: SHIFT_SELECT,
  });
  return rows.map(mapShiftRow);
}

async function getShiftById(db = prisma, id) {
  const row = await db.shift.findUnique({ where: { id }, select: SHIFT_SELECT });
  if (!row) {
    const err = new Error("Shift not found.");
    err.statusCode = 404;
    throw err;
  }
  return mapShiftRow(row);
}

async function createShift(db = prisma, input) {
  const shiftCode = normalizeShiftCode(input.shiftCode);
  if (!shiftCode) {
    const err = new Error("Shift code is required.");
    err.statusCode = 400;
    throw err;
  }
  const shiftName = normalizeName(input.shiftName);
  if (!shiftName) {
    const err = new Error("Shift name is required.");
    err.statusCode = 400;
    throw err;
  }
  const breakRaw =
    input.plannedBreakMinutes == null || input.plannedBreakMinutes === ""
      ? 0
      : input.plannedBreakMinutes;
  const durations = computeShiftDurations(input.startTime, input.endTime, breakRaw);
  const remarks = normalizeOptionalText(input.remarks, 500);

  await assertUniqueShiftCode(db, shiftCode);

  const row = await db.shift.create({
    data: {
      shiftCode,
      shiftName,
      startTime: durations.startTime,
      endTime: durations.endTime,
      plannedBreakMinutes: durations.plannedBreakMinutes,
      remarks,
      isActive: true,
    },
    select: SHIFT_SELECT,
  });
  return mapShiftRow(row);
}

async function updateShift(db = prisma, id, input) {
  const existing = await db.shift.findUnique({ where: { id }, select: SHIFT_SELECT });
  if (!existing) {
    const err = new Error("Shift not found.");
    err.statusCode = 404;
    throw err;
  }

  const data = {};

  if (Object.prototype.hasOwnProperty.call(input, "shiftCode")) {
    const shiftCode = normalizeShiftCode(input.shiftCode);
    if (!shiftCode) {
      const err = new Error("Shift code is required.");
      err.statusCode = 400;
      throw err;
    }
    await assertUniqueShiftCode(db, shiftCode, id);
    data.shiftCode = shiftCode;
  }

  if (input.shiftName != null) {
    const shiftName = normalizeName(input.shiftName);
    if (!shiftName) {
      const err = new Error("Shift name is required.");
      err.statusCode = 400;
      throw err;
    }
    data.shiftName = shiftName;
  }

  const touchTimes =
    Object.prototype.hasOwnProperty.call(input, "startTime") ||
    Object.prototype.hasOwnProperty.call(input, "endTime") ||
    Object.prototype.hasOwnProperty.call(input, "plannedBreakMinutes");

  if (touchTimes) {
    const startTime = Object.prototype.hasOwnProperty.call(input, "startTime")
      ? input.startTime
      : existing.startTime;
    const endTime = Object.prototype.hasOwnProperty.call(input, "endTime")
      ? input.endTime
      : existing.endTime;
    const breakRaw = Object.prototype.hasOwnProperty.call(input, "plannedBreakMinutes")
      ? input.plannedBreakMinutes == null || input.plannedBreakMinutes === ""
        ? 0
        : input.plannedBreakMinutes
      : existing.plannedBreakMinutes;
    const durations = computeShiftDurations(startTime, endTime, breakRaw);
    data.startTime = durations.startTime;
    data.endTime = durations.endTime;
    data.plannedBreakMinutes = durations.plannedBreakMinutes;
  }

  if (Object.prototype.hasOwnProperty.call(input, "remarks")) {
    data.remarks = normalizeOptionalText(input.remarks, 500);
  }
  if (input.isActive != null) {
    data.isActive = Boolean(input.isActive);
  }

  const row = await db.shift.update({
    where: { id },
    data,
    select: SHIFT_SELECT,
  });
  return mapShiftRow(row);
}

module.exports = {
  normalizeShiftCode,
  normalizeName,
  mapShiftRow,
  listShifts,
  getShiftById,
  createShift,
  updateShift,
};
