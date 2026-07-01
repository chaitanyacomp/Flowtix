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

  it("returns READY for ready gate even when an accepted short issue leaves a partial RM line", () => {
    expect(
      deriveProductionConciseRmLabel({
        bomMissing: false,
        gate: "READY_FOR_PRODUCTION",
        productionAllowedNowQty: 4487,
        rmLines: [{ status: "PARTIAL" }],
        workOrderId: 1,
      } as never),
    ).toBe("READY");
  });

  it("returns READY for fully issued ready-for-production gate", () => {
    expect(
      deriveProductionConciseRmLabel({
        bomMissing: false,
        gate: "READY_FOR_PRODUCTION",
        productionAllowedNowQty: 4487,
        rmLines: [{ status: "READY" }],
        workOrderId: 1,
      } as never),
    ).toBe("READY");
  });

  it("returns WAITING RM when ready gate has no producible RM cap", () => {
    expect(
      deriveProductionConciseRmLabel({
        bomMissing: false,
        gate: "READY_FOR_PRODUCTION",
        productionAllowedNowQty: 0,
        rmLines: [{ status: "READY" }],
        workOrderId: 1,
      } as never),
    ).toBe("WAITING RM");
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

  it("returns WAITING RM while issued RM is not released to production", () => {
    expect(
      deriveProductionConciseRmLabel({
        bomMissing: false,
        gate: "WAITING_RELEASE_TO_PRODUCTION",
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
