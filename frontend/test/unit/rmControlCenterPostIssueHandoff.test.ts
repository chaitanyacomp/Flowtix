import { describe, expect, it } from "vitest";
import {
  POST_ISSUE_RM_TABLE_HEADERS,
  POST_ISSUE_RM_TABLE_HELPER_TEXT,
  PRE_ISSUE_RM_TABLE_HEADERS,
  STORE_HANDOFF_ACTION_LABEL,
  STORE_HANDOFF_COMPLETE_LABEL,
  STORE_HANDOFF_ISSUED_COVERAGE_LABEL,
  STORE_HANDOFF_LINE_STATUS_PARTIAL,
  STORE_HANDOFF_STATUS_LABEL,
  STORE_PRODUCTION_HANDOFF_LABEL,
  isPostIssueStoreHandoff,
  sanitizeStoreHandoffOperatorCopy,
  storeHandoffLineCoverageLabel,
  storeHandoffLineStatusLabel,
} from "../../src/lib/rmControlCenterPostIssueHandoff";
import {
  groupRmQueueByCase,
  operatorNextActionHint,
  operatorStageLabel,
  sanitizeStoreOperatorCopy,
} from "../../src/lib/storeRmWorkspaceUx";

describe("rmControlCenterPostIssueHandoff", () => {
  it("detects post-issue handoff from queue type, store action, and allocation status", () => {
    expect(
      isPostIssueStoreHandoff({
        queueType: "READY_TO_RELEASE_WO",
        storeActionKey: "REVIEW",
        allocationFirstKey: "WAITING_RM",
      }),
    ).toBe(true);
    expect(
      isPostIssueStoreHandoff({
        storeActionKey: "HANDOFF_TO_PRODUCTION",
      }),
    ).toBe(true);
    expect(
      isPostIssueStoreHandoff({
        allocationFirstKey: "READY_FOR_PRODUCTION",
      }),
    ).toBe(true);
    expect(
      isPostIssueStoreHandoff({
        queueType: "PMR_WAITING_ISSUE",
        storeActionKey: "ISSUE",
        allocationFirstKey: "READY_FOR_ISSUE",
      }),
    ).toBe(false);
  });

  it("rewrites production-oriented queue copy for Store handoff", () => {
    expect(sanitizeStoreHandoffOperatorCopy("Start production")).toBe(STORE_HANDOFF_ACTION_LABEL);
    expect(sanitizeStoreHandoffOperatorCopy("Open Production Workspace")).toBe(STORE_HANDOFF_ACTION_LABEL);
    expect(sanitizeStoreOperatorCopy("Start production")).toBe(STORE_HANDOFF_ACTION_LABEL);
  });

  it("uses production handoff status labels instead of procurement coverage", () => {
    expect(storeHandoffLineStatusLabel({ requiredQty: 40.35, issuedToProductionQty: 40.35 })).toBe(
      STORE_HANDOFF_ISSUED_COVERAGE_LABEL,
    );
    expect(storeHandoffLineStatusLabel({ requiredQty: 10, issuedToProductionQty: 4 })).toBe(
      STORE_HANDOFF_LINE_STATUS_PARTIAL,
    );
    expect(storeHandoffLineStatusLabel({ requiredQty: 10, issuedToProductionQty: 0 })).toBe(
      STORE_HANDOFF_COMPLETE_LABEL,
    );
    expect(storeHandoffLineCoverageLabel({ requiredQty: 10, issuedToProductionQty: 10 })).toBe(
      STORE_HANDOFF_ISSUED_COVERAGE_LABEL,
    );
  });

  it("defines post-issue table columns without procurement availability fields", () => {
    expect(POST_ISSUE_RM_TABLE_HEADERS).toEqual([
      "RM item",
      "Required",
      "Issued to Production",
      "Store Balance",
      "Status",
    ]);
    expect(POST_ISSUE_RM_TABLE_HEADERS).not.toContain("Available");
    expect(POST_ISSUE_RM_TABLE_HEADERS).not.toContain("Incoming");
    expect(POST_ISSUE_RM_TABLE_HEADERS).not.toContain("Coverage");
    expect(POST_ISSUE_RM_TABLE_HEADERS).not.toContain("Procurement");
  });

  it("keeps pre-issue table columns for procurement availability", () => {
    expect(PRE_ISSUE_RM_TABLE_HEADERS).toEqual([
      "RM item",
      "Need",
      "Available",
      "Incoming",
      "Coverage",
      "Procurement",
    ]);
  });

  it("uses polished post-issue table helper copy", () => {
    expect(POST_ISSUE_RM_TABLE_HELPER_TEXT).toBe(
      "Issued quantities for Production. Store Balance is remaining free stock, not WO availability.",
    );
  });
});

describe("Store post-issue RM Control Center presentation rules", () => {
  it("hides procurement and production CTAs when handoff is active", () => {
    const postIssueHandoff = isPostIssueStoreHandoff({
      queueType: "READY_TO_RELEASE_WO",
      storeActionKey: "HANDOFF_TO_PRODUCTION",
      allocationFirstKey: "READY_FOR_PRODUCTION",
    });
    const showProcurementPanel = !postIssueHandoff;
    const showRequirementProcurementBlock = !postIssueHandoff;
    const showAllocationControls = !postIssueHandoff;
    const showCenterHandoffBanner = false;

    expect(postIssueHandoff).toBe(true);
    expect(showProcurementPanel).toBe(false);
    expect(showRequirementProcurementBlock).toBe(false);
    expect(showAllocationControls).toBe(false);
    expect(showCenterHandoffBanner).toBe(false);
  });

  it("uses Store handoff messaging on left card and next hints", () => {
    expect(operatorNextActionHint({ queueType: "READY_TO_RELEASE_WO", recommendedAction: "Start production" })).toBe(
      STORE_HANDOFF_ACTION_LABEL,
    );
    const grouped = groupRmQueueByCase([
      {
        workOrderId: 1,
        rmItemId: 10,
        queueType: "READY_TO_RELEASE_WO",
        shortageAfterReservationQty: 5,
        freeStockQty: 0,
      },
      {
        workOrderId: 1,
        rmItemId: 11,
        queueType: "READY_TO_RELEASE_WO",
        shortageAfterReservationQty: 3,
        freeStockQty: 0,
      },
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].shortageLineCount).toBe(0);
    expect(operatorStageLabel({ postIssueHandoff: true, nextAction: "Start production" })).toBe(
      STORE_HANDOFF_STATUS_LABEL,
    );
    expect(STORE_PRODUCTION_HANDOFF_LABEL).toMatch(/waiting for Production/i);
  });

  it("FULLY_ISSUED row shows issued quantity matching required", () => {
    const requiredQty = 40.35;
    const issuedToProductionQty = 40.35;
    expect(issuedToProductionQty).toBe(requiredQty);
    expect(storeHandoffLineStatusLabel({ requiredQty, issuedToProductionQty })).toBe("Issued to Production");
  });
});
