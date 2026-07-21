import * as React from "react";
import { cn } from "../../lib/utils";
import { apiFetch } from "../../services/api";
import type { DashboardProductionStatusSource } from "../../lib/dashboardProductionStatus";
import {
  classifyLiveFactoryBucket,
  liveFactoryStatusLabel,
  summarizeLiveFactoryCounters,
  type LiveFactoryBucket,
} from "../../lib/liveFactoryStatus";
import { formatQuantityWithUnit } from "../../lib/quantityDisplay";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

const PAGE_SIZE = 25;

type StatusFilter =
  | "ALL_ACTIVE"
  | "READY_TO_START"
  | "RUNNING"
  | "PAUSED"
  | "BLOCKED"
  | "AWAITING_REPORT"
  | "PENDING_QC";

type MonitorRow = DashboardProductionStatusSource & {
  liveFactoryBucket?: LiveFactoryBucket | string | null;
};

function formatAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

function blockerOrNext(row: MonitorRow, bucket: LiveFactoryBucket): string {
  if (bucket === "BLOCKED" || bucket === "PAUSED") {
    return (
      String(row.productionBlockReasonLabel ?? row.holdReason ?? row.productionBlockRemarks ?? "").trim() ||
      (row.rmReadyForProduction === false
        ? String(row.rmReadinessGate ?? "RM not ready").replace(/_/g, " ")
        : "Review")
    );
  }
  if (bucket === "READY_TO_START") return "Start production";
  if (bucket === "RUNNING") return "Continue production";
  if (bucket === "AWAITING_REPORT") return "Complete report";
  if (bucket === "PENDING_QC") return "Pending QC";
  return String(row.actionLabel ?? row.nextAction ?? "—");
}

type Props = {
  /** When true, expand Factory Monitor (focus=factory). */
  emphasized?: boolean;
  className?: string;
};

/**
 * Control Tower — dense WO-wise Factory Monitor (read-only).
 * Same production-queue + liveFactoryBucket classification as Admin Live Factory Status.
 */
export function ControlTowerFactoryMonitor({ emphasized = false, className }: Props) {
  const [rows, setRows] = React.useState<MonitorRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("ALL_ACTIVE");
  const [customer, setCustomer] = React.useState("");
  const [product, setProduct] = React.useState("");
  const [woSearch, setWoSearch] = React.useState("");
  const [page, setPage] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    apiFetch<MonitorRow[]>("/api/dashboard/production-queue")
      .then((data) => {
        if (!cancelled) {
          setRows(Array.isArray(data) ? data : []);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRows([]);
          setError(err instanceof Error ? err.message : "Failed to load factory monitor");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const primaries = React.useMemo(() => {
    const byWo = new Map<number, MonitorRow>();
    for (const row of rows ?? []) {
      const woId = Number(row.workOrderId);
      if (!(woId > 0)) continue;
      const cur = byWo.get(woId);
      if (!cur || Number(row.balanceQty ?? 0) > Number(cur.balanceQty ?? 0)) byWo.set(woId, row);
    }
    return [...byWo.values()];
  }, [rows]);

  const counters = React.useMemo(() => summarizeLiveFactoryCounters(primaries), [primaries]);

  const filtered = React.useMemo(() => {
    const q = woSearch.trim().toLowerCase();
    const cust = customer.trim().toLowerCase();
    const prod = product.trim().toLowerCase();
    return primaries.filter((row) => {
      const bucket = classifyLiveFactoryBucket(row);
      if (bucket === "COMPLETED") return false;
      if (statusFilter !== "ALL_ACTIVE" && bucket !== statusFilter) return false;
      if (cust && !String(row.customerName ?? "").toLowerCase().includes(cust)) return false;
      if (prod && !String(row.itemName ?? "").toLowerCase().includes(prod)) return false;
      if (
        q &&
        !`${row.workOrderNo ?? ""} ${row.salesOrderNo ?? ""} ${row.itemName ?? ""}`.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [primaries, statusFilter, customer, product, woSearch]);

  React.useEffect(() => {
    setPage(0);
  }, [statusFilter, customer, product, woSearch]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const filterBtn = (id: StatusFilter, label: string, count?: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setStatusFilter(id)}
      className={cn(
        "rounded-md px-2 py-1 text-[12px] font-medium",
        statusFilter === id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
      )}
    >
      {label}
      {count != null ? <span className="ml-1 tabular-nums opacity-80">{count}</span> : null}
    </button>
  );

  return (
    <section
      id="control-tower-factory-monitor"
      aria-labelledby="control-tower-factory-monitor-heading"
      className={cn("space-y-2", className)}
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="control-tower-factory-monitor-heading" className="text-lg font-semibold text-slate-900">
            Factory Monitor
          </h2>
          <p className="text-[13px] text-slate-600">
            WO-wise operational view · shared Live Factory classification
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-slate-600">
          <div>
            Ready <span className="font-semibold tabular-nums text-slate-900">{counters.readyToStart}</span>
          </div>
          <div>
            Running <span className="font-semibold tabular-nums text-slate-900">{counters.running}</span>
          </div>
          <div>
            Paused <span className="font-semibold tabular-nums text-slate-900">{counters.paused}</span>
          </div>
          <div>
            Blocked <span className="font-semibold tabular-nums text-slate-900">{counters.blocked}</span>
          </div>
          <div>
            Report <span className="font-semibold tabular-nums text-slate-900">{counters.awaitingReport}</span>
          </div>
          <div>
            QC <span className="font-semibold tabular-nums text-slate-900">{counters.pendingQc}</span>
          </div>
        </dl>
      </div>

      <Card className={cn(emphasized && "ring-2 ring-sky-200")}>
        <CardHeader className="space-y-2 border-b border-slate-100 px-3 py-2">
          <CardTitle className="sr-only">Factory Monitor filters</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {filterBtn("ALL_ACTIVE", "All Active", filtered.length)}
            {filterBtn("READY_TO_START", "Ready to Start", counters.readyToStart)}
            {filterBtn("RUNNING", "Running", counters.running)}
            {filterBtn("PAUSED", "Paused", counters.paused)}
            {filterBtn("BLOCKED", "Blocked", counters.blocked)}
            {filterBtn("AWAITING_REPORT", "Awaiting Report", counters.awaitingReport)}
            {filterBtn("PENDING_QC", "Pending QC", counters.pendingQc)}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              type="search"
              value={woSearch}
              onChange={(e) => setWoSearch(e.target.value)}
              placeholder="WO / SO search"
              className="h-8 rounded-md border border-slate-200 px-2 text-[13px]"
              aria-label="WO search"
            />
            <input
              type="search"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="Customer"
              className="h-8 rounded-md border border-slate-200 px-2 text-[13px]"
              aria-label="Customer filter"
            />
            <input
              type="search"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              placeholder="Product"
              className="h-8 rounded-md border border-slate-200 px-2 text-[13px]"
              aria-label="Product filter"
            />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0 py-0">
          {error ? <p className="px-3 py-2 text-[13px] text-red-800">{error}</p> : null}
          {rows === null ? (
            <p className="px-3 py-2 text-[13px] text-slate-600">Loading factory monitor…</p>
          ) : pageRows.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-slate-600">No work orders match the current filters.</p>
          ) : (
            <table className="w-full min-w-[960px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-[12px] text-slate-600">
                  <th className="px-2 py-1.5 font-semibold">WO</th>
                  <th className="px-2 py-1.5 font-semibold">SO / cycle</th>
                  <th className="px-2 py-1.5 font-semibold">Customer</th>
                  <th className="px-2 py-1.5 font-semibold">Product</th>
                  <th className="px-2 py-1.5 font-semibold tabular-nums">Planned</th>
                  <th className="px-2 py-1.5 font-semibold tabular-nums">Produced</th>
                  <th className="px-2 py-1.5 font-semibold tabular-nums">Remaining</th>
                  <th className="px-2 py-1.5 font-semibold">Status</th>
                  <th className="px-2 py-1.5 font-semibold">Owner</th>
                  <th className="px-2 py-1.5 font-semibold">Blocker / next</th>
                  <th className="px-2 py-1.5 font-semibold">Age</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const bucket = classifyLiveFactoryBucket(row);
                  const soCycle = [row.salesOrderNo, row.cycleNo != null ? `C${row.cycleNo}` : null]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <tr key={row.workOrderId} className="border-b border-slate-100 align-top">
                      <td className="px-2 py-1.5 font-semibold text-slate-900">{row.workOrderNo}</td>
                      <td className="px-2 py-1.5 text-slate-700">{soCycle || "—"}</td>
                      <td className="max-w-[9rem] truncate px-2 py-1.5 text-slate-700">{row.customerName ?? "—"}</td>
                      <td className="max-w-[10rem] truncate px-2 py-1.5 text-slate-700">{row.itemName}</td>
                      <td className="px-2 py-1.5 tabular-nums text-slate-800">
                        {formatQuantityWithUnit(row.requiredQty, row.itemUnit)}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-slate-800">
                        {formatQuantityWithUnit(row.producedQty, row.itemUnit)}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-slate-800">
                        {formatQuantityWithUnit(Math.max(0, Number(row.balanceQty ?? 0)), row.itemUnit)}
                      </td>
                      <td className="px-2 py-1.5 font-medium text-slate-900">{liveFactoryStatusLabel(bucket)}</td>
                      <td className="px-2 py-1.5 text-slate-600">Production</td>
                      <td className="max-w-[12rem] truncate px-2 py-1.5 text-slate-700">
                        {blockerOrNext(row, bucket)}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-slate-600">
                        {formatAge(row.pausedAt ?? row.workOrderDate ?? null)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {filtered.length > PAGE_SIZE ? (
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-[12px] text-slate-600">
              <span>
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of{" "}
                {filtered.length}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
