import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { dashboardToneToBadgeVariant, dispatchBacklogStatusTone } from "../lib/dispatchBacklog";
import {
  getDrillRowProps,
  qcEntryFocusHref,
  rmPoGrnFocusHref,
  salesOrdersFocusHref,
  stockFocusHref,
  withReportsReturnContext,
  workOrdersFocusHref,
} from "../lib/drillDownRoutes";
import {
  purchasePoStatusTone,
  qcQueueStatusTone,
  rmRiskStatusTone,
  workOrderStatusTone,
} from "../lib/reportStatusTones";
import { useToast } from "../contexts/ToastContext";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { useAuth } from "../hooks/useAuth";
import { useDrillAccessMap } from "../hooks/useDrillAccess";
import { Download } from "lucide-react";
import { ReportPageHeader, StickyReportBackStrip } from "../components/PageHeader";

type Severity = "CRITICAL" | "WARNING";

type DispatchExRow = {
  salesOrderId: number;
  salesOrderNo: string;
  customerName: string;
  itemId: number;
  itemName: string;
  orderedQty: number;
  dispatchedQty: number;
  pendingQty: number;
  salesOrderDate: string;
  status: string;
  quantityMetricContext?: string;
  severity: Severity;
  exceptionAgeDays: number;
  exceptionPendingShare: number;
  exceptionClassificationContext?: string;
};

type ProductionExRow = {
  workOrderId: number;
  workOrderNo: string;
  salesOrderId: number;
  salesOrderNo: string;
  itemId: number;
  itemName: string;
  /** SO line required qty (same basis as remaining) */
  requiredQty?: number;
  producedQty: number;
  balanceQty: number;
  status: string;
  workOrderDate: string;
  quantityMetricContext?: string;
  severity: Severity;
  exceptionAgeDays: number;
  exceptionBalanceShare: number;
  exceptionClassificationContext?: string;
};

type QcExRow = {
  qcRef: string;
  workOrderId: number;
  workOrderNo: string;
  salesOrderNo: string;
  itemId: number;
  itemName: string;
  producedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  pendingQcQty: number;
  status: string;
  qcDate: string;
  quantityMetricContext?: string;
  severity: Severity;
  exceptionPendingQcToProducedRatio: number;
  exceptionClassificationContext?: string;
};

type RmExRow = {
  itemId: number;
  itemCode: string;
  itemName: string;
  currentStockQty: number;
  requiredQty: number;
  freeQty: number;
  shortageQty: number;
  status: string;
  quantityMetricContext?: string;
  severity: Severity;
  exceptionClassificationContext?: string;
};

type PurchaseExRow = {
  purchaseOrderId: number;
  purchaseOrderNo: string;
  supplierName: string;
  itemId: number;
  itemName: string;
  orderedQty: number;
  receivedQty: number;
  pendingQty: number;
  status: string;
  purchaseDate: string;
  quantityMetricContext?: string;
  severity: Severity;
  exceptionAgeDays: number;
  exceptionPendingVsMaxShare: number;
  exceptionClassificationContext?: string;
};

type OpsExceptionPayload = {
  metricDefinitions: Record<string, string>;
  metricContextLegend: Record<string, string>;
  dispatch: DispatchExRow[];
  production: ProductionExRow[];
  qc: QcExRow[];
  rm: RmExRow[];
  purchase: PurchaseExRow[];
  summary: {
    dispatchExceptionCount: number;
    qcExceptionRowsWithPendingQc: number;
    criticalRmItemCount: number;
    purchaseSummaryLineCount: number;
    productionExceptionCount: number;
  };
};

type ExceptionSection = "ALL" | "DISPATCH" | "PRODUCTION" | "QC" | "RM" | "PURCHASE";

function severityTone(s: Severity): "critical" | "active" {
  return s === "CRITICAL" ? "critical" : "active";
}

function matchesSearch(
  q: string,
  parts: (string | number | undefined | null)[],
): boolean {
  if (!q) return true;
  const s = q.trim().toLowerCase();
  return parts.some((p) => String(p ?? "").toLowerCase().includes(s));
}

function opsExceptionReportAllowed(role: string | undefined): boolean {
  return role === "ADMIN";
}

export function OperationsExceptionReportPage() {
  const auth = useAuth();
  const allowed = opsExceptionReportAllowed(auth.user?.role);
  const navigate = useNavigate();
  const toast = useToast();
  const drill = useDrillAccessMap();

  const [payload, setPayload] = React.useState<OpsExceptionPayload | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [sectionFilter, setSectionFilter] = React.useState<ExceptionSection>("ALL");
  const [severityFilter, setSeverityFilter] = React.useState<"ALL" | Severity>("ALL");
  const [search, setSearch] = React.useState("");
  const liveTick = useErpRefreshTick(["reports", "dashboard"], { pollIntervalMs: ERP_REPORT_POLL_MS });

  React.useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(true);
    setLoadError(null);
    apiFetch<OpsExceptionPayload>("/api/reports/operations-exceptions")
      .then((d) => {
        if (mounted) {
          setPayload(d);
          setLoadError(null);
        }
      })
      .catch((e) => {
        if (mounted) {
          setPayload(null);
          setLoadError(e instanceof Error ? e.message : "Failed to load");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [allowed, liveTick]);

  const dispatchEx = payload?.dispatch ?? [];
  const productionEx = payload?.production ?? [];
  const qcEx = payload?.qc ?? [];
  const rmEx = payload?.rm ?? [];
  const purchaseEx = payload?.purchase ?? [];
  const summary = payload?.summary;

  const q = search.trim();

  const filterSeverity = (r: { severity: Severity }) => severityFilter === "ALL" || r.severity === severityFilter;

  const dispatchFiltered = React.useMemo(
    () =>
      dispatchEx.filter(
        (r) =>
          filterSeverity(r) &&
          matchesSearch(q, [r.salesOrderNo, r.customerName, r.itemName, r.status]),
      ),
    [dispatchEx, severityFilter, q],
  );

  const productionFiltered = React.useMemo(
    () =>
      productionEx.filter(
        (r) =>
          filterSeverity(r) &&
          matchesSearch(q, [r.workOrderNo, r.salesOrderNo, r.itemName, r.status]),
      ),
    [productionEx, severityFilter, q],
  );

  const qcFiltered = React.useMemo(
    () =>
      qcEx.filter(
        (r) =>
          filterSeverity(r) &&
          matchesSearch(q, [r.qcRef, r.workOrderNo, r.salesOrderNo, r.itemName, r.status]),
      ),
    [qcEx, severityFilter, q],
  );

  const rmFiltered = React.useMemo(
    () =>
      rmEx.filter(
        (r) =>
          filterSeverity(r) && matchesSearch(q, [r.itemCode, r.itemName, r.status]),
      ),
    [rmEx, severityFilter, q],
  );

  const purchaseFiltered = React.useMemo(
    () =>
      purchaseEx.filter(
        (r) =>
          filterSeverity(r) &&
          matchesSearch(q, [r.purchaseOrderNo, r.supplierName, r.itemName, r.status]),
      ),
    [purchaseEx, severityFilter, q],
  );

  const showDispatch = sectionFilter === "ALL" || sectionFilter === "DISPATCH";
  const showProduction = sectionFilter === "ALL" || sectionFilter === "PRODUCTION";
  const showQc = sectionFilter === "ALL" || sectionFilter === "QC";
  const showRm = sectionFilter === "ALL" || sectionFilter === "RM";
  const showPurchase = sectionFilter === "ALL" || sectionFilter === "PURCHASE";

  const hasActiveFilters = sectionFilter !== "ALL" || severityFilter !== "ALL" || search.trim() !== "";
  const canClear = hasActiveFilters;

  function clearFilters() {
    setSectionFilter("ALL");
    setSeverityFilter("ALL");
    setSearch("");
  }

  function onExport() {
    toast.showInfo("Export will be available in a future update.");
  }

  function exceptionResultLine(
    err: string | null,
    filtered: number,
    total: number,
    entityPlural: string,
  ) {
    if (err) {
      return <p className="text-xs text-red-700">Could not load: {err}</p>;
    }
    return (
      <p className="text-xs text-slate-600">
        <span className="font-medium text-slate-700">Results:</span>{" "}
        <span className="font-semibold tabular-nums text-slate-900">{filtered}</span>
        <span className="text-slate-500"> of </span>
        <span className="font-semibold tabular-nums text-slate-900">{total}</span>
        <span className="text-slate-500"> {entityPlural}</span>
        {hasActiveFilters ? <span className="text-slate-500"> · filtered view</span> : null}
      </p>
    );
  }

  const selectClass =
    "h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 shadow-sm";

  const sectionScroll = "max-h-[min(38vh,420px)] overflow-auto border-t border-slate-200";

  if (!allowed) {
    return (
      <div className="flex min-h-0 flex-col gap-3">
        <StickyReportBackStrip />
        <div className="rounded-md border border-slate-200 bg-slate-50 px-6 py-10 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Not authorized</h2>
          <p className="mt-2 text-sm text-slate-600">
            You don&apos;t have permission to view the Operations Exception report. If you need access, contact an administrator.
          </p>
        </div>
      </div>
    );
  }

  if (loadError && !payload) {
    return (
      <div className="flex min-h-0 flex-col gap-3">
        <StickyReportBackStrip />
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <ReportPageHeader
        className="mb-0"
        title="Operations Exception Report"
        purpose="Highlights transactions that are stuck, delayed, missing the next step, or operationally abnormal."
      />
      <p className="text-xs text-slate-500">
        Severities and exception shares are computed on the server; this page does not recalculate quantities or ratios.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Dispatch exceptions</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-900">
            {loading ? "…" : summary?.dispatchExceptionCount ?? 0}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">QC exceptions (pending qty)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-900">
            {loading ? "…" : summary?.qcExceptionRowsWithPendingQc ?? 0}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Critical RM items</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-red-800">
            {loading ? "…" : summary?.criticalRmItemCount ?? 0}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Purchase summary lines</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {loading ? "…" : summary?.purchaseSummaryLineCount ?? 0}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Production exceptions</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {loading ? "…" : summary?.productionExceptionCount ?? 0}
          </div>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-sm font-semibold text-slate-800">Filters</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8" disabled={!canClear} onClick={clearFilters}>
              Clear filters
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={onExport}>
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Exception type
            <select
              className={selectClass}
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value as ExceptionSection)}
            >
              <option value="ALL">All sections</option>
              <option value="DISPATCH">Dispatch</option>
              <option value="PRODUCTION">Production</option>
              <option value="QC">QC</option>
              <option value="RM">RM</option>
              <option value="PURCHASE">Purchase</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Severity
            <select
              className={selectClass}
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as "ALL" | Severity)}
            >
              <option value="ALL">All</option>
              <option value="CRITICAL">Critical</option>
              <option value="WARNING">Warning</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700 sm:col-span-2 lg:col-span-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Search</span>
            <Input
              className="h-10 border-slate-300 bg-white text-sm font-medium shadow-sm placeholder:font-normal placeholder:text-slate-400"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SO, WO, item, customer, supplier…"
            />
          </label>
        </CardContent>
      </Card>

      {loading ? (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-10 text-sm text-slate-500">Loading exception report…</div>
      ) : (
        <>
          {showDispatch ? (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-800">A. Dispatch exceptions</CardTitle>
                <p className="text-xs text-slate-500">Older backlog or high pending share (server-classified).</p>
                {exceptionResultLine(null, dispatchFiltered.length, dispatchEx.length, "dispatch exceptions")}
              </CardHeader>
              <CardContent className="p-0">
                {dispatchFiltered.length === 0 ? (
                  <div className="border-t border-slate-200 px-4 py-8">
                    {dispatchEx.length === 0 ? (
                      <>
                        <p className="text-sm font-medium text-slate-800">No dispatch exceptions</p>
                        <p className="mt-1 text-xs text-slate-600">
                          No backlog lines meet the age, pending-share, or combo rules used for this report.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-slate-800">No matching dispatch exceptions</p>
                        <p className="mt-1 text-xs text-slate-600">
                          Clear filters or search to see all {dispatchEx.length} row{dispatchEx.length === 1 ? "" : "s"} in this
                          section.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className={sectionScroll}>
                    <div className="erp-table-wrap border-0">
                      <table className="erp-table min-w-[720px] text-xs sm:text-sm">
                        <thead className="sticky top-0 z-[1] [&_th]:bg-slate-50">
                          <tr>
                            <th>SO No</th>
                            <th>Customer</th>
                            <th>Item</th>
                            <th className="text-right">Pending</th>
                            <th>Date</th>
                            <th>Status</th>
                            <th className="text-right">Age (d)</th>
                            <th>Severity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dispatchFiltered.map((r, idx) => (
                            <tr
                              key={`${r.salesOrderId}-${r.itemId}-${idx}`}
                              {...getDrillRowProps({
                                onActivate: () => navigate(withReportsReturnContext(salesOrdersFocusHref(r.salesOrderId))),
                                ariaLabel: `Open sales order ${r.salesOrderNo}`,
                                className: cn(
                                  r.severity === "CRITICAL" && "[&_td]:!bg-red-50/90",
                                  r.severity === "WARNING" && "[&_td]:!bg-amber-50/40",
                                ),
                                activable: drill["sales-order"],
                              })}
                            >
                              <td className="font-medium tabular-nums">{r.salesOrderNo}</td>
                              <td className="max-w-[10rem] truncate">{r.customerName}</td>
                              <td className="max-w-[12rem] truncate">{r.itemName}</td>
                              <td className="text-right font-semibold tabular-nums">{r.pendingQty}</td>
                              <td className="whitespace-nowrap">{new Date(r.salesOrderDate).toLocaleDateString()}</td>
                              <td>
                                <Badge variant={dashboardToneToBadgeVariant(dispatchBacklogStatusTone(r.status))}>
                                  {r.status}
                                </Badge>
                              </td>
                              <td className="text-right tabular-nums">{r.exceptionAgeDays.toFixed(0)}</td>
                              <td>
                                <Badge variant={dashboardToneToBadgeVariant(severityTone(r.severity))}>{r.severity}</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {showProduction ? (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-800">B. Production exceptions</CardTitle>
                <p className="text-xs text-slate-500">Aging or high remaining balance (server-classified).</p>
                {exceptionResultLine(null, productionFiltered.length, productionEx.length, "production exceptions")}
              </CardHeader>
              <CardContent className="p-0">
                {productionFiltered.length === 0 ? (
                  <div className="border-t border-slate-200 px-4 py-8">
                    {productionEx.length === 0 ? (
                      <>
                        <p className="text-sm font-medium text-slate-800">No production exceptions</p>
                        <p className="mt-1 text-xs text-slate-600">No open work orders meet the age or balance rules.</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-slate-800">No matching production exceptions</p>
                        <p className="mt-1 text-xs text-slate-600">
                          Clear filters or search to see all {productionEx.length} row{productionEx.length === 1 ? "" : "s"} in
                          this section.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className={sectionScroll}>
                    <div className="erp-table-wrap border-0">
                      <table className="erp-table min-w-[680px] text-xs sm:text-sm">
                        <thead className="sticky top-0 z-[1] [&_th]:bg-slate-50">
                          <tr>
                            <th>WO No</th>
                            <th>SO No</th>
                            <th>Item</th>
                            <th className="text-right">Balance</th>
                            <th>Status</th>
                            <th>Date</th>
                            <th>Severity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {productionFiltered.map((r, idx) => (
                            <tr
                              key={`${r.workOrderId}-${r.itemId}-${idx}`}
                              {...getDrillRowProps({
                                onActivate: () => navigate(withReportsReturnContext(workOrdersFocusHref(r.workOrderId))),
                                ariaLabel: `Open work order ${r.workOrderNo}`,
                                className: cn(
                                  r.severity === "CRITICAL" && "[&_td]:!bg-red-50/90",
                                  r.severity === "WARNING" && "[&_td]:!bg-amber-50/40",
                                ),
                                activable: drill["work-order"],
                              })}
                            >
                              <td className="font-medium tabular-nums">{r.workOrderNo}</td>
                              <td className="tabular-nums">{r.salesOrderNo}</td>
                              <td className="max-w-[12rem] truncate">{r.itemName}</td>
                              <td className="text-right font-semibold tabular-nums">{r.balanceQty}</td>
                              <td>
                                <Badge variant={dashboardToneToBadgeVariant(workOrderStatusTone(r.status))}>{r.status}</Badge>
                              </td>
                              <td className="whitespace-nowrap">{new Date(r.workOrderDate).toLocaleDateString()}</td>
                              <td>
                                <Badge variant={dashboardToneToBadgeVariant(severityTone(r.severity))}>{r.severity}</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {showQc ? (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-800">C. QC exceptions</CardTitle>
                <p className="text-xs text-slate-500">Pending inspection or rejection (server-classified).</p>
                {exceptionResultLine(null, qcFiltered.length, qcEx.length, "QC exceptions")}
              </CardHeader>
              <CardContent className="p-0">
                {qcFiltered.length === 0 ? (
                  <div className="border-t border-slate-200 px-4 py-8">
                    {qcEx.length === 0 ? (
                      <>
                        <p className="text-sm font-medium text-slate-800">No QC exceptions</p>
                        <p className="mt-1 text-xs text-slate-600">No rows have open pending QC or rejected quantity.</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-slate-800">No matching QC exceptions</p>
                        <p className="mt-1 text-xs text-slate-600">
                          Clear filters or search to see all {qcEx.length} row{qcEx.length === 1 ? "" : "s"} in this section.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className={sectionScroll}>
                    <div className="erp-table-wrap border-0">
                      <table className="erp-table min-w-[900px] text-xs sm:text-sm">
                        <thead className="sticky top-0 z-[1] [&_th]:bg-slate-50">
                          <tr>
                            <th>Ref</th>
                            <th>WO No</th>
                            <th>Item</th>
                            <th className="text-right">Accepted</th>
                            <th className="text-right">Rejected</th>
                            <th className="text-right">Pending QC</th>
                            <th>Status</th>
                            <th>Date</th>
                            <th>Severity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {qcFiltered.map((r) => (
                            <tr
                              key={r.qcRef}
                              {...getDrillRowProps({
                                onActivate: () => navigate(withReportsReturnContext(qcEntryFocusHref(r.workOrderId))),
                                ariaLabel: `Open QC for work order ${r.workOrderNo}`,
                                className: cn(
                                  r.severity === "CRITICAL" && "[&_td]:!bg-red-50/90",
                                  r.severity === "WARNING" && "[&_td]:!bg-amber-50/40",
                                ),
                                activable: drill["qc-entry"],
                              })}
                            >
                              <td className="font-mono text-[11px] sm:text-xs">{r.qcRef}</td>
                              <td className="tabular-nums">{r.workOrderNo}</td>
                              <td className="max-w-[10rem] truncate">{r.itemName}</td>
                              <td className="text-right tabular-nums">{r.acceptedQty}</td>
                              <td className="text-right font-medium tabular-nums text-red-800">{r.rejectedQty}</td>
                              <td className="text-right font-semibold tabular-nums">{r.pendingQcQty}</td>
                              <td>
                                <Badge variant={dashboardToneToBadgeVariant(qcQueueStatusTone(r.status))}>{r.status}</Badge>
                              </td>
                              <td className="whitespace-nowrap">{new Date(r.qcDate).toLocaleDateString()}</td>
                              <td>
                                <Badge variant={dashboardToneToBadgeVariant(severityTone(r.severity))}>{r.severity}</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {showRm ? (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-800">D. RM exceptions</CardTitle>
                <p className="text-xs text-slate-500">Critical shortage or low buffer.</p>
                {exceptionResultLine(null, rmFiltered.length, rmEx.length, "RM exceptions")}
              </CardHeader>
              <CardContent className="p-0">
                {rmFiltered.length === 0 ? (
                  <div className="border-t border-slate-200 px-4 py-8">
                    {rmEx.length === 0 ? (
                      <>
                        <p className="text-sm font-medium text-slate-800">No RM exceptions</p>
                        <p className="mt-1 text-xs text-slate-600">The RM risk API returned no critical or low-buffer rows.</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-slate-800">No matching RM exceptions</p>
                        <p className="mt-1 text-xs text-slate-600">
                          Clear filters or search to see all {rmEx.length} row{rmEx.length === 1 ? "" : "s"} in this section.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className={sectionScroll}>
                    <div className="erp-table-wrap border-0">
                      <table className="erp-table min-w-[720px] text-xs sm:text-sm">
                        <thead className="sticky top-0 z-[1] [&_th]:bg-slate-50">
                          <tr>
                            <th>Item</th>
                            <th className="text-right">Stock</th>
                            <th className="text-right">Required</th>
                            <th className="text-right">Free</th>
                            <th className="text-right">Shortage</th>
                            <th>Status</th>
                            <th>Severity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rmFiltered.map((r) => (
                            <tr
                              key={r.itemId}
                              {...getDrillRowProps({
                                onActivate: () => navigate(withReportsReturnContext(stockFocusHref(r.itemId))),
                                ariaLabel: `Open stock for ${r.itemName}`,
                                className: cn(
                                  r.severity === "CRITICAL" && "[&_td]:!bg-red-50",
                                  r.severity === "WARNING" && "[&_td]:!bg-amber-50/50",
                                ),
                                activable: drill.stock,
                              })}
                            >
                              <td className="max-w-[14rem] truncate font-medium">{r.itemName}</td>
                              <td className="text-right tabular-nums">{r.currentStockQty}</td>
                              <td className="text-right tabular-nums">{r.requiredQty}</td>
                              <td className="text-right tabular-nums">{r.freeQty}</td>
                              <td className="text-right font-semibold tabular-nums text-red-800">{r.shortageQty}</td>
                              <td>
                                <Badge variant={dashboardToneToBadgeVariant(rmRiskStatusTone(r.status))}>{r.status}</Badge>
                              </td>
                              <td>
                                <Badge variant={dashboardToneToBadgeVariant(severityTone(r.severity))}>{r.severity}</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {showPurchase ? (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-800">E. Purchase exceptions</CardTitle>
                <p className="text-xs text-slate-500">Old or heavily pending RM PO lines (server-classified).</p>
                {exceptionResultLine(null, purchaseFiltered.length, purchaseEx.length, "purchase summary lines")}
              </CardHeader>
              <CardContent className="p-0">
                {purchaseFiltered.length === 0 ? (
                  <div className="border-t border-slate-200 px-4 py-8">
                    {purchaseEx.length === 0 ? (
                      <>
                        <p className="text-sm font-medium text-slate-800">No purchase summary lines</p>
                        <p className="mt-1 text-xs text-slate-600">The purchase summary API returned no rows.</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-slate-800">No matching purchase lines</p>
                        <p className="mt-1 text-xs text-slate-600">
                          Clear filters or search to see all {purchaseEx.length} line{purchaseEx.length === 1 ? "" : "s"} in this
                          section.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className={sectionScroll}>
                    <div className="erp-table-wrap border-0">
                      <table className="erp-table min-w-[720px] text-xs sm:text-sm">
                        <thead className="sticky top-0 z-[1] [&_th]:bg-slate-50">
                          <tr>
                            <th>PO No</th>
                            <th>Supplier</th>
                            <th>Item</th>
                            <th className="text-right">Pending</th>
                            <th>Status</th>
                            <th>Date</th>
                            <th className="text-right">Age (d)</th>
                            <th>Severity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {purchaseFiltered.map((r, idx) => (
                            <tr
                              key={`${r.purchaseOrderId}-${r.itemId}-${idx}`}
                              {...getDrillRowProps({
                                onActivate: () => navigate(withReportsReturnContext(rmPoGrnFocusHref(r.purchaseOrderId))),
                                ariaLabel: `Open Material Planning — ${r.purchaseOrderNo}`,
                                className: cn(
                                  r.severity === "CRITICAL" && "[&_td]:!bg-red-50/90",
                                  r.severity === "WARNING" && "[&_td]:!bg-amber-50/40",
                                ),
                                activable: drill["rm-po-grn"],
                              })}
                            >
                              <td className="font-medium tabular-nums">{r.purchaseOrderNo}</td>
                              <td className="max-w-[10rem] truncate">{r.supplierName}</td>
                              <td className="max-w-[12rem] truncate">{r.itemName}</td>
                              <td className="text-right font-semibold tabular-nums">{r.pendingQty}</td>
                              <td>
                                <Badge variant={dashboardToneToBadgeVariant(purchasePoStatusTone(r.status))}>{r.status}</Badge>
                              </td>
                              <td className="whitespace-nowrap">{new Date(r.purchaseDate).toLocaleDateString()}</td>
                              <td className="text-right tabular-nums">{r.exceptionAgeDays.toFixed(0)}</td>
                              <td>
                                <Badge variant={dashboardToneToBadgeVariant(severityTone(r.severity))}>{r.severity}</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
