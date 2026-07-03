import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const inboxPath = resolve(__dirname, "../../src/components/erp/planning/NoQtyPlannerInboxSection.tsx");
const workspacePath = resolve(__dirname, "../../src/components/erp/planning/NoQtyCycleManagementWorkspace.tsx");
const skeletonPath = resolve(__dirname, "../../src/components/erp/planning/NoQtyCycleManagementSkeleton.tsx");
const planningPagePath = resolve(__dirname, "../../src/pages/PlanningDashboardPage.tsx");
const inboxSource = readFileSync(inboxPath, "utf8");
const workspaceSource = readFileSync(workspacePath, "utf8");
const skeletonSource = readFileSync(skeletonPath, "utf8");
const planningPageSource = readFileSync(planningPagePath, "utf8");

describe("NoQtyPlannerInboxSection FT-UX-002", () => {
  it("does not expose duplicate RS launcher buttons", () => {
    expect(inboxSource).not.toContain("openCurrentRsButtonLabel");
    expect(inboxSource).not.toContain("resolveNoQtyInboxPlanningCta");
    expect(workspaceSource).not.toContain("openCurrentRsButtonLabel");
    expect(workspaceSource).not.toContain("Open Current RS");
  });

  it("uses cycle management workspace and single primary action resolver", () => {
    expect(inboxSource).toContain("NoQtyCycleManagementWorkspace");
    expect(workspaceSource).toContain("resolveNoQtyCycleManagementPrimaryAction");
    expect(workspaceSource).toContain("cycle-mgmt-primary-action");
    expect(workspaceSource).toContain("cycle-mgmt-current-cycle-card");
    expect(workspaceSource).toContain("NoQtyPreviousCyclesSection");
  });

  it("supports focused sales order workspace mode", () => {
    expect(inboxSource).toContain("focusedSalesOrderId");
    expect(inboxSource).toContain("Cycle Management Workspace");
  });

  it("uses reserved-height skeleton until cycle data is ready", () => {
    expect(inboxSource).toContain("NoQtyCycleManagementSkeleton");
    expect(inboxSource).toContain("showSkeleton");
    expect(inboxSource).toContain("contextLoading");
    expect(inboxSource).not.toContain("Loading cycle management data");
    expect(skeletonSource).toContain("min-h-[17.5rem]");
    expect(skeletonSource).toContain("data-testid=\"cycle-management-skeleton\"");
    expect(planningPageSource).toContain("plannerInboxInitialLoading");
    expect(planningPageSource).toContain("contextLoading=");
  });
});
