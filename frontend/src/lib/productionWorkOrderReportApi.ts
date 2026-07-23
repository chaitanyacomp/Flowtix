import { apiFetch } from "../services/api";

export type ProductionReportBatch = {
  productionEntryId: number;
  productionEntryDocNo: string;
  productionDate: string;
  workOrderLineId: number | null;
  fgItemId: number | null;
  fgItemName: string | null;
  producedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  pendingQcQty: number;
  approvedByName: string | null;
  rmLines: Array<{
    itemId: number;
    itemName: string;
    unit: string;
    standardQty: number;
    actualQty: number;
    varianceQty: number;
    variancePercent: number | null;
    consumptionType: string | null;
    remarks: string | null;
  }>;
};

export type ProductionWorkOrderReport = {
  workOrderId: number;
  workOrderNo: string;
  workOrderStatus: string;
  salesOrderId: number | null;
  salesOrderNo: string | null;
  salesOrderOrderType: string;
  customerName: string | null;
  requirementSheetId: number | null;
  requirementSheetNo: string | null;
  cycleId: number | null;
  cycleNo: number | null;
  fgItemId: number | null;
  fgItemName: string | null;
  fgUnit: string | null;
  isRegular: boolean;
  hasApprovedProduction: boolean;
  execution: {
    status: string | null;
    blockReason: string | null;
    blockRemarks: string | null;
    blockedAt: string | null;
    blockedByName: string | null;
    completedAt: string | null;
    completedByName: string | null;
    startedAt: string | null;
    updatedAt: string | null;
  };
  summary: {
    plannedQty: number;
    producedQty: number;
    remainderQty: number;
    surplusQty: number;
    productionPendingQty: number;
    lines: Array<{
      workOrderLineId: number;
      fgItemId: number;
      fgItemName: string | null;
      plannedQty: number;
      producedQty: number;
      remainderQty: number;
      surplusQty: number;
      productionPendingQty: number;
    }>;
  };
  batches: ProductionReportBatch[];
  rmLines: Array<{
    itemId: number;
    itemName: string;
    unit: string;
    issuedQty: number | null;
    ledgerConsumedQty: number | null;
    returnedQty: number | null;
    returnableQty: number | null;
    unusedQty: number | null;
    availableForContinuationQty: number | null;
    standardQty: number | null;
    reportedConsumedQty: number | null;
    varianceQty: number | null;
    runnerWasteQty: number;
  }>;
  confirmation: {
    confirmed: boolean;
    reportId: number | null;
    status: string | null;
    confirmedAt: string | null;
    confirmedByName: string | null;
    remarks: string | null;
    plannedQty?: number;
    producedQty?: number;
    remainingQty?: number;
    lines: Array<{
      id: number;
      itemId: number;
      itemName: string;
      unit: string;
      rmIssuedQty: number;
      rmConsumedQty: number;
      rmReturnQty: number;
      scrapWasteQty: number;
      varianceQty: number;
      runnerWasteQty?: number;
      remarks: string | null;
    }>;
    returnPendings: Array<{
      id: number;
      workOrderId: number;
      workOrderNo: string | null;
      itemId: number;
      itemName: string;
      unit: string;
      requestedQty: number;
      status: string;
      materialReturnNoteId: number | null;
      materialReturnNoteNo: string | null;
      receivedAt: string | null;
      receivedByName: string | null;
      remarks: string | null;
      createdAt: string;
    }>;
    wastageDetails: Array<{
      id: number;
      wastageTypeId: number;
      itemId: number | null;
      itemName?: string | null;
      wastageTypeName: string | null;
      qty: number;
      remarks: string | null;
      sortOrder: number;
    }>;
  };
  generatedAt: string;
  wastageTypes?: Array<{ id: number; name: string; sortOrder: number; isActive: boolean }>;
  totalWastageQty?: number;
  rmAvailableForContinuation?: number;
};

export function fetchProductionWorkOrderReport(workOrderId: number): Promise<ProductionWorkOrderReport> {
  return apiFetch<ProductionWorkOrderReport>(`/api/production/work-orders/${workOrderId}/production-report`);
}

export type ConfirmProductionWorkOrderReportInput = {
  remarks?: string | null;
  closeWorkOrder?: boolean;
  lines: Array<{
    itemId: number;
    rmConsumedQty?: number | null;
    rmReturnQty?: number | null;
    scrapWasteQty?: number | null;
    varianceQty?: number | null;
    remarks?: string | null;
  }>;
  wastageDetails?: Array<{
    wastageTypeId: number;
    itemId: number;
    qty: number;
    remarks?: string | null;
    sortOrder?: number;
  }>;
};

export function confirmProductionWorkOrderReport(
  workOrderId: number,
  body: ConfirmProductionWorkOrderReportInput,
): Promise<{
  report: ProductionWorkOrderReport;
  confirmation: ProductionWorkOrderReport["confirmation"];
  alreadyConfirmed: boolean;
  requiresShortfallDecision: boolean;
  executionClose?: {
    outcome?: "FULL_COMPLETE" | "CARRY_FORWARD" | "WAIVE_BALANCE" | string;
    successMessage?: string | null;
  } | null;
}> {
  return apiFetch(`/api/production/work-orders/${workOrderId}/production-report/confirm`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
