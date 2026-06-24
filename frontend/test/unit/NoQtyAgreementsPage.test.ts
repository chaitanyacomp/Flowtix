import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pagePath = resolve(__dirname, "../../src/pages/NoQtyAgreementsPage.tsx");
const pageSource = readFileSync(pagePath, "utf8");

describe("NoQtyAgreementsPage execution register", () => {
  it("exports page component", async () => {
    const mod = await import("../../src/pages/NoQtyAgreementsPage");
    expect(typeof mod.NoQtyAgreementsPage).toBe("function");
  });

  it("does not render NoQtyPlannerInboxSection", () => {
    expect(pageSource).not.toContain("NoQtyPlannerInboxSection");
  });

  it("uses execution register title and subtitle", () => {
    expect(pageSource).toContain('title="NO_QTY Execution"');
    expect(pageSource).toContain("Track locked requirement sheets");
    expect(pageSource).toContain("WO placement actions");
  });

  it("renders execution register columns from API fields", () => {
    expect(pageSource).toContain("RS Balance");
    expect(pageSource).toContain("Suggested WO");
    expect(pageSource).toContain("RM Coverage");
    expect(pageSource).toContain("Action Needed");
    expect(pageSource).toContain("placementRequirementSheetNo");
    expect(pageSource).toContain("rsBalanceQty");
    expect(pageSource).toContain("suggestedWoQty");
    expect(pageSource).toContain("rmCoverageLabel");
    expect(pageSource).toContain("actionNeededLabel");
  });

  it("filters to executionRegisterEnabled rows only", () => {
    expect(pageSource).toContain("executionRegisterEnabled === true");
  });

  it("shows execution empty state copy", () => {
    expect(pageSource).toContain('data-testid="no-qty-execution-empty"');
    expect(pageSource).toContain("No NO_QTY execution work is currently pending.");
  });

  it("uses Open Execution Workspace CTA with executionWorkspaceHref", () => {
    expect(pageSource).toContain("NO_QTY_OPEN_EXECUTION_WORKSPACE_LABEL");
    expect(pageSource).toContain("resolveNoQtyExecutionWorkspaceHref");
    expect(pageSource).toContain("executionWorkspaceHref");
    expect(pageSource).not.toContain("resolveNoQtyInboxPlanningCta");
    expect(pageSource).not.toContain("openCurrentRsButtonLabel");
    expect(pageSource).not.toContain("pendingPlanningAction");
    expect(pageSource).not.toContain("Open Current RS");
    expect(pageSource).not.toContain("Create Requirement Sheet");
    expect(pageSource).not.toContain("Open Monthly Planning");
  });

  it("styles action needed from actionNeededKey", () => {
    expect(pageSource).toContain("noQtyExecutionActionNeededClassName");
    expect(pageSource).toContain("actionNeededKey");
  });
});
