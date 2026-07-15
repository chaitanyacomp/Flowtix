import { describe, expect, it } from "vitest";
import {
  isDecisionOnlyRecoveryCycleReady,
  DECISION_ONLY_RECOVERY_FINALIZE_MESSAGE,
} from "../../src/lib/noQtyDecisionOnlyRecoveryCycle";

describe("isDecisionOnlyRecoveryCycleReady", () => {
  it("true when all WAIVE and zero qty", () => {
    expect(
      isDecisionOnlyRecoveryCycleReady({
        isNoQty: true,
        sheetStatus: "DRAFT",
        lines: [{ requirementQty: 0, newWoQty: 0, toProduceQty: 0 }],
        recoveryDecisionItems: [{ decisionStatus: "WAIVED", pendingRecoveryQty: 6 }],
      }),
    ).toBe(true);
  });

  it("false while PENDING remains", () => {
    expect(
      isDecisionOnlyRecoveryCycleReady({
        isNoQty: true,
        sheetStatus: "DRAFT",
        lines: [{ requirementQty: 0, toProduceQty: 0 }],
        recoveryDecisionItems: [{ decisionStatus: "PENDING", pendingRecoveryQty: 6 }],
      }),
    ).toBe(false);
  });

  it("false when Current Requirement > 0", () => {
    expect(
      isDecisionOnlyRecoveryCycleReady({
        isNoQty: true,
        sheetStatus: "DRAFT",
        lines: [{ requirementQty: 6, toProduceQty: 0 }],
        recoveryDecisionItems: [{ decisionStatus: "WAIVED", pendingRecoveryQty: 0 }],
      }),
    ).toBe(false);
  });

  it("exposes operator message", () => {
    expect(DECISION_ONLY_RECOVERY_FINALIZE_MESSAGE).toContain("Recovery decisions completed");
  });
});
