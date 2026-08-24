const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const { createAdminUserService, USER_ROLES } = require("../../src/services/adminUserService");

const ROLE_ENUM = z.enum(["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "PRODUCTION_MANAGER", "QA"]);

function createMemoryDb(initialUsers = []) {
  let nextId = initialUsers.length + 1;
  const users = initialUsers.map((u) => ({ ...u }));

  const db = {
    user: {
      findUnique: async ({ where }) => {
        if (where.email) return users.find((u) => u.email === where.email) ?? null;
        if (where.id != null) return users.find((u) => u.id === where.id) ?? null;
        return null;
      },
      findMany: async ({ where } = {}) => {
        let rows = users;
        if (where?.role) rows = rows.filter((u) => u.role === where.role);
        if (where?.isActive != null) rows = rows.filter((u) => u.isActive === where.isActive);
        return rows.map(({ passwordHash, ...pub }) => pub);
      },
      create: async ({ data, select }) => {
        const row = {
          id: nextId++,
          createdAt: new Date("2026-08-24T18:00:00.000Z"),
          updatedAt: new Date("2026-08-24T18:00:00.000Z"),
          ...data,
        };
        users.push(row);
        return pick(row, select);
      },
      update: async ({ where, data, select }) => {
        const idx = users.findIndex((u) => u.id === where.id);
        assert.ok(idx >= 0, "user not found");
        users[idx] = { ...users[idx], ...data, updatedAt: new Date("2026-08-24T18:01:00.000Z") };
        return pick(users[idx], select);
      },
      count: async ({ where }) =>
        users.filter((u) => {
          if (where.role && u.role !== where.role) return false;
          if (where.isActive != null && u.isActive !== where.isActive) return false;
          if (where.id?.not != null && u.id === where.id.not) return false;
          return true;
        }).length,
    },
    auditLog: {
      create: async () => ({ id: 1 }),
    },
    $transaction: async (fn) => fn(db),
  };

  return db;
}

function pick(row, select) {
  if (!select) return row;
  const out = {};
  for (const key of Object.keys(select)) {
    if (select[key]) out[key] = row[key];
  }
  return out;
}

describe("admin user PRODUCTION_MANAGER role", () => {
  test("USER_ROLES and route ROLE_ENUM include PRODUCTION_MANAGER", () => {
    assert.ok(USER_ROLES.includes("PRODUCTION_MANAGER"));
    assert.equal(
      z.object({ role: ROLE_ENUM }).parse({ role: "PRODUCTION_MANAGER" }).role,
      "PRODUCTION_MANAGER",
    );
  });

  test("createUser persists PRODUCTION_MANAGER", async () => {
    const db = createMemoryDb();
    const svc = createAdminUserService({ prisma: db });
    const user = await svc.createUser({
      email: "pm@test.com",
      name: "Production Manager",
      role: "PRODUCTION_MANAGER",
      password: "secret1",
      actorUserId: 1,
      actorRole: "ADMIN",
    });
    assert.equal(user.role, "PRODUCTION_MANAGER");
    assert.equal(user.email, "pm@test.com");
    assert.equal(user.isActive, true);
  });

  test("updateUser can change role to PRODUCTION_MANAGER", async () => {
    const db = createMemoryDb([
      {
        id: 2,
        email: "prod@test.com",
        name: "Production",
        role: "PRODUCTION",
        isActive: true,
        passwordHash: "x",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const svc = createAdminUserService({ prisma: db });
    const user = await svc.updateUser({
      userId: 2,
      patch: { role: "PRODUCTION_MANAGER" },
      actorUserId: 1,
      actorRole: "ADMIN",
    });
    assert.equal(user.role, "PRODUCTION_MANAGER");
  });

  test("listUsers accepts PRODUCTION_MANAGER filter", async () => {
    const db = createMemoryDb([
      {
        id: 3,
        email: "pm@test.com",
        name: "PM",
        role: "PRODUCTION_MANAGER",
        isActive: true,
        passwordHash: "x",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 4,
        email: "store@test.com",
        name: "Store",
        role: "STORE",
        isActive: true,
        passwordHash: "x",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const svc = createAdminUserService({ prisma: db });
    const users = await svc.listUsers({ role: "PRODUCTION_MANAGER" });
    assert.equal(users.length, 1);
    assert.equal(users[0].role, "PRODUCTION_MANAGER");
  });
});
