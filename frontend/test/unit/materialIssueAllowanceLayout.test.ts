import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rowSource = readFileSync(
  new URL("../../src/components/erp/MaterialIssueAllowanceRow.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../../src/pages/MaterialIssuePage.tsx", import.meta.url),
  "utf8",
);

describe("Material Issue compact RM card layout contract", () => {
  it("uses the final two-row four-column field layout", () => {
    expect(pageSource).toContain("material-issue-compact-grid");
    expect(rowSource).toContain("RM Item");
    expect(rowSource).toContain("Qty (BOM)");
    expect(rowSource).toContain("Allowance %");
    expect(rowSource).toContain("Available Qty");
    expect(rowSource).toContain("Add Qty");
    expect(rowSource).toContain("Issue Now");
    expect(rowSource).toContain("Already Issued");
    expect(rowSource).toContain("Remaining");
    expect(rowSource).toContain("Issue Status");
    expect(rowSource).toContain("DESKTOP_COLS");
    expect(rowSource).toContain("Original BOM requirement");
    // Compact card must not show a "Pending" qty column (approval statuses may still say PENDING_*).
    expect(rowSource).not.toMatch(/FieldLabel[^>]*>\s*Pending\s*</);
    expect(rowSource).not.toContain("Use Recommended");
    expect(rowSource).not.toContain("Recommended Issue");
    expect(rowSource).not.toContain("Line 1:");
    expect(pageSource).not.toContain("Line 1:");
  });

  it("does not use number inputs that expose spinner/wheel increment behaviour", () => {
    expect(rowSource).not.toContain('type="number"');
    expect(rowSource).toContain('type="text"');
    expect(rowSource).toContain('inputMode="decimal"');
    expect(rowSource).toContain("blockDecimalSpinnerKeys");
    expect(rowSource).toContain("blockDecimalWheel");
  });

  it("has no permanent horizontal scrolling", () => {
    expect(pageSource).not.toContain('className="mt-2 overflow-x-auto rounded border border-slate-200"');
    expect(rowSource).not.toContain("overflow-x-auto");
  });

  it("Add Qty is editable; Allowance % is read-only acknowledgement", () => {
    expect(rowSource).toContain('data-testid="extra-allowance-pct"');
    expect(rowSource).toContain("onExtraQtyChange");
    expect(rowSource).toContain('variant="prominent"');
    expect(pageSource).toContain("updateExtraAllowanceQty");
    expect(pageSource).toContain('allowanceInputSource: "QUANTITY"');
    expect(pageSource).not.toContain("enteredAllowancePct");
  });

  it("keeps Available Ready/Short and Issue Status compact", () => {
    expect(rowSource).toContain('data-testid="stock-readiness-badge"');
    expect(rowSource).toContain("issueStatusPresentation");
    expect(rowSource).toContain("Issue Status");
    expect(rowSource).toContain("status.issueLabel");
  });

  it("expands only for reason/approval details", () => {
    expect(rowSource).toContain('data-expanded={expanded ? "true" : "false"}');
    expect(rowSource).toContain("calculation.requiresReason");
    expect(rowSource).toContain("Admin approval required above 5%.");
  });
});
