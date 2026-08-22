const { prisma } = require("../utils/prisma");

const MACHINE_TYPES = Object.freeze([
  "INJECTION_MOULDING",
  "BLOW_MOULDING",
  "EXTRUSION",
  "ASSEMBLY",
  "CNC",
  "PRESS",
  "PACKAGING",
  "UTILITY",
  "OTHER",
]);

const MACHINE_TYPE_LABELS = Object.freeze({
  INJECTION_MOULDING: "Injection Moulding",
  BLOW_MOULDING: "Blow Moulding",
  EXTRUSION: "Extrusion",
  ASSEMBLY: "Assembly",
  CNC: "CNC",
  PRESS: "Press",
  PACKAGING: "Packaging",
  UTILITY: "Utility",
  OTHER: "Other",
});

const MACHINE_SELECT = Object.freeze({
  id: true,
  machineCode: true,
  machineName: true,
  machineType: true,
  make: true,
  model: true,
  serialNumber: true,
  departmentLocation: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Trim, uppercase, collapse spaces to underscores — stored form for case-insensitive uniqueness. */
function normalizeMachineCode(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  return raw.replace(/\s+/g, "_").slice(0, 32);
}

function normalizeMachineType(value) {
  const type = String(value ?? "").trim().toUpperCase();
  if (!MACHINE_TYPES.includes(type)) {
    const err = new Error(`Invalid machine type. Use one of: ${MACHINE_TYPES.join(", ")}.`);
    err.statusCode = 400;
    throw err;
  }
  return type;
}

function normalizeOptionalText(value, maxLen) {
  if (value == null) return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  return text ? text.slice(0, maxLen) : null;
}

function mapMachineRow(row) {
  if (!row) return row;
  return {
    ...row,
    machineTypeLabel: MACHINE_TYPE_LABELS[row.machineType] ?? row.machineType,
  };
}

async function assertUniqueMachineCode(db, machineCode, excludeId = null) {
  const dup = await db.machine.findFirst({
    where: {
      machineCode,
      ...(excludeId != null ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (dup) {
    const err = new Error("Machine code already exists.");
    err.statusCode = 409;
    throw err;
  }
}

async function listMachines(db = prisma, { includeInactive = false } = {}) {
  const rows = await db.machine.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ machineName: "asc" }, { id: "asc" }],
    select: MACHINE_SELECT,
  });
  return rows.map(mapMachineRow);
}

async function getMachineById(db = prisma, id) {
  const row = await db.machine.findUnique({ where: { id }, select: MACHINE_SELECT });
  if (!row) {
    const err = new Error("Machine not found.");
    err.statusCode = 404;
    throw err;
  }
  return mapMachineRow(row);
}

async function createMachine(db = prisma, input) {
  const machineCode = normalizeMachineCode(input.machineCode);
  if (!machineCode) {
    const err = new Error("Machine code is required.");
    err.statusCode = 400;
    throw err;
  }
  const machineName = normalizeName(input.machineName);
  if (!machineName) {
    const err = new Error("Machine name is required.");
    err.statusCode = 400;
    throw err;
  }
  const machineType = normalizeMachineType(input.machineType);
  const make = normalizeOptionalText(input.make, 120);
  const model = normalizeOptionalText(input.model, 120);
  const serialNumber = normalizeOptionalText(input.serialNumber, 120);
  const departmentLocation = normalizeOptionalText(input.departmentLocation, 120);
  const description = normalizeOptionalText(input.description, 500);

  await assertUniqueMachineCode(db, machineCode);

  const row = await db.machine.create({
    data: {
      machineCode,
      machineName,
      machineType,
      make,
      model,
      serialNumber,
      departmentLocation,
      description,
      isActive: true,
    },
    select: MACHINE_SELECT,
  });
  return mapMachineRow(row);
}

async function updateMachine(db = prisma, id, input) {
  const existing = await db.machine.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    const err = new Error("Machine not found.");
    err.statusCode = 404;
    throw err;
  }

  const data = {};

  if (Object.prototype.hasOwnProperty.call(input, "machineCode")) {
    const machineCode = normalizeMachineCode(input.machineCode);
    if (!machineCode) {
      const err = new Error("Machine code is required.");
      err.statusCode = 400;
      throw err;
    }
    await assertUniqueMachineCode(db, machineCode, id);
    data.machineCode = machineCode;
  }

  if (input.machineName != null) {
    const machineName = normalizeName(input.machineName);
    if (!machineName) {
      const err = new Error("Machine name is required.");
      err.statusCode = 400;
      throw err;
    }
    data.machineName = machineName;
  }

  if (input.machineType != null) {
    data.machineType = normalizeMachineType(input.machineType);
  }

  if (Object.prototype.hasOwnProperty.call(input, "make")) {
    data.make = normalizeOptionalText(input.make, 120);
  }
  if (Object.prototype.hasOwnProperty.call(input, "model")) {
    data.model = normalizeOptionalText(input.model, 120);
  }
  if (Object.prototype.hasOwnProperty.call(input, "serialNumber")) {
    data.serialNumber = normalizeOptionalText(input.serialNumber, 120);
  }
  if (Object.prototype.hasOwnProperty.call(input, "departmentLocation")) {
    data.departmentLocation = normalizeOptionalText(input.departmentLocation, 120);
  }
  if (Object.prototype.hasOwnProperty.call(input, "description")) {
    data.description = normalizeOptionalText(input.description, 500);
  }
  if (input.isActive != null) {
    data.isActive = Boolean(input.isActive);
  }

  const row = await db.machine.update({
    where: { id },
    data,
    select: MACHINE_SELECT,
  });
  return mapMachineRow(row);
}

module.exports = {
  MACHINE_TYPES,
  MACHINE_TYPE_LABELS,
  normalizeMachineCode,
  normalizeMachineType,
  normalizeName,
  normalizeOptionalText,
  mapMachineRow,
  listMachines,
  getMachineById,
  createMachine,
  updateMachine,
};
