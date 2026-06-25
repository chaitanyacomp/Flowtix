const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  actorMayCreatePurchaseRequestForSourceTypes,
  assertActorMayCreatePurchaseRequest,
} = require("../../src/services/procurementPurchaseRequestOwnership");

describe("procurementPurchaseRequestOwnership", () => {
  it("Purchase may create PR for MONTHLY_PLAN (MPRS) only", () => {
    assert.equal(actorMayCreatePurchaseRequestForSourceTypes("PURCHASE", ["MONTHLY_PLAN"]), true);
    assert.equal(actorMayCreatePurchaseRequestForSourceTypes("PURCHASE", ["SALES_ORDER"]), false);
    assert.equal(actorMayCreatePurchaseRequestForSourceTypes("PURCHASE", ["WORK_ORDER_PLANNING"]), false);
  });

  it("Store may create PR for non-MPRS demand pools", () => {
    assert.equal(actorMayCreatePurchaseRequestForSourceTypes("STORE", ["SALES_ORDER"]), true);
    assert.equal(actorMayCreatePurchaseRequestForSourceTypes("STORE", ["WORK_ORDER_PLANNING"]), true);
    assert.equal(actorMayCreatePurchaseRequestForSourceTypes("STORE", ["STOCK_REPLENISHMENT"]), true);
    assert.equal(actorMayCreatePurchaseRequestForSourceTypes("STORE", ["MONTHLY_PLAN"]), false);
  });

  it("Admin may create PR for any single pool", () => {
    assert.equal(actorMayCreatePurchaseRequestForSourceTypes("ADMIN", ["MONTHLY_PLAN"]), true);
    assert.equal(actorMayCreatePurchaseRequestForSourceTypes("ADMIN", ["SALES_ORDER"]), true);
  });

  it("assertActorMayCreatePurchaseRequest throws 403 for wrong role", () => {
    assert.throws(
      () => assertActorMayCreatePurchaseRequest({ role: "PURCHASE" }, ["SALES_ORDER"]),
      (err) => err.statusCode === 403,
    );
    assert.throws(
      () => assertActorMayCreatePurchaseRequest({ role: "STORE" }, ["MONTHLY_PLAN"]),
      (err) => err.statusCode === 403,
    );
    assert.doesNotThrow(() =>
      assertActorMayCreatePurchaseRequest({ role: "PURCHASE" }, ["MONTHLY_PLAN"]),
    );
  });
});
