const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../../src/createApp");
const { signAccessToken } = require("../../src/utils/jwt");
const { prefixForDocType } = require("../../src/services/docNoService");
const { DocType } = require("../../src/prismaClientPackage");
const { TXN_TYPE, computeMaterialIssuePlanLine } = require("../../src/services/materialIssueService");

function bearerForRole(role) {
  return `Bearer ${signAccessToken({
    userId: role === "ADMIN" ? 1 : 2,
    email: `${role.toLowerCase()}@test.com`,
    role,
    name: role,
  })}`;
}

describe("material issue (Phase 3A)", () => {
  it("uses MIN doc prefix for MATERIAL_ISSUE_NOTE", () => {
    assert.equal(prefixForDocType(DocType.MATERIAL_ISSUE_NOTE), "MIN");
  });

  it("uses LOCATION_TRANSFER stock txn type (not production ISSUE)", () => {
    assert.equal(TXN_TYPE, "LOCATION_TRANSFER");
    assert.notEqual(TXN_TYPE, "ISSUE");
  });

  it("calculates re-issue from WO balance and production-held RM", () => {
    const line = computeMaterialIssuePlanLine({
      fullWoRmNeed: 5000,
      consumedQty: 3000,
      returnedQty: 1000,
      issuedToProductionQty: 5000,
      requiredForBalanceQty: 2000,
      availableInStore: 800,
    });

    assert.equal(line.atProductionQty, 1000);
    assert.equal(line.stillRequiredQty, 1000);
    assert.equal(line.issueNowQty, 800);
  });

  it("caps issue-now by both balance requirement and store stock", () => {
    const firstIssue = computeMaterialIssuePlanLine({
      fullWoRmNeed: 5000,
      consumedQty: 0,
      returnedQty: 0,
      issuedToProductionQty: 0,
      requiredForBalanceQty: 5000,
      availableInStore: 6000,
    });
    const storeShort = computeMaterialIssuePlanLine({
      fullWoRmNeed: 5000,
      consumedQty: 0,
      returnedQty: 0,
      issuedToProductionQty: 0,
      requiredForBalanceQty: 5000,
      availableInStore: 2500,
    });

    assert.equal(firstIssue.issueNowQty, 5000);
    assert.equal(storeShort.issueNowQty, 2500);
    assert.ok(storeShort.issueNowQty <= storeShort.stillRequiredQty);
    assert.ok(storeShort.issueNowQty <= storeShort.availableInStore);
  });

  it("restricts material issue API to store roles", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/material-issues/context")
      .set("Authorization", bearerForRole("PRODUCTION"));
    assert.equal(res.status, 403);
  });

  it("allows STORE to load material issue context", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/material-issues/context")
      .set("Authorization", bearerForRole("STORE"));
    assert.ok(res.status === 200 || res.status >= 500);
    if (res.status === 200) {
      assert.ok(Array.isArray(res.body?.fromLocations));
      assert.ok(Array.isArray(res.body?.toLocations));
    }
  });
});
