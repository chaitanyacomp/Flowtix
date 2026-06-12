import { demandPoolKeyForSourceType } from "./procurementTraceTerminology";
import { buildProcurementWorkspaceHref } from "./woProcurementContinuity";
import { buildRmPoDetailHref } from "./rmPurchaseWoContinuity";
import { buildGrnDocumentHref, parseGrnDisplayNo } from "./procurementNavigation";

export type ConnectivityReportRow = {
  rowKey: string;
  rmPoId: number;
  rmPoLineId: number;
  rmPoDisplayNo: string;
  rmPoStatus: string;
  supplier: { id: number; name: string } | null;
  rmItem: { id: number; itemName: string; unit?: string | null } | null;
  orderedQty: number;
  receivedQty: number;
  pendingQty: number;
  receiptStatus: string;
  receiptStatusLabel: string;
  billStatus: string;
  billStatusLabel: string;
  demandSourceType: string | null;
  demandSourceLabel: string;
  monthlyPlanRevision: number | null;
  monthlyPlan?: { label?: string | null } | null;
  mr: {
    materialRequirementId: number;
    docNo: string | null;
    workOrder?: { id: number; docNo: string | null } | null;
    salesOrder?: { id: number; docNo: string | null } | null;
  } | null;
  pr: { purchaseRequestId: number | null; docNo: string | null } | null;
  grnSummary: {
    label: string;
    activeGrnNos: string[];
    reversedGrnNos: string[];
  };
  stockPosted: { posted: boolean; label: string };
  purchaseBillLines: Array<{
    purchaseBillId: number;
    purchaseBill?: {
      id: number;
      billNo: string | null;
      status: string;
      isExported?: boolean;
    } | null;
  }>;
  traceChain: string[];
};

export type ConnectivityReportFilters = {
  sourceType: string;
  rmItemId: string;
  supplierId: string;
  rmPoId: string;
  mrId: string;
  prId: string;
  status: string;
};

export const CONNECTIVITY_SOURCE_TYPES = [
  { value: "", label: "All sources" },
  { value: "SALES_ORDER", label: "Sales Orders" },
  { value: "MONTHLY_PLAN", label: "Monthly Planning" },
  { value: "STOCK_REPLENISHMENT", label: "Stock Replenishment" },
  { value: "WORK_ORDER_PLANNING", label: "Legacy / Historical Demand" },
  { value: "QUOTATION", label: "Quotation" },
] as const;

export const CONNECTIVITY_RECEIPT_STATUSES = [
  { value: "", label: "All receipt status" },
  { value: "PENDING_RECEIPT", label: "Pending receipt" },
  { value: "PARTIALLY_RECEIVED", label: "Partially received" },
  { value: "RECEIVED", label: "Received" },
] as const;

export function formatConnectivityQty(n: number | null | undefined, unit?: string | null): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const r = Math.round(x * 1000) / 1000;
  const base = String(r);
  return unit ? `${base} ${unit}` : base;
}

export function buildConnectivityReportQuery(filters: ConnectivityReportFilters): string {
  const qs = new URLSearchParams();
  if (filters.sourceType) qs.set("sourceType", filters.sourceType);
  if (filters.rmItemId) qs.set("rmItemId", filters.rmItemId);
  if (filters.supplierId) qs.set("supplierId", filters.supplierId);
  if (filters.rmPoId) qs.set("rmPoId", filters.rmPoId);
  if (filters.mrId) qs.set("mrId", filters.mrId);
  if (filters.prId) qs.set("prId", filters.prId);
  if (filters.status) qs.set("status", filters.status);
  return qs.toString();
}

export function connectivityPoHref(row: ConnectivityReportRow): string {
  const soId = row.mr?.salesOrder?.id;
  return buildRmPoDetailHref(row.rmPoId, {
    salesOrderId: soId,
    from: "connectivity-report",
  });
}

export function connectivityProcurementHref(row: ConnectivityReportRow, returnTo: string): string {
  return buildProcurementWorkspaceHref({
    materialRequirementId: row.mr?.materialRequirementId,
    workOrderId: row.mr?.workOrder?.id,
    salesOrderId: row.mr?.salesOrder?.id,
    rmItemId: row.rmItem?.id,
    returnTo,
    demandPool: demandPoolKeyForSourceType(row.demandSourceType) ?? undefined,
    sourceType: row.demandSourceType,
  });
}

export function connectivityGrnHref(row: ConnectivityReportRow): string {
  return `/rm-po-grn/${row.rmPoId}?from=connectivity-report`;
}

export function connectivityGrnDocumentHref(row: ConnectivityReportRow, returnTo?: string): string | null {
  const grnNo = row.grnSummary.activeGrnNos[0] ?? row.grnSummary.label;
  const grnId = parseGrnDisplayNo(grnNo);
  if (!grnId) return null;
  return buildGrnDocumentHref(grnId, returnTo ?? "/reports/rm-procurement-connectivity");
}

export function connectivityBillHref(billId: number): string {
  return `/purchase-bills/${billId}`;
}

export function connectivityBillSummary(row: ConnectivityReportRow): string {
  if (row.billStatusLabel) return row.billStatusLabel;
  const bills = row.purchaseBillLines || [];
  if (!bills.length) return "Not billed";
  const finalized = bills.find((b) => b.purchaseBill?.status === "FINALIZED");
  return finalized?.purchaseBill?.billNo
    ? `Bill ${finalized.purchaseBill.billNo}`
    : row.billStatusLabel || "Not billed";
}

export function connectivityBillExportLabel(row: ConnectivityReportRow): string | null {
  const bills = row.purchaseBillLines || [];
  if (!bills.length) return null;
  const finalized =
    bills.find((b) => b.purchaseBill?.status === "FINALIZED" && b.purchaseBill?.isExported != null) ??
    bills.find((b) => b.purchaseBill?.isExported != null);
  if (!finalized?.purchaseBill || finalized.purchaseBill.isExported == null) return null;
  return finalized.purchaseBill.isExported ? "Exported" : "Not exported";
}

export function receiptStatusTone(status: string): string {
  if (status === "RECEIVED") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (status === "PARTIALLY_RECEIVED") return "text-amber-800 bg-amber-50 border-amber-200";
  return "text-slate-600 bg-slate-50 border-slate-200";
}
