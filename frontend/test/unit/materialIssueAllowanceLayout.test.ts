import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildMaterialIssueActionSummary,
  resolveCompactLineStatus,
} from "../../src/lib/materialIssueRmTableUx";
import { calculatePlannedAllowance } from "../../src/lib/plannedProcessAllowance";

const tableSource = readFileSync(
  new URL("../../src/components/erp/MaterialIssueRmTable.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../../src/pages/MaterialIssuePage.tsx", import.meta.url),
  "utf8",
);

describe("Material Issue compact RM table layout contract", () => {
  it("uses compact table with required columns (legacy + Kg rounding sections)", () => {
    expect(pageSource).toContain("MaterialIssueRmTable");
    expect(tableSource).toContain("material-issue-compact-grid");
    expect(tableSource).toContain("material-issue-rm-table-body");
    expect(pageSource).toContain("material-issue-action-summary");
    expect(pageSource).toContain("material-issue-action-bar");
    expect(tableSource).toContain("RM Item");
    expect(tableSource).toContain("BOM Qty");
    expect(tableSource).toContain("Planned Requirement");
    expect(tableSource).toContain("Rounding Rule");
    expect(tableSource).toContain("formatKgRoundingRuleLabel");
    expect(tableSource).toContain("Issue Target");
    expect(tableSource).toContain("Already Issued");
    expect(tableSource).toContain("Rounding Excess");
    expect(tableSource).toContain("Available");
    expect(tableSource).toContain("Issue Now");
    expect(tableSource).toContain("material-issue-kg-card");
    expect(tableSource).toContain("material-issue-rounding-rule");
    expect(tableSource).toContain("KG_ROUNDING_RULE_TOOLTIP");
    expect(tableSource).toContain("Allowance %");
    expect(tableSource).toContain("Available Stock");
    expect(tableSource).toContain("Add Qty");
    expect(tableSource).toContain("Remaining");
    expect(tableSource).toContain("Status");
    expect(tableSource).toContain("MaterialIssueRmTableSection");
    expect(tableSource).toContain('align="center"');
    expect(tableSource).not.toContain(">Increment<");
    expect(tableSource).not.toContain("Issue Status");
    expect(tableSource).not.toMatch(/FieldLabel[^>]*>\s*Pending\s*</);
    expect(tableSource).not.toContain("Use Recommended");
    expect(tableSource).not.toContain("Recommended Issue");
  });

  it("scrolls only the RM table body and keeps the action bar visible", () => {
    expect(tableSource).toContain('data-testid="material-issue-rm-table-body"');
    expect(tableSource).toContain("overflow-y-auto");
    expect(tableSource).not.toContain("overflow-x-auto");
    expect(pageSource).toContain('data-testid="material-issue-action-bar"');
    expect(pageSource).toContain("max-h-[calc(100dvh-5rem)]");
  });

  it("uses DecimalInput without native number spinners", () => {
    expect(tableSource).toContain("DecimalInput");
    expect(tableSource).not.toContain('type="number"');
    expect(pageSource).toContain("buildMaterialIssueActionSummary");
  });

  it("shows compact status badges with tooltip detail only", () => {
    expect(tableSource).toContain("resolveCompactLineStatus");
    expect(tableSource).toContain('data-testid="material-issue-status-pill"');
    expect(tableSource).toContain('data-testid="extra-allowance-pct"');
  });

  it("expands only for reason/approval details", () => {
    expect(tableSource).toContain('data-expanded={showReason ? "true" : "false"}');
    expect(tableSource).toContain("calculation.requiresReason");
    expect(tableSource).toContain("Admin approval required above 5%.");
  });
});

describe("materialIssueRmTableUx", () => {
  it("builds sticky action summary text", () => {
    const summary = buildMaterialIssueActionSummary(
      [
        {
          pmrLineId: 1,
          unit: "Kg",
          issueQty: "30.4",
          theoreticalQty: 30.4,
          issuedQty: 0,
          pendingQty: 30.4,
          plannedAllowanceQty: "0",
          availableQty: 530,
          approvalStatus: "NONE",
        },
        {
          pmrLineId: 2,
          unit: "Kg",
          issueQty: "7.6",
          theoreticalQty: 7.6,
          issuedQty: 0,
          pendingQty: 7.6,
          plannedAllowanceQty: "0",
          availableQty: 57,
          approvalStatus: "NONE",
        },
      ],
      "STORE",
    );
    expect(summary).toContain("2 RM lines");
    expect(summary).toContain("Issue 38");
    expect(summary).toContain("2 Ready");
    expect(summary).toContain("0 Approval Pending");
  });

  it("maps approval pending to compact status", () => {
    const calc = calculatePlannedAllowance({
      theoreticalQty: 10,
      quantityRaw: "1",
      alreadyIssuedQty: 0,
    });
    const status = resolveCompactLineStatus({
      calculation: calc,
      availableQty: 100,
      issueQty: "11",
      pendingQty: 10,
      approvalStatus: "PENDING_APPROVAL",
    });
    expect(status.label).toBe("Approval Pending");
  });
});
