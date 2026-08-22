const { prisma } = require("../utils/prisma");

const OPERATOR_SELECT = Object.freeze({
  id: true,
  operatorCode: true,
  operatorName: true,
  employeeNumber: true,
  department: true,
  designationSkill: true,
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

/** Trim, uppercase, collapse spaces to underscores — same as Machine Code. */
function normalizeOperatorCode(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  return raw.replace(/\s+/g, "_").slice(0, 32);
}

function normalizeOptionalText(value, maxLen) {
  if (value == null) return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  return text ? text.slice(0, maxLen) : null;
}

/** Employee number: trim only; empty → null. Uniqueness is on stored trimmed value. */
function normalizeEmployeeNumber(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 64) : null;
}

function mapOperatorRow(row) {
  return row;
}

async function assertUniqueOperatorCode(db, operatorCode, excludeId = null) {
  const dup = await db.operator.findFirst({
    where: {
      operatorCode,
      ...(excludeId != null ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (dup) {
    const err = new Error("Operator code already exists.");
    err.statusCode = 409;
    throw err;
  }
}

async function assertUniqueEmployeeNumber(db, employeeNumber, excludeId = null) {
  if (!employeeNumber) return;
  const dup = await db.operator.findFirst({
    where: {
      employeeNumber,
      ...(excludeId != null ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (dup) {
    const err = new Error("Employee number already exists.");
    err.statusCode = 409;
    throw err;
  }
}

async function listOperators(db = prisma, { includeInactive = false } = {}) {
  const rows = await db.operator.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ operatorName: "asc" }, { id: "asc" }],
    select: OPERATOR_SELECT,
  });
  return rows.map(mapOperatorRow);
}

async function getOperatorById(db = prisma, id) {
  const row = await db.operator.findUnique({ where: { id }, select: OPERATOR_SELECT });
  if (!row) {
    const err = new Error("Operator not found.");
    err.statusCode = 404;
    throw err;
  }
  return mapOperatorRow(row);
}

async function createOperator(db = prisma, input) {
  const operatorCode = normalizeOperatorCode(input.operatorCode);
  if (!operatorCode) {
    const err = new Error("Operator code is required.");
    err.statusCode = 400;
    throw err;
  }
  const operatorName = normalizeName(input.operatorName);
  if (!operatorName) {
    const err = new Error("Operator name is required.");
    err.statusCode = 400;
    throw err;
  }
  const employeeNumber = normalizeEmployeeNumber(input.employeeNumber);
  const department = normalizeOptionalText(input.department, 120);
  const designationSkill = normalizeOptionalText(input.designationSkill, 120);
  const remarks = normalizeOptionalText(input.remarks, 500);

  await assertUniqueOperatorCode(db, operatorCode);
  await assertUniqueEmployeeNumber(db, employeeNumber);

  const row = await db.operator.create({
    data: {
      operatorCode,
      operatorName,
      employeeNumber,
      department,
      designationSkill,
      remarks,
      isActive: true,
    },
    select: OPERATOR_SELECT,
  });
  return mapOperatorRow(row);
}

async function updateOperator(db = prisma, id, input) {
  const existing = await db.operator.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    const err = new Error("Operator not found.");
    err.statusCode = 404;
    throw err;
  }

  const data = {};

  if (Object.prototype.hasOwnProperty.call(input, "operatorCode")) {
    const operatorCode = normalizeOperatorCode(input.operatorCode);
    if (!operatorCode) {
      const err = new Error("Operator code is required.");
      err.statusCode = 400;
      throw err;
    }
    await assertUniqueOperatorCode(db, operatorCode, id);
    data.operatorCode = operatorCode;
  }

  if (input.operatorName != null) {
    const operatorName = normalizeName(input.operatorName);
    if (!operatorName) {
      const err = new Error("Operator name is required.");
      err.statusCode = 400;
      throw err;
    }
    data.operatorName = operatorName;
  }

  if (Object.prototype.hasOwnProperty.call(input, "employeeNumber")) {
    const employeeNumber = normalizeEmployeeNumber(input.employeeNumber);
    await assertUniqueEmployeeNumber(db, employeeNumber, id);
    data.employeeNumber = employeeNumber;
  }

  if (Object.prototype.hasOwnProperty.call(input, "department")) {
    data.department = normalizeOptionalText(input.department, 120);
  }
  if (Object.prototype.hasOwnProperty.call(input, "designationSkill")) {
    data.designationSkill = normalizeOptionalText(input.designationSkill, 120);
  }
  if (Object.prototype.hasOwnProperty.call(input, "remarks")) {
    data.remarks = normalizeOptionalText(input.remarks, 500);
  }
  if (input.isActive != null) {
    data.isActive = Boolean(input.isActive);
  }

  const row = await db.operator.update({
    where: { id },
    data,
    select: OPERATOR_SELECT,
  });
  return mapOperatorRow(row);
}

module.exports = {
  normalizeOperatorCode,
  normalizeEmployeeNumber,
  normalizeName,
  normalizeOptionalText,
  mapOperatorRow,
  listOperators,
  getOperatorById,
  createOperator,
  updateOperator,
};
