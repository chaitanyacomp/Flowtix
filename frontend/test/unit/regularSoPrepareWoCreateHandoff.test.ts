import { describe, expect, it } from "vitest";
import {
  buildRegularSoPostCreateMaterialIssueHref,
  regularSoCreateWoSuccessToast,
  shouldReuseExistingRegularWo,
} from "../../src/lib/regularSoPrepareWoCreateHandoff";
import {
  buildWoPrepareGuidedStripModel,
  deriveWoPrepareWorkflowStepLabel,
} from "../../src/lib/woPrepareWorkflowGuidance";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rmCheckSource = readFileSync(resolve(__dirname, "../../src/pages/RmCheckPage.tsx"), "utf8");

describe("REGULAR_SO Prepare WO labels and create handoff", () => {
  it("eligible Ready for WO shows Store Department and Ready for WO stage", () => {
    const step = deriveWoPrepareWorkflowStepLabel({
      workflowState: "READY_FOR_WO",
      canCreateWorkOrder: true,
      hasRmShortage: false,
      hasPendingMr: false,
      hasExistingWorkOrder: false,
      allRmAvailable: true,
    });
    expect(step).toBe("Ready for WO");
    expect(step).not.toBe("RM Received in Store");

    const strip = buildWoPrepareGuidedStripModel({
      state: "READY_FOR_WO",
      salesOrderId: 258,
      pendingMrLabel: "",
      canRaiseMr: false,
      raisingMr: false,
      canStartWo: true,
      woCreateDisabled: false,
      loading: false,
      onRaiseMr: () => {},
      onCreateWo: () => {},
      onResumeWo: () => {},
      onRefreshAvailability: () => {},
    });
    expect(strip?.owner).toBe("Store Department");
    expect(strip?.owner).not.toMatch(/Production/i);
    expect(strip?.primaryLabel).toBe("Create Work Order");
  });

  it("post-create deep-link opens Material Issue for the new WO — not generic Work Orders or Dashboard", () => {
    const href = buildRegularSoPostCreateMaterialIssueHref({
      workOrderId: 901,
      pmrId: 44,
      salesOrderId: 258,
      source: "prepare-wo",
    });
    expect(href).toContain("/material-issue");
    expect(href).toContain("workOrderId=901");
    expect(href).toContain("pmrId=44");
    expect(href).toContain("salesOrderId=258");
    expect(href).toContain("returnTo=prepare-wo");
    expect(href).not.toContain("/work-orders?");
    expect(href).not.toContain("/dashboard");
    expect(href).not.toContain("/sales-orders");
  });

  it("success toast includes business WO number and Material Issue next step", () => {
    const msg = regularSoCreateWoSuccessToast({ id: 12, docNo: "WO-26-0003" }, "PMR-26-0001");
    expect(msg).toContain("WO-26-0003");
    expect(msg).toMatch(/issue material/i);
  });

  it("reuses an existing WO id instead of posting a duplicate", () => {
    expect(shouldReuseExistingRegularWo(901)).toBe(true);
    expect(shouldReuseExistingRegularWo(null)).toBe(false);
    expect(shouldReuseExistingRegularWo(0)).toBe(false);
  });

  it("Prepare WO posts create API and disables while submitting (no nav to generic WO list)", () => {
    expect(rmCheckSource).toContain('"/api/production/work-orders"');
    expect(rmCheckSource).toContain("createWoInFlightRef");
    expect(rmCheckSource).toContain("setCreatingWo(true)");
    expect(rmCheckSource).toContain("buildRegularSoPostCreateMaterialIssueHref");
    expect(rmCheckSource).not.toMatch(
      /nav\(\s*["']\/work-orders["']\s*,\s*\{\s*state:\s*\{\s*source:\s*["']rmCheck["']/,
    );
  });

  it("WO_CREATED guided strip keeps Store ownership and Material Issue CTA", () => {
    const strip = buildWoPrepareGuidedStripModel({
      state: "WO_CREATED",
      salesOrderId: 258,
      pendingMrLabel: "",
      canRaiseMr: false,
      raisingMr: false,
      canStartWo: true,
      woCreateDisabled: false,
      loading: false,
      onRaiseMr: () => {},
      onCreateWo: () => {},
      onResumeWo: () => {},
      onRefreshAvailability: () => {},
    });
    expect(strip?.owner).toBe("Store Department");
    expect(strip?.primaryHref).toContain("/material-issue");
    expect(strip?.primaryHref).not.toContain("/work-orders?");
  });
});
