/**
 * P6D — RM Planning vs Actual Received report UX helpers.
 */

export type ReportRowStatus =
  | "SHORT_RECEIVED"
  | "FULLY_RECEIVED"
  | "OVER_RECEIVED"
  | "NO_PO"
  | "NO_GRN";

export type PlanningSourceRow = {
  planId: number;
  planDocNo: string | null;
  planLabel: string;
  revision: number;
  periodKey: string;
  sourceType: string;
  sourceTypeLabel: string;
  plannedQty: number;
};

export type ProcurementDetailRow = {
  sourceType: string | null;
  sourceTypeLabel: string | null;
  mrId: number | null;
  mrDocNo: string | null;
  prId: number | null;
  prDocNo: string | null;
  rmPoId: number | null;
  rmPoDisplayNo: string | null;
  supplierId: number | null;
  supplierName: string | null;
  poQty: number;
  allocatedQty: number;
  grnQty: number;
  grnEntries: Array<{
    grnId: number;
    grnNo: string;
    grnQty: number;
    grnDate: string | null;
  }>;
  planId: number | null;
  planDocNo: string | null;
  periodKey: string | null;
  planRevision: number | null;
  releasedQty: number;
};

export type RmPlanningVsReceivedRow = {
  rmItemId: number;
  rmItemName: string;
  unit: string;
  plannedRmQty: number;
  releasedProcurementQty: number;
  poQty: number;
  grnReceivedQty: number;
  pendingGrnQty: number;
  varianceQty: number;
  variancePercent: number | null;
  status: ReportRowStatus;
  statusLabel: string;
  planningSources: PlanningSourceRow[];
  procurementDetails: ProcurementDetailRow[];
};

export type RmPlanningVsReceivedFilters = {
  periodKey: string;
  rmItemId: string;
  procurementSource: string;
  supplierId: string;
  status: string;
};

export const PROCUREMENT_SOURCE_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "MONTHLY_PLAN", label: "Monthly Planning" },
  { value: "SALES_ORDER", label: "Sales Order" },
  { value: "STOCK_REPLENISHMENT", label: "Stock Replenishment" },
] as const;

export const ROW_STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "SHORT_RECEIVED", label: "Short Received" },
  { value: "FULLY_RECEIVED", label: "Fully Received" },
  { value: "OVER_RECEIVED", label: "Over Received" },
  { value: "NO_PO", label: "No PO" },
  { value: "NO_GRN", label: "No GRN" },
] as const;

export function defaultPeriodKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function buildReportQuery(filters: RmPlanningVsReceivedFilters): string {
  const p = new URLSearchParams();
  if (filters.periodKey) p.set("periodKey", filters.periodKey);
  if (filters.rmItemId) p.set("rmItemId", filters.rmItemId);
  if (filters.procurementSource && filters.procurementSource !== "ALL") {
    p.set("procurementSource", filters.procurementSource);
  }
  if (filters.supplierId) p.set("supplierId", filters.supplierId);
  if (filters.status) p.set("status", filters.status);
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export function formatReportQty(n: number | null | undefined, unit?: string | null): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const r = Math.round(x * 1000) / 1000;
  const base = r.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return unit ? `${base} ${unit}` : base;
}

export function formatVarianceQty(n: number | null | undefined, unit?: string | null): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${formatReportQty(x, unit)}`;
}

export function formatVariancePercent(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const sign = Number(n) > 0 ? "+" : "";
  return `${sign}${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

export function rowStatusTone(status: ReportRowStatus): string {
  switch (status) {
    case "SHORT_RECEIVED":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "FULLY_RECEIVED":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "OVER_RECEIVED":
      return "border-sky-200 bg-sky-50 text-sky-900";
    case "NO_PO":
      return "border-slate-200 bg-slate-50 text-slate-700";
    case "NO_GRN":
      return "border-violet-200 bg-violet-50 text-violet-900";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

export function buildReportHref(periodKey?: string, procurementSource = "MONTHLY_PLAN"): string {
  const p = new URLSearchParams();
  p.set("periodKey", periodKey || defaultPeriodKey());
  if (procurementSource) p.set("procurementSource", procurementSource);
  return `/reports/rm-planning-vs-actual?${p.toString()}`;
}

export function buildCsvDownloadUrl(filters: RmPlanningVsReceivedFilters): string {
  const qs = buildReportQuery(filters);
  const sep = qs ? `${qs}&` : "?";
  return `/api/reports/rm-planning-vs-received${sep}export=csv`;
}
