import { describe, expect, it } from "vitest";
import {
  formatPlanningInboxNextRsLine,
  isNoQtyAgreementClosed,
  planningInboxAttentionScore,
  resolvePlanningInboxRsStatus,
  sortPlanningInboxRows,
} from "../../src/lib/planningInboxPresentation";

describe("planningInboxPresentation", () => {
  it("detects closed NO_QTY agreements", () => {
    expect(isNoQtyAgreementClosed({ internalStatus: "CLOSED" })).toBe(true);
    expect(isNoQtyAgreementClosed({ internalStatus: "IN_PROCESS" })).toBe(false);
  });

  it("resolves RS status from cycle-scoped sheets", () => {
    expect(
      resolvePlanningInboxRsStatus(
        [
          { id: 1, cycleId: 10, version: 1, status: "DRAFT" },
          { id: 2, cycleId: 10, version: 2, status: "LOCKED" },
        ],
        10,
      ),
    ).toBe("Locked");
  });

  it("formats next RS blocked line with reason", () => {
    const line = formatPlanningInboxNextRsLine({
      id: 1,
      noQtyCreateNextRsEligible: false,
      noQtyCreateNextRsBlockReason: "NO_LOCKED_RS",
    });
    expect(line.headline).toBe("Next RS Blocked");
    expect(line.reason).toContain("locked");
  });

  it("sorts attention-first rows", () => {
    const sorted = sortPlanningInboxRows([
      { so: { id: 1, noQtyCreateNextRsEligible: false }, rsStatus: "Locked" },
      { so: { id: 2, noQtyCreateNextRsEligible: true }, rsStatus: "Locked" },
    ]);
    expect(sorted[0]?.so.id).toBe(2);
    expect(planningInboxAttentionScore({ so: { id: 2, noQtyCreateNextRsEligible: true }, rsStatus: "Draft" })).toBeGreaterThan(
      planningInboxAttentionScore({ so: { id: 1 }, rsStatus: "Locked" }),
    );
  });
});
