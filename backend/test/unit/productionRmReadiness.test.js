const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  floorFgQty,
  productionQtyExceedsRmAllowed,
  resolveReadinessGate,
  SUBMITTED_PMR_STATUSES,
} = require("../../src/services/productionRmReadinessService");

describe("productionRmReadinessService", () => {
  it("SUBMITTED_PMR_STATUSES includes store-issue states", () => {
    assert.ok(SUBMITTED_PMR_STATUSES.includes("REQUESTED"));
    assert.ok(SUBMITTED_PMR_STATUSES.includes("PARTIALLY_ISSUED"));
    assert.ok(!SUBMITTED_PMR_STATUSES.includes("DRAFT"));
  });

  it("floorFgQty - max producible is limited by scarcest RM", () => {
    const ppCaps = floorFgQty(4000, 1);
    const powderCaps = floorFgQty(3000, 1);
    assert.equal(ppCaps, 4000);
    assert.equal(powderCaps, 3000);
    assert.equal(Math.min(ppCaps, powderCaps), 3000);
  });

  it("allows production qty equal to RM allowed qty", () => {
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 2000,
        productionAllowedNowQty: 2000,
      }),
      false,
    );
  });

  it("blocks only when production qty exceeds RM allowed qty", () => {
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 2001,
        productionAllowedNowQty: 2000,
      }),
      true,
    );
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 1000,
        productionAllowedNowQty: 2000,
      }),
      false,
    );
  });

  it("uses tolerance for decimal equality at the RM cap", () => {
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 2000.0000004,
        productionAllowedNowQty: 2000,
      }),
      false,
    );
  });

  it("resolveReadinessGate - no PMR when empty", () => {
    const g = resolveReadinessGate([], 0);
    assert.equal(g.gate, "NO_PMR");
  });

  it("resolveReadinessGate - waiting when submitted but zero issued", () => {
    const g = resolveReadinessGate([{ status: "REQUESTED" }], 0);
    assert.equal(g.gate, "WAITING_STORE_ISSUE");
  });

  it("resolveReadinessGate - partial when some issued", () => {
    const g = resolveReadinessGate([{ status: "PARTIALLY_ISSUED" }], 100);
    assert.equal(g.gate, "PARTIAL_READY");
  });

  it("resolveReadinessGate - fully issued when all PMRs FULLY_ISSUED", () => {
    const g = resolveReadinessGate([{ status: "FULLY_ISSUED" }, { status: "FULLY_ISSUED" }], 500);
    assert.equal(g.gate, "FULLY_ISSUED_READY");
  });
});
