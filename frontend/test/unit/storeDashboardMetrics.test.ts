import { describe, expect, it } from "vitest";
import type { NoQtyPlannerInboxRow } from "../../src/hooks/useNoQtyPlannerInbox";
import {
  computeNoQtyExecutionSummaryMetrics,
  computeStoreDashboardKpiMetrics,
  computeStoreProcurementMonitorMetrics,
  computeStoreRmccSummaryMetrics,
  countBlockedProcurementCases,
} from "../../src/lib/storeDashboardMetrics";
import { sampleWorkspace } from "./storeProcurementPulse.test";

function inboxRow(overrides: Partial<NoQtyPlannerInboxRow> = {}): NoQtyPlannerInboxRow {
  return {
    so: { salesOrderId: 1, docNo: "SO-26-0001", customerName: "Acme" },
    rsStatus: "LOCKED",
    lockedPeriodKey: "2026-05",
    flowState: null,
    guidedCycleId: 1,
    cycleNo: 1,
    executionRegisterEnabled: true,
    actionNeededKey: null,
    rsBalanceQty: null,
    ...overrides,
  };
}

describe("computeNoQtyExecutionSummaryMetrics", () => {
  it("counts execution register buckets from actionNeededKey", () => {
    const metrics = computeNoQtyExecutionSummaryMetrics([
      inboxRow({ actionNeededKey: "PLACE_WO", rsBalanceQty: 7000 }),
      inboxRow({ actionNeededKey: "ISSUE_RM", so: { salesOrderId: 2, docNo: "SO-26-0002", customerName: "Beta" } }),
      inboxRow({
        actionNeededKey: "MONITOR_WO",
        so: { salesOrderId: 3, docNo: "SO-26-0003", customerName: "Gamma" },
      }),
      inboxRow({
        actionNeededKey: "AWAIT_PROCUREMENT",
        so: { salesOrderId: 4, docNo: "SO-26-0004", customerName: "Delta" },
      }),
      inboxRow({ executionRegisterEnabled: false, actionNeededKey: "PLACE_WO", rsBalanceQty: 100 }),
    ]);

    expect(metrics).toEqual({
      readyForWo: 1,
      openWos: 2,
      awaitProcurement: 1,
      rsBalancePending: 1,
    });
  });
});

describe("computeStoreRmccSummaryMetrics", () => {
  it("maps workspace summary queue and issue-ready counts", () => {
    expect(
      computeStoreRmccSummaryMetrics({
        queueCount: 5,
        readyIssueCount: 2,
      }),
    ).toEqual({
      openCases: 5,
      issueReadyWos: 2,
    });
  });
});

describe("computeStoreProcurementMonitorMetrics", () => {
  it("combines inbox await with procurement workspace pipeline counts", () => {
    const ws = sampleWorkspace();
    const metrics = computeStoreProcurementMonitorMetrics(ws, [
      inboxRow({ actionNeededKey: "AWAIT_PROCUREMENT" }),
      inboxRow({ actionNeededKey: "BLOCKED", so: { salesOrderId: 9, docNo: "SO-26-0009", customerName: "Z" } }),
    ]);

    expect(metrics.grnPending).toBe(3);
    expect(metrics.awaitProcurement).toBeGreaterThanOrEqual(2);
    expect(metrics.blockedProcurementCases).toBeGreaterThanOrEqual(1);
  });
});

describe("countBlockedProcurementCases", () => {
  it("counts blocked operational keys in workspace MRs", () => {
    const blocked = countBlockedProcurementCases({
      summary: { pendingMrCount: 0, purchaseRequestCount: 0, grnPendingLineCount: 0 },
      sections: {
        pendingMaterialRequirements: [
          {
            materialRequirementId: 1,
            docNo: "MR-1",
            operationalKey: "BLOCKED",
            nextActionKey: "TRACK",
            totalRemainingQty: 10,
          },
        ],
      },
    });
    expect(blocked).toBe(1);
  });
});

describe("computeStoreDashboardKpiMetrics", () => {
  it("assembles execution-first KPI strip metrics", () => {
    const kpis = computeStoreDashboardKpiMetrics({
      inboxRows: [inboxRow({ actionNeededKey: "PLACE_WO" })],
      materialIssuePendingCount: 3,
      rmccSummary: { queueCount: 4, readyIssueCount: 2 },
      procurementWorkspace: sampleWorkspace(),
    });

    expect(kpis.readyForWo).toBe(1);
    expect(kpis.materialIssuePending).toBe(3);
    expect(kpis.rmccCases).toBe(4);
    expect(kpis.awaitProcurement).toBeGreaterThanOrEqual(1);
  });
});
