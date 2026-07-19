import { describe, expect, it } from "vitest";
import {
  classifyProductionWorkbenchState,
  classifyProductionWorkspaceSectionFromState,
  hasExecutableBalanceWithPendingEntryQc,
  pwSectionForProductionBucket,
  shouldPreferContinueOverEntryQc,
  workbenchStatePrimaryActionLabel,
  workbenchStateStatusLabel,
} from "../../src/lib/productionWorkbenchState";
import { matchesProductionWorkspaceBucket } from "../../src/lib/productionWorkspaceBucketFilter";
import { buildProductionWorkspaceSectionRows } from "../../src/lib/productionWorkspaceSections";
import {
  buildPendingActionsProductionOverviewHref,
  buildProductionWorkspaceOverviewHref,
  parseProductionWorkspaceFocusWo,
} from "../../src/lib/productionWorkspaceRouteContract";
import { groupPendingActionsIntoWorkBuckets } from "../../src/lib/pendingActionsWorkBuckets";
import type { PendingAction } from "../../src/lib/pendingActionsApi";
import { operationalStatusFromProductionRow } from "../../src/lib/dashboardProductionStatus";

function continueWithQcRow() {
  return {
    workOrderId: 260001,
    workOrderNo: "WO-26-0001",
    itemName: "FG",
    requiredQty: 5000,
    producedQty: 2000,
    balanceQty: 3000,
    orderType: "NO_QTY",
    status: "IN_PROGRESS",
    productionExecutionStatus: "RUNNING",
    nextAction: "PRODUCTION_PENDING",
    hasPendingQc: true,
    pendingQcQty: 2000,
    canAcceptProductionEntry: true,
    productionWorkState: "CONTINUE_PRODUCTION" as const,
  };
}

describe("productionWorkbenchState canonical classifier", () => {
  it("partial finalized + Pending QC + remaining → CONTINUE_PRODUCTION (same for Dashboard/PA/Workbench)", () => {
    const row = continueWithQcRow();
    expect(classifyProductionWorkbenchState(row)).toBe("CONTINUE_PRODUCTION");
    expect(hasExecutableBalanceWithPendingEntryQc(row)).toBe(true);
    expect(shouldPreferContinueOverEntryQc(row)).toBe(true);
    expect(classifyProductionWorkspaceSectionFromState(row)).toBe("active");
    expect(workbenchStateStatusLabel("CONTINUE_PRODUCTION")).toBe("Continue");
    expect(workbenchStatePrimaryActionLabel("CONTINUE_PRODUCTION")).toBe("Continue Production");
    expect(matchesProductionWorkspaceBucket(row, "inProgress")).toBe(true);
    expect(matchesProductionWorkspaceBucket(row, "readyToStart")).toBe(false);
    expect(operationalStatusFromProductionRow(row).label).toBe("Continue");
  });

  it("ready never-started WO is READY_TO_START (not In Progress / Continue)", () => {
    const row = {
      workOrderId: 2,
      itemName: "Box",
      requiredQty: 1500,
      producedQty: 0,
      balanceQty: 1500,
      orderType: "NO_QTY",
      status: "IN_PROGRESS",
      productionExecutionStatus: "RUNNING",
      nextAction: "PRODUCTION_PENDING",
      canAcceptProductionEntry: true,
      productionWorkState: "READY_TO_START" as const,
    };
    expect(classifyProductionWorkbenchState(row)).toBe("READY_TO_START");
    expect(classifyProductionWorkspaceSectionFromState(row)).toBe("ready");
    expect(workbenchStateStatusLabel("READY_TO_START")).toBe("Ready");
    expect(matchesProductionWorkspaceBucket(row, "readyToStart")).toBe(true);
  });

  it("open draft → DRAFT_PENDING under Ready when nothing finalized", () => {
    const row = {
      workOrderId: 3,
      itemName: "Box",
      requiredQty: 100,
      producedQty: 0,
      balanceQty: 100,
      nextAction: "PRODUCTION_DRAFT_REVIEW",
      hasOpenDraft: true,
      canAcceptProductionEntry: true,
      productionWorkState: "READY_TO_START" as const,
    };
    expect(classifyProductionWorkbenchState(row)).toBe("DRAFT_PENDING");
    expect(classifyProductionWorkspaceSectionFromState(row)).toBe("ready");
    expect(workbenchStatePrimaryActionLabel("DRAFT_PENDING")).toBe("Review & Finalize");
  });

  it("fully produced + Pending QC only → QC_PENDING_ONLY", () => {
    const row = {
      workOrderId: 9,
      itemName: "FG",
      requiredQty: 2000,
      producedQty: 2000,
      balanceQty: 0,
      productionExecutionStatus: "COMPLETED",
      nextAction: "QC_PENDING",
      hasPendingQc: true,
      canAcceptProductionEntry: false,
    };
    expect(classifyProductionWorkbenchState(row)).toBe("QC_PENDING_ONLY");
    expect(shouldPreferContinueOverEntryQc(row)).toBe(false);
  });

  it("equal/extra production awaiting report → PRODUCTION_REPORT_PENDING (not QC-only)", () => {
    const row = {
      workOrderId: 260001,
      workOrderNo: "WO-26-0001",
      itemName: "FG",
      requiredQty: 3000,
      producedQty: 3075,
      balanceQty: 0,
      orderType: "NO_QTY",
      status: "IN_PROGRESS",
      productionExecutionStatus: "SHORTFALL_PENDING",
      nextAction: "PRODUCTION_SHORTFALL_DECISION",
      hasPendingQc: true,
      pendingQcQty: 3075,
      canAcceptProductionEntry: false,
    };
    expect(classifyProductionWorkbenchState(row)).toBe("PRODUCTION_REPORT_PENDING");
    expect(classifyProductionWorkspaceSectionFromState(row)).toBe("reportPending");
    expect(workbenchStateStatusLabel("PRODUCTION_REPORT_PENDING")).toBe("Report Pending");
    expect(workbenchStatePrimaryActionLabel("PRODUCTION_REPORT_PENDING")).toBe("Open Production Report");
  });

  it("paused with remaining → PAUSED_PRODUCTION", () => {
    const row = {
      workOrderId: 4,
      itemName: "FG",
      requiredQty: 1500,
      producedQty: 500,
      balanceQty: 1000,
      productionExecutionStatus: "BLOCKED",
      nextAction: "PRODUCTION_EXECUTION_BLOCKED",
      canAcceptProductionEntry: false,
      productionWorkState: "PAUSED_PRODUCTION" as const,
    };
    expect(classifyProductionWorkbenchState(row)).toBe("PAUSED_PRODUCTION");
    expect(classifyProductionWorkspaceSectionFromState(row)).toBe("paused");
  });

  it("sections place continue-with-QC under Continue tab, ready under Ready", () => {
    const sections = buildProductionWorkspaceSectionRows([
      continueWithQcRow(),
      {
        workOrderId: 260002,
        workOrderNo: "WO-26-0002",
        itemName: "A",
        requiredQty: 100,
        producedQty: 0,
        balanceQty: 100,
        nextAction: "PRODUCTION_PENDING",
        canAcceptProductionEntry: true,
        productionWorkState: "READY_TO_START",
      },
    ]);
    expect(sections.active.map((r) => r.workOrderId)).toContain(260001);
    expect(sections.ready.map((r) => r.workOrderId)).toContain(260002);
    expect(sections.active).toHaveLength(1);
    expect(sections.ready).toHaveLength(1);
  });
});

describe("Pending Actions / deep-link routing", () => {
  it("Ready to Start overview opens Ready tab (pwSection=ready), never Continue", () => {
    const href = buildPendingActionsProductionOverviewHref("readyToStart");
    expect(href).toContain("productionBucket=readyToStart");
    expect(href).toContain("pwSection=ready");
    expect(href).not.toContain("pwSection=active");
    expect(pwSectionForProductionBucket("readyToStart")).toBe("ready");
  });

  it("Continue Production overview opens Continue tab", () => {
    const href = buildPendingActionsProductionOverviewHref("inProgress");
    expect(href).toContain("productionBucket=inProgress");
    expect(href).toContain("pwSection=active");
  });

  it("single Ready to Start uses pwFocus card highlight, not scoped workOrderId", () => {
    const buckets = groupPendingActionsIntoWorkBuckets([
      {
        id: "one",
        priority: "MEDIUM",
        action: "Ready to Start Production",
        documentNo: "WO-26-0004",
        ownerRole: "PRODUCTION",
        ageHours: 1,
        href: "/production?from=pending-actions&workOrderId=4&flow=NO_QTY&salesOrderId=245&cycleId=12&source=no_qty_so",
      } satisfies PendingAction,
    ]);
    expect(buckets[0]?.openHref).toContain("pwSection=ready");
    expect(buckets[0]?.openHref).toContain("pwFocus=4");
    expect(buckets[0]?.openHref).not.toContain("workOrderId=");
    expect(buckets[0]?.openHref).not.toContain("salesOrderId=");
  });

  it("single Continue keeps executable WO deep-link with Continue tab tokens", () => {
    const buckets = groupPendingActionsIntoWorkBuckets([
      {
        id: "c",
        priority: "HIGH",
        action: "Continue Production",
        documentNo: "WO-26-0001",
        ownerRole: "PRODUCTION",
        ageHours: 2,
        href: "/production?from=pending-actions&workOrderId=1&flow=NO_QTY&salesOrderId=9&cycleId=2",
      } satisfies PendingAction,
    ]);
    expect(buckets[0]?.openHref).toContain("workOrderId=1");
    expect(buckets[0]?.openHref).toContain("productionBucket=inProgress");
    expect(buckets[0]?.openHref).toContain("pwSection=active");
  });

  it("deep-link focus survives in overview URL and parses after refresh", () => {
    const href = buildProductionWorkspaceOverviewHref({
      productionBucket: "readyToStart",
      pwSection: "ready",
      pwFocus: 4,
      from: "pending-actions",
      returnTo: "pending-actions",
    });
    expect(href).toContain("pwFocus=4");
    const params = new URLSearchParams(href.split("?")[1] ?? "");
    expect(parseProductionWorkspaceFocusWo(params.get("pwFocus"))).toBe(4);
  });

  it("stale-notice helper keeps overview unscoped", () => {
    const href = buildProductionWorkspaceOverviewHref({
      pwSection: "paused",
      pwFocus: 99,
      pwNotice: "Status changed",
      from: "pending-actions",
    });
    expect(href).toContain("pwNotice=");
    expect(href).not.toContain("workOrderId=");
  });
});

describe("high-volume workbench pagination contract", () => {
  it("classifies 25 concurrent rows without collapsing Continue into Ready", () => {
    const rows = Array.from({ length: 25 }, (_, i) => {
      const produced = i % 3 === 0 ? 0 : 100;
      return {
        workOrderId: 1000 + i,
        workOrderNo: `WO-${1000 + i}`,
        itemName: `Item ${i}`,
        requiredQty: 500,
        producedQty: produced,
        balanceQty: 500 - produced,
        nextAction: "PRODUCTION_PENDING",
        canAcceptProductionEntry: true,
        productionWorkState: (produced > 0 ? "CONTINUE_PRODUCTION" : "READY_TO_START") as const,
        hasPendingQc: i % 5 === 0 && produced > 0,
      };
    });
    const sections = buildProductionWorkspaceSectionRows(rows);
    expect(sections.ready.length + sections.active.length).toBe(25);
    expect(sections.ready.every((r) => Number(r.producedQty) <= 1e-6)).toBe(true);
    expect(sections.active.every((r) => Number(r.producedQty) > 1e-6)).toBe(true);
  });
});
