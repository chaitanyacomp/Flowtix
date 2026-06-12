import { describe, expect, it } from "vitest";
import {
  demandPoolKeyForSourceType,
  demandPoolLabelForSourceType,
  demandPoolLabelFromRemarks,
  formatProcurementDemandSourceLabel,
  formatProcurementExecutionWoLabel,
  LEGACY_HISTORICAL_DEMAND_LABEL,
  poTraceChainSummary,
  resolveConnectivityDemandSourceLabel,
} from "../../src/lib/procurementTraceTerminology";
import { buildProcurementWorkspaceHref } from "../../src/lib/woProcurementContinuity";

describe("procurementTraceTerminology", () => {
  it("maps source types to procurement source keys and labels", () => {
    expect(demandPoolKeyForSourceType("SALES_ORDER")).toBe("REGULAR_SO");
    expect(demandPoolLabelForSourceType("MONTHLY_PLAN")).toBe("Monthly Planning");
    expect(demandPoolLabelForSourceType("WORK_ORDER_PLANNING")).toBe(LEGACY_HISTORICAL_DEMAND_LABEL);
  });

  it("formatProcurementDemandSourceLabel prefers document references", () => {
    expect(
      formatProcurementDemandSourceLabel({
        sourceType: "SALES_ORDER",
        salesOrderDocNo: "SO-26-0001",
      }),
    ).toBe("SO-26-0001");
    expect(
      formatProcurementDemandSourceLabel({
        sourceType: "MONTHLY_PLAN",
        monthlyPlanLabel: "Monthly Plan Jun 2026",
      }),
    ).toBe("Monthly Plan Jun 2026");
    expect(
      formatProcurementDemandSourceLabel({
        sourceType: "WORK_ORDER_PLANNING",
      }),
    ).toBe(LEGACY_HISTORICAL_DEMAND_LABEL);
  });

  it("formatProcurementExecutionWoLabel returns WO reference only", () => {
    expect(formatProcurementExecutionWoLabel({ workOrderDocNo: "WO-26-0003" })).toBe("WO-26-0003");
  });

  it("parses procurement source suffix from PR remarks", () => {
    expect(demandPoolLabelFromRemarks("Purchase request for MR-26-0001 · MPRS")).toBe("Monthly Planning");
  });

  it("resolveConnectivityDemandSourceLabel replaces unknown demand labels", () => {
    expect(
      resolveConnectivityDemandSourceLabel({
        demandSourceLabel: "Unknown demand",
        demandSourceType: "MONTHLY_PLAN",
        monthlyPlan: { label: "Monthly Plan Jun 2026" },
        mr: { docNo: "MR-26-0001" },
      }),
    ).toBe("Monthly Plan Jun 2026");
  });

  it("poTraceChainSummary describes business procurement chains", () => {
    expect(poTraceChainSummary("SALES_ORDER")).toBe("PO → MR → Sales Order");
    expect(poTraceChainSummary("MONTHLY_PLAN")).toBe("PO → MR → Monthly Planning");
  });
});

describe("buildProcurementWorkspaceHref deep links", () => {
  it("opens REGULAR_SO pool from SO / RM Control Center context", () => {
    expect(buildProcurementWorkspaceHref({ salesOrderId: 12, returnTo: "rm-control-center" })).toBe(
      "/procurement-planning?demandPool=REGULAR_SO&salesOrderId=12&returnTo=rm-control-center",
    );
  });

  it("opens MPRS pool from monthly planning source type", () => {
    expect(buildProcurementWorkspaceHref({ sourceType: "MONTHLY_PLAN" })).toBe(
      "/procurement-planning?demandPool=MPRS",
    );
  });

  it("opens STOCK_REPLENISHMENT pool when explicitly requested", () => {
    expect(buildProcurementWorkspaceHref({ demandPool: "STOCK_REPLENISHMENT" })).toBe(
      "/procurement-planning?demandPool=STOCK_REPLENISHMENT",
    );
  });
});
