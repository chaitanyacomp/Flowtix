import { describe, expect, it } from "vitest";
import {
  applicableBomRequirement,
  assessIssueAgainstAllowance,
  calculatePlannedAllowance,
  deriveAllowanceFromIssueNow,
  issueStatusPresentation,
  stockReadinessBadge,
} from "../../src/lib/plannedProcessAllowance";

describe("plannedProcessAllowance Add Qty (read-only %)", () => {
  it("derives Add Qty bidirectionally from Issue Now using the remaining BOM", () => {
    expect(deriveAllowanceFromIssueNow({ issueQtyRaw: "25", theoreticalQty: 22.8 })).toMatchObject({
      valid: true,
      allowanceQty: 2.2,
      applicableBomQty: 22.8,
    });
    expect(deriveAllowanceFromIssueNow({ issueQtyRaw: "23.8", theoreticalQty: 22.8 }).allowanceQty).toBe(1);
    expect(deriveAllowanceFromIssueNow({ issueQtyRaw: "20", theoreticalQty: 22.8 }).allowanceQty).toBe(0);
  });

  it("preserves temporary decimal drafts by deferring derivation until valid", () => {
    expect(deriveAllowanceFromIssueNow({ issueQtyRaw: "", theoreticalQty: 22.8 }).valid).toBe(false);
    expect(deriveAllowanceFromIssueNow({ issueQtyRaw: ".", theoreticalQty: 22.8 }).valid).toBe(false);
    expect(deriveAllowanceFromIssueNow({ issueQtyRaw: "25.", theoreticalQty: 22.8 }).allowanceQty).toBe(2.2);
  });
  it("zero Add Qty → Qty BOM and Issue Now equal applicable BOM", () => {
    const result = calculatePlannedAllowance({
      theoreticalQty: 27,
      quantityRaw: "0",
    });
    expect(result.valid).toBe(true);
    expect(result.applicableBomQty).toBe(27);
    expect(result.calculatedQty).toBe(0);
    expect(result.calculatedPct).toBe(0);
    expect(result.defaultIssueNowQty).toBe(27);
  });

  it("Add Qty 1.5 on BOM 40.5 → read-only 3.70% and Issue Now 42", () => {
    const result = calculatePlannedAllowance({
      theoreticalQty: 40.5,
      quantityRaw: "1.5",
    });
    expect(result.calculatedQty).toBe(1.5);
    expect(result.calculatedPct).toBe(3.7037);
    expect(result.calculatedPct.toFixed(2)).toBe("3.70");
    expect(result.defaultIssueNowQty).toBe(42);
  });

  it("percentage is Add Qty ÷ applicable BOM, not ÷ Issue Now", () => {
    const result = calculatePlannedAllowance({
      theoreticalQty: 27,
      quantityRaw: "1",
    });
    expect(result.defaultIssueNowQty).toBe(28);
    expect(result.calculatedPct).toBe(3.7037);
  });

  it("partial / cumulative issues use remaining Qty BOM without double-counting", () => {
    expect(applicableBomRequirement(40.5, 20)).toBe(20.5);
    const afterPartial = calculatePlannedAllowance({
      theoreticalQty: 40.5,
      quantityRaw: "1.5",
      alreadyIssuedQty: 20,
    });
    expect(afterPartial.applicableBomQty).toBe(20.5);
    expect(afterPartial.defaultIssueNowQty).toBe(22);
    expect(afterPartial.calculatedPct).toBeCloseTo(7.3171, 3);
    expect(afterPartial.requiresAdminApproval).toBe(true);

    const afterFullBom = calculatePlannedAllowance({
      theoreticalQty: 40.5,
      quantityRaw: "1.5",
      alreadyIssuedQty: 40.5,
    });
    expect(afterFullBom.applicableBomQty).toBe(0);
    expect(afterFullBom.defaultIssueNowQty).toBe(1.5);
  });

  it("assesses on-target, short, and excess against applicable BOM + Add Qty", () => {
    expect(
      assessIssueAgainstAllowance({
        issueQty: 42,
        theoreticalQty: 40.5,
        alreadyIssuedQty: 0,
        extraAllowanceQty: 1.5,
      }),
    ).toMatchObject({ position: "ON_TARGET", excessQty: 0 });

    expect(
      assessIssueAgainstAllowance({
        issueQty: 20,
        theoreticalQty: 40.5,
        alreadyIssuedQty: 0,
        extraAllowanceQty: 1.5,
      }),
    ).toMatchObject({ position: "TRUE_SHORT", trueShortQty: 20.5 });

    expect(
      assessIssueAgainstAllowance({
        issueQty: 43,
        theoreticalQty: 40.5,
        alreadyIssuedQty: 0,
        extraAllowanceQty: 1.5,
      }),
    ).toMatchObject({ position: "EXCESS", excessQty: 1 });
  });

  it("issue status covers normal, approval, blocked, and insufficient stock", () => {
    const normal = calculatePlannedAllowance({ theoreticalQty: 40.5, quantityRaw: "1.5" });
    expect(
      issueStatusPresentation({
        calculation: normal,
        issueQty: 42,
        availableQty: 323,
        actorRole: "STORE",
      }).issueLabel,
    ).toBe("Normal · No approval required");

    const six = calculatePlannedAllowance({ theoreticalQty: 27, quantityRaw: "1.62" });
    expect(six.requiresAdminApproval).toBe(true);
    expect(
      issueStatusPresentation({
        calculation: six,
        issueQty: six.defaultIssueNowQty,
        availableQty: 100,
        actorRole: "STORE",
        reason: "",
      }).issueLabel,
    ).toBe("Reason and Admin approval required");

    const eleven = calculatePlannedAllowance({ theoreticalQty: 27, quantityRaw: "3" });
    expect(eleven.blocked).toBe(true);
    expect(
      issueStatusPresentation({
        calculation: eleven,
        issueQty: eleven.defaultIssueNowQty,
        availableQty: 100,
      }).issueLabel,
    ).toContain("Blocked");

    expect(stockReadinessBadge(5, 12.75).label).toBe("Short");
    expect(
      issueStatusPresentation({
        calculation: normal,
        issueQty: 42,
        availableQty: 5,
      }).issueLabel,
    ).toBe("Insufficient stock");
  });

  it("rejects negative, empty, and NaN-like Add Qty", () => {
    for (const raw of ["", "-1", "NaN", "Infinity"]) {
      expect(
        calculatePlannedAllowance({
          theoreticalQty: 27,
          quantityRaw: raw,
        }).valid,
      ).toBe(false);
    }
  });

  it("accepts leading-dot Add Qty such as .5", () => {
    const result = calculatePlannedAllowance({
      theoreticalQty: 27,
      quantityRaw: ".5",
    });
    expect(result.valid).toBe(true);
    expect(result.calculatedQty).toBe(0.5);
    expect(result.defaultIssueNowQty).toBe(27.5);
  });
});
