import { describe, expect, it } from "vitest";
import type { PendingAction } from "../../src/lib/pendingActionsApi";
import {
  countStoreDashboardActionablePendingActions,
  isStoreDashboardActionablePendingAction,
  isStoreWorkspaceTabActive,
  shouldShowStoreDispatchReadySection,
  shouldShowStoreNoQtyQueueSection,
  shouldShowStorePrepareHeadroomSection,
  shouldShowStoreProcurementSection,
  shouldShowStoreRmccSection,
  storeCreateRsPendingIdentity,
} from "../../src/lib/storeDashboardPresentation";
import { createCycleRequirementSheetButtonLabel, createCycleRsButtonLabel } from "../../src/lib/noQtyRsActionLabels";

function pa(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    priority: "MEDIUM",
    action: "Issue Material",
    documentNo: "MI-1",
    ownerRole: "STORE",
    ageHours: 1,
    href: "/material-issue",
    ...overrides,
  };
}

describe("storeDashboardPresentation tabs", () => {
  it("marks only Production Monitor as active when selected", () => {
    expect(isStoreWorkspaceTabActive("production-monitor", "production-monitor")).toBe(true);
    expect(isStoreWorkspaceTabActive("no-qty", "production-monitor")).toBe(false);
    expect(isStoreWorkspaceTabActive("production-monitor", "overview")).toBe(false);
    expect(isStoreWorkspaceTabActive("dispatch", "overview")).toBe(false);
  });
});

describe("storeDashboardPresentation section gates", () => {
  it("hides zero-count module cards", () => {
    expect(shouldShowStoreRmccSection({ openCases: 0, issueReadyWos: 0 })).toBe(false);
    expect(shouldShowStoreRmccSection({ openCases: 1, issueReadyWos: 0 })).toBe(true);
    expect(
      shouldShowStoreProcurementSection({
        awaitProcurement: 0,
        grnPending: 0,
        blockedProcurementCases: 0,
      }),
    ).toBe(false);
    expect(
      shouldShowStoreProcurementSection({
        awaitProcurement: 0,
        grnPending: 2,
        blockedProcurementCases: 0,
      }),
    ).toBe(true);
    expect(shouldShowStoreDispatchReadySection(0)).toBe(false);
    expect(shouldShowStoreDispatchReadySection(3)).toBe(true);
    expect(shouldShowStorePrepareHeadroomSection(0, 0)).toBe(false);
    expect(shouldShowStorePrepareHeadroomSection(1, 0)).toBe(true);
    expect(shouldShowStoreNoQtyQueueSection(false)).toBe(false);
    expect(shouldShowStoreNoQtyQueueSection(true)).toBe(true);
  });
});

describe("storeDashboardPresentation pending actions", () => {
  it("dedupes Create Cycle N Requirement Sheet by SO/cycle identity", () => {
    const a = pa({
      id: "no-qty-create-next-rs:10:1",
      action: createCycleRequirementSheetButtonLabel(1),
      metadata: { salesOrderId: 10, cycleId: 1, cycleNo: 1 },
      href: "/planning-dashboard?salesOrderId=10",
    });
    const b = pa({
      id: "ct-normalized-create-rs",
      action: createCycleRequirementSheetButtonLabel(1),
      metadata: { salesOrderId: 10, cycleId: 1, cycleNo: 1 },
      href: "/planning-dashboard?salesOrderId=10",
    });
    expect(storeCreateRsPendingIdentity(a)).toBe(storeCreateRsPendingIdentity(b));
    expect(countStoreDashboardActionablePendingActions([a, b, pa()])).toBe(2);
  });

  it("excludes monitoring-only and zero-qty dispatch rows", () => {
    expect(
      isStoreDashboardActionablePendingAction(
        pa({ action: "Monitor WO progress", href: "/production" }),
      ),
    ).toBe(false);
    expect(
      isStoreDashboardActionablePendingAction(
        pa({ action: "Prepare dispatch", qty: 0, href: "/dispatch" }),
      ),
    ).toBe(false);
    expect(isStoreDashboardActionablePendingAction(pa())).toBe(true);
  });
});

describe("Create Cycle wording", () => {
  it("uses Create Cycle N Requirement Sheet consistently", () => {
    expect(createCycleRsButtonLabel(1)).toBe("Create Cycle 1 Requirement Sheet");
    expect(createCycleRequirementSheetButtonLabel(1)).toBe("Create Cycle 1 Requirement Sheet");
  });
});
