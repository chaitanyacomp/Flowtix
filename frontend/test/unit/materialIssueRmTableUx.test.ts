import { describe, expect, it } from "vitest";
import {
  buildMaterialIssueActionSummary,
  resolveCompactLineStatus,
} from "../../src/lib/materialIssueRmTableUx";
import { calculatePlannedAllowance } from "../../src/lib/plannedProcessAllowance";

describe("resolveCompactLineStatus", () => {
  it("returns Insufficient Stock when issue exceeds available", () => {
    const calculation = calculatePlannedAllowance({
      theoreticalQty: 10,
      quantityRaw: "0",
      alreadyIssuedQty: 0,
    });
    const status = resolveCompactLineStatus({
      calculation,
      availableQty: 5,
      issueQty: "8",
      pendingQty: 10,
    });
    expect(status.label).toBe("Insufficient Stock");
  });

  it("returns Invalid Qty when allowance is blocked", () => {
    const calculation = calculatePlannedAllowance({
      theoreticalQty: 10,
      quantityRaw: "2",
      alreadyIssuedQty: 0,
    });
    const status = resolveCompactLineStatus({
      calculation,
      availableQty: 100,
      issueQty: "12",
      pendingQty: 10,
    });
    expect(status.label).toBe("Invalid Qty");
  });
});

describe("buildMaterialIssueActionSummary", () => {
  it("returns empty-state message when no lines", () => {
    expect(buildMaterialIssueActionSummary([])).toBe("No RM lines loaded");
  });
});
