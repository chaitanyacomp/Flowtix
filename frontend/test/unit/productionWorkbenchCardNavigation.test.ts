import { describe, expect, it } from "vitest";
import {
  isCardActivationKey,
  productionWorkbenchCardAriaLabel,
  resolveProductionWorkbenchCardAction,
} from "../../src/lib/productionWorkbenchCardNavigation";
import { workbenchStatePrimaryActionLabel } from "../../src/lib/productionWorkbenchState";

describe("productionWorkbenchCardNavigation", () => {
  it("card click and primary button share the same navigate action for Continue", () => {
    const a = resolveProductionWorkbenchCardAction({
      state: "CONTINUE_PRODUCTION",
      href: "/production?workOrderId=1",
      hasOpenRowHandler: false,
    });
    const b = resolveProductionWorkbenchCardAction({
      state: "CONTINUE_PRODUCTION",
      href: "/production?workOrderId=1",
      hasOpenRowHandler: false,
    });
    expect(a).toEqual(b);
    expect(a).toEqual({ kind: "navigate", href: "/production?workOrderId=1" });
    expect(workbenchStatePrimaryActionLabel("CONTINUE_PRODUCTION")).toBe("Continue Production");
  });

  it("paused cards resolve to resume (single primary action)", () => {
    expect(
      resolveProductionWorkbenchCardAction({
        state: "PAUSED_PRODUCTION",
        href: "/production?workOrderId=4",
        hasOpenRowHandler: true,
      }),
    ).toEqual({ kind: "resume" });
  });

  it("uses openRow when handler present for Ready/Draft/Continue", () => {
    expect(
      resolveProductionWorkbenchCardAction({
        state: "READY_TO_START",
        href: "/production?workOrderId=2",
        hasOpenRowHandler: true,
      }),
    ).toEqual({ kind: "openRow" });
    expect(
      resolveProductionWorkbenchCardAction({
        state: "DRAFT_PENDING",
        href: "/production?workOrderId=3",
        hasOpenRowHandler: true,
      }),
    ).toEqual({ kind: "openRow" });
  });

  it("QC-only navigates to QA href", () => {
    expect(
      resolveProductionWorkbenchCardAction({
        state: "QC_PENDING_ONLY",
        href: "/qc-entry?workOrderId=9",
        hasOpenRowHandler: true,
      }),
    ).toEqual({ kind: "navigate", href: "/qc-entry?workOrderId=9" });
  });

  it("keyboard activation keys are Enter and Space", () => {
    expect(isCardActivationKey("Enter")).toBe(true);
    expect(isCardActivationKey(" ")).toBe(true);
    expect(isCardActivationKey("Tab")).toBe(false);
  });

  it("aria label includes action, WO and item", () => {
    expect(
      productionWorkbenchCardAriaLabel({
        state: "READY_TO_START",
        workOrderNo: "WO-26-0002",
        itemName: "Square Box",
      }),
    ).toBe("Start Production: WO-26-0002 · Square Box");
  });

  it("Ready status label is never In Progress", () => {
    expect(workbenchStatePrimaryActionLabel("READY_TO_START")).toBe("Start Production");
    expect(workbenchStatePrimaryActionLabel("READY_TO_START")).not.toMatch(/In Progress/i);
  });
});
