import { describe, expect, it } from "vitest";
import {
  formatReleaseSuccessSummaryMessage,
  MP_PROCUREMENT,
  MP_RELEASE_CTA,
  MP_RELEASE_STATUS_META,
  procurementProgressModelLine,
  purchasePlanningOperationalStatusMessage,
  releaseConfirmModalBodyMessage,
  releaseDeltaDisabledStatusMessage,
} from "../../src/lib/monthlyPlanningProcurementLabels";

describe("monthlyPlanningProcurementLabels", () => {
  it("defines canonical procurement stage labels", () => {
    expect(MP_PROCUREMENT.REQUIREMENT_SNAPSHOT).toBe("Requirement Snapshot");
    expect(MP_PROCUREMENT.DEMAND_RELEASED).toBe("Demand Released");
    expect(MP_PROCUREMENT.ORDERED_QTY).toBe("Ordered Qty");
    expect(MP_PROCUREMENT.RECEIVED_QTY).toBe("Received Qty");
  });

  it("procurementProgressModelLine follows stage model", () => {
    expect(procurementProgressModelLine()).toBe(
      "Requirement Snapshot → Demand Released → Ordered → Received",
    );
  });

  it("defines release CTA labels without delta wording for initial plans", () => {
    expect(MP_RELEASE_CTA.PRIMARY).toBe("Release RM Requirement to Procurement");
    expect(MP_RELEASE_CTA.MODAL_CONFIRM).toBe("Release RM Requirement");
  });

  it("purchasePlanningOperationalStatusMessage uses clear RM requirement wording", () => {
    expect(purchasePlanningOperationalStatusMessage(10, 0)).toBe(
      "RM requirement pending release to procurement.",
    );
    expect(purchasePlanningOperationalStatusMessage(10, 0, "ADDITIONAL")).toContain("Additional RM");
    expect(purchasePlanningOperationalStatusMessage(0, 50)).toBe(
      "RM requirement released to procurement. Track Ordered → Received below.",
    );
    expect(purchasePlanningOperationalStatusMessage(0, 0)).toContain("Requirement Snapshot");
  });

  it("releaseDeltaDisabledStatusMessage uses RM requirement wording for plan documents", () => {
    expect(releaseDeltaDisabledStatusMessage(0, 50, true)).toBe(
      "RM requirement released — no further release required.",
    );
    expect(releaseDeltaDisabledStatusMessage(0, 50, true, "ADDITIONAL")).toContain("Additional RM");
    expect(releaseDeltaDisabledStatusMessage(0, 0, false)).toBe("No RM requirement to release.");
  });

  it("releaseConfirmModalBodyMessage avoids delta for initial plans", () => {
    expect(releaseConfirmModalBodyMessage("INITIAL")).toContain("net RM requirement");
    expect(releaseConfirmModalBodyMessage("INITIAL")).not.toContain("delta");
    expect(releaseConfirmModalBodyMessage("ADDITIONAL")).toContain("additional RM requirement");
  });

  it("formatReleaseSuccessSummaryMessage references demand released", () => {
    const msg = formatReleaseSuccessSummaryMessage({
      planLabel: "June Plan 1",
      materialRequirementDocNo: "MR-26-0001",
      releasedLineCount: 2,
      totalDeltaQty: 50,
      skippedLineCount: 0,
      surplusLineCount: 0,
    });
    expect(msg).toContain("Demand Released");
    expect(msg).toContain("June Plan 1");
    expect(msg).toContain("Ordered → Received");
  });

  it("standardizes release status labels", () => {
    expect(MP_RELEASE_STATUS_META.NOT_RELEASED.label).toBe("Not Released");
    expect(MP_RELEASE_STATUS_META.PARTIALLY_RELEASED.label).toBe("Partially Released");
    expect(MP_RELEASE_STATUS_META.FULLY_RELEASED.label).toBe("Released");
    expect(MP_RELEASE_STATUS_META.OVER_RELEASED.label).toBe("Over Released");
  });
});
