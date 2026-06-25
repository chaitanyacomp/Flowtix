const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  floorFgQty,
  productionQtyExceedsRmAllowed,
  resolveReadinessGate,
  SUBMITTED_PMR_STATUSES,
  aggregatePmrRequiredByItem,
  computeMaxProducibleFromPmrBasis,
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

  it("aggregatePmrRequiredByItem sums submitted PMR lines", () => {
    const map = aggregatePmrRequiredByItem([
      {
        lines: [
          { itemId: 10, requiredQty: "3.9" },
          { itemId: 10, requiredQty: 0 },
        ],
      },
      {
        lines: [{ itemId: 20, requiredQty: 2.34 }],
      },
    ]);
    assert.equal(map.get(10), 3.9);
    assert.equal(map.get(20), 2.34);
  });

  it("Dummy Plug — full PMR issue allows full WO production (1500)", () => {
    const max = computeMaxProducibleFromPmrBasis({
      woQty: 1500,
      totalWoQty: 1500,
      pmrRequiredByItem: new Map([[101, 3.9]]),
      availableByItem: new Map([[101, 3.9]]),
    });
    assert.equal(max, 1500);
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 1500,
        productionAllowedNowQty: max,
      }),
      false,
    );
  });

  it("Square Box — full PMR issue allows full WO production (500)", () => {
    const max = computeMaxProducibleFromPmrBasis({
      woQty: 500,
      totalWoQty: 500,
      pmrRequiredByItem: new Map([[102, 2.34]]),
      availableByItem: new Map([[102, 2.34]]),
    });
    assert.equal(max, 500);
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 500,
        productionAllowedNowQty: max,
      }),
      false,
    );
  });

  it("partial PMR issue limits production proportionally", () => {
    const max = computeMaxProducibleFromPmrBasis({
      woQty: 1500,
      totalWoQty: 1500,
      pmrRequiredByItem: new Map([[101, 3.9]]),
      availableByItem: new Map([[101, 1.95]]),
    });
    assert.equal(max, 750);
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 751,
        productionAllowedNowQty: max,
      }),
      true,
    );
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 750,
        productionAllowedNowQty: max,
      }),
      false,
    );
  });

  it("PMR basis uses scarcest RM when multiple PMR lines exist", () => {
    const max = computeMaxProducibleFromPmrBasis({
      woQty: 1000,
      totalWoQty: 1000,
      pmrRequiredByItem: new Map([
        [10, 4000],
        [11, 3000],
      ]),
      availableByItem: new Map([
        [10, 4000],
        [11, 1500],
      ]),
    });
    assert.equal(max, 500);
  });

  it("BOM per-unit would under-count vs PMR — PMR basis restores full WO qty", () => {
    const issuedKg = 3.9;
    const woQty = 1500;
    const pmrRequiredKg = 3.9;
    const bomPerFgKg = 0.003;
    const bomCap = floorFgQty(issuedKg, bomPerFgKg);
    const pmrCap = computeMaxProducibleFromPmrBasis({
      woQty,
      totalWoQty: woQty,
      pmrRequiredByItem: new Map([[101, pmrRequiredKg]]),
      availableByItem: new Map([[101, issuedKg]]),
    });
    assert.equal(bomCap, 1300);
    assert.equal(pmrCap, 1500);
  });

  it("Square Box — BOM per-unit 5g would cap at 468; PMR basis allows 500", () => {
    const issuedKg = 2.34;
    const woQty = 500;
    const pmrRequiredKg = 2.34;
    const bomPerFgKg = 0.005;
    const bomCap = floorFgQty(issuedKg, bomPerFgKg);
    const pmrCap = computeMaxProducibleFromPmrBasis({
      woQty,
      totalWoQty: woQty,
      pmrRequiredByItem: new Map([[102, pmrRequiredKg]]),
      availableByItem: new Map([[102, issuedKg]]),
    });
    assert.equal(bomCap, 468);
    assert.equal(pmrCap, 500);
  });
});
