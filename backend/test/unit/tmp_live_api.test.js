const { test } = require("node:test");
const request = require("supertest");
const { createApp } = require("../../src/createApp");
const { signAccessToken } = require("../../src/utils/jwt");

test("live api procurement workspace for SO-26-0001", async () => {
  const app = createApp();
  const token = "Bearer " + signAccessToken({ userId: 1, email: "admin@test.com", role: "ADMIN", name: "Admin" });
  const procurement = await request(app)
    .get("/api/procurement-planning/workspace?salesOrderId=127")
    .set("Authorization", token);
  const pending = await request(app)
    .get("/api/dashboard/procurement-pending?salesOrderId=127")
    .set("Authorization", token);
  const control = await request(app)
    .get("/api/material-availability/workspace?salesOrderId=127&onlyBlocked=true")
    .set("Authorization", token);
  console.log(JSON.stringify({
    procurement: { status: procurement.status, body: procurement.body },
    pending: { status: pending.status, body: pending.body },
    control: { status: control.status, body: control.body },
  }, null, 2));
});

