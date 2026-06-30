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
    standardQty: number | null;
    reportedConsumedQty: number | null;
    varianceQty: number | null;
  }>;
  generatedAt: string;
};

export function fetchProductionWorkOrderReport(workOrderId: number): Promise<ProductionWorkOrderReport> {
  return apiFetch<ProductionWorkOrderReport>(`/api/production/work-orders/${workOrderId}/production-report`);
}
