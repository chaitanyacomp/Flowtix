import { describe, expect, it } from "vitest";
import {
  formatProcurementSoFilterLabel,
  isRawSoHashIdLabel,
} from "../../src/lib/procurementSoFilterDisplay";
import { buildProcurementWorkspaceHref } from "../../src/lib/woProcurementContinuity";

describe("Regular SO procurement filter display", () => {
  it("shows business SO number instead of SO #258", () => {
    expect(formatProcurementSoFilterLabel(258, "SO-26-0001")).toBe("SO-26-0001");
    expect(isRawSoHashIdLabel(`SO #258`, 258)).toBe(true);
    expect(isRawSoHashIdLabel("SO-26-0001", 258)).toBe(false);
  });

  it("persists salesOrderId + salesOrderDocNo on procurement workspace href", () => {
    const href = buildProcurementWorkspaceHref({
      salesOrderId: 258,
      salesOrderDocNo: "SO-26-0001",
      materialRequirementId: 99,
      demandPool: "REGULAR_SO",
      returnTo: "pending-actions",
    });
    expect(href).toContain("salesOrderId=258");
    expect(href).toContain("salesOrderDocNo=SO-26-0001");
    expect(href).toContain("demandPool=REGULAR_SO");
    expect(href).not.toContain("SO%20%23258");
    expect(href).not.toMatch(/SO #258/);
  });
});
