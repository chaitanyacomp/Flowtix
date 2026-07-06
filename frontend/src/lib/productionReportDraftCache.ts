import type { WastageDetailDraft } from "./productionWastageClassification";

export type ProductionReportLineInputDraft = {
  rmConsumedQty: string;
  rmReturnQty: string;
  scrapWasteQty: string;
  varianceQty: string;
  remarks: string;
};

export type ProductionReportDraftSnapshot = {
  lineInputs: Record<number, ProductionReportLineInputDraft>;
  wastageRows: WastageDetailDraft[];
  remarks: string;
};

type CachedDraft = ProductionReportDraftSnapshot & {
  dirty: boolean;
  reportConfirmed: boolean;
};

const draftsByWorkOrderId = new Map<number, CachedDraft>();

export function getProductionReportDraft(workOrderId: number): ProductionReportDraftSnapshot | null {
  if (!(workOrderId > 0)) return null;
  const row = draftsByWorkOrderId.get(workOrderId);
  if (!row || row.reportConfirmed) return null;
  return {
    lineInputs: row.lineInputs,
    wastageRows: row.wastageRows,
    remarks: row.remarks,
  };
}

export function isProductionReportDraftDirty(workOrderId: number): boolean {
  if (!(workOrderId > 0)) return false;
  const row = draftsByWorkOrderId.get(workOrderId);
  return Boolean(row?.dirty && !row.reportConfirmed);
}

export function saveProductionReportDraft(
  workOrderId: number,
  snapshot: ProductionReportDraftSnapshot,
  options?: { dirty?: boolean; reportConfirmed?: boolean },
): void {
  if (!(workOrderId > 0)) return;
  draftsByWorkOrderId.set(workOrderId, {
    ...snapshot,
    dirty: options?.dirty ?? true,
    reportConfirmed: options?.reportConfirmed ?? false,
  });
}

export function clearProductionReportDraft(workOrderId: number): void {
  if (!(workOrderId > 0)) return;
  draftsByWorkOrderId.delete(workOrderId);
}
