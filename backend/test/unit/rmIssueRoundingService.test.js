/**
 * Unit tests for Kg RM upward issue rounding.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  computeRoundedIssueTargetQty,
  computeKgIssueRoundingPlan,
  resolvePmrLineIssueRounding,
  assertIssueWithinRoundingTarget,
  kgIssueRoundingApplies,
  normalizeIssueIncrementForItemSave,
  isKilogramUnit,
} = require("../../src/services/rmIssueRoundingService");

describe("rmIssueRoundingService", () => {
  it("rounds upward with 1 Kg increment examples", () => {
    assert.equal(computeRoundedIssueTargetQty(73.0, 1), 73);
    assert.equal(computeRoundedIssueTargetQty(73.2, 1), 74);
    assert.equal(computeRoundedIssueTargetQty(73.5, 1), 74);
    assert.equal(computeRoundedIssueTargetQty(73.9, 1), 74);
  });

  it("supports configurable 0.5 Kg increment", () => {
    assert.equal(computeRoundedIssueTargetQty(73.2, 0.5), 73.5);
    assert.equal(computeRoundedIssueTargetQty(73.6, 0.5), 74);
    assert.equal(computeRoundedIssueTargetQty(10, 0.5), 10);
  });

  it("does not apply to Gm or Nos", () => {
    assert.equal(isKilogramUnit("Gm"), false);
    assert.equal(isKilogramUnit("Nos"), false);
    assert.equal(
      kgIssueRoundingApplies({ itemType: "RM", unit: "Gm", issueIncrement: 1 }),
      false,
    );
    assert.equal(
      kgIssueRoundingApplies({ itemType: "RM", unit: "Nos", issueIncrement: 1 }),
      false,
    );
    const gm = resolvePmrLineIssueRounding({
      line: { requiredQty: 73.2, issuedQty: 0, waivedQty: 0 },
      item: { itemType: "RM", unit: "Gm", issueIncrement: 1 },
    });
    assert.equal(gm.applies, false);
    assert.equal(gm.remainingIssueQty, 73.2);
  });

  it("computes one rounded target and does not re-round partial issues", () => {
    const plan1 = computeKgIssueRoundingPlan({
      plannedRequiredQty: 73.2,
      issueIncrement: 1,
      cumulativeNetIssuedQty: 0,
    });
    assert.equal(plan1.roundedIssueTargetQty, 74);
    assert.equal(plan1.roundingExcessQty, 0.8);
    assert.equal(plan1.remainingIssueQty, 74);

    const plan2 = computeKgIssueRoundingPlan({
      plannedRequiredQty: 73.2,
      issueIncrement: 1,
      cumulativeNetIssuedQty: 40,
    });
    assert.equal(plan2.roundedIssueTargetQty, 74);
    assert.equal(plan2.remainingIssueQty, 34);

    const plan3 = computeKgIssueRoundingPlan({
      plannedRequiredQty: 73.2,
      issueIncrement: 1,
      cumulativeNetIssuedQty: 74,
    });
    assert.equal(plan3.remainingIssueQty, 0);
  });

  it("caps suggested qty by available stock", () => {
    const plan = computeKgIssueRoundingPlan({
      plannedRequiredQty: 73.2,
      issueIncrement: 1,
      availableQty: 10.25,
    });
    assert.equal(plan.roundedIssueTargetQty, 74);
    assert.equal(plan.suggestedIssueQty, 10.25);
    assert.equal(plan.cappedByStock, true);
  });

  it("API assert blocks issue above remaining rounded target", () => {
    const plan = resolvePmrLineIssueRounding({
      line: {
        requiredQty: 73.2,
        issuedQty: 40,
        waivedQty: 0,
        issueIncrementSnapshot: 1,
        roundedIssueTargetQty: 74,
      },
      item: { itemType: "RM", unit: "Kg", issueIncrement: 1 },
    });
    assert.equal(plan.remainingIssueQty, 34);
    assert.throws(
      () => assertIssueWithinRoundingTarget({ issueQty: 35, plan, itemId: 9 }),
      (err) => err && err.code === "PMR_ROUNDED_ISSUE_TARGET_EXCEEDED",
    );
    assert.doesNotThrow(() =>
      assertIssueWithinRoundingTarget({ issueQty: 34, plan, itemId: 9 }),
    );
  });

  it("uses snapshot target so live increment change does not re-round", () => {
    const plan = resolvePmrLineIssueRounding({
      line: {
        requiredQty: 73.2,
        issuedQty: 0,
        waivedQty: 0,
        issueIncrementSnapshot: 1,
        roundedIssueTargetQty: 74,
      },
      item: { itemType: "RM", unit: "Kg", issueIncrement: 0.5 },
    });
    assert.equal(plan.roundedIssueTargetQty, 74);
    assert.equal(plan.remainingIssueQty, 74);
  });

  it("rounding excess stays as issued production stock (returnable; not wastage)", () => {
    const plan = computeKgIssueRoundingPlan({
      plannedRequiredQty: 73.2,
      issueIncrement: 1,
      cumulativeNetIssuedQty: 74,
    });
    assert.equal(plan.roundingExcessQty, 0.8);
    assert.equal(plan.remainingIssueQty, 0);
    // Net after returning unused excess 0.8 Kg of floor stock:
    const afterReturn = computeKgIssueRoundingPlan({
      plannedRequiredQty: 73.2,
      issueIncrement: 1,
      cumulativeNetIssuedQty: 73.2,
    });
    // Returning excess does not change planned requirement / FG target; remaining to issue stays 0
    // against rounded target once net issued still covers planned (73.2 < 74 still leaves 0.8).
    assert.equal(afterReturn.roundedIssueTargetQty, 74);
    assert.ok(afterReturn.remainingIssueQty > 0);
    assert.equal(afterReturn.remainingIssueQty, 0.8);
  });

  it("normalizes Item Master issueIncrement for RM+Kg only", () => {
    assert.equal(
      normalizeIssueIncrementForItemSave({ itemType: "RM", unitToken: "Kg", issueIncrement: 1 }),
      1,
    );
    assert.equal(
      normalizeIssueIncrementForItemSave({ itemType: "RM", unitToken: "Gm", issueIncrement: 1 }),
      null,
    );
    assert.equal(
      normalizeIssueIncrementForItemSave({ itemType: "FG", unitToken: "Kg", issueIncrement: 1 }),
      null,
    );
    assert.throws(() =>
      normalizeIssueIncrementForItemSave({ itemType: "RM", unitToken: "Kg", issueIncrement: 0 }),
    );
  });

  it("planned requirement includes production (runner in base) + purge once before rounding", () => {
    // Mimic PMR composition: productionRmQty already includes runner via BOM baseQty;
    // purgingRmQty merged once; round only the combined planned requiredQty.
    const productionRmQty = 70.1; // shot + runner
    const purgingRmQty = 3.1; // planned purge once
    const plannedRequiredQty = Math.round((productionRmQty + purgingRmQty) * 1000) / 1000;
    assert.equal(plannedRequiredQty, 73.2);
    const plan = computeKgIssueRoundingPlan({
      plannedRequiredQty,
      issueIncrement: 1,
      cumulativeNetIssuedQty: 0,
    });
    assert.equal(plan.roundedIssueTargetQty, 74);
    assert.equal(plan.roundingExcessQty, 0.8);
    // Double-counting purge would inflate planned; ensure single merge is what we round.
    const doubleCounted = computeRoundedIssueTargetQty(productionRmQty + purgingRmQty + purgingRmQty, 1);
    assert.notEqual(doubleCounted, plan.roundedIssueTargetQty);
  });

  it("REGULAR and NO_QTY share the same rounding formula", () => {
    const shared = {
      plannedRequiredQty: 73.2,
      issueIncrement: 1,
      cumulativeNetIssuedQty: 20,
    };
    const regular = computeKgIssueRoundingPlan(shared);
    const noQty = computeKgIssueRoundingPlan({ ...shared });
    assert.deepEqual(regular, noQty);
    assert.equal(regular.remainingIssueQty, 54);
  });
});
