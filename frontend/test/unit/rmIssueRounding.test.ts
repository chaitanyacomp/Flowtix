import { describe, expect, it } from "vitest";
import {
  computeRoundedIssueTargetQty,
  computeKgIssueRoundingPlan,
  showIssueIncrementOnItemMaster,
  isKilogramUnitToken,
  formatKgRoundingRuleLabel,
  KG_ROUNDING_RULE_TOOLTIP,
} from "../../src/lib/rmIssueRounding";

describe("rmIssueRounding (frontend)", () => {
  it("matches Kg upward examples", () => {
    expect(computeRoundedIssueTargetQty(73.0, 1)).toBe(73);
    expect(computeRoundedIssueTargetQty(73.2, 1)).toBe(74);
    expect(computeRoundedIssueTargetQty(73.5, 1)).toBe(74);
    expect(computeRoundedIssueTargetQty(73.9, 1)).toBe(74);
  });

  it("supports 0.5 Kg increment", () => {
    expect(computeRoundedIssueTargetQty(73.2, 0.5)).toBe(73.5);
  });

  it("partial remaining does not re-round the planned total", () => {
    const first = computeKgIssueRoundingPlan({
      plannedRequiredQty: 73.2,
      issueIncrement: 1,
      cumulativeNetIssuedQty: 0,
    });
    const second = computeKgIssueRoundingPlan({
      plannedRequiredQty: 73.2,
      issueIncrement: 1,
      cumulativeNetIssuedQty: 40,
    });
    expect(first.roundedIssueTargetQty).toBe(74);
    expect(second.roundedIssueTargetQty).toBe(74);
    expect(second.remainingIssueQty).toBe(34);
  });

  it("Item Master shows increment only for RM + Kg", () => {
    expect(showIssueIncrementOnItemMaster({ itemType: "RM", unitCode: "KG" })).toBe(true);
    expect(showIssueIncrementOnItemMaster({ itemType: "RM", unitName: "Gm" })).toBe(false);
    expect(showIssueIncrementOnItemMaster({ itemType: "FG", unitCode: "KG" })).toBe(false);
    expect(isKilogramUnitToken("Nos")).toBe(false);
  });

  it("formats operator Rounding Rule without exposing raw 1 Kg", () => {
    expect(formatKgRoundingRuleLabel(1)).toBe("Next whole Kg");
    expect(formatKgRoundingRuleLabel(0.5)).toBe("Next 0.5 Kg");
    expect(KG_ROUNDING_RULE_TOOLTIP).toContain("rounded upward");
  });
});
