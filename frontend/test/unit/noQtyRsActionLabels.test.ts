import { describe, expect, it } from "vitest";
import {
  createCycleRequirementSheetButtonLabel,
  createCycleRsButtonLabel,
  createNextRsButtonLabel,
  noQtyCurrentCycleLabel,
  noQtyNextCycleLabel,
  noQtyPlanningHubHref,
  NO_QTY_OPEN_MONTHLY_PLANNING_LABEL,
  NO_QTY_PLACE_WO_LABEL,
  noQtyMonthlyPlanningHref,
  noQtyRsCreationWorkspaceHref,
  noQtyRsExecutionWorkspaceHref,
  resolveNoQtyInboxPlanningCta,
  resolveNoQtyLockedRsPlanningCta,
  openCurrentRsButtonLabel,
  noQtyAgreementWorkspaceHref,
  noQtyBusinessNextRsBlockReason,
  noQtyBusinessWorkflowStage,
  noQtyCreateNextCycleContinuationLabel,
  noQtyNextRsStatusHeadline,
  noQtySoListHref,
  resolveCreateRsButtonLabel,
  resolveNoQtyExecutionWorkspaceHref,
  NO_QTY_OPEN_EXECUTION_WORKSPACE_LABEL,
  noQtyExecutionActionNeededClassName,
  noQtyExecutionEntryHref,
} from "../../src/lib/noQtyRsActionLabels";

describe("noQtyRsActionLabels", () => {
  it("maps workflow stages to cycle-oriented language", () => {
    expect(noQtyBusinessWorkflowStage({ processStageKey: "NO_QTY_DRAFT", hasRs: false })).toBe(
      "Requirement Sheet pending",
    );
    expect(noQtyBusinessWorkflowStage({ processStageKey: "NO_QTY_IN_PRODUCTION", hasRs: true })).toBe(
      "Production / QA in progress",
    );
    expect(noQtyBusinessWorkflowStage({ processStageKey: "NO_QTY_READY_TO_PLACE_WO", hasRs: true })).toBe(
      "Procurement complete · Ready for WO placement",
    );
    expect(noQtyBusinessWorkflowStage({ processStageKey: "NO_QTY_PROCUREMENT_IN_PROGRESS", hasRs: true })).toBe(
      "Procurement in progress",
    );
  });

  it("maps draft RS block reasons", () => {
    expect(noQtyBusinessNextRsBlockReason("DRAFT_RS_ON_CYCLE")).toContain("not locked");
    expect(noQtyBusinessNextRsBlockReason("DRAFT_RS_EXISTS")).toContain("draft");
  });

  it("uses standard button labels", () => {
    expect(openCurrentRsButtonLabel()).toBe("Open Current RS");
    expect(createCycleRsButtonLabel(2)).toBe("Create Cycle 2 RS");
    expect(createNextRsButtonLabel(null)).toBe("Create Next Requirement Sheet");
    expect(createNextRsButtonLabel(3)).toBe("Create Cycle 3 Requirement Sheet");
  });

  it("resolves create labels from context", () => {
    expect(
      resolveCreateRsButtonLabel({
        hasRs: false,
        currentCycleNo: 1,
      }),
    ).toBe("Create Cycle 1 RS");
    expect(
      resolveCreateRsButtonLabel({
        hasRs: true,
        createNextRsEligible: true,
        nextCycleNo: 2,
      }),
    ).toBe("Create Cycle 2 Requirement Sheet");
  });

  it("uses standard Next RS status headlines", () => {
    expect(noQtyNextRsStatusHeadline(true)).toBe("Next RS Ready");
    expect(noQtyNextRsStatusHeadline(false)).toBe("Next RS Blocked");
  });

  it("noQtyRsCreationWorkspaceHref targets creation workspace with intent=add", () => {
    expect(noQtyRsCreationWorkspaceHref({ salesOrderId: 42, cycleId: 7, from: "so_created" })).toBe(
      "/sales-orders/42/requirement-sheets?source=no_qty_so&salesOrderId=42&intent=add&from=so_created&cycleId=7",
    );
  });

  it("noQtyRsExecutionWorkspaceHref targets execution workspace with focus=execution", () => {
    expect(
      noQtyRsExecutionWorkspaceHref({
        salesOrderId: 15,
        cycleId: 3,
        requirementSheetId: 99,
        from: "pending-actions",
      }),
    ).toContain("focus=execution");
    expect(
      noQtyRsExecutionWorkspaceHref({
        salesOrderId: 15,
        cycleId: 3,
        requirementSheetId: 99,
        from: "pending-actions",
      }),
    ).toContain("/sales-orders/15/requirement-sheets");
  });

  it("builds NO_QTY SO list href with optional focus", () => {
    expect(noQtySoListHref()).toBe("/sales-orders?soType=NO_QTY");
    expect(noQtySoListHref(42)).toBe("/sales-orders?soType=NO_QTY&salesOrderId=42");
    expect(noQtySoListHref(42, "STORE")).toBe("/no-qty-agreements?salesOrderId=42");
    expect(noQtySoListHref(undefined, "STORE")).toBe("/no-qty-agreements");
  });

  it("builds Store-safe planning navigation hrefs", () => {
    expect(noQtyAgreementWorkspaceHref(42, { intent: "add", from: "dashboard" })).toBe(
      "/sales-orders/42/requirement-sheets?source=no_qty_so&salesOrderId=42&intent=add&from=dashboard",
    );
    expect(noQtyPlanningHubHref(42)).toBe("/planning-dashboard?salesOrderId=42&source=no_qty_planning");
    expect(noQtyPlanningHubHref()).toBe("/planning-dashboard");
    expect(createCycleRequirementSheetButtonLabel(2)).toBe("Create Cycle 2 Requirement Sheet");
    expect(noQtyCreateNextCycleContinuationLabel({ currentCycleNo: 1 })).toBe(
      "Create Cycle 2 Requirement Sheet",
    );
  });

  it("noQtyMonthlyPlanningHref includes period and salesOrderId", () => {
    expect(
      noQtyMonthlyPlanningHref({
        salesOrderId: 42,
        period: "2026-06",
        source: "no_qty_planning",
      }),
    ).toBe("/monthly-planning?source=no_qty_planning&salesOrderId=42&period=2026-06");
  });

  it("noQtyRsExecutionWorkspaceHref targets execution workspace", () => {
    expect(
      noQtyRsExecutionWorkspaceHref({
        salesOrderId: 15,
        cycleId: 301,
        requirementSheetId: 260,
        source: "no_qty_rs",
      }),
    ).toContain("/sales-orders/15/requirement-sheets");
    expect(
      noQtyRsExecutionWorkspaceHref({
        salesOrderId: 15,
        cycleId: 301,
        requirementSheetId: 260,
        source: "no_qty_rs",
      }),
    ).toContain("focus=execution");
    expect(
      noQtyRsExecutionWorkspaceHref({
        salesOrderId: 15,
        cycleId: 301,
        requirementSheetId: 260,
        source: "no_qty_rs",
      }),
    ).toContain("sheetId=260");
  });

  it("resolveNoQtyInboxPlanningCta routes REQUIREMENT_READY to Monthly Planning", () => {
    const cta = resolveNoQtyInboxPlanningCta({
      processStageKey: "NO_QTY_REQUIREMENT_READY",
      salesOrderId: 15,
      lockedPeriodKey: "2026-08",
    });
    expect(cta.label).toBe(NO_QTY_OPEN_MONTHLY_PLANNING_LABEL);
    expect(cta.href).toContain("/monthly-planning");
  });

  it("resolveNoQtyInboxPlanningCta routes READY_TO_PLACE_WO to execution workspace", () => {
    const cta = resolveNoQtyInboxPlanningCta({
      processStageKey: "NO_QTY_READY_TO_PLACE_WO",
      salesOrderId: 15,
      cycleId: 301,
      requirementSheetId: 260,
    });
    expect(cta.label).toBe(NO_QTY_PLACE_WO_LABEL);
    expect(cta.href).toContain("focus=execution");
    expect(cta.href).toContain("/sales-orders/15/requirement-sheets");
  });

  it("resolveNoQtyLockedRsPlanningCta opens execution when ready", () => {
    const cta = resolveNoQtyLockedRsPlanningCta({
      salesOrderId: 9,
      periodKey: "2026-05",
      cycleId: 2,
      requirementSheetId: 88,
      readyToPlaceWo: true,
    });
    expect(cta?.label).toBe(NO_QTY_PLACE_WO_LABEL);
    expect(cta?.href).toContain("focus=execution");
  });

  it("resolveNoQtyLockedRsPlanningCta opens Monthly Planning before release", () => {
    const cta = resolveNoQtyLockedRsPlanningCta({
      salesOrderId: 9,
      periodKey: "2026-05",
      processStageKey: "NO_QTY_REQUIREMENT_READY",
    });
    expect(cta?.label).toBe("Open Monthly Planning");
    expect(cta?.href).toBe("/monthly-planning?source=no_qty_rs&salesOrderId=9&period=2026-05");
  });

  it("resolveNoQtyExecutionWorkspaceHref prefers API href", () => {
    const href = resolveNoQtyExecutionWorkspaceHref({
      salesOrderId: 171,
      executionWorkspaceHref:
        "/sales-orders/171/requirement-sheets?source=no_qty_so&salesOrderId=171&sheetId=261&cycleId=301&focus=execution",
      placementRequirementSheetId: 261,
    });
    expect(href).toContain("sheetId=261");
    expect(href).toContain("focus=execution");
    expect(NO_QTY_OPEN_EXECUTION_WORKSPACE_LABEL).toBe("Open Execution Workspace");
  });

  it("resolveNoQtyExecutionWorkspaceHref falls back to placement sheet id", () => {
    const href = resolveNoQtyExecutionWorkspaceHref({
      salesOrderId: 15,
      placementRequirementSheetId: 260,
      guidedCycleId: 301,
    });
    expect(href).toContain("/sales-orders/15/requirement-sheets");
    expect(href).toContain("sheetId=260");
    expect(href).toContain("focus=execution");
  });

  it("noQtyExecutionActionNeededClassName maps execution action keys", () => {
    expect(noQtyExecutionActionNeededClassName("PLACE_WO")).toContain("font-semibold");
    expect(noQtyExecutionActionNeededClassName("ISSUE_RM")).toContain("amber");
    expect(noQtyExecutionActionNeededClassName("BLOCKED")).toContain("red");
    expect(noQtyExecutionActionNeededClassName("COMPLETE")).toContain("emerald");
  });

  it("noQtyExecutionEntryHref falls back to execution register without sheet id", () => {
    const href = noQtyExecutionEntryHref({
      salesOrderId: 42,
      role: "STORE",
      source: "rm_control_center",
    });
    expect(href).toContain("/no-qty-agreements");
    expect(href).toContain("salesOrderId=42");
    expect(href).toContain("source=rm_control_center");
  });

  it("noQtyExecutionEntryHref prefers execution workspace when sheet id is known", () => {
    const href = noQtyExecutionEntryHref({
      salesOrderId: 15,
      placementRequirementSheetId: 260,
      guidedCycleId: 301,
      role: "STORE",
    });
    expect(href).toContain("focus=execution");
    expect(href).toContain("sheetId=260");
  });
});
