const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../../src/createApp");
const { signAccessToken } = require("../../src/utils/jwt");
const {
  MATERIAL_REQUISITION_WRITE_ROLES,
  RM_PO_WRITE_ROLES,
  PURCHASE_EXECUTION_ROLES,
} = require("../../src/constants/erpRoles");

function bearerForRole(role) {
  return `Bearer ${signAccessToken({
    userId: role === "ADMIN" ? 1 : 2,
    email: `${role.toLowerCase()}@test.com`,
    role,
    name: role,
  })}`;
}

describe("P5C-1 — procurement ownership route authorization", () => {
  it("STORE is in MATERIAL_REQUISITION_WRITE_ROLES; PURCHASE is not", () => {
    assert.ok(MATERIAL_REQUISITION_WRITE_ROLES.includes("STORE"));
    assert.equal(MATERIAL_REQUISITION_WRITE_ROLES.includes("PURCHASE"), false);
  });

  it("PURCHASE remains in RM_PO_WRITE_ROLES for PO execution", () => {
    assert.ok(RM_PO_WRITE_ROLES.includes("PURCHASE"));
    assert.equal(RM_PO_WRITE_ROLES.includes("STORE"), false);
  });

  it("PURCHASE is in PURCHASE_EXECUTION_ROLES for MPRS PR creation", () => {
    assert.ok(PURCHASE_EXECUTION_ROLES.includes("PURCHASE"));
    assert.equal(PURCHASE_EXECUTION_ROLES.includes("STORE"), false);
  });

  it("POST /api/procurement-planning/send-requirement allows PURCHASE past role gate", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/procurement-planning/send-requirement")
      .set("Authorization", bearerForRole("PURCHASE"))
      .send({ lines: [] });
    assert.notEqual(res.status, 403);
  });

  it("POST /api/procurement-planning/send-requirement allows STORE past role gate", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/procurement-planning/send-requirement")
      .set("Authorization", bearerForRole("STORE"))
      .send({ lines: [] });
    assert.notEqual(res.status, 403);
  });

  it("POST /api/material-availability/production-shortage-mr rejects PURCHASE (403)", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/material-availability/production-shortage-mr")
      .set("Authorization", bearerForRole("PURCHASE"))
      .send({ workOrderId: 1, rmItemId: 1, shortageQty: 1 });
    assert.equal(res.status, 403);
  });

  it("POST /api/material-availability/production-shortage-mr allows STORE past role gate", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/material-availability/production-shortage-mr")
      .set("Authorization", bearerForRole("STORE"))
      .send({ workOrderId: 1, rmItemId: 1, shortageQty: 1 });
    assert.notEqual(res.status, 403);
  });

  it("POST /api/material-availability/production-shortage-mr/bulk rejects PURCHASE (403)", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/material-availability/production-shortage-mr/bulk")
      .set("Authorization", bearerForRole("PURCHASE"))
      .send({ workOrderId: 1 });
    assert.equal(res.status, 403);
  });

  it("POST /api/material-availability/production-shortage-mr/bulk allows STORE past role gate", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/material-availability/production-shortage-mr/bulk")
      .set("Authorization", bearerForRole("STORE"))
      .send({ workOrderId: 1 });
    assert.notEqual(res.status, 403);
  });
});
