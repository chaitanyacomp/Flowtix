const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  STOCK_REPLENISHMENT_SOURCE,
  RM_STOCK_MONITOR_STATUS,
  suggestedRmReplenishmentQty,
  classifyRmStockMonitorStatus,
  rmStockMonitorStatusLabel,
  resolveReplenishmentLevel,
  isEligibleForReplenishmentRequest,
} = require("../../src/services/rmStockReplenishmentService");

describe("rmStockReplenishmentService", () => {
  it("keeps canonical source type STOCK_REPLENISHMENT (no parallel RM_STOCK_REPLENISHMENT enum)", () => {
    assert.equal(STOCK_REPLENISHMENT_SOURCE, "STOCK_REPLENISHMENT");
  });

  it("Current equals Minimum → Healthy and not eligible", () => {
    assert.equal(
      classifyRmStockMonitorStatus({ currentQty: 50, minimumStockQty: 50 }),
      RM_STOCK_MONITOR_STATUS.HEALTHY,
    );
    assert.equal(rmStockMonitorStatusLabel(RM_STOCK_MONITOR_STATUS.HEALTHY), "Healthy");
    assert.equal(
      isEligibleForReplenishmentRequest({
        currentQty: 50,
        minimumStockQty: 50,
        targetStockQty: 100,
        openStockReplenishmentQty: 0,
      }),
      false,
    );
  });

  it("Current below Minimum → Below Minimum and eligible when gap remains", () => {
    assert.equal(
      classifyRmStockMonitorStatus({ currentQty: 40, minimumStockQty: 50 }),
      RM_STOCK_MONITOR_STATUS.BELOW_MINIMUM,
    );
    assert.equal(rmStockMonitorStatusLabel(RM_STOCK_MONITOR_STATUS.BELOW_MINIMUM), "Below Minimum");
    assert.equal(
      isEligibleForReplenishmentRequest({
        currentQty: 40,
        minimumStockQty: 50,
        targetStockQty: null,
        openStockReplenishmentQty: 0,
      }),
      true,
    );
  });

  it("Target not configured → Minimum used as replenishment level", () => {
    assert.equal(resolveReplenishmentLevel({ minimumStockQty: 50, targetStockQty: null }), 50);
    assert.equal(
      suggestedRmReplenishmentQty({
        currentQty: 40,
        minimumStockQty: 50,
        targetStockQty: null,
        openStockReplenishmentQty: 0,
      }),
      10,
    );
  });

  it("Target configured → Target used as replenishment level (status still Minimum-only)", () => {
    assert.equal(resolveReplenishmentLevel({ minimumStockQty: 50, targetStockQty: 100 }), 100);
    assert.equal(
      suggestedRmReplenishmentQty({
        currentQty: 40,
        minimumStockQty: 50,
        targetStockQty: 100,
        openStockReplenishmentQty: 0,
      }),
      60,
    );
    // Above Minimum but below Target is still Healthy (no Low status on Monitor).
    assert.equal(
      classifyRmStockMonitorStatus({ currentQty: 60, minimumStockQty: 50 }),
      RM_STOCK_MONITOR_STATUS.HEALTHY,
    );
    assert.equal(RM_STOCK_MONITOR_STATUS.LOW, undefined);
  });

  it("Existing open request reduces suggested quantity", () => {
    assert.equal(
      suggestedRmReplenishmentQty({
        currentQty: 40,
        minimumStockQty: 50,
        targetStockQty: 100,
        openStockReplenishmentQty: 25,
      }),
      35,
    );
  });

  it("Existing open request fully covers gap → duplicate request blocked (not eligible)", () => {
    assert.equal(
      suggestedRmReplenishmentQty({
        currentQty: 40,
        minimumStockQty: 50,
        targetStockQty: 100,
        openStockReplenishmentQty: 60,
      }),
      0,
    );
    assert.equal(
      isEligibleForReplenishmentRequest({
        currentQty: 40,
        minimumStockQty: 50,
        targetStockQty: 100,
        openStockReplenishmentQty: 60,
      }),
      false,
    );
  });

  it("Cancelled request does not reduce the new replenishment gap (open qty omitted)", () => {
    // Open qty loader excludes CANCELLED; when open qty is 0, full gap remains.
    assert.equal(
      suggestedRmReplenishmentQty({
        currentQty: 40,
        minimumStockQty: 50,
        targetStockQty: null,
        openStockReplenishmentQty: 0,
      }),
      10,
    );
    assert.equal(
      isEligibleForReplenishmentRequest({
        currentQty: 40,
        minimumStockQty: 50,
        targetStockQty: null,
        openStockReplenishmentQty: 0,
      }),
      true,
    );
  });
});
