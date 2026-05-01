/**
 * Pure policy tests for stock adjustment reversal window (no DB).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertReverseWithinPolicyWindow,
  assertUserCanReverseStockAdjustment,
  assertUserCanCreateStockAdjustment,
  normalizeStockAdjustmentPolicy,
  MSG,
} = require("../src/services/stockAdjustmentPolicy");

describe("normalizeStockAdjustmentPolicy defaults", () => {
  it("fills defaults when row missing", () => {
    const p = normalizeStockAdjustmentPolicy(null);
    assert.equal(p.stockAdjustmentReverseRoles, "ADMIN_ONLY");
    assert.equal(p.stockAdjustmentReverseWindowType, "HOURS");
    assert.equal(p.stockAdjustmentReverseWindowValue, 24);
    assert.equal(p.stockAdjustmentCreateRoles, "ADMIN_AND_STORE");
  });
});

describe("assertUserCanReverseStockAdjustment", () => {
  const pAdminOnly = normalizeStockAdjustmentPolicy({ stockAdjustmentReverseRoles: "ADMIN_ONLY" });
  const pBoth = normalizeStockAdjustmentPolicy({ stockAdjustmentReverseRoles: "ADMIN_AND_STORE" });

  it("ADMIN_ONLY allows ADMIN", () => {
    assertUserCanReverseStockAdjustment("ADMIN", pAdminOnly);
  });
  it("ADMIN_ONLY blocks STORE", () => {
    assert.throws(() => assertUserCanReverseStockAdjustment("STORE", pAdminOnly), (e) => e.message === MSG.reverseRole);
  });
  it("ADMIN_AND_STORE allows STORE", () => {
    assertUserCanReverseStockAdjustment("STORE", pBoth);
  });
});

describe("assertUserCanCreateStockAdjustment", () => {
  const pAdminOnly = normalizeStockAdjustmentPolicy({ stockAdjustmentCreateRoles: "ADMIN_ONLY" });
  const pBoth = normalizeStockAdjustmentPolicy({ stockAdjustmentCreateRoles: "ADMIN_AND_STORE" });

  it("create ADMIN_ONLY blocks STORE", () => {
    assert.throws(() => assertUserCanCreateStockAdjustment("STORE", pAdminOnly), (e) => e.message === MSG.createRole);
  });
  it("create ADMIN_AND_STORE allows STORE", () => {
    assertUserCanCreateStockAdjustment("STORE", pBoth);
  });
});

describe("assertReverseWithinPolicyWindow", () => {
  const pNoLimit = normalizeStockAdjustmentPolicy({
    stockAdjustmentReverseWindowType: "NO_LIMIT",
  });
  const pSameDay = normalizeStockAdjustmentPolicy({
    stockAdjustmentReverseWindowType: "SAME_DAY",
  });
  const pHours24 = normalizeStockAdjustmentPolicy({
    stockAdjustmentReverseWindowType: "HOURS",
    stockAdjustmentReverseWindowValue: 24,
  });
  const pDays3 = normalizeStockAdjustmentPolicy({
    stockAdjustmentReverseWindowType: "DAYS",
    stockAdjustmentReverseWindowValue: 3,
  });

  it("NO_LIMIT allows old dates", () => {
    const orig = new Date("2020-01-01T10:00:00");
    const now = new Date("2025-06-01T12:00:00");
    assertReverseWithinPolicyWindow(orig, now, pNoLimit);
  });

  it("SAME_DAY allows same calendar day", () => {
    const orig = new Date("2025-06-10T08:00:00");
    const now = new Date("2025-06-10T22:00:00");
    assertReverseWithinPolicyWindow(orig, now, pSameDay);
  });

  it("SAME_DAY blocks next day", () => {
    const orig = new Date("2025-06-10T23:00:00");
    const now = new Date("2025-06-11T01:00:00");
    assert.throws(() => assertReverseWithinPolicyWindow(orig, now, pSameDay), (e) => e.message === MSG.sameDay);
  });

  it("HOURS allows within window", () => {
    const orig = new Date("2025-06-10T12:00:00");
    const now = new Date("2025-06-10T18:00:00");
    assertReverseWithinPolicyWindow(orig, now, pHours24);
  });

  it("HOURS blocks after window", () => {
    const orig = new Date("2025-06-10T12:00:00");
    const now = new Date("2025-06-11T13:00:00");
    assert.throws(() => assertReverseWithinPolicyWindow(orig, now, pHours24), (e) => e.message === MSG.hours);
  });

  it("DAYS blocks after window", () => {
    const orig = new Date("2025-06-01T12:00:00");
    const now = new Date("2025-06-05T12:00:00");
    assert.throws(() => assertReverseWithinPolicyWindow(orig, now, pDays3), (e) => e.message === MSG.days);
  });
});
