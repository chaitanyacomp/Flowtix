import { describe, expect, it } from "vitest";
import {
  mapQueueReadinessToOperationalPresentation,
  mapRmReadinessGateToLabel,
  resolveQueueActionLabel,
} from "../../src/lib/workOrderReadinessUx";

describe("workOrderReadinessUx", () => {
  it("maps RM readiness gates to waiting labels", () => {
    expect(mapRmReadinessGateToLabel("WAITING_STORE_ISSUE")).toBe("Waiting for RM issue");
    expect(mapRmReadinessGateToLabel("NO_PMR")).toBe("Waiting for Material");
    expect(mapRmReadinessGateToLabel("READY_FOR_PRODUCTION")).toBe("Ready for Production");
  });

  it("maps backend nextAction to operational presentation", () => {
    expect(
      mapQueueReadinessToOperationalPresentation({
        nextAction: "QC_PENDING",
        actionLabel: "Complete QA",
      }),
    ).toEqual({ label: "QA in progress", tone: "qc", actionLabel: "Complete QA" });

    expect(
      mapQueueReadinessToOperationalPresentation({
        nextAction: "PRODUCTION_PENDING",
        rmReadinessGate: "WAITING_STORE_ISSUE",
        rmReadyForProduction: false,
        producedQty: 0,
        balanceQty: 100,
        actionLabel: "Go to Production",
      }).label,
    ).toBe("Waiting for RM issue");

    expect(
      mapQueueReadinessToOperationalPresentation({
        nextAction: "PRODUCTION_PENDING",
        rmReadinessGate: "READY_FOR_PRODUCTION",
        rmReadyForProduction: true,
        producedQty: 0,
        status: "PENDING",
      }),
    ).toEqual({ label: "Ready to Start", tone: "ready", actionLabel: null });
  });

  it("prefers backend actionLabel over href inference", () => {
    expect(
      resolveQueueActionLabel(
        { actionLabel: "Create Next RS", nextAction: "NEXT_RS_REQUIRED" },
        "Continue Production",
      ),
    ).toBe("Create Next RS");
    expect(resolveQueueActionLabel({ nextAction: "DISPATCH_PENDING" }, null)).toBe("Go to Dispatch");
  });
});
