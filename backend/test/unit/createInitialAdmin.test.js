const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createInitialAdmin } = require("../../../deployment/create-initial-admin");

test("fresh database bootstrap creates only the requested admin without a packaged password", async () => {
  let created;
  const prisma = {
    user: {
      count: async () => 0,
      findUnique: async () => null,
      create: async ({ data }) => {
        created = data;
        return { id: 1, ...data };
      },
    },
  };
  const bcrypt = { hash: async (password, rounds) => `hash:${rounds}:${password.length}` };
  await createInitialAdmin({
    prisma,
    bcrypt,
    email: "pilot.admin@example.com",
    name: "Pilot Admin",
    password: "client-chosen-secret",
  });
  assert.deepEqual(created, {
    email: "pilot.admin@example.com",
    name: "Pilot Admin",
    role: "ADMIN",
    isActive: true,
    passwordHash: "hash:12:20",
  });
});

test("upgrade bootstrap refuses to touch a database with an existing active admin", async () => {
  let writes = 0;
  const prisma = {
    user: {
      count: async () => 1,
      findUnique: async () => ({ id: 7 }),
      create: async () => { writes += 1; },
    },
  };
  await assert.rejects(
    createInitialAdmin({
      prisma,
      bcrypt: { hash: async () => "unused" },
      email: "admin@example.com",
      name: "Admin",
      password: "client-chosen-secret",
    }),
    /already exists/,
  );
  assert.equal(writes, 0);
});
