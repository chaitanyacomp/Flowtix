const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");
const { prisma } = require("../../src/utils/prisma");
const { createApp } = require("../../src/createApp");

const password = "Auth-regression-2026!";
const roles = ["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "QA"];
const emails = roles.map((role) => `auth-${role.toLowerCase()}@integration.local`);
const inactiveEmail = "auth-inactive@integration.local";

before(async () => {
  const passwordHash = await bcrypt.hash(password, 10);
  for (let i = 0; i < roles.length; i += 1) {
    await prisma.user.upsert({
      where: { email: emails[i] },
      update: { role: roles[i], isActive: true, passwordHash },
      create: { email: emails[i], name: `Auth ${roles[i]}`, role: roles[i], isActive: true, passwordHash },
    });
  }
  await prisma.user.upsert({
    where: { email: inactiveEmail },
    update: { role: "QA", isActive: false, passwordHash },
    create: { email: inactiveEmail, name: "Inactive QA", role: "QA", isActive: false, passwordHash },
  });
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [...emails, inactiveEmail] } } });
  await prisma.$disconnect();
});

test("active Admin, Store, Purchase, Production, and QA users authenticate with role permissions", async () => {
  const app = createApp();
  for (const role of roles) {
    const response = await request(app).post("/api/auth/login").send({ email: `  AUTH-${role.toLowerCase()}@INTEGRATION.LOCAL `, password });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.user.role, role);
    assert.equal(response.body.user.landingPath, "/dashboard");
    assert.ok(response.body.user.permissions.includes(`dashboard:${role.toLowerCase()}`));
    assert.equal(response.body.token.split(".").length, 3);
  }
});

test("incorrect password is rejected as credentials, not post-login authorization", async () => {
  const response = await request(createApp()).post("/api/auth/login").send({ email: emails[1], password: "wrong-password" });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.message, "Invalid email or password");
});

test("inactive QA user is rejected with an explicit account-disabled error", async () => {
  const response = await request(createApp()).post("/api/auth/login").send({ email: inactiveEmail, password });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "ACCOUNT_DISABLED");
  assert.equal(response.body.error.message, "Account is disabled");
});
