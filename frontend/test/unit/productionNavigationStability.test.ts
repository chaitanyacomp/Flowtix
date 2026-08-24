import { describe, expect, it } from "vitest";
import {
  buildRegularExecutableProductionSearch,
  productionScopedUrlAlreadyMatches,
  resolveExtraRmCapacityQty,
  resolveUseRemainingQtyFill,
  shouldHoldProductionIdentityUnresolved,
  shouldAutoOpenExecutableFromProductionWorkspaceList,
  resolveProductionRegularBack,
  buildProductionWorkspaceListBackHref,
  detectProductionNavOscillation,
  appendProductionNavHistory,
  normalizeProductionNavHref,
  isProductionEntryBlockedByRunStartGate,
  shouldHideEnterProductionCtaInEntryWorkspace,
  shouldSuppressRecordProductionPrimaryStrip,
  PRODUCTION_ENTRY_AWAIT_RUN_CONFIRM_MESSAGE,
  isStaleProductionNavigationGeneration,
  resolveProductionWorkspaceNavState,
} from "../../src/lib/productionNavigationStability";
import { PRODUCTION_FLOW_GREEN_LEVEL, PRODUCTION_FLOW_REGULAR } from "../../src/lib/productionFlowContract";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("productionNavigationStability — flicker guards", () => {
  it("does not hold identity resolving when flow is already REGULAR_SO", () => {
    expect(
      shouldHoldProductionIdentityUnresolved({
        fromNoQtySo: false,
        explicitNoQtyUrlNavigate: false,
        flowParam: PRODUCTION_FLOW_REGULAR,
        focusSoIdValid: true,
        focusSoId: 10,
        soOrderTypeKnown: false,
        woIdFromUrlValid: true,
        initialRefreshDone: true,
        woSalesOrderId: 10,
        woSoOrderTypeKnown: false,
        woIsGreenLevel: false,
        regularFlowToken: PRODUCTION_FLOW_REGULAR,
        greenLevelFlowToken: PRODUCTION_FLOW_GREEN_LEVEL,
      }),
    ).toBe(false);
  });

  it("still waits for initial WO refresh when REGULAR URL pins a WO", () => {
    expect(
      shouldHoldProductionIdentityUnresolved({
        fromNoQtySo: false,
        explicitNoQtyUrlNavigate: false,
        flowParam: PRODUCTION_FLOW_REGULAR,
        focusSoIdValid: true,
        focusSoId: 10,
        soOrderTypeKnown: true,
        woIdFromUrlValid: true,
        initialRefreshDone: false,
        woSalesOrderId: 10,
        woSoOrderTypeKnown: true,
        woIsGreenLevel: false,
        regularFlowToken: PRODUCTION_FLOW_REGULAR,
        greenLevelFlowToken: PRODUCTION_FLOW_GREEN_LEVEL,
      }),
    ).toBe(true);
  });

  it("holds identity when flow is unknown and SO master is not loaded", () => {
    expect(
      shouldHoldProductionIdentityUnresolved({
        fromNoQtySo: false,
        explicitNoQtyUrlNavigate: false,
        flowParam: null,
        focusSoIdValid: true,
        focusSoId: 10,
        soOrderTypeKnown: false,
        woIdFromUrlValid: false,
        initialRefreshDone: true,
        woSalesOrderId: null,
        woSoOrderTypeKnown: true,
        woIsGreenLevel: false,
        regularFlowToken: PRODUCTION_FLOW_REGULAR,
        greenLevelFlowToken: PRODUCTION_FLOW_GREEN_LEVEL,
      }),
    ).toBe(true);
  });

  it("skips navigate when URL already matches WO/line/flow (one click → one navigate)", () => {
    const search = "workOrderId=42&workOrderLineId=99&flow=REGULAR_SO&salesOrderId=10&from=work-orders";
    expect(
      productionScopedUrlAlreadyMatches(search, {
        workOrderId: 42,
        workOrderLineId: 99,
        flow: PRODUCTION_FLOW_REGULAR,
      }),
    ).toBe(true);
    expect(
      productionScopedUrlAlreadyMatches(search, {
        workOrderId: 42,
        workOrderLineId: 100,
        flow: PRODUCTION_FLOW_REGULAR,
      }),
    ).toBe(false);
  });

  it("builds a stable REGULAR production search without cloning volatile params", () => {
    const qs = buildRegularExecutableProductionSearch({
      workOrderId: 42,
      workOrderLineId: 99,
      flow: PRODUCTION_FLOW_REGULAR,
      salesOrderId: 10,
      from: "work-orders",
    });
    const params = new URLSearchParams(qs);
    expect(params.get("workOrderId")).toBe("42");
    expect(params.get("workOrderLineId")).toBe("99");
    expect(params.get("flow")).toBe(PRODUCTION_FLOW_REGULAR);
    expect(params.get("salesOrderId")).toBe("10");
    expect(params.get("from")).toBe("work-orders");
    expect(params.has("liveTick")).toBe(false);
  });

  it("Use Remaining fills WO target remaining, not full RM surplus", () => {
    expect(resolveUseRemainingQtyFill(5000, 5142)).toBe(5000);
    expect(resolveUseRemainingQtyFill(5000, 4000)).toBe(4000);
  });

  it("Extra RM Capacity is RM-supported max minus planned (not Target Remaining)", () => {
    expect(resolveExtraRmCapacityQty(5142, 5000)).toBe(142);
    expect(resolveExtraRmCapacityQty(5000, 5000)).toBe(0);
    expect(resolveExtraRmCapacityQty(4800, 5000)).toBe(0);
  });

  it("Back from Work Orders focuses WO list — never obsolete Create WO via salesOrderId", () => {
    const back = resolveProductionRegularBack({
      fromParam: "work-orders",
      sourceParam: "",
      salesOrderId: 10,
      workOrderId: 42,
    });
    expect(back.label).toBe("Back to Work Orders");
    expect(back.to).toBe("/work-orders?workOrderId=42");
    expect(back.to).not.toContain("salesOrderId=");
  });

  it("Back from Production Workspace with draft opens Draft Awaiting Approval", () => {
    const back = resolveProductionRegularBack({
      fromParam: "production-workspace",
      sourceParam: "",
      salesOrderId: 10,
      workOrderId: 42,
      hasActiveDraft: true,
    });
    expect(back.label).toBe("Back to Production Workspace");
    expect(back.to).toContain("pwSection=draftPending");
    expect(back.to).toContain("pwFocus=42");
    expect(back.to).not.toContain("workOrderId=");
  });

  it("Pending Actions origin on scoped WO returns to workspace list (not PA, not WO pin)", () => {
    const back = resolveProductionRegularBack({
      fromParam: "pending-actions",
      sourceParam: "",
      returnToParam: "pending-actions",
      salesOrderId: 1,
      workOrderId: 4,
      productionBucket: "readyToStart",
    });
    expect(back.label).toBe("Back to Production Workspace");
    expect(back.to).toContain("/production?");
    expect(back.to).toContain("from=pending-actions");
    expect(back.to).toContain("productionBucket=readyToStart");
    expect(back.to).not.toContain("workOrderId=");
    expect(back.to).not.toBe("/pending-actions");
  });

  it("Pending Actions list (no WO) still returns to Pending Actions", () => {
    expect(
      resolveProductionRegularBack({
        fromParam: "pending-actions",
        sourceParam: "",
        salesOrderId: 1,
      }).to,
    ).toBe("/pending-actions");
  });
});

describe("production workspace Back loop regression", () => {
  it("never auto-opens executable WO from workspace list", () => {
    expect(shouldAutoOpenExecutableFromProductionWorkspaceList()).toBe(false);
  });

  it("canonical nav states distinguish list vs scoped WO entry", () => {
    expect(
      resolveProductionWorkspaceNavState({
        workOrderIdInUrl: 0,
        workOrderLineIdInUrl: 0,
        selectedWorkOrderId: 0,
        selectedWorkOrderLineId: 0,
      }),
    ).toBe("workspace_list");
    expect(
      resolveProductionWorkspaceNavState({
        workOrderIdInUrl: 4,
        workOrderLineIdInUrl: 10,
        selectedWorkOrderId: 0,
        selectedWorkOrderLineId: 0,
      }),
    ).toBe("scoped_wo_entry");
  });

  it("Back list href strips WO deep-link params and keeps highlight-only pwFocus", () => {
    const href = buildProductionWorkspaceListBackHref({
      productionBucket: "readyToStart",
      pwFocus: 4,
      from: "production-workspace",
    });
    expect(href).toBe(
      "/production?productionBucket=readyToStart&pwSection=ready&pwFocus=4&from=production-workspace",
    );
    expect(href).not.toContain("workOrderId=");
    expect(href).not.toContain("workOrderLineId=");
  });

  it("detects A↔B replace oscillation after repeated bounce", () => {
    const list = "/production?productionBucket=readyToStart&from=production-workspace";
    const detail = "/production?workOrderId=4&workOrderLineId=10&flow=REGULAR_SO&from=production-workspace";
    let hist: string[] = [];
    hist = appendProductionNavHistory(hist, list);
    hist = appendProductionNavHistory(hist, detail);
    hist = appendProductionNavHistory(hist, list);
    hist = appendProductionNavHistory(hist, detail);
    expect(detectProductionNavOscillation(hist, list)).toBe(true);
    expect(detectProductionNavOscillation([list, detail], list)).toBe(false);
  });

  it("normalizes pwFocus noise so oscillation compare is stable", () => {
    expect(
      normalizeProductionNavHref("/production?productionBucket=readyToStart&pwFocus=4"),
    ).toBe(normalizeProductionNavHref("/production?productionBucket=readyToStart&pwFocus=9"));
  });

  it("ignores stale async generation after Back", () => {
    expect(isStaleProductionNavigationGeneration(1, 2)).toBe(true);
    expect(isStaleProductionNavigationGeneration(3, 3)).toBe(false);
  });

  it("ProductionPage wires Back clear + no workspace auto-open + shared back button", () => {
    const page = fs.readFileSync(
      path.join(__dirname, "../../src/pages/ProductionPage.tsx"),
      "utf8",
    );
    expect(page).toContain("suppressWorkspaceAutoOpenRef");
    expect(page).toContain("navigateBackToProductionWorkspaceList");
    expect(page).toContain("shouldAutoOpenExecutableFromProductionWorkspaceList");
    expect(page).toContain('data-testid="production-back-to-workspace"');
    expect(page).toContain("ERPBackNavigation");
    expect(page).not.toMatch(/← \{productionRegularBackNav\.label\}/);
    expect(page).toContain("runStartEntryBlocked");
    expect(page).toContain("onEntryGateChange={onRunStartEntryGateChange}");
    expect(page).toContain("shouldHideEnterProductionCtaInEntryWorkspace");
  });

  it("entry controls stay blocked until a confirmed run is selected", () => {
    expect(
      isProductionEntryBlockedByRunStartGate({
        mode: "MACHINE_RUN_PLANNING",
        confirmedRunCount: 0,
      }),
    ).toBe(true);
    expect(
      isProductionEntryBlockedByRunStartGate({
        mode: "MACHINE_RUN_PLANNING",
        confirmedRunCount: 1,
      }),
    ).toBe(false);
    expect(
      isProductionEntryBlockedByRunStartGate({
        mode: "MACHINE_RUN_PLANNING",
        confirmedRunCount: 1,
        selectedRunAllocationId: null,
      }),
    ).toBe(true);
    expect(
      isProductionEntryBlockedByRunStartGate({
        mode: "MACHINE_RUN_PLANNING",
        confirmedRunCount: 2,
        selectedRunAllocationId: 55,
      }),
    ).toBe(false);
    expect(
      isProductionEntryBlockedByRunStartGate({
        mode: "LEGACY",
        confirmedRunCount: 0,
      }),
    ).toBe(false);
    expect(
      isProductionEntryBlockedByRunStartGate({
        mode: "MACHINE_RUN_PLANNING",
        confirmedRunCount: 0,
        loading: true,
      }),
    ).toBe(true);
  });

  it("suppresses Record/Continue production strip on scoped WO entry", () => {
    expect(
      shouldSuppressRecordProductionPrimaryStrip({
        alreadyInScopedEntry: true,
      }),
    ).toBe(true);
    expect(
      shouldSuppressRecordProductionPrimaryStrip({
        alreadyInScopedEntry: false,
        runStartEntryBlocked: true,
      }),
    ).toBe(true);
    expect(
      shouldSuppressRecordProductionPrimaryStrip({
        alreadyInScopedEntry: false,
        runStartEntryBlocked: false,
      }),
    ).toBe(false);
  });

  it("hides Enter Production CTA when already inside scoped entry / start gate", () => {
    expect(
      shouldHideEnterProductionCtaInEntryWorkspace({
        alreadyInScopedEntry: true,
      }),
    ).toBe(true);
    expect(
      shouldHideEnterProductionCtaInEntryWorkspace({
        alreadyInScopedEntry: false,
        runStartEntryBlocked: true,
      }),
    ).toBe(true);
    expect(
      shouldHideEnterProductionCtaInEntryWorkspace({
        alreadyInScopedEntry: false,
        runStartEntryBlocked: false,
      }),
    ).toBe(false);
  });

  it("WO entry screen: no Record production strip, locked form contracts", () => {
    const page = fs.readFileSync(
      path.join(__dirname, "../../src/pages/ProductionPage.tsx"),
      "utf8",
    );
    const entry = fs.readFileSync(
      path.join(__dirname, "../../src/components/erp/production/ProductionOperatorEntryShell.tsx"),
      "utf8",
    );
    expect(page).toContain("shouldSuppressRecordProductionPrimaryStrip");
    expect(page).toContain("runStartConfirmLocked={runStartEntryBlocked}");
    expect(page).toContain("runAllocationId: selectedRunAllocationId");
    // Header Continue production link removed from scoped WO entry chrome.
    expect(page).not.toMatch(/>\s*Continue production\s*</);
    expect(entry).toContain('data-testid="production-date-input"');
    expect(entry).toContain('data-testid="production-entry-await-run-confirm"');
    expect(entry).toContain("PRODUCTION_ENTRY_AWAIT_RUN_CONFIRM_MESSAGE");
    expect(PRODUCTION_ENTRY_AWAIT_RUN_CONFIRM_MESSAGE).toBe(
      "Confirm a machine run before recording production.",
    );
    expect(entry).toContain("runStartConfirmLocked");
    expect(entry).toContain("disabled={fieldsDisabled}");
    expect(entry).toContain("readOnly={fieldsDisabled}");
    // No spacer-only wrapper around the lock message.
    expect(entry).not.toMatch(/mb-4[\s\S]*production-entry-await-run-confirm/);
  });
});
