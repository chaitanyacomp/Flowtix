import { describe, expect, it } from "vitest";
import {
  PURCHASE_PLANNING_AUDIT_TABLE_HEADERS,
  PURCHASE_PLANNING_DEFAULT_TABLE_HEADERS,
  purchasePlanningAuditTableHeaders,
  purchasePlanningDefaultTableHeaders,
  purchasePlanningLineOperationalStatus,
  purchasePlanningTableColumnCount,
} from "../../src/lib/monthlyPlanningPurchaseTableUx";

describe("monthlyPlanningPurchaseTableUx", () => {
  it("defines procurement-focused default table headers without warnings or audit columns", () => {
    expect(purchasePlanningDefaultTableHeaders()).toEqual([
      "RM Item",
      "Unit",
      "Required",
      "Released",
      "Ordered",
      "Received",
      "Pending / Over",
      "Status",
    ]);
    expect(PURCHASE_PLANNING_DEFAULT_TABLE_HEADERS).not.toContain("Warnings");
    expect(PURCHASE_PLANNING_DEFAULT_TABLE_HEADERS).not.toContain("Additional Requirement");
    expect(PURCHASE_PLANNING_DEFAULT_TABLE_HEADERS).not.toContain("Line Receipt Coverage %");
  });

  it("defines audit table headers shown when toggle is enabled", () => {
    expect(purchasePlanningAuditTableHeaders()).toEqual([
      "Additional Requirement",
      "Reduction",
      "Suggested Buy Qty",
      "Line Receipt Coverage %",
      "Release Status",
      "Warnings",
    ]);
    expect(PURCHASE_PLANNING_AUDIT_TABLE_HEADERS).toHaveLength(6);
  });

  it("counts columns for default vs audit mode", () => {
    expect(purchasePlanningTableColumnCount(false)).toBe(8);
    expect(purchasePlanningTableColumnCount(true)).toBe(14);
  });

  it("keeps Warnings in audit headers only", () => {
    expect(purchasePlanningDefaultTableHeaders()).not.toContain("Warnings");
    expect(purchasePlanningAuditTableHeaders()).toContain("Warnings");
  });

  it("derives combined operational status from receipt and release signals", () => {
    expect(
      purchasePlanningLineOperationalStatus({
        procurementStatus: "FULLY_RELEASED",
        receiptCoverageStatus: "NOT_RECEIVED",
        additionalRequirementQty: 0,
        poQty: 0,
      }).label,
    ).toBe("Released");

    expect(
      purchasePlanningLineOperationalStatus({
        procurementStatus: "FULLY_RELEASED",
        receiptCoverageStatus: "NOT_RECEIVED",
        additionalRequirementQty: 0,
        poQty: 100,
      }).label,
    ).toBe("Ordered");

    expect(
      purchasePlanningLineOperationalStatus({
        procurementStatus: "NOT_RELEASED",
        receiptCoverageStatus: "NOT_RECEIVED",
        additionalRequirementQty: 5,
        poQty: 0,
      }).label,
    ).toBe("Pending Release");

    expect(
      purchasePlanningLineOperationalStatus({
        procurementStatus: "FULLY_RELEASED",
        receiptCoverageStatus: "PARTIALLY_COVERED",
        additionalRequirementQty: 0,
        poQty: 50,
      }).label,
    ).toBe("Partially Received");

    expect(
      purchasePlanningLineOperationalStatus({
        procurementStatus: "FULLY_RELEASED",
        receiptCoverageStatus: "FULLY_COVERED",
        additionalRequirementQty: 0,
        poQty: 100,
      }).label,
    ).toBe("Received");
  });
});
