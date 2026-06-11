/** Types aligned with GET /api/procurement-trace/rm-po/:id (P2). */

export type RmPoTraceDemandSource = {
  demandSourceType: string | null;
  demandSourceLabel?: string;
  monthlyPlanRevision: number | null;
  monthlyPlan: { label?: string; periodKey?: string; sourceRevision?: number | null } | null;
  mr: {
    materialRequirementId?: number;
    docNo: string | null;
    sourceType?: string | null;
    workOrder?: { id: number; docNo: string | null } | null;
    salesOrder?: { id: number; docNo: string | null } | null;
  } | null;
  pr: { purchaseRequestId?: number | null; docNo: string | null } | null;
  workOrder?: { id: number; docNo: string | null } | null;
  salesOrder?: { id: number; docNo: string | null } | null;
};

export type RmPoTraceLine = {
  id: number;
  item: { id: number; itemName: string; unit?: string | null; hsn?: string | null } | null;
  orderedQty: number;
  receivedQty: number;
  pendingQty: number;
  rate: number;
  demandSources: RmPoTraceDemandSource[];
  traceChain: string[];
  grnLines: Array<{
    id: number;
    grnId: number;
    grnNo: string;
    receivedQty: number;
    isReversed: boolean;
    location: { name: string | null; code: string | null } | null;
    stockTransactions: Array<{ qtyIn: number; stockBucket: string }>;
    purchaseBillLines: Array<{
      purchaseBillId: number;
      purchaseBill?: { billNo: string | null; status: string } | null;
    }>;
  }>;
  purchaseBillLines: Array<{
    purchaseBillId: number;
    purchaseBill?: { billNo: string | null; status: string } | null;
  }>;
};

export type RmPoTracePayload = {
  rmPo: {
    id: number;
    displayNo: string;
    status: string;
    createdAt?: string;
    remarks?: string | null;
  };
  supplier: {
    id: number;
    name: string;
    gstin?: string | null;
    stateName?: string | null;
    stateCode?: string | null;
  } | null;
  supplierLocation: { label?: string | null; gstin?: string | null; stateName?: string | null } | null;
  grns: Array<{
    id: number;
    displayNo: string;
    supplierInvoiceNo?: string;
    date?: string;
    reversedAt?: string | null;
    billingStatus?: string;
    lineCount?: number;
  }>;
  lines: RmPoTraceLine[];
};

const SOURCE_LABELS: Record<string, string> = {
  MONTHLY_PLAN: "Monthly Plan",
  WORK_ORDER_PLANNING: "Work Order Planning",
  STOCK_REPLENISHMENT: "Stock Replenishment",
  SALES_ORDER: "Sales Order",
  QUOTATION: "Quotation",
};

export function demandSourceDisplay(ds: RmPoTraceDemandSource): string {
  if (ds.monthlyPlan?.label) return ds.monthlyPlan.label;
  if (ds.demandSourceLabel?.trim()) return ds.demandSourceLabel.trim();
  if (ds.monthlyPlanRevision != null) return `Monthly Plan Rev ${ds.monthlyPlanRevision}`;
  if (ds.demandSourceType && SOURCE_LABELS[ds.demandSourceType]) return SOURCE_LABELS[ds.demandSourceType];
  if (ds.workOrder?.docNo) return `WO ${ds.workOrder.docNo}`;
  if (ds.salesOrder?.docNo) return `SO ${ds.salesOrder.docNo}`;
  return "Demand source";
}

export function lineReceiptStatusLabel(ordered: number, received: number, pending: number): string {
  if (received <= 1e-6) return "Pending receipt";
  if (pending > 1e-6) return "Partially received";
  return "Received";
}

export function lineBillStatusLabel(
  billLines: RmPoTraceLine["purchaseBillLines"],
): string {
  if (!billLines?.length) return "Not billed";
  const finalized = billLines.find((b) => b.purchaseBill?.status === "FINALIZED");
  if (finalized?.purchaseBill?.billNo) return `Billed — ${finalized.purchaseBill.billNo}`;
  return "Not billed";
}

export function traceLineByPoLineId(trace: RmPoTracePayload | null, poLineId: number): RmPoTraceLine | null {
  return trace?.lines?.find((l) => l.id === poLineId) ?? null;
}

export function formatPoDocumentDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatTraceQty(n: number, unit?: string | null): string {
  const r = Math.round(n * 1000) / 1000;
  return unit ? `${r} ${unit}` : String(r);
}
