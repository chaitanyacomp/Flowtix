import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const productionSource = readFileSync(resolve(__dirname, "../../src/pages/ProductionPage.tsx"), "utf8");
const regularDecisionSource = readFileSync(
  resolve(__dirname, "../../src/components/erp/production/RegularSoEndProductionPanel.tsx"),
  "utf8",
);
const issueSource = readFileSync(resolve(__dirname, "../../src/pages/MaterialIssuePage.tsx"), "utf8");
const dispatchSource = readFileSync(resolve(__dirname, "../../src/pages/DispatchPage.tsx"), "utf8");

describe("REGULAR_SO acceptance UI isolation", () => {
  it("moves a partial issue to Partially Issued and focuses the affected PMR/WO", () => {
    expect(issueSource).toContain('nextParams.set("bucket", "partiallyIssued")');
    expect(issueSource).toContain('nextParams.set("pmrId", String(issued.pmrId))');
    expect(issueSource).toContain('nextParams.set("workOrderId", String(issued.workOrderId))');
    expect(issueSource).toContain("selectPmr(affected.id, affected.workOrderId)");
  });

  it("offers both explicit remaining-issue choices and requires a short-close reason", () => {
    expect(issueSource).toContain("Issue Remaining Later");
    expect(issueSource).toContain("Close Remaining as Short Issue");
    expect(issueSource).toContain("handleIssueLater");
    expect(issueSource).toContain("handleWaiveRemaining");
    expect(issueSource).toContain('showError("Select a Short Issue close reason.")');
    expect(issueSource).toContain("disabled={submitting || !waiveReason}");
  });

  it("uses only the post-approval Continue Later / permanent shortage decision", () => {
    expect(regularDecisionSource).toContain("Continue Later");
    expect(regularDecisionSource).toContain("Permanently Close WO with Shortage");
    expect(regularDecisionSource).not.toContain("Produced Qty");
    expect(regularDecisionSource).not.toContain("Return Unused RM");
    expect(productionSource).toContain("!isRegularFlow && reviewFinalize.remaining > 1e-6");
    expect(productionSource).toContain('data-testid="regular-review-finalize-next-decision"');
  });

  it("requires reason and explicit acknowledgement and displays the exact shortage", () => {
    expect(productionSource).toContain("regularSoCoverage?.soShortageQty");
    expect(productionSource).toContain("Enter the closure reason");
    expect(productionSource).toContain("I understand this WO will close permanently.");
    expect(productionSource).toContain("permanentClosureAcknowledged: true");
  });

  it("separates dispatchable FG from permanent customer shortage and removes planning action", () => {
    expect(dispatchSource).toContain('data-testid="regular-closed-short-quantities"');
    expect(dispatchSource).toContain("Usable FG pending dispatch:");
    expect(dispatchSource).toContain("Permanently closed short:");
    expect(dispatchSource).toContain("!currentLine.permanentShortClosure");
  });
});
