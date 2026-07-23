const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../../src/createApp");
const { signAccessToken } = require("../../src/utils/jwt");
const {
  MATERIAL_REQUISITION_WRITE_ROLES,
  PURCHASE_EXECUTION_ROLES,
  RM_PO_WRITE_ROLES,
} = require("../../src/constants/erpRoles");

function bearerForRole(role) {
  return `Bearer ${signAccessToken({
    userId: role === "ADMIN" ? 1 : 2,
    email: `${role.toLowerCase()}@test.com`,
    role,
    name: role,
  })}`;
}

describe("REGULAR_SO create-purchase-request ownership", () => {
  it("Store may call create-purchase-request; Purchase is rejected at role gate", async () => {
    assert.ok(MATERIAL_REQUISITION_WRITE_ROLES.includes("STORE"));
    assert.equal(MATERIAL_REQUISITION_WRITE_ROLES.includes("PURCHASE"), false);
    assert.ok(RM_PO_WRITE_ROLES.includes("PURCHASE"));
    assert.ok(PURCHASE_EXECUTION_ROLES.includes("PURCHASE"));

    const app = createApp();
    // Use a non-existent SO id so authorization is exercised without mutating live data.
    const storeRes = await request(app)
      .post("/api/sales-orders/999999999/create-purchase-request")
      .set("Authorization", bearerForRole("STORE"))
      .send({});
    assert.notEqual(storeRes.status, 403);
    assert.equal(storeRes.status, 404);

    const purchaseRes = await request(app)
      .post("/api/sales-orders/999999999/create-purchase-request")
      .set("Authorization", bearerForRole("PURCHASE"))
      .send({});
    assert.equal(purchaseRes.status, 403);
  });
});
