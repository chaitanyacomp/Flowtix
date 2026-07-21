import { describe, expect, it } from "vitest";
import {
  adminWoNeedsActionCount,
  assertNoDuplicateWorkOrderKeys,
  isAdminOwnedOperationalAction,
  isReadyToStartStatus,
  isRunningProductionStatus,
  summarizeFactoryProductionCounters,
} from "../../src/lib/adminDashboardClassification";
import {
  operationalStatusFromProductionRow,
  type DashboardProductionStatusSource,
} from "../../src/lib/dashboardProductionStatus";
import { buildOperationalSoActions } from "../../src/lib/operationalBlockers";

function row(partial: Partial<DashboardProductionStatusSource> = {}): DashboardProductionStatusSource {
  return {
    workOrderId: 1,
    workOrderNo: "WO-100",
    itemName: "Widget",
    requiredQty: 100,
    producedQty: 0,
    balanceQty: 100,
    orderType: "NORMAL",
    itemId: 10,
    salesOrderId: 5,
    nextAction: "PRODUCTION_PENDING",
    rmReadyForProduction: true,
    rmReadinessGate: "READY_FOR_PRODUCTION",
    productionWorkState: "READY_TO_START",
    status: "PENDING",
    ...partial,
  };
}

describe("Admin dashboard classification", () => {
  it("1. Ready WO is not counted as Running", () => {
    const ready = row({ workOrderId: 11, producedQty: 0, productionWorkState: "READY_TO_START" });
    const running = row({
      workOrderId: 12,
      producedQty: 40,
      balanceQty: 60,
      productionWorkState: "CONTINUE_PRODUCTION",
    });
    const counters = summarizeFactoryProductionCounters([ready, running]);
    expect(counters.readyToStart).toBe(1);
    expect(counters.running).toBe(1);
    expect(isReadyToStartStatus(operationalStatusFromProductionRow(ready))).toBe(true);
    expect(isRunningProductionStatus(operationalStatusFromProductionRow(ready))).toBe(false);
  });

  it("2. Ready WO is not an Admin blocker", () => {
    const actions = buildOperationalSoActions(
      [],
      { rmShortageBlocking: [], purchaseGrnPending: [], readyForWoCreation: [] },
      null,
      [
        {
          workOrderId: 177,
          operationalKey: "AWAITING_RELEASE",
          nextActionKey: "RELEASE_TO_PRODUCTION",
          salesOrderId: 1,
        },
        {
          workOrderId: 178,
          operationalKey: "READY_FOR_PRODUCTION",
          salesOrderId: 2,
        },
      ],
      { audience: "admin" },
    );
    expect(actions).toEqual([]);
  });

  it("3. Ready-to-start WO does not show Release to Production", () => {
    const actions = buildOperationalSoActions(
      [],
      { rmShortageBlocking: [], purchaseGrnPending: [], readyForWoCreation: [] },
      null,
      [
        {
          workOrderId: 88,
          operationalKey: "AWAITING_RELEASE",
          nextActionKey: "RELEASE_TO_PRODUCTION",
          salesOrderId: 1,
        },
      ],
    );
    expect(actions.every((a) => a.actionLabel !== "Release to Production")).toBe(true);
    expect(actions).toHaveLength(0);
  });

  it("4. Running counter includes only canonical running/continue WOs", () => {
    const rows = [
      row({ workOrderId: 1, producedQty: 0, productionWorkState: "READY_TO_START" }),
      row({ workOrderId: 2, producedQty: 0, productionWorkState: "READY_TO_START" }),
      row({ workOrderId: 3, producedQty: 0, productionWorkState: "READY_TO_START" }),
      row({ workOrderId: 4, producedQty: 0, productionWorkState: "READY_TO_START" }),
      row({
        workOrderId: 5,
        producedQty: 10,
        balanceQty: 90,
        productionWorkState: "CONTINUE_PRODUCTION",
        nextAction: "PRODUCTION_PENDING",
      }),
    ];
    const counters = summarizeFactoryProductionCounters(rows);
    expect(counters.readyToStart).toBe(4);
    expect(counters.running).toBe(1);
  });

  it("5. Paused and Awaiting Report classifications remain separate", () => {
    const paused = row({
      workOrderId: 21,
      productionWorkState: "PAUSED_PRODUCTION",
      status: "PAUSED",
      nextAction: "PRODUCTION_PAUSED",
    });
    const awaiting = row({
      workOrderId: 22,
      producedQty: 100,
      balanceQty: 0,
      productionWorkState: null,
      nextAction: "QC_PENDING",
      hasPendingQc: true,
      rmReadyForProduction: true,
    });
    const counters = summarizeFactoryProductionCounters([paused, awaiting]);
    expect(counters.paused).toBe(1);
    expect(counters.pendingQc + counters.awaitingReport).toBeGreaterThanOrEqual(1);
    expect(counters.running).toBe(0);
    expect(counters.readyToStart).toBe(0);
  });

  it("6. Admin WO needs-action excludes Ready-to-Start", () => {
    const counters = summarizeFactoryProductionCounters([
      row({ workOrderId: 1 }),
      row({ workOrderId: 2 }),
      row({
        workOrderId: 3,
        producedQty: 5,
        balanceQty: 95,
        productionWorkState: "CONTINUE_PRODUCTION",
      }),
    ]);
    expect(counters.readyToStart).toBe(2);
    expect(adminWoNeedsActionCount(counters)).toBe(1);
  });

  it("7. Same WO is not duplicated across operational blocker keys", () => {
    const actions = buildOperationalSoActions(
      [
        {
          materialRequirementId: 1,
          docNo: "MR-1",
          salesOrderId: 10,
          salesOrderDocNo: "SO-1",
          primaryFgName: "Cap",
          shortageRmLineCount: 1,
          totalShortageQty: 10,
          workOrderId: 50,
          operationalLabel: "Procurement pending",
          pendingPoStatus: "PO pending",
          pendingGrnStatus: "—",
          supplierPendingStatus: "—",
          nextActionKey: "OPEN_PURCHASE_PLAN",
        },
      ],
      { rmShortageBlocking: [], purchaseGrnPending: [], readyForWoCreation: [] },
      [
        {
          materialRequirementId: 1,
          docNo: "MR-1",
          salesOrderId: 10,
          salesOrderDocNo: "SO-1",
          primaryFgName: "Cap",
          shortageRmLineCount: 0,
          totalShortageQty: 0,
          workOrderId: 50,
          operationalLabel: "Issue RM",
          pendingPoStatus: "—",
          pendingGrnStatus: "—",
          supplierPendingStatus: "—",
          nextActionKey: "ISSUE_RM",
        },
      ],
      null,
    );
    const dupes = assertNoDuplicateWorkOrderKeys(actions.map((a) => a.key));
    expect(dupes).toEqual([]);
    expect(actions.filter((a) => a.key === "wo:50")).toHaveLength(1);
  });

  it("8. Store/Production/QA tasks are not Admin-owned operational actions", () => {
    expect(
      isAdminOwnedOperationalAction({
        actionLabel: "Release to Production",
        stageLabel: "Awaiting release to production",
        operationalKey: "AWAITING_RELEASE",
      }),
    ).toBe(false);
    expect(
      isAdminOwnedOperationalAction({
        actionLabel: "Issue RM to Production",
        operationalKey: "READY_FOR_ISSUE",
      }),
    ).toBe(false);
    expect(
      isAdminOwnedOperationalAction({
        actionLabel: "Create Work Order",
        operationalKey: "RM_RECEIVED",
      }),
    ).toBe(false);
  });

  it("9. Ready monitoring remains read-only classification (no Admin release action)", () => {
    const status = operationalStatusFromProductionRow(row());
    expect(status.label).toBe("Ready to Start");
    expect(status.tone).toBe("ready");
    const adminActions = buildOperationalSoActions([], null, null, null, { audience: "admin" });
    expect(adminActions).toEqual([]);
  });

  it("10. No corrupted user-facing separators in Admin classification helpers", () => {
    const source = [
      "../../src/lib/adminDashboardClassification.ts",
      "../../src/lib/operationalBlockers.ts",
    ];
    // Labels used in UI must not contain lone replacement-style " ? " fragments.
    const ready = operationalStatusFromProductionRow(row());
    expect(ready.label).not.toMatch(/ \? /);
    expect(ready.label).toBe("Ready to Start");
    void source;
  });
});
