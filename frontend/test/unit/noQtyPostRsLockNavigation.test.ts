import { describe, expect, it } from "vitest";
import {
  hasNoQtyDispatchableAfterLock,
  resolveNoQtyPostRsLockNavigation,
} from "../../src/lib/noQtyPostRsLockNavigation";

describe("hasNoQtyDispatchableAfterLock", () => {
  it("is true when dispatchableQty > 0", () => {
    expect(hasNoQtyDispatchableAfterLock({ dispatchableQty: 12 })).toBe(true);
  });

  it("is true when primaryAction is DISPATCH", () => {
    expect(hasNoQtyDispatchableAfterLock({ primaryAction: "DISPATCH" })).toBe(true);
  });

  it("is false when nothing is ready", () => {
    expect(
      hasNoQtyDispatchableAfterLock({
        dispatchableQty: 0,
        hasQcDispatchPending: false,
        primaryAction: "DONE",
      }),
    ).toBe(false);
  });
});

describe("resolveNoQtyPostRsLockNavigation", () => {
  it("Case 1: decision-only with no FG → SO summary (not Dispatch)", () => {
    const r = resolveNoQtyPostRsLockNavigation({
      salesOrderId: 42,
      cycleId: 9,
      decisionOnlyRecoveryCycle: true,
      isZeroPlanning: true,
      dispatchableQty: 0,
      primaryAction: "DONE",
      viewerRole: "ADMIN",
    });
    expect(r.kind).toBe("SO_SUMMARY");
    expect(r.href).toContain("soType=NO_QTY");
    expect(r.href).toContain("salesOrderId=42");
    expect(r.href).not.toContain("/dispatch");
  });

  it("Case 1: zero planning, no dispatchable → SO summary", () => {
    const r = resolveNoQtyPostRsLockNavigation({
      salesOrderId: 7,
      isZeroPlanning: true,
      dispatchableQty: 0,
      viewerRole: "STORE",
    });
    expect(r.kind).toBe("SO_SUMMARY");
    expect(r.href).toContain("/no-qty-agreements");
    expect(r.href).toContain("salesOrderId=7");
  });

  it("Case 2: dispatchable FG → contextual Dispatch with source + cycle", () => {
    const r = resolveNoQtyPostRsLockNavigation({
      salesOrderId: 42,
      cycleId: 9,
      requirementSheetId: 100,
      isZeroPlanning: true,
      dispatchableQty: 5,
      primaryAction: "DISPATCH",
      viewerRole: "ADMIN",
    });
    expect(r.kind).toBe("DISPATCH_CONTEXTUAL");
    expect(r.href).toContain("/dispatch");
    expect(r.href).toContain("source=no_qty_so");
    expect(r.href).toContain("salesOrderId=42");
    expect(r.href).toContain("cycleId=9");
    expect(r.href).toContain("requirementSheetId=100");
  });

  it("Case 2 wins over decisionOnly when FG remains dispatchable", () => {
    const r = resolveNoQtyPostRsLockNavigation({
      salesOrderId: 42,
      cycleId: 3,
      decisionOnlyRecoveryCycle: true,
      isZeroPlanning: true,
      dispatchableQty: 2,
      viewerRole: "ADMIN",
    });
    expect(r.kind).toBe("DISPATCH_CONTEXTUAL");
    expect(r.href).toContain("/dispatch");
  });

  it("non-zero planning Store → dashboard (unchanged)", () => {
    const r = resolveNoQtyPostRsLockNavigation({
      salesOrderId: 42,
      isZeroPlanning: false,
      dispatchableQty: 0,
      viewerRole: "STORE",
    });
    expect(r).toEqual({ kind: "DASHBOARD", href: "/dashboard" });
  });

  it("non-zero planning Admin → stay on RS (unchanged)", () => {
    const r = resolveNoQtyPostRsLockNavigation({
      salesOrderId: 42,
      isZeroPlanning: false,
      dispatchableQty: 0,
      viewerRole: "ADMIN",
    });
    expect(r).toEqual({ kind: "STAY", href: null });
  });
});
