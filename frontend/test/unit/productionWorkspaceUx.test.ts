import { describe, expect, it } from "vitest";
import { deriveProductionConciseRmLabel } from "../../src/lib/productionRmConciseStatus";
import { deriveNoQtyMacroLifecycleStages } from "../../src/components/erp/production/NoQtyMacroLifecycleStrip";
import type { NoQtyFlowState } from "../../src/lib/noQtyFlowState";

describe("deriveProductionConciseRmLabel", () => {
  it("returns READY when production is not blocked", () => {
    expect(
      deriveProductionConciseRmLabel({
        bomMissing: false,
        gate: "READY",
        workOrderId: 1,
      } as never),
    ).toBe("READY");
  });

  it("returns PARTIAL for partial gate", () => {
    expect(
      deriveProductionConciseRmLabel({
        bomMissing: false,
        gate: "PARTIAL_READY",
        workOrderId: 1,
      } as never),
    ).toBe("PARTIAL");
  });

  it("returns WAITING RM when blocked or BOM missing", () => {
    expect(
      deriveProductionConciseRmLabel({
        bomMissing: true,
        gate: "WAITING_STORE_ISSUE",
        workOrderId: 1,
      } as never),
    ).toBe("WAITING RM");
  });
});

describe("deriveNoQtyMacroLifecycleStages", () => {
  it("marks RS current when requirement exists but not locked", () => {
    const stages = deriveNoQtyMacroLifecycleStages({
      requirementExists: true,
      requirementLocked: false,
    } as NoQtyFlowState);
    expect(stages.find((s) => s.key === "rs")?.status).toBe("current");
  });

  it("marks production current when flow points to production", () => {
    const stages = deriveNoQtyMacroLifecycleStages(
      {
        requirementLocked: true,
        workOrderExists: true,
        primaryAction: "PRODUCTION",
      } as NoQtyFlowState,
      "READY",
    );
    expect(stages.find((s) => s.key === "prod")?.status).toBe("current");
  });
});
