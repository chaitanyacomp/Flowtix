import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { ReportFilterField,
  ReportFilterToolbar,
  ReportKpiStrip,
  ReportTableShell,
  ReportEmptyState,
  type ReportKpiItem, ReportPageShell } from "../components/erp/ReportChrome";
import { withReportsReturnContext, workOrdersFocusHref } from "../lib/drillDownRoutes";
import { useAuth } from "../hooks/useAuth";
import { useDrillActivable } from "../hooks/useDrillAccess";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { ReportPageHeader } from "../components/PageHeader";
import {
  ReportPrintExportBar,
  ReportPrintMeta,
  downloadReportCsv,
  downloadReportExcel,
} from "../components/erp/ReportPrintExport";
import {
  type WoTrackingRow,
  type WoTrackingApiResponse,
  type WoTrackingFlow,
  normalizeWoTrackingApiResponse,
  buildWorkOrderTrackingQuery,
} from "../lib/woTrackingResponse";
import {
  type WoScopeFilter,
  classifyRecoveryBadge,
  computeNoQtyKpiStrip,
  computeRegularKpiStrip,
  dispatchProgress,
  filterRowsByWoScope,
  formatQtyCompact,
  includeClosedForScope,
  parseRecoveryDetail,
  productionProgress,
  qcProgress,
  recoveryBadgeLabel,
  recoveryBadgeVariant,
  statusDisplay,
} from "../lib/woTrackingReportUi";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { useStablePageData } from "../hooks/useStablePageData";
import { ReportResultsLoadGate } from "../components/erp/foundation/ReportResultsLoadGate";
import { sanitizeReportUiError } from "../lib/reportUiError";
import { ErpModal } from "../components/erp/ErpModal";

type Customer = { id: number; name: string };

function woTrackingReportAllowed(role: string | undefined): boolean {
  return role === "ADMIN" || role === "PRODUCTION";
}

/** Compact progress block — column header names the stage (FT-PD-066 §17.8). */
function ProgressCell({
  done,
  total,
  pending,
  emphasize,
}: {
  done: number;
  total: number;
  pending?: number;
  emphasize?: boolean;
}) {
  const pct = total > 1e-6 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5 leading-tight">
        <span className="text-[13px] font-semibold tabular-nums text-slate-900">
          {formatQtyCompact(done)}
          <span className="font-normal text-slate-400"> / </span>
          {formatQtyCompact(total)}
        </span>
        {pending != null && pending > 1e-6 ? (
          <span
            className={cn(
              "text-[10px] font-semibold tabular-nums",
              emphasize ? "text-amber-800" : "text-slate-500",
            )}
          >
            {formatQtyCompact(pending)} pend
          </span>
        ) : null}
      </div>
      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn(
            "h-full rounded-full",
            pct >= 99.5 ? "bg-emerald-500" : emphasize ? "bg-amber-500" : "bg-slate-400",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function WorkOrderTrackingReportPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const allowed = woTrackingReportAllowed(auth.user?.role);
  const canDrillWorkOrder = useDrillActivable("work-order");
  const { patch, read } = useUrlQueryState({
    flow: "REGULAR",
    woScope: "open",
    includeClosed: "0",
    customerName: "",
    dateFrom: "",
    dateTo: "",
    q: "",
  });

  const flow = read.enum("flow", ["REGULAR", "NO_QTY"] as const, "REGULAR") as WoTrackingFlow;
  // Prefer woScope; migrate legacy includeClosed=1 → all
  const woScopeRaw = read.string("woScope");
  const legacyClosed = read.string("includeClosed") === "1" || read.string("includeClosed") === "true";
  const woScope: WoScopeFilter =
    woScopeRaw === "closed" || woScopeRaw === "all" || woScopeRaw === "open"
      ? woScopeRaw
      : legacyClosed
        ? "all"
        : "open";
  const includeClosed = includeClosedForScope(woScope);
  const customerName = read.string("customerName");
  const dateFrom = read.string("dateFrom");
  const dateTo = read.string("dateTo");
  const qFromUrl = read.string("q");
  const [search, setSearch] = useDebouncedUrlStringParam({ urlValue: qFromUrl, patch, paramKey: "q" });
  const isNoQty = flow === "NO_QTY";

  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [expandedId, setExpandedId] = React.useState<number | null>(null);
  const [recoveryRow, setRecoveryRow] = React.useState<WoTrackingRow | null>(null);

  const liveTick = useErpRefreshTick(["reports", "production", "workorders", "qc", "dispatch"], {
    pollIntervalMs: ERP_REPORT_POLL_MS,
  });

  React.useEffect(() => {
    if (!allowed) return;
    apiFetch<Customer[]>("/api/customers")
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, [allowed, liveTick]);

  const {
    data,
    error: loadError,
    firstLoadDone,
    loading,
  } = useStablePageData<WoTrackingApiResponse>({
    enabled: allowed,
    scopes: ["reports", "production", "workorders", "qc", "dispatch"],
    pollIntervalMs: ERP_REPORT_POLL_MS,
    deps: [flow, includeClosed],
    fetcher: (signal) =>
      apiFetch<unknown>(`/api/reports/work-order-tracking?${buildWorkOrderTrackingQuery(flow, includeClosed)}`, {
        signal,
      }).then((raw) => normalizeWoTrackingApiResponse(raw, flow)),
  });

  const rows = data?.rows ?? [];
  const emptyMessage =
    data?.emptyMessage ??
    (isNoQty
      ? "No active NO_QTY work orders found for the selected filters."
      : "No Regular Sales Order work orders found for the selected filters.");

  const scoped = React.useMemo(
    () => filterRowsByWoScope(rows, woScope, isNoQty),
    [rows, woScope, isNoQty],
  );

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((r) => {
      if (customerName && r.customerName !== customerName) return false;
      const ymd = r.workOrderDate.slice(0, 10);
      if (dateFrom && ymd < dateFrom) return false;
      if (dateTo && ymd > dateTo) return false;
      if (q) {
        const hit =
          r.salesOrderNo.toLowerCase().includes(q) ||
          r.workOrderNo.toLowerCase().includes(q) ||
          r.itemName.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          String(r.requirementSheetNo || "")
            .toLowerCase()
            .includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [scoped, customerName, dateFrom, dateTo, search]);

  const noQtyKpis = React.useMemo(() => (isNoQty ? computeNoQtyKpiStrip(filtered) : null), [isNoQty, filtered]);
  const regularKpis = React.useMemo(
    () => (!isNoQty ? computeRegularKpiStrip(filtered, data?.summary ?? null) : null),
    [isNoQty, filtered, data?.summary],
  );

  const hasActiveFilters =
    customerName !== "" || dateFrom !== "" || dateTo !== "" || search.trim() !== "" || woScope !== "open";

  function clearFilters() {
    patch({
      customerName: null,
      dateFrom: null,
      dateTo: null,
      q: null,
      woScope: null,
      includeClosed: null,
    });
    setSearch("");
  }

  function setScope(next: WoScopeFilter) {
    patch({
      woScope: next === "open" ? null : next,
      includeClosed: next === "open" ? null : "1",
    });
  }

  const filterSummary = [
    isNoQty ? "NO_QTY" : "Regular",
    woScope === "open" ? "Open" : woScope === "closed" ? "Closed" : "All",
    customerName ? `Customer ${customerName}` : null,
    dateFrom ? `From ${dateFrom}` : null,
    dateTo ? `To ${dateTo}` : null,
    search.trim() ? `Search “${search.trim()}”` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const csvHeaders = isNoQty
    ? ["SO", "RS", "Cycle", "WO", "Item", "Customer", "Demand", "Produced", "Planned", "Accepted", "Dispatched", "Recovery", "Status"]
    : ["SO", "WO", "Item", "Customer", "Ordered", "Produced", "Planned", "Accepted", "Dispatched", "Status"];

  const csvRows = filtered.map((r) => {
    const st = statusDisplay(r, isNoQty).label;
    if (isNoQty) {
      return [
        r.salesOrderNo,
        r.requirementSheetNo ?? "",
        r.cycleNo ?? "",
        r.workOrderNo,
        r.itemName,
        r.customerName,
        r.customerDemandQty ?? "",
        r.producedQty,
        r.plannedQty ?? "",
        r.acceptedQty,
        r.dispatchedQty,
        recoveryBadgeLabel(classifyRecoveryBadge(r)),
        st,
      ];
    }
    return [
      r.salesOrderNo,
      r.workOrderNo,
      r.itemName,
      r.customerName,
      r.orderedQty ?? "",
      r.producedQty,
      r.plannedQty ?? "",
      r.acceptedQty,
      r.dispatchedQty,
      st,
    ];
  });

  const kpiItems: ReportKpiItem[] = isNoQty && noQtyKpis
    ? [
        { key: "openWos", label: "Open WOs", value: noQtyKpis.openWos },
        { key: "openCycles", label: "Open Cycles", value: noQtyKpis.openCycles },
        {
          key: "activeProd",
          label: "Active Prod. Pend.",
          value: formatQtyCompact(noQtyKpis.activeProductionPending),
          tone: noQtyKpis.activeProductionPending > 0 ? "warning" : "default",
        },
        {
          key: "carryFwd",
          label: "Carry Forward Qty",
          value: formatQtyCompact(noQtyKpis.carryForwardQty),
        },
        {
          key: "recoveryPend",
          label: "Recovery Pending",
          value: noQtyKpis.recoveryPending,
          tone: noQtyKpis.recoveryPending > 0 ? "warning" : "default",
        },
      ]
    : regularKpis
      ? [
          { key: "openLines", label: "Open WO Lines", value: regularKpis.openWoLines },
          {
            key: "prodPend",
            label: "Prod. Pending",
            value: formatQtyCompact(regularKpis.pendingProduction),
            tone: regularKpis.pendingProduction > 0 ? "warning" : "default",
          },
          {
            key: "qcPend",
            label: "QC Pending",
            value: formatQtyCompact(regularKpis.pendingQc),
            tone: regularKpis.pendingQc > 0 ? "warning" : "default",
          },
          {
            key: "dispPend",
            label: "Dispatch Pending",
            value: formatQtyCompact(regularKpis.pendingDispatch),
            tone: regularKpis.pendingDispatch > 0 ? "warning" : "default",
          },
        ]
      : [];

  if (!allowed) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-6 py-10 text-center shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Not authorized</h2>
        <p className="mt-2 text-sm text-slate-600">
          You don&apos;t have permission to view the Work Order Tracking report.
        </p>
      </div>
    );
  }

  return (
    <ReportPageShell>
      <ReportPrintMeta title="Work Order Tracking Report" filterSummary={filterSummary} />
      <ReportPageHeader
        title="Work Order Tracking Report"
        purpose={
          isNoQty
            ? "NO_QTY operational workbench — RS/cycle progress, recovery, and active pending."
            : "Regular SO workbench — production, QC, and dispatch progress."
        }
        actions={
          <ReportPrintExportBar
            filterSummary={filterSummary}
            onExportCsv={() =>
              downloadReportCsv(`work-order-tracking_${new Date().toISOString().slice(0, 10)}.csv`, csvHeaders, csvRows)
            }
            onExportExcel={() =>
              downloadReportExcel(
                `work-order-tracking_${new Date().toISOString().slice(0, 10)}.xlsx`,
                "Work Order Tracking",
                csvHeaders,
                csvRows,
              )
            }
            csvDisabled={loading}
            excelDisabled={loading}
          />
        }
      />

      {loadError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {sanitizeReportUiError(loadError)}
        </div>
      ) : null}

      <ReportKpiStrip items={kpiItems} />

      <ReportFilterToolbar
        onReset={hasActiveFilters ? clearFilters : undefined}
        resetLabel="Clear"
        leftExtras={
          <span className="text-[12px] text-slate-500">
            Showing <span className="font-semibold tabular-nums text-slate-800">{filtered.length}</span>
            {filtered.length !== rows.length ? (
              <>
                {" "}
                of <span className="tabular-nums">{rows.length}</span>
              </>
            ) : null}{" "}
            {isNoQty ? "NO_QTY" : "Regular"} rows
          </span>
        }
      >
        <ReportFilterField label="Flow">
          <select
            value={flow}
            onChange={(e) => patch({ flow: e.target.value as WoTrackingFlow })}
            aria-label="Work order flow"
          >
            <option value="REGULAR">Regular SO</option>
            <option value="NO_QTY">NO_QTY</option>
          </select>
        </ReportFilterField>
        <ReportFilterField label="Status">
          <select
            value={woScope}
            onChange={(e) => setScope(e.target.value as WoScopeFilter)}
            aria-label="Open closed or all"
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
        </ReportFilterField>
        <ReportFilterField label="Customer">
          <select
            value={customerName}
            onChange={(e) => patch({ customerName: e.target.value || null })}
            aria-label="Customer"
          >
            <option value="">All</option>
            {customers.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </ReportFilterField>
        <ReportFilterField label="From">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => patch({ dateFrom: e.target.value || null })}
          />
        </ReportFilterField>
        <ReportFilterField label="To">
          <Input type="date" value={dateTo} onChange={(e) => patch({ dateTo: e.target.value || null })} />
        </ReportFilterField>
        <ReportFilterField label="Search" span={2}>
          <input
            type="search"
            className="search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="SO, WO, RS, item…"
            aria-label="Search"
          />
        </ReportFilterField>
      </ReportFilterToolbar>

      <Card className="min-h-0 flex-1 border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <ReportResultsLoadGate
            firstLoadDone={firstLoadDone}
            loading={loading}
            hasDisplayData={data != null}
            isEmpty={filtered.length === 0}
            error={
              loadError && data == null ? (
                <div className="px-4 py-8 text-sm text-red-700">{sanitizeReportUiError(loadError)}</div>
              ) : null
            }
            emptyState={<ReportEmptyState title={emptyMessage} body="Adjust Flow, Status, or Search and try again." />}
          >
            <ReportTableShell>
              <table className="erp-table erp-table-dense w-full table-fixed border-collapse text-left text-[12px]">
                <colgroup>
                  {isNoQty ? (
                    <>
                      <col className="w-[7%]" />
                      <col className="w-[9%]" />
                      <col className="w-[7%]" />
                      <col className="w-[14%]" />
                      <col className="w-[8%]" />
                      <col className="w-[12%]" />
                      <col className="w-[11%]" />
                      <col className="w-[11%]" />
                      <col className="w-[10%]" />
                      <col className="w-[11%]" />
                    </>
                  ) : (
                    <>
                      <col className="w-[8%]" />
                      <col className="w-[8%]" />
                      <col className="w-[16%]" />
                      <col className="w-[9%]" />
                      <col className="w-[13%]" />
                      <col className="w-[12%]" />
                      <col className="w-[12%]" />
                      <col className="w-[10%]" />
                      <col className="w-[12%]" />
                    </>
                  )}
                </colgroup>
                <thead className="sticky top-0 z-[1]">
                  <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-1.5">SO</th>
                    {isNoQty ? <th className="px-2 py-1.5">RS / Cycle</th> : null}
                    <th className="px-2 py-1.5">WO</th>
                    <th className="px-2 py-1.5">Item</th>
                    <th className="px-2 py-1.5 text-right" title={isNoQty ? "Customer Demand" : "Ordered Qty"}>
                      {isNoQty ? "Demand" : "Ordered"}
                    </th>
                    <th className="px-2 py-1.5">Production</th>
                    <th className="px-2 py-1.5">QC</th>
                    <th className="px-2 py-1.5">Dispatch</th>
                    {isNoQty ? <th className="px-2 py-1.5">Recovery</th> : null}
                    <th className="px-2 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const prod = productionProgress(r);
                    const qc = qcProgress(r);
                    const disp = dispatchProgress(r, isNoQty);
                    const st = statusDisplay(r, isNoQty);
                    const recoveryKind = classifyRecoveryBadge(r);
                    const open = expandedId === r.workOrderLineId;
                    const prodPend = Number(r.activeProductionPendingQty ?? r.productionPendingQty ?? 0);
                    const dispPend = Number(r.activeDispatchPendingQty ?? r.dispatchPendingQty ?? 0);
                    return (
                      <React.Fragment key={r.workOrderLineId}>
                        <tr
                          className={cn(
                            "border-b border-slate-100 align-top hover:bg-slate-50/80",
                            open && "bg-slate-50/90",
                          )}
                        >
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              className="inline-flex items-center gap-0.5 font-semibold tabular-nums text-slate-900 hover:text-sky-800"
                              onClick={() => setExpandedId(open ? null : r.workOrderLineId)}
                              aria-expanded={open}
                              aria-label={open ? "Collapse row" : "Expand row"}
                            >
                              {open ? (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              )}
                              {r.salesOrderNo}
                            </button>
                            <div className="mt-0.5 truncate pl-4 text-[10px] text-slate-500" title={r.customerName}>
                              {r.customerName}
                            </div>
                          </td>
                          {isNoQty ? (
                            <td className="px-2 py-2">
                              <div className="font-medium tabular-nums text-slate-800">{r.requirementSheetNo ?? "—"}</div>
                              <div className="text-[10px] text-slate-500">
                                C{r.cycleNo ?? "—"}
                                {r.cycleStatus ? ` · ${r.cycleStatus}` : ""}
                              </div>
                            </td>
                          ) : null}
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              className="font-medium tabular-nums text-sky-800 hover:underline disabled:text-slate-800 disabled:no-underline"
                              disabled={!canDrillWorkOrder}
                              onClick={() => navigate(withReportsReturnContext(workOrdersFocusHref(r.workOrderId)))}
                            >
                              {r.workOrderNo}
                            </button>
                          </td>
                          <td className="px-2 py-2">
                            <div className="truncate font-medium text-slate-800" title={r.itemName}>
                              {r.itemName}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold text-slate-900">
                            {isNoQty
                              ? r.customerDemandQty == null
                                ? "—"
                                : formatQtyCompact(r.customerDemandQty)
                              : r.orderedQty == null
                                ? "—"
                                : formatQtyCompact(r.orderedQty)}
                          </td>
                          <td className="px-2 py-1.5">
                            <ProgressCell
                              done={prod.done}
                              total={prod.total}
                              pending={prodPend}
                              emphasize={prodPend > 1e-6}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <ProgressCell
                              done={qc.done}
                              total={qc.total}
                              pending={r.qcPendingQty}
                              emphasize={r.qcPendingQty > 1e-6}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <ProgressCell
                              done={disp.done}
                              total={disp.total}
                              pending={dispPend}
                              emphasize={dispPend > 1e-6}
                            />
                          </td>
                          {isNoQty ? (
                            <td className="px-2 py-2">
                              <button
                                type="button"
                                className="max-w-full"
                                onClick={() => setRecoveryRow(r)}
                                title="View recovery detail"
                              >
                                <Badge variant={recoveryBadgeVariant(recoveryKind)} density="compact" className="cursor-pointer">
                                  {recoveryBadgeLabel(recoveryKind)}
                                </Badge>
                              </button>
                            </td>
                          ) : null}
                          <td className="px-2 py-2">
                            <Badge variant={st.variant} density="compact">
                              {st.label}
                            </Badge>
                          </td>
                        </tr>
                        {open ? (
                          <tr className="border-b border-slate-200 bg-slate-50/60">
                            <td colSpan={isNoQty ? 10 : 9} className="px-3 py-2.5">
                              <ExpandedDetail r={r} isNoQty={isNoQty} />
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </ReportTableShell>
          </ReportResultsLoadGate>
        </CardContent>
      </Card>

      {recoveryRow ? (
        <ErpModal
          onClose={() => setRecoveryRow(null)}
          closeOnBackdropClick
          aria-labelledby="wo-tracking-recovery-title"
          backdropClassName="bg-slate-950/40"
        >
          <div className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3 id="wo-tracking-recovery-title" className="text-sm font-semibold text-slate-900">
                  Recovery / Carry Forward
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {recoveryRow.salesOrderNo} · {recoveryRow.workOrderNo} · {recoveryRow.itemName}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setRecoveryRow(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <RecoveryDetailBody r={recoveryRow} />
          </div>
        </ErpModal>
      ) : null}
    </ReportPageShell>
  );
}

function ExpandedDetail({ r, isNoQty }: { r: WoTrackingRow; isNoQty: boolean }) {
  const cells = [
    { k: "Required", v: r.requiredQty ?? r.workOrderQty },
    { k: "Planned", v: r.plannedQty },
    { k: "Produced", v: r.producedQty },
    { k: "Accepted", v: r.acceptedQty },
    { k: "Rejected", v: r.rejectedQty },
    { k: "Dispatched", v: r.dispatchedQty },
    {
      k: isNoQty ? "Active Prod Pend" : "Prod Pend",
      v: r.activeProductionPendingQty ?? r.productionPendingQty,
    },
    { k: "QC Pend", v: r.qcPendingQty },
    {
      k: isNoQty ? "Active Disp Pend" : "Disp Pend",
      v: r.activeDispatchPendingQty ?? r.dispatchPendingQty,
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Quantities</p>
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {cells.map((c) => (
            <React.Fragment key={c.k}>
              <dt className="text-slate-500">{c.k}</dt>
              <dd className="text-right tabular-nums font-medium text-slate-800">
                {c.v == null ? "—" : formatQtyCompact(Number(c.v))}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Context</p>
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-slate-500">Customer</dt>
          <dd className="truncate text-right font-medium text-slate-800">{r.customerName}</dd>
          <dt className="text-slate-500">WO status</dt>
          <dd className="text-right font-medium text-slate-800">{r.workOrderStatus}</dd>
          <dt className="text-slate-500">Execution</dt>
          <dd className="text-right font-medium text-slate-800">{r.executionStatus ?? "—"}</dd>
          {isNoQty ? (
            <>
              <dt className="text-slate-500">SO status</dt>
              <dd className="text-right font-medium text-slate-800">{r.salesOrderInternalStatus ?? "—"}</dd>
              <dt className="text-slate-500">RS status</dt>
              <dd className="text-right font-medium text-slate-800">{r.requirementSheetStatus ?? "—"}</dd>
            </>
          ) : null}
        </dl>
      </div>
      {isNoQty ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recovery summary</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-700">{r.recoveryCarryForwardOutcome ?? "NONE"}</p>
        </div>
      ) : (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Dispatch note</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            Dispatched qty on this report is the WO-line share of SO+item confirmed dispatch (presentation).
          </p>
        </div>
      )}
    </div>
  );
}

function RecoveryDetailBody({ r }: { r: WoTrackingRow }) {
  const d = parseRecoveryDetail(r);
  const rows: { k: string; v: string }[] = [
    { k: "Production Shortfall", v: d.productionShortfall == null ? "—" : formatQtyCompact(d.productionShortfall) },
    { k: "Recovery Status", v: d.recoveryStatus },
    { k: "Keep / Allocated Qty", v: d.keepQty == null ? "—" : formatQtyCompact(d.keepQty) },
    { k: "Cycle", v: d.cycleLabel },
    { k: "Execution", v: d.executionStatus },
    { k: "Outcome", v: d.outcome },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
      {rows.map((row) => (
        <React.Fragment key={row.k}>
          <dt className="text-xs text-slate-500">{row.k}</dt>
          <dd className="text-right text-xs font-medium text-slate-900">{row.v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
