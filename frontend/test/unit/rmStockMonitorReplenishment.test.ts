import { describe, expect, it } from "vitest";
import {
  classifyRmStockMonitorStatus,
  suggestedRmReplenishmentQty,
  rmStockMonitorStatusLabel,
  resolveReplenishmentLevel,
  isEligibleForReplenishmentRequest,
  classifyInventoryHealth,
} from "../../src/lib/inventoryHealth";
import {
  canRaisePurchaseRequestForRow,
  isRowCheckboxEnabled,
  isRowOrderQtyLocked,
  isRowSelectableForReplenishmentMr,
} from "../../src/lib/rmStockPlanningUx";

describe("RM Stock Monitor replenishment helpers", () => {
  it("Current equals Minimum → Healthy and not selectable", () => {
    expect(classifyRmStockMonitorStatus({ currentQty: 50, minimumStockQty: 50 })).toBe("HEALTHY");
    expect(rmStockMonitorStatusLabel("HEALTHY")).toBe("Healthy");
    expect(
      isEligibleForReplenishmentRequest({
        currentQty: 50,
        minimumStockQty: 50,
        targetStockQty: 120,
        openStockReplenishmentQty: 0,
      }),
    ).toBe(false);
    expect(
      isRowCheckboxEnabled({
        currentStock: 50,
        minimumStockQty: 50,
        suggestedPurchaseQty: 0,
        canRaisePurchaseRequest: false,
        monitorStatus: "HEALTHY",
      }),
    ).toBe(false);
    expect(
      isRowSelectableForReplenishmentMr(
        {
          currentStock: 50,
          minimumStockQty: 50,
          canRaisePurchaseRequest: false,
          monitorStatus: "HEALTHY",
        },
        10,
      ),
    ).toBe(false);
    expect(
      isRowOrderQtyLocked({
        currentStock: 50,
        minimumStockQty: 50,
        canRaisePurchaseRequest: false,
      }),
    ).toBe(true);
  });

  it("Current below Minimum → Eligible", () => {
    expect(classifyRmStockMonitorStatus({ currentQty: 40, minimumStockQty: 50 })).toBe("BELOW_MINIMUM");
    expect(rmStockMonitorStatusLabel("BELOW_MINIMUM")).toBe("Below Minimum");
    expect(
      isEligibleForReplenishmentRequest({
        currentQty: 40,
        minimumStockQty: 50,
        targetStockQty: null,
        openStockReplenishmentQty: 0,
      }),
    ).toBe(true);
    expect(
      canRaisePurchaseRequestForRow({
        currentStock: 40,
        minimumStockQty: 50,
        suggestedPurchaseQty: 10,
        canRaisePurchaseRequest: true,
        eligibleForRequest: true,
      }),
    ).toBe(true);
    expect(
      isRowCheckboxEnabled({
        currentStock: 40,
        minimumStockQty: 50,
        suggestedPurchaseQty: 10,
        canRaisePurchaseRequest: true,
      }),
    ).toBe(true);
  });

  it("Target not configured → Minimum used", () => {
    expect(resolveReplenishmentLevel({ minimumStockQty: 50, targetStockQty: null })).toBe(50);
    expect(
      suggestedRmReplenishmentQty({
        currentQty: 40,
        minimumStockQty: 50,
        targetStockQty: null,
        openStockReplenishmentQty: 0,
      }),
    ).toBe(10);
  });

  it("Existing open request reduces suggested quantity", () => {
    expect(
      suggestedRmReplenishmentQty({
        currentQty: 40,
        minimumStockQty: 50,
        targetStockQty: 100,
        openStockReplenishmentQty: 25,
      }),
    ).toBe(35);
  });

  it("Existing open request fully covers gap → duplicate request blocked", () => {
    expect(
      suggestedRmReplenishmentQty({
        currentQty: 40,
        minimumStockQty: 50,
        targetStockQty: 100,
        openStockReplenishmentQty: 60,
      }),
    ).toBe(0);
    expect(
      isEligibleForReplenishmentRequest({
        currentQty: 40,
        minimumStockQty: 50,
        targetStockQty: 100,
        openStockReplenishmentQty: 60,
      }),
    ).toBe(false);
    expect(
      isRowCheckboxEnabled({
        currentStock: 40,
        minimumStockQty: 50,
        suggestedPurchaseQty: 0,
        canRaisePurchaseRequest: false,
        monitorStatus: "BELOW_MINIMUM",
      }),
    ).toBe(false);
  });

  it("Cancelled request does not reduce the new replenishment gap", () => {
    expect(
      suggestedRmReplenishmentQty({
        currentQty: 40,
        minimumStockQty: 50,
        targetStockQty: null,
        openStockReplenishmentQty: 0,
      }),
    ).toBe(10);
    expect(
      isEligibleForReplenishmentRequest({
        currentQty: 40,
        minimumStockQty: 50,
        targetStockQty: null,
        openStockReplenishmentQty: 0,
      }),
    ).toBe(true);
  });

  it("Monitor has no Low status; Target may still warn on dashboard health", () => {
    expect(classifyRmStockMonitorStatus({ currentQty: 70, minimumStockQty: 50 })).toBe("HEALTHY");
    expect(
      classifyInventoryHealth({ currentQty: 70, minimumStock: 50, targetStock: 100 }),
    ).toBe("LOW");
  });
});
