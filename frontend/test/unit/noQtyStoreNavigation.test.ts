import { describe, expect, it } from "vitest";
import {
  NO_QTY_AGREEMENTS_HREF,
  NO_QTY_PLANNING_HUB_HREF,
  isStoreLikePlanningRole,
  noQtyAgreementListHref,
  noQtyPlanningHubOrAgreementsHref,
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

  it("picks planning hub vs agreements for Store-like roles", () => {
    expect(noQtyPlanningHubOrAgreementsHref("ADMIN")).toBe(NO_QTY_PLANNING_HUB_HREF);
    expect(noQtyPlanningHubOrAgreementsHref("STORE")).toBe(NO_QTY_AGREEMENTS_HREF);
  });
});
