import { describe, expect, it } from "vitest";
import {
  buildMaterialIssueDeepLink,
  buildMaterialIssuePostActionSearchParams,
  buildProductionWorkspaceListHref,
  buildRegularDispatchGuidedHref,
  buildRmControlCenterDeepLink,
  productionHrefFromProductionWorkspace,
} from "../../src/lib/manufacturingNavigationContinuity";

describe("manufacturingNavigationContinuity", () => {
  it("builds production workspace list href with bucket filter", () => {
    expect(buildProductionWorkspaceListHref({ productionBucket: "WAITING_RM" })).toBe(
      "/production?productionBucket=WAITING_RM",
    );
    expect(buildProductionWorkspaceListHref()).toBe("/production");
  });

  it("builds material issue deep link for WO and PMR paths", () => {
    expect(
      buildMaterialIssueDeepLink({
        workOrderId: 42,
        pmrId: 7,
        returnTo: "rm-control-center",
        salesOrderId: 4,
      }),
    ).toBe("/material-issue?pmrId=7&workOrderId=42&returnTo=rm-control-center&salesOrderId=4");
    expect(buildMaterialIssueDeepLink({ pmrId: 7, returnTo: "rm-control-center" })).toBe(
      "/material-issue?pmrId=7&returnTo=rm-control-center",
    );
  });

  it("preserves post-issue session scope for production-workspace return", () => {
    expect(
      buildMaterialIssuePostActionSearchParams({
        returnTo: "production-workspace",
        workOrderId: 99,
        productionBucket: "READY",
        salesOrderId: 12,
        requirementSheetId: 55,
      }),
    ).toEqual({
      returnTo: "production-workspace",
      workOrderId: "99",
      productionBucket: "READY",
      salesOrderId: "12",
      requirementSheetId: "55",
    });
  });

  it("delegates RM control center deep link to shared builder", () => {
    expect(
      buildRmControlCenterDeepLink({
        workOrderId: 10,
        returnTo: "material-issue",
        onlyBlocked: true,
      }),
    ).toBe("/reports/rm-shortage?workOrderId=10&onlyBlocked=true&returnTo=material-issue");
  });

  it("adds production-workspace from token when opening scoped production", () => {
    expect(
      productionHrefFromProductionWorkspace({
        workOrderId: 5,
        workOrderLineId: 9,
        salesOrderId: 3,
      }),
    ).toContain("from=production-workspace");
    expect(
      productionHrefFromProductionWorkspace({
        workOrderId: 5,
        workOrderLineId: 9,
        salesOrderId: 3,
      }),
    ).toContain("workOrderId=5");
  });

  it("builds regular dispatch guided cross-links with return context", () => {
    expect(buildRegularDispatchGuidedHref({ to: "/production", salesOrderId: 88 })).toBe(
      "/production?salesOrderId=88&fromStep=dispatch&from=dispatch&returnTo=dispatch",
    );
  });
});
