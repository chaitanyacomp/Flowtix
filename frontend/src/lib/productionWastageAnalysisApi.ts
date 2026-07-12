/**
 * Shared API client for Lane C production wastage analysis reports.
 * Frontend renders API results only — no business formula recalculation.
 */
import { apiFetch, getApiUrl } from "../services/api";

export type ProductionWastageMode = "wo-detail" | "type-summary" | "legacy";

export type ProductionWastageFilters = {
  fromDate?: string;
  toDate?: string;
  workOrderId?: number | string;
  woNumber?: string;
  salesOrderId?: number | string;
  customerId?: number | string;
  fgItemId?: number | string;
  rmItemId?: number | string;
  wastageTypeId?: number | string;
  category?: string;
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortDir?: "asc" | "desc";
  export?: "all" | "csv";
};

export type WoDetailRow = {
  reportId: number;
  reportDate: string | null;
  workOrderId: number | null;
  workOrderNo: string | null;
  salesOrderId: number | null;
  salesOrderNo: string | null;
  customerId: number | null;
  customerName: string | null;
  fgItemId: number | null;
  fgItemName: string | null;
  fgUnit: string | null;
  rmItemId: number;
  rmItemName: string;
  rmUnit: string;
  plannedConsumption: number | null;
  issuedQty: number;
  returnedQty: number;
  actualConsumedQty: number;
  fgProducedQty: number;
  wastageQty: number;
  wastagePct: number | null;
  yieldPct: number | null;
  excessConsumption: number | null;
  wastageTypeLabel: string | null;
  categoryLabel: string | null;
  remarks: string | null;
  productionReportRef: string;
  status: string;
  drillDown: {
    workOrderId: number | null;
    productionReportId: number;
    hrefWorkOrder: string | null;
    hrefProductionReport: string | null;
  };
};

export type TypeSummaryRow = {
  wastageTypeId: number;
  wastageTypeCode: string | null;
  wastageTypeName: string | null;
  category: string | null;
  isActiveType: boolean | null;
  totalWastageQty: number;
  shareOfTotalWastagePct: number | null;
  workOrderCount: number;
  productionReportCount: number;
  averageWastagePerWo: number | null;
  averageWastagePct: number | null;
  highestWastageWoId: number | null;
  highestWastageWoNo: string | null;
  highestWastageQty: number | null;
  lowestNonZeroWastageWoId: number | null;
  lowestNonZeroWastageWoNo: string | null;
  lowestNonZeroWastageQty: number | null;
  drillDown: { wastageTypeId: number; hrefWoReport: string };
};

export type ProductionWastageAnalysisResponse<TRow> = {
  mode: ProductionWastageMode;
  filters: Record<string, unknown>;
  kpis: Record<string, number | string | null | undefined>;
  rows: TRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  sort: { field: string; dir: string };
  formulas?: Record<string, unknown>;
  reconciliation?: {
    confirmedReportCount: number;
    lineWastageTotal: number;
    classificationDetailTotal: number;
    delta: number;
    warnings: Array<{ code: string; message: string }>;
  };
  generatedAt: string;
};

function buildQs(mode: ProductionWastageMode, filters: ProductionWastageFilters): string {
  const qs = new URLSearchParams();
  qs.set("mode", mode);
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  return qs.toString();
}

export function fetchProductionWastageWoDetail(
  filters: ProductionWastageFilters,
): Promise<ProductionWastageAnalysisResponse<WoDetailRow>> {
  return apiFetch(`/api/reports/production-wastage-classification?${buildQs("wo-detail", filters)}`);
}

export function fetchProductionWastageTypeSummary(
  filters: ProductionWastageFilters,
): Promise<ProductionWastageAnalysisResponse<TypeSummaryRow>> {
  return apiFetch(`/api/reports/production-wastage-classification?${buildQs("type-summary", filters)}`);
}

export async function downloadProductionWastageCsv(
  mode: "wo-detail" | "type-summary",
  filters: ProductionWastageFilters,
  filename: string,
): Promise<void> {
  const qs = buildQs(mode, { ...filters, export: "csv", page: undefined, pageSize: undefined });
  const token = localStorage.getItem("token");
  const res = await fetch(getApiUrl(`/api/reports/production-wastage-classification?${qs}`), {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
