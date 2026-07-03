import { describe, expect, it } from "vitest";

import {
  noQtyDashboardRowHasRs,
  noQtyDashboardRowToPresentation,
  noQtyDashboardStageLabel,
  resolveNoQtyDashboardActionLabel,
} from "../../src/lib/noQtyDashboardPresentation";
import { NO_QTY_RS_STORE_HANDOFF_LABEL } from "../../src/lib/noQtyRsActionLabels";
import type { ResolvedNoQtyContinuation } from "../../src/lib/noQtyDashboardContinuation";

describe("noQtyDashboardPresentation", () => {
  it("detects absence of RS for new SO rows", () => {
    expect(noQtyDashboardRowHasRs({ lastRsStatus: null, latestRequirementSheetId: null })).toBe(false);
    expect(noQtyDashboardRowHasRs({ lastRsStatus: "DRAFT", latestRequirementSheetId: 5 })).toBe(true);
  });

  it("shows RS Pending stage when no RS exists", () => {
    expect(
      noQtyDashboardStageLabel({ lastRsStatus: null, noQtyPlanningPointerAhead: false, hasRs: false }),
    ).toBe("RS Pending");
  });

  it("never labels Create Cycle 2 when navigating to first RS", () => {
    const resolved: ResolvedNoQtyContinuation = {
      kind: "navigate",
      label: "Create RS",
      to: "/sales-orders/1/requirement-sheets?intent=add",
    };
    expect(
      resolveNoQtyDashboardActionLabel({
        resolved,
        currentCycleNo: 1,
        lastRsStatus: null,
        hasRs: false,
      }),
    ).toBe("Create Cycle 1 Requirement Sheet");
  });

  it("labels prepare_next_rs with next cycle number only when eligible path fires", () => {
    const resolved: ResolvedNoQtyContinuation = { kind: "prepare_next_rs", label: "Next RS" };
    expect(
      resolveNoQtyDashboardActionLabel({
        resolved,
        currentCycleNo: 1,
        lastRsStatus: "LOCKED",
        hasRs: true,
      }),
    ).toBe("Create Cycle 2 Requirement Sheet");
  });

  it("labels draft RS with open draft CTA", () => {
    const resolved: ResolvedNoQtyContinuation = {
      kind: "navigate",
      label: "Next RS",
      to: "/sales-orders/1/requirement-sheets?sheetId=42",
    };
    expect(
      resolveNoQtyDashboardActionLabel({
        resolved,
        currentCycleNo: 1,
        lastRsStatus: "DRAFT",
        hasRs: true,
      }),
    ).toBe("Open Draft RS (Cycle 1)");
  });

  it("shows Store handoff label for ADMIN on prepare_next_rs rows", () => {
    const pres = noQtyDashboardRowToPresentation({
      row: {
        salesOrderId: 1,
        salesOrderDocNo: "SO-26-0001",
        customerName: "Acme",
        cycleNo: 1,
        lastRsStatus: "LOCKED",
      },
      flow: { createNextRsEligible: true } as never,
      viewerRole: "ADMIN",
      commercialContinuation: true,
    });
    expect(pres.actionLabel).toBe(NO_QTY_RS_STORE_HANDOFF_LABEL);
  });

  it("keeps Create Cycle CTA for STORE on prepare_next_rs rows", () => {
    const pres = noQtyDashboardRowToPresentation({
      row: {
        salesOrderId: 1,
        salesOrderDocNo: "SO-26-0001",
        customerName: "Acme",
        cycleNo: 1,
        lastRsStatus: "LOCKED",
      },
      flow: { createNextRsEligible: true } as never,
      viewerRole: "STORE",
      commercialContinuation: true,
    });
    expect(pres.actionLabel).toBe("Create Cycle 2 Requirement Sheet");
  });
});
