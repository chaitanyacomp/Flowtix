import { describe, expect, it } from "vitest";
import {
  prefersProcurementWorkspaceNavigation,
  resolveCaseProcurementMr,
} from "../../src/lib/rmControlCenterProcurementHandoff";

describe("rmControlCenterProcurementHandoff", () => {
  it("prefers monthly-plan MR from open MR lines when WO MR is absent", () => {
    const ctx = resolveCaseProcurementMr({
      woCaseMr: null,
      queueRowMrId: 101,
      openMrLines: [
        {
          materialRequirementId: 101,
          sourceType: "MONTHLY_PLAN",
          materialRequirementDocNo: "MR-26-0001",
          status: "APPROVED",
        },
      ],
      workOrderId: 1,
      planningDrivenProcurement: true,
    });
    expect(ctx).toEqual({
      materialRequirementId: 101,
      sourceType: "MONTHLY_PLAN",
      docNo: "MR-26-0001",
      status: "APPROVED",
    });
    expect(
      prefersProcurementWorkspaceNavigation(ctx, { planningDrivenProcurement: true, woCaseMrId: null }),
    ).toBe(true);
  });

  it("keeps regular SO MR on direct PR path", () => {
    const ctx = resolveCaseProcurementMr({
      woCaseMr: {
        id: 55,
        sourceType: "SALES_ORDER",
        docNo: "MR-SO-55",
        status: "APPROVED",
      },
      planningDrivenProcurement: true,
    });
    expect(ctx?.sourceType).toBe("SALES_ORDER");
    expect(
      prefersProcurementWorkspaceNavigation(ctx, { planningDrivenProcurement: true, woCaseMrId: 55 }),
    ).toBe(false);
  });

  it("falls back to queue MR id when open MR lines are empty", () => {
    const ctx = resolveCaseProcurementMr({
      queueRowMrId: 202,
      openMrLines: [],
      planningDrivenProcurement: true,
    });
    expect(ctx).toEqual({
      materialRequirementId: 202,
      sourceType: "MONTHLY_PLAN",
      docNo: null,
      status: null,
    });
  });

  it("uses boundMaterialRequirement from completed MPRS case supply", () => {
    const ctx = resolveCaseProcurementMr({
      woCaseMr: null,
      boundMaterialRequirement: {
        id: 1,
        sourceType: "MONTHLY_PLAN",
        docNo: "MR-26-0001",
        status: "FULLY_PROCURED",
      },
      openMrLines: [],
      workOrderId: 1,
      planningDrivenProcurement: true,
    });
    expect(ctx).toEqual({
      materialRequirementId: 1,
      sourceType: "MONTHLY_PLAN",
      docNo: "MR-26-0001",
      status: "FULLY_PROCURED",
    });
  });
});
