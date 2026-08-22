const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeOperatorCode,
  normalizeEmployeeNumber,
  normalizeName,
  createOperator,
  updateOperator,
  listOperators,
} = require("../../src/services/operatorService");

function makeDb({ operators = [] } = {}) {
  const opRows = operators.map((r, i) => ({
    id: r.id ?? i + 1,
    operatorCode: r.operatorCode,
    operatorName: r.operatorName,
    employeeNumber: r.employeeNumber ?? null,
    department: r.department ?? null,
    designationSkill: r.designationSkill ?? null,
    remarks: r.remarks ?? null,
    isActive: r.isActive ?? true,
    createdAt: r.createdAt ?? new Date(),
    updatedAt: r.updatedAt ?? new Date(),
  }));

  function filterOps(where = {}) {
    return opRows.filter((r) => {
      if (where.isActive === true && !r.isActive) return false;
      if (where.operatorCode != null && r.operatorCode !== where.operatorCode) return false;
      if (where.employeeNumber != null && r.employeeNumber !== where.employeeNumber) return false;
      if (where.id?.not != null && r.id === where.id.not) return false;
      if (typeof where.id === "number" && r.id !== where.id) return false;
      return true;
    });
  }

  return {
    operator: {
      findMany: async ({ where } = {}) => filterOps(where || {}),
      findFirst: async ({ where } = {}) => filterOps(where || {})[0] ?? null,
      findUnique: async ({ where }) => opRows.find((r) => r.id === where.id) ?? null,
      create: async ({ data, select }) => {
        const row = {
          id: opRows.length ? Math.max(...opRows.map((o) => o.id)) + 1 : 1,
          employeeNumber: null,
          department: null,
          designationSkill: null,
          remarks: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        opRows.push(row);
        if (!select) return row;
        const out = {};
        for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
        return out;
      },
      update: async ({ where, data, select }) => {
        const row = opRows.find((r) => r.id === where.id);
        Object.assign(row, data, { updatedAt: new Date() });
        if (!select) return row;
        const out = {};
        for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
        return out;
      },
    },
  };
}

describe("operatorService (Step 2 Operator Master)", () => {
  it("normalizes code like Machine Code", () => {
    assert.equal(normalizeName("  Op  One "), "Op One");
    assert.equal(normalizeOperatorCode("  op 01 "), "OP_01");
    assert.equal(normalizeOperatorCode("op-01"), "OP-01");
    assert.equal(normalizeOperatorCode("   "), null);
    assert.equal(normalizeEmployeeNumber("  E-9  "), "E-9");
    assert.equal(normalizeEmployeeNumber("   "), null);
  });

  it("creates operator and blocks duplicate code / employee number", async () => {
    const db = makeDb({
      operators: [{ id: 1, operatorCode: "OP_01", operatorName: "One", employeeNumber: "E1" }],
    });
    const created = await createOperator(db, {
      operatorCode: "  op 02 ",
      operatorName: " Two ",
      employeeNumber: " E2 ",
      department: " Line A ",
      designationSkill: " Setter ",
      remarks: " note ",
    });
    assert.equal(created.operatorCode, "OP_02");
    assert.equal(created.operatorName, "Two");
    assert.equal(created.employeeNumber, "E2");
    assert.equal(created.department, "Line A");
    assert.equal(created.designationSkill, "Setter");
    assert.equal(created.remarks, "note");
    assert.equal(created.isActive, true);
    assert.equal(Object.prototype.hasOwnProperty.call(created, "linkedUserId"), false);

    await assert.rejects(
      () => createOperator(db, { operatorCode: "op 01", operatorName: "X" }),
      (err) => err.statusCode === 409 && /Operator code already exists/i.test(err.message),
    );
    await assert.rejects(
      () => createOperator(db, { operatorCode: "OP_03", operatorName: "X", employeeNumber: "E1" }),
      (err) => err.statusCode === 409 && /Employee number already exists/i.test(err.message),
    );
  });

  it("lists inactive when requested; supports activate/deactivate", async () => {
    const db = makeDb({
      operators: [
        { id: 1, operatorCode: "A1", operatorName: "Active", isActive: true },
        { id: 2, operatorCode: "B1", operatorName: "Inactive", isActive: false },
      ],
    });
    assert.equal((await listOperators(db, { includeInactive: false })).length, 1);
    assert.equal((await listOperators(db, { includeInactive: true })).length, 2);
    const updated = await updateOperator(db, 1, { isActive: false });
    assert.equal(updated.isActive, false);
  });
});
