import { describe, expect, it } from "vitest";
import {
  NO_QTY_AGREEMENTS_HREF,
  NO_QTY_PLANNING_HUB_HREF,
  isStoreLikePlanningRole,
  noQtyAgreementListHref,
  noQtyPlanningHubOrAgreementsHref,
  noQtyExecutionRegisterHref,
  noQtyFgDispositionWorkspaceHref,
  noQtyDownstreamBlockerHref,
} from "../../src/lib/noQtyStoreNavigation";

describe("noQtyStoreNavigation", () => {
  it("detects Store-like planning roles", () => {
    expect(isStoreLikePlanningRole("STORE")).toBe(true);
    expect(isStoreLikePlanningRole("PRODUCTION")).toBe(true);
    expect(isStoreLikePlanningRole("ADMIN")).toBe(false);
    expect(isStoreLikePlanningRole("SALES")).toBe(false);
  });

  it("routes Admin to commercial SO list and Store to execution hub", () => {
    expect(noQtyAgreementListHref("ADMIN")).toBe("/sales-orders?soType=NO_QTY");
    expect(noQtyAgreementListHref("STORE")).toBe(NO_QTY_AGREEMENTS_HREF);
    expect(noQtyAgreementListHref("PRODUCTION")).toBe(NO_QTY_AGREEMENTS_HREF);
    expect(noQtyAgreementListHref("STORE", 42)).toBe(`${NO_QTY_AGREEMENTS_HREF}?salesOrderId=42`);
    expect(noQtyAgreementListHref("ADMIN", 42)).toBe("/sales-orders?soType=NO_QTY&salesOrderId=42");
  });

  it("builds FG disposition and downstream blocker hrefs on NO_QTY Agreements only", () => {
    expect(noQtyFgDispositionWorkspaceHref(7)).toBe(
      "/sales-orders?soType=NO_QTY&salesOrderId=7&action=no-qty-fg-disposition",
    );
    expect(noQtyDownstreamBlockerHref("ADMIN", 7)).toContain("soType=NO_QTY");
    expect(noQtyDownstreamBlockerHref("ADMIN", 7)).toContain("highlight=downstream");
    expect(noQtyDownstreamBlockerHref("STORE", 7)).toBe(
      `${NO_QTY_AGREEMENTS_HREF}?salesOrderId=7&highlight=downstream`,
    );
  });

  it("picks planning hub vs agreements for Store-like roles", () => {
    expect(noQtyPlanningHubOrAgreementsHref("ADMIN")).toBe(NO_QTY_PLANNING_HUB_HREF);
    expect(noQtyPlanningHubOrAgreementsHref("STORE")).toBe(NO_QTY_AGREEMENTS_HREF);
  });

  it("builds execution register href for Store handoff without sheet id", () => {
    expect(noQtyExecutionRegisterHref(42)).toBe(`${NO_QTY_AGREEMENTS_HREF}?salesOrderId=42`);
    expect(noQtyExecutionRegisterHref(42, "dashboard")).toContain("source=dashboard");
  });
});
