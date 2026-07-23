const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  scaleRmRequiredToWoTarget,
  computeRoundedDownToleranceQty,
  isWithinRoundingTolerance,
  physicalRmSupportedProductionQty,
  computeRegularSoProductionMaximum,
  deriveRegularSoRmIssueStatus,
  cumulativeAllowanceExcessPercent,
  assertRegularSoCumulativeAllowanceGate,
  resolveRegularSoRmPlanningFgQty,
  buildRegularSoQuantityProjection,
  ROUNDING_TOLERANCE_MAX_KG,
} = require("../../src/services/regularSoRmIssuePlanning");

describe("regularSoRmIssuePlanning — buffered RM readiness", () => {
  it("15,000 Nos + 0.5% → WO 15,075; RM Required 211.05 from 210 Kg BOM", () => {
    const salesOrderQty = 15000;
    const woTargetQty = 15075;
    const bomForSo = 210;
    const theoretical = scaleRmRequiredToWoTarget(bomForSo, salesOrderQty, woTargetQty);
    assert.equal(theoretical, 211.05);
    assert.equal(210 / 15000, 0.014);
    assert.ok(Math.abs(15075 * 0.014 - 211.05) < 1e-9);
  });

  it("resolveRegularSoRmPlanningFgQty prefers buffered planned over stale SO-qty override", () => {
    const qty = resolveRegularSoRmPlanningFgQty(
      {
        customerCommittedQty: 15000,
        orderQty: 15000,
        plannedProductionQty: 15075,
        rmPlanningQty: 15075,
      },
      15000,
    );
    assert.equal(qty, 15075);
  });

  it("resolveRegularSoRmPlanningFgQty still honours intentional lower plan override", () => {
    const qty = resolveRegularSoRmPlanningFgQty(
      {
        customerCommittedQty: 15000,
        plannedProductionQty: 15075,
        rmPlanningQty: 15075,
      },
      8000,
    );
    assert.equal(qty, 8000);
  });
});

describe("regularSoRmIssuePlanning — rounding tolerance", () => {
  it("tolerance = min(0.5% of theoretical, 0.5 Kg)", () => {
    assert.equal(computeRoundedDownToleranceQty(211.05), 0.5); // 0.5% of 211.05 = 1.05525 → capped 0.5
    assert.equal(ROUNDING_TOLERANCE_MAX_KG, 0.5);
    assert.equal(computeRoundedDownToleranceQty(40), 0.2); // 0.5% of 40 = 0.2
  });

  it("211 Kg issued vs 211.05 required is within tolerance", () => {
    assert.equal(isWithinRoundingTolerance(211.05, 211), true);
  });

  it("larger shortage outside tolerance remains partial", () => {
    assert.equal(isWithinRoundingTolerance(211.05, 210), false);
    assert.equal(
      deriveRegularSoRmIssueStatus({
        theoreticalRmRequiredQty: 211.05,
        cumulativeRmIssuedQty: 210,
      }).statusKey,
      "PARTIALLY_ISSUED",
    );
  });

  it("acknowledged rounding tolerance status label", () => {
    const s = deriveRegularSoRmIssueStatus({
      theoreticalRmRequiredQty: 211.05,
      cumulativeRmIssuedQty: 211,
      waivedQty: 0.05,
      shortCloseReason: "ROUNDING_TOLERANCE",
    });
    assert.equal(s.statusKey, "FULLY_ISSUED_WITHIN_ROUNDING_TOLERANCE");
    assert.match(s.statusLabel, /Within Rounding Tolerance/i);
  });
});

describe("regularSoRmIssuePlanning — issue statuses and capacity", () => {
  const perFg = 0.014;

  it("exact 211.05 → Fully Issued", () => {
    const s = deriveRegularSoRmIssueStatus({
      theoreticalRmRequiredQty: 211.05,
      cumulativeRmIssuedQty: 211.05,
    });
    assert.equal(s.statusKey, "FULLY_ISSUED");
  });

  it("100 Kg → Partially Issued; physical capacity 7,142 Nos", () => {
    const s = deriveRegularSoRmIssueStatus({
      theoreticalRmRequiredQty: 211.05,
      cumulativeRmIssuedQty: 100,
    });
    assert.equal(s.statusKey, "PARTIALLY_ISSUED");
    assert.equal(physicalRmSupportedProductionQty(100, perFg), 7142);
  });

  it("211 Kg physical 15,071; with tolerance ack WO target 15,075 permitted; not beyond", () => {
    assert.equal(physicalRmSupportedProductionQty(211, perFg), 15071);
    assert.equal(
      computeRegularSoProductionMaximum({
        netRmIssuedQty: 211,
        bomConsumptionPerFg: perFg,
        woTargetQty: 15075,
        roundingToleranceAcknowledged: true,
      }),
      15075,
    );
    assert.equal(
      computeRegularSoProductionMaximum({
        netRmIssuedQty: 211,
        bomConsumptionPerFg: perFg,
        woTargetQty: 15075,
        roundingToleranceAcknowledged: false,
      }),
      15071,
    );
  });

  it("212 / 213 Kg → Excess/Allowance Issued; capacity 15,142 / 15,214", () => {
    assert.equal(physicalRmSupportedProductionQty(212, perFg), 15142);
    assert.equal(physicalRmSupportedProductionQty(213, perFg), 15214);
    assert.equal(
      deriveRegularSoRmIssueStatus({
        theoreticalRmRequiredQty: 211.05,
        cumulativeRmIssuedQty: 212,
      }).statusKey,
      "EXCESS_ALLOWANCE_ISSUED",
    );
    assert.equal(
      computeRegularSoProductionMaximum({
        netRmIssuedQty: 212,
        bomConsumptionPerFg: perFg,
        woTargetQty: 15075,
        roundingToleranceAcknowledged: false,
      }),
      15142,
    );
  });

  it("quantity projection keeps SO dispatch qty separate from WO target", () => {
    const p = buildRegularSoQuantityProjection({
      salesOrderQty: 15000,
      woTargetQty: 15075,
      theoreticalRmRequiredQty: 211.05,
      cumulativeRmIssuedQty: 211,
      roundingToleranceAcknowledged: true,
    });
    assert.equal(p.salesOrderQty, 15000);
    assert.equal(p.woTargetQty, 15075);
    assert.equal(p.theoreticalRmRequiredQty, 211.05);
    assert.equal(p.productionMaximumQty, 15075);
    assert.equal(p.rmSupportedProductionQty, 15071);
  });
});

describe("regularSoRmIssuePlanning — cumulative allowance gate", () => {
  it("split issues cannot bypass >5% cumulative excess", () => {
    // After full theoretical + first small top-up already at ~4.97%, second top-up pushes >5%.
    const theoretical = 211.05;
    const afterFirstTopUp = 211.05 + 10.5;
    assert.ok(cumulativeAllowanceExcessPercent(theoretical, afterFirstTopUp) < 5.01);
    assert.throws(
      () =>
        assertRegularSoCumulativeAllowanceGate({
          theoreticalRmRequiredQty: theoretical,
          cumulativeNetIssuedAfter: afterFirstTopUp + 10.5,
          role: "STORE",
          hasApprovedRequest: false,
        }),
      (err) => err.code === "REGULAR_SO_CUMULATIVE_ALLOWANCE_ADMIN_REQUIRED",
    );
  });

  it("above 10% cumulative excess is blocked", () => {
    assert.throws(
      () =>
        assertRegularSoCumulativeAllowanceGate({
          theoreticalRmRequiredQty: 211.05,
          cumulativeNetIssuedAfter: 211.05 * 1.11,
          role: "ADMIN",
          hasApprovedRequest: true,
        }),
      (err) => err.code === "REGULAR_SO_CUMULATIVE_ALLOWANCE_BLOCKED",
    );
  });

  it("≤5% cumulative excess allowed for Store", () => {
    const r = assertRegularSoCumulativeAllowanceGate({
      theoreticalRmRequiredQty: 211.05,
      cumulativeNetIssuedAfter: 211.05 * 1.04,
      role: "STORE",
    });
    assert.equal(r.requiresAdminApproval, false);
  });
});
