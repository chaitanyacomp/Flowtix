import { describe, expect, it } from "vitest";
import {
  buildContinueWoPreparationHref,
  buildCreateWorkOrderHref,
  buildRmPoDetailHref,
  buildViewRmStockHref,
  buildViewWorkOrderHref,
  postGrnFulfilledMessage,
  resolvePoLinkedSalesOrderId,
  resolvePostGrnNextStep,
  type PostGrnContinuitySnapshot,
} from "../../src/lib/rmPurchaseWoContinuity";
import type { RmPoRow } from "../../src/pages/rmPurchase/rmPurchaseShared";

function snap(partial: Partial<PostGrnContinuitySnapshot> & { salesOrderId: number }): PostGrnContinuitySnapshot {
  return {
    salesOrderId: partial.salesOrderId,
    salesOrderDocNo: partial.salesOrderDocNo ?? "SO-26-0004",
    orderType: partial.orderType ?? "NORMAL",
    processStageKey: partial.processStageKey ?? "WO_PENDING",
    workOrderId: partial.workOrderId ?? null,
    workOrderNo: partial.workOrderNo ?? null,
    workOrderLineId: partial.workOrderLineId ?? null,
    allocationFirstKey: partial.allocationFirstKey ?? null,
    hasProductionEntry: partial.hasProductionEntry ?? false,
    rmReadiness: partial.rmReadiness ?? null,
  };
}

describe("rmPurchaseWoContinuity", () => {
  it("builds WO preparation deep-link with sales order context", () => {
    expect(buildContinueWoPreparationHref(42)).toBe("/work-orders?salesOrderId=42&from=rm-purchase");
    expect(buildCreateWorkOrderHref(42)).toBe("/work-orders/prepare?salesOrderId=42");
    expect(buildViewWorkOrderHref(42, 101)).toContain("salesOrderId=42");
    expect(buildViewWorkOrderHref(42, 101)).toContain("workOrderId=101");
    expect(buildViewRmStockHref()).toBe("/stock");
  });

  it("builds RM PO detail href with sales order context", () => {
    expect(buildRmPoDetailHref(9, { salesOrderId: 42, from: "rm-purchase" })).toBe(
      "/rm-po-grn/9?salesOrderId=42&from=rm-purchase",
    );
  });

  it("uses fulfilled post-GRN copy", () => {
    expect(postGrnFulfilledMessage()).toContain("Goods receipt posted.");
    expect(postGrnFulfilledMessage()).toContain("RM requirement for this sales order has been fulfilled.");
  });

  it("resolves linked sales order id from procurement traceability", () => {
    const po = {
      id: 1,
      supplierId: 1,
      supplier: { id: 1, name: "S" },
      status: "COMPLETED",
      lines: [
        {
          id: 10,
          itemId: 1,
          qty: "1",
          item: { id: 1, itemName: "RM", itemCode: "RM1", itemType: "RM" },
          procurementLinks: [
            {
              materialRequirementLine: {
                materialRequirement: { salesOrderId: 404 },
              },
            },
          ],
        },
      ],
      grns: [],
    } as unknown as RmPoRow;
    expect(resolvePoLinkedSalesOrderId(po)).toBe(404);
  });

  it("Case A: GRN completed, no WO — Create Work Order + View RM Stock only", () => {
    const step = resolvePostGrnNextStep(snap({ salesOrderId: 4, processStageKey: "WO_PENDING" }));
    expect(step.stageKey).toBe("CREATE_WO");
    expect(step.actionLabel).toBe("Create Work Order");
    expect(step.actionHref).toContain("/work-orders/prepare");
    expect(step.secondaryLabel).toBe("View RM Stock");
    expect(step.secondaryHref).toBe("/stock");
    expect(step.actionHref).not.toContain("/production");
  });

  it("Case B: WO exists, RM not issued — Issue RM to Production", () => {
    const step = resolvePostGrnNextStep(
      snap({
        salesOrderId: 4,
        processStageKey: "PRODUCTION_PENDING",
        workOrderId: 101,
        workOrderLineId: 7,
        allocationFirstKey: "READY_FOR_ISSUE",
      }),
      { materialIssueReturnTo: "/rm-po-grn/9?salesOrderId=4" },
    );
    expect(step.stageKey).toBe("MATERIAL_ISSUE");
    expect(step.actionLabel).toBe("Issue RM to Production");
    expect(step.actionHref).toContain("workOrderId=101");
    expect(step.secondaryLabel).toBe("View Work Order");
    expect(step.actionHref).not.toContain("/production?salesOrderId");
  });

  it("Case C: RM issued, no production — Start Production", () => {
    const step = resolvePostGrnNextStep(
      snap({
        salesOrderId: 4,
        processStageKey: "PRODUCTION_PENDING",
        workOrderId: 101,
        workOrderLineId: 7,
        allocationFirstKey: "READY_FOR_PRODUCTION",
        hasProductionEntry: false,
      }),
    );
    expect(step.stageKey).toBe("START_PRODUCTION");
    expect(step.actionLabel).toBe("Start Production");
    expect(step.actionHref).toContain("/production");
    expect(step.actionHref).toContain("woId=101");
    expect(step.secondaryLabel).toBe("View Work Order");
  });

  it("Case D: production started — Continue Production", () => {
    const step = resolvePostGrnNextStep(
      snap({
        salesOrderId: 4,
        processStageKey: "PRODUCTION_PENDING",
        workOrderId: 101,
        allocationFirstKey: "READY_FOR_PRODUCTION",
        hasProductionEntry: true,
      }),
    );
    expect(step.stageKey).toBe("CONTINUE_PRODUCTION");
    expect(step.actionLabel).toBe("Continue Production");
    expect(step.actionHref).toContain("/production");
  });

  it("routes post-GRN next step to QC when process stage is QC pending", () => {
    const step = resolvePostGrnNextStep(snap({ salesOrderId: 4, processStageKey: "QC_PENDING", workOrderId: 101 }));
    expect(step.actionLabel).toBe("Continue To QC");
    expect(step.actionHref).toContain("qc-entry");
  });

  it("routes completed sales orders to view completed order", () => {
    const step = resolvePostGrnNextStep(snap({ salesOrderId: 4, processStageKey: "COMPLETED" }));
    expect(step.isWorkflowComplete).toBe(true);
    expect(step.actionLabel).toBe("View Completed Order");
  });

  it("never suggests GRN → Production when WO does not exist", () => {
    const step = resolvePostGrnNextStep(
      snap({ salesOrderId: 4, processStageKey: "WO_PENDING", allocationFirstKey: "RM_RECEIVED" }),
    );
    expect(step.actionLabel).toBe("Create Work Order");
    expect(step.actionHref).not.toMatch(/\/production/);
  });
});
