const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../../src/createApp");
const { signAccessToken } = require("../../src/utils/jwt");

function bearerForRole(role) {
  return `Bearer ${signAccessToken({
    userId: role === "ADMIN" ? 1 : 2,
    email: `${role.toLowerCase()}@test.com`,
    role,
    name: role,
  })}`;
}

describe("master bulk route role gates", () => {
  it("rejects unauthenticated and non-admin customer bulk-delete", async () => {
    const app = createApp();
    const anon = await request(app).post("/api/customers/bulk-delete").send({ ids: [1] });
    assert.equal(anon.status, 401);

    const store = await request(app)
      .post("/api/customers/bulk-delete")
      .set("Authorization", bearerForRole("STORE"))
      .send({ ids: [1] });
    assert.equal(store.status, 403);
  });

  it("rejects non-admin item bulk-activate", async () => {
    const app = createApp();
    const store = await request(app)
      .post("/api/items/bulk-activate")
      .set("Authorization", bearerForRole("STORE"))
      .send({ ids: [1] });
    assert.equal(store.status, 403);
  });

  it("rejects non-admin supplier bulk-delete but allows STORE bulk-deactivate past role gate", async () => {
    const app = createApp();
    const storeDelete = await request(app)
      .post("/api/suppliers/bulk-delete")
      .set("Authorization", bearerForRole("STORE"))
      .send({ ids: [1] });
    assert.equal(storeDelete.status, 403);

    const storeDeactivate = await request(app)
      .post("/api/suppliers/bulk-deactivate")
      .set("Authorization", bearerForRole("STORE"))
      .send({ ids: [999999999] });
    assert.notEqual(storeDeactivate.status, 401);
    assert.notEqual(storeDeactivate.status, 403);
  });
});
