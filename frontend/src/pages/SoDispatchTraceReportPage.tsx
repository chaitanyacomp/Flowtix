import * as React from "react";
import { Card, CardContent } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { useAuth } from "../hooks/useAuth";
import { ALL_APP_ROLES } from "../components/ProtectedRoute";
import { PageContainer, ReportPageHeader, StickyReportBackStrip } from "../components/PageHeader";
import { ReportFilterToolbar, ReportFilterField } from "../components/erp/ReportChrome";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import {
  OperationalDispatchSnapshot,
  type OperationalDispatchSnapshotMetrics,
} from "../components/erp/OperationalDispatchSnapshot";
import { buildNoQtyOperationalMetrics, type DispatchSoLike } from "../lib/noQtyOperationalMetrics";

type TraceCell = {
  label: string | null;
  date: string | null;
  /** Quantity / breakdown lines for this stage (row-specific). */
  detailLines?: string[];
};

type TraceRow = {
  rowKey: string;
  salesOrder: TraceCell;
  workOrder: TraceCell;
  production: TraceCell;
  qc: TraceCell;
  dispatch: TraceCell;
};

type SoSummaryItem = {
  salesOrderId: number;
  salesOrderNo: string;
  orderType?: string | null;
  /** NO_QTY: active cycle number when available */
  cycleNo?: number | null;
  soQty: number | null;
  dispatchQty: number;
  balanceQty: number | null;
};

type TracePayload = {
  rows: TraceRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  soSummaries: SoSummaryItem[];
};

type FgItem = { id: number; itemName: string };

function formatSummaryQty(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const r = Math.round(n * 1000) / 1000;
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return String(r);
}

function formatTraceDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-GB", { month: "short" });
  const y = d.getFullYear();
  return `(${dd}-${mon}-${y})`;
}

function TraceCellDisplay({ cell }: { cell: TraceCell }) {
  if (!cell.label) {
    return <span className="text-slate-400">—</span>;
  }
  const details = cell.detailLines ?? [];
  return (
    <div className="leading-tight">
      <div className="font-semibold text-slate-900">{cell.label}</div>
      {cell.date ? <div className="text-[11px] text-slate-500">{formatTraceDate(cell.date)}</div> : null}
      {details.map((line, i) => (
        <div key={i} className="text-xs text-slate-600">
          {line}
        </div>
      ))}
    </div>
  );
}

const PAGE_SIZE = 50;

function soDispatchTraceAllowed(role: string | undefined): boolean {
  return role != null && ALL_APP_ROLES.includes(role as (typeof ALL_APP_ROLES)[number]);
}

export function SoDispatchTraceReportPage() {
  const auth = useAuth();
  const allowed = soDispatchTraceAllowed(auth.user?.role);

  const [rows, setRows] = React.useState<TraceRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [soSearch, setSoSearch] = React.useState("");
  const [itemId, setItemId] = React.useState<number | "">("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [filterTick, setFilterTick] = React.useState(0);
  const [fgItems, setFgItems] = React.useState<FgItem[]>([]);
  const [soSummaries, setSoSummaries] = React.useState<SoSummaryItem[]>([]);
  const [operationalSnapshot, setOperationalSnapshot] = React.useState<OperationalDispatchSnapshotMetrics | null>(
    null,
  );
  const [snapshotLoading, setSnapshotLoading] = React.useState(false);
  const liveTick = useErpRefreshTick(["reports", "dispatch", "production", "qc"], {
    pollIntervalMs: ERP_REPORT_POLL_MS,
  });

  React.useEffect(() => {
    if (!allowed) return;
    apiFetch<FgItem[]>("/api/items?type=FG")
      .then(setFgItems)
      .catch(() => setFgItems([]));
  }, [allowed, liveTick]);

  const load = React.useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      const t = soSearch.trim();
      if (t) params.set("soSearch", t);
      if (itemId !== "" && Number.isFinite(itemId)) params.set("itemId", String(itemId));
      if (dateFrom.trim()) params.set("dateFrom", dateFrom.trim());
      if (dateTo.trim()) params.set("dateTo", dateTo.trim());
      const data = await apiFetch<TracePayload>(`/api/reports/so-dispatch-trace?${params.toString()}`);
      setRows(data.rows);
      setTotal(data.total);
      setPage(data.page);
      setTotalPages(data.totalPages);
      setSoSummaries(Array.isArray(data.soSummaries) ? data.soSummaries : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trace");
      setRows([]);
      setSoSummaries([]);
    } finally {
      setLoading(false);
    }
  }, [allowed, page, soSearch, itemId, dateFrom, dateTo, filterTick, liveTick]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const focusedNoQtySummary =
    soSummaries.length === 1 && soSummaries[0]?.orderType === "NO_QTY" ? soSummaries[0] : null;
  const focusedItemId = itemId !== "" && Number.isFinite(Number(itemId)) ? Number(itemId) : null;

  React.useEffect(() => {
    if (!focusedNoQtySummary || focusedItemId == null) {
      setOperationalSnapshot(null);
      return;
    }
    let cancelled = false;
    setSnapshotLoading(true);
    (async () => {
      try {
        const soId = focusedNoQtySummary.salesOrderId;
        const cycles = await apiFetch<Array<{ id: number; cycleNo: number }>>(
          `/api/dispatch/no-qty-cycles?soId=${soId}`,
        );
        const cycleNo = focusedNoQtySummary.cycleNo;
        const cycleList = Array.isArray(cycles) ? cycles : [];
        const cycle =
          cycleNo != null
            ? cycleList.find((c) => Number(c.cycleNo) === Number(cycleNo))
            : cycleList[0];
        const cycleId = cycle?.id;
        const qs = new URLSearchParams();
        qs.set("noQtySoId", String(soId));
        if (cycleId != null) qs.set("noQtyCycleId", String(cycleId));
        const list = await apiFetch<DispatchSoLike[]>(`/api/dispatch/sales-orders?${qs.toString()}`);
        const so = (Array.isArray(list) ? list : []).find((r) => Number(r.id) === soId) ?? null;
        if (cancelled || !so) {
          if (!cancelled) setOperationalSnapshot(null);
          return;
        }
        const metrics = buildNoQtyOperationalMetrics(so, focusedItemId, {
          totalDispatchedOverride: focusedNoQtySummary.dispatchQty,
        });
        if (!cancelled) setOperationalSnapshot(metrics);
      } catch {
        if (!cancelled) setOperationalSnapshot(null);
      } finally {
        if (!cancelled) setSnapshotLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusedNoQtySummary, focusedItemId, liveTick]);

  function applyFilters() {
    setPage(1);
    setFilterTick((t) => t + 1);
  }

  if (!allowed) {
    return (
      <PageContainer className="pb-8">
        <StickyReportBackStrip />
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-slate-600">You do not have access to this report.</p>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="pb-8">
      <ReportPageHeader
        title="SO to Dispatch Trace"
        purpose="Follow each FG line from sales order through work order, production, QC, and dispatch (read-only). Partial flows show blank downstream cells."
      />
      <ReportFilterToolbar onApply={applyFilters} applyLabel="Apply" applyBusy={loading}>
        <ReportFilterField label="SO #">
          <input
            type="text"
            placeholder="e.g. 12"
            value={soSearch}
            onChange={(e) => setSoSearch(e.target.value)}
          />
        </ReportFilterField>
        <ReportFilterField label="Item (FG)">
          <select
            value={itemId === "" ? "" : String(itemId)}
            onChange={(e) => setItemId(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">All</option>
            {fgItems.map((it) => (
              <option key={it.id} value={it.id}>
                {it.itemName}
              </option>
            ))}
          </select>
        </ReportFilterField>
        <ReportFilterField label="From">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </ReportFilterField>
        <ReportFilterField label="To">
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </ReportFilterField>
      </ReportFilterToolbar>
      <div className="erp-info-strip" data-tone="info">
        <span className="font-semibold">Tip:</span>
        <span>
          Filter to one NO_QTY sales order and one FG item to see an operational dispatch snapshot (customer
          pending, usable stock, can dispatch now).
        </span>
      </div>
      {error ? <div className="text-sm text-red-700">{error}</div> : null}

      {snapshotLoading ? (
        <p className="text-xs text-slate-500">Loading operational snapshot…</p>
      ) : operationalSnapshot ? (
        <OperationalDispatchSnapshot metrics={operationalSnapshot} />
      ) : null}

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
            <div className="relative min-w-0 flex-1">
              {loading ? (
                <div
                  className="pointer-events-none absolute inset-0 z-[1] flex items-start justify-center bg-white/55 pt-10"
                  aria-busy
                >
                  <span className="rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm">
                    Loading…
                  </span>
                </div>
              ) : null}
              <div className={`erp-table-wrap mb-3 overflow-x-auto ${loading ? "opacity-60" : ""}`}>
                  <table className="erp-table w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-slate-600">
                        <th className="py-2 pr-3 align-top">
                          <div className="font-semibold text-slate-800">Sales order</div>
                          <div className="text-[10px] font-normal normal-case text-slate-500">Doc · date · ordered qty</div>
                        </th>
                        <th className="py-2 pr-3 align-top">
                          <div className="font-semibold text-slate-800">Work order</div>
                          <div className="text-[10px] font-normal normal-case text-slate-500">Doc · date · line qty</div>
                        </th>
                        <th className="py-2 pr-3 align-top">
                          <div className="font-semibold text-slate-800">Production</div>
                          <div className="text-[10px] font-normal normal-case text-slate-500">Batch · date · produced</div>
                        </th>
                        <th className="py-2 pr-3 align-top">
                          <div className="font-semibold text-slate-800">QC</div>
                          <div className="text-[10px] font-normal normal-case text-slate-500">Entry · date · accepted / rejected</div>
                        </th>
                        <th className="py-2 pr-3 align-top">
                          <div className="font-semibold text-slate-800">Dispatch</div>
                          <div className="text-[10px] font-normal normal-case text-slate-500">
                            Doc · date (ref.; qty on right)
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-4 text-slate-600">
                            No rows match the current filters.
                          </td>
                        </tr>
                      ) : (
                        rows.map((r) => (
                          <tr key={r.rowKey} className="border-t border-slate-100">
                            <td className="align-top py-2 pr-3">
                              <TraceCellDisplay cell={r.salesOrder} />
                            </td>
                            <td className="align-top py-2 pr-3">
                              <TraceCellDisplay cell={r.workOrder} />
                            </td>
                            <td className="align-top py-2 pr-3">
                              <TraceCellDisplay cell={r.production} />
                            </td>
                            <td className="align-top py-2 pr-3">
                              <TraceCellDisplay cell={r.qc} />
                            </td>
                            <td className="align-top py-2 pr-3">
                              <TraceCellDisplay cell={r.dispatch} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-700">
                  <span>
                    {total === 0 ? "0" : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)}`} of {total}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page <= 1 || loading}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <span className="tabular-nums">
                      Page {page} / {totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages || loading}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
            </div>

              <aside className="w-full shrink-0 border-t border-slate-200 pt-4 lg:w-[min(100%,320px)] lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0 xl:w-[300px] lg:sticky lg:top-4 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
                <div className="mb-2 border-b border-slate-100 pb-2">
                  <h2 className="text-sm font-semibold text-slate-800">SO summary</h2>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                    Filtered scope (not page-limited). One card per sales order in scope.
                  </p>
                </div>
                {soSummaries.length === 0 ? (
                  <p className="text-xs text-slate-500">No sales orders in the current filter scope.</p>
                ) : (
                  <ul className="space-y-2">
                    {soSummaries.map((s) => {
                      const isNoQty = s.orderType === "NO_QTY";
                      const pending = !isNoQty && (s.balanceQty ?? 0) > 1e-9;
                      return (
                        <li
                          key={s.salesOrderId}
                          className="rounded-md border border-slate-200 bg-slate-50/90 px-3 py-2.5 shadow-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">SO No</span>
                            <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-sky-900">
                              {s.salesOrderNo}
                            </span>
                          </div>
                          {isNoQty ? (
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              Cycle-based order
                              {s.cycleNo != null && Number.isFinite(Number(s.cycleNo)) ? (
                                <span className="text-slate-600"> · Cycle: {s.cycleNo}</span>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="mt-2 space-y-1 text-sm tabular-nums">
                            {isNoQty ? (
                              <>
                                <div className="flex justify-between gap-3">
                                  <span className="text-slate-600">Total dispatched</span>
                                  <span className="font-medium text-slate-900">{formatSummaryQty(s.dispatchQty)}</span>
                                </div>
                                <p className="text-[10px] leading-snug text-slate-500">
                                  Open order — use operational snapshot above when one item is selected.
                                </p>
                              </>
                            ) : (
                              <>
                                <div className="flex justify-between gap-3">
                                  <span className="text-slate-600">SO Qty</span>
                                  <span className="font-medium text-slate-900">{formatSummaryQty(s.soQty)}</span>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <span className="text-slate-600">Total dispatched</span>
                                  <span className="font-medium text-slate-900">{formatSummaryQty(s.dispatchQty)}</span>
                                </div>
                                <div
                                  className={
                                    pending
                                      ? "flex justify-between gap-3 rounded border border-amber-200/80 bg-amber-50/90 px-2 py-1 -mx-0.5"
                                      : "flex justify-between gap-3"
                                  }
                                >
                                  <span className={pending ? "font-medium text-amber-900" : "text-slate-600"}>
                                    Balance pending
                                  </span>
                                  <span
                                    className={
                                      pending ? "font-semibold tabular-nums text-amber-950" : "font-medium text-slate-900"
                                    }
                                  >
                                    {formatSummaryQty(s.balanceQty)}
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </aside>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
