/**
 * Store Operations — read-only Production Monitor.
 * Consumes /api/dashboard/production-monitor. No production mutation CTAs.
 */

import * as React from "react";
import { ChevronDown, ChevronRight, Factory, Search } from "lucide-react";
import { apiFetch } from "../../../services/api";
import { cn } from "../../../lib/utils";
import { displaySalesOrderNo, displayWorkOrderNo } from "../../../lib/docNoDisplay";
import { ErpEmptyState } from "../foundation/ErpEmptyState";
import { ErpRefreshingBadge } from "../foundation/ErpRefreshingBadge";
import { Input } from "../../ui/input";
import type { DashboardProductionStatusSource } from "../../../lib/dashboardProductionStatus";
import {
  buildStoreMonitorWorkspaceParity,
  buildStoreProductionMonitorCounts,
  collectMonitorMachines,
  enrichStoreProductionMonitorRow,
  filterStoreProductionMonitorRows,
  formatMonitorQty,
  storeMonitorStatusLabel,
  storeMonitorStatusToneClass,
  type StoreProductionMonitorFilter,
  type StoreProductionMonitorRow,
} from "../../../lib/storeProductionMonitor";
import { ERP_DASHBOARD_POLL_MS, useErpRefreshTick } from "../../../hooks/useErpRefreshTick";
import { useRouteActive } from "../../../hooks/useRouteActive";

type MonitorApiPayload = {
  readOnly?: boolean;
  activeRows?: DashboardProductionStatusSource[];
  completedTodayRows?: DashboardProductionStatusSource[];
  generatedAt?: string;
};

type ExecutionDetail = {
  workOrderId: number;
  workOrderDocNo?: string | null;
  workOrderStatus?: string;
  executionStatus?: string | null;
  blockReason?: string | null;
  blockReasonLabel?: string | null;
  blockRemarks?: string | null;
  blockedAt?: string | null;
  plannedQty?: number;
  producedQty?: number;
  remainderQty?: number;
  productionPendingQty?: number;
  pendingShortfallResolution?: boolean;
  lines?: Array<{
    workOrderLineId: number;
    fgItemName?: string | null;
    plannedQty: number;
    producedQty: number;
    remainderQty: number;
  }>;
};

const FILTERS: { id: StoreProductionMonitorFilter; label: string }[] = [
  { id: "ALL_ACTIVE", label: "All Active" },
  { id: "RUNNING", label: "Running" },
  { id: "PAUSED", label: "Paused" },
  { id: "BLOCKED", label: "Blocked" },
  { id: "AWAITING_REPORT", label: "Awaiting Report" },
  { id: "READY_TO_START", label: "Ready to Start" },
  { id: "COMPLETED_TODAY", label: "Completed Today" },
];

/** Compact single-line timestamp: `19 Jul · 9:20 PM` */
function formatWhenCompact(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = d.toLocaleString(undefined, { day: "numeric", month: "short" });
  const time = d.toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

function CounterChip({
  label,
  value,
  active,
  onClick,
  warn,
}: {
  label: string;
  value: number;
  active?: boolean;
  onClick: () => void;
  warn?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-w-[5.5rem] flex-1 flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors",
        active
          ? "border-blue-300 bg-blue-50/80 ring-1 ring-blue-200"
          : warn && value > 0
            ? "border-amber-200/90 bg-amber-50/40 hover:border-amber-300"
            : "border-slate-200/90 bg-white hover:border-slate-300",
      )}
    >
      <span className="text-[12px] font-semibold text-slate-600">{label}</span>
      <span
        className={cn(
          "text-lg font-extrabold tabular-nums leading-none",
          value > 0 ? (warn ? "text-amber-950" : "text-slate-950") : "text-slate-400",
        )}
      >
        {value}
      </span>
    </button>
  );
}

function RmReadinessLabel(row: StoreProductionMonitorRow): string {
  if (row.rmReadyForProduction === true) return "RM ready";
  const gate = String(row.rmReadinessGate ?? "").trim();
  if (!gate) return "RM —";
  if (gate === "READY" || gate === "READY_FOR_PRODUCTION") return "RM ready";
  if (gate === "NO_PMR") return "No PMR";
  return gate.replace(/_/g, " ");
}

export function StoreProductionMonitorPanel({
  refreshTick: parentTick,
}: {
  refreshTick?: number;
}) {
  const isDashboardRoute = useRouteActive("/dashboard");
  const internalTick = useErpRefreshTick(["dashboard", "production"], {
    pollIntervalMs: ERP_DASHBOARD_POLL_MS,
    enabled: isDashboardRoute && parentTick == null,
  });
  const liveTick = parentTick ?? internalTick;

  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [activeRows, setActiveRows] = React.useState<StoreProductionMonitorRow[]>([]);
  const [completedTodayRows, setCompletedTodayRows] = React.useState<StoreProductionMonitorRow[]>([]);
  const [filter, setFilter] = React.useState<StoreProductionMonitorFilter>("ALL_ACTIVE");
  const [query, setQuery] = React.useState("");
  const [machine, setMachine] = React.useState("");
  const [expandedKey, setExpandedKey] = React.useState<string | null>(null);
  const [detailByWo, setDetailByWo] = React.useState<Record<number, ExecutionDetail | "loading" | "error">>({});

  const load = React.useCallback(async (opts?: { soft?: boolean }) => {
    if (opts?.soft) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch<MonitorApiPayload>("/api/dashboard/production-monitor");
      const active = (payload.activeRows ?? []).map((r) =>
        enrichStoreProductionMonitorRow({ ...r, completedToday: false }),
      );
      const completed = (payload.completedTodayRows ?? []).map((r) =>
        enrichStoreProductionMonitorRow({ ...r, completedToday: true }),
      );
      setActiveRows(active);
      setCompletedTodayRows(completed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load production monitor");
      setActiveRows([]);
      setCompletedTodayRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void load(liveTick > 0 ? { soft: true } : undefined);
  }, [load, liveTick]);

  const counts = React.useMemo(
    () => buildStoreProductionMonitorCounts(activeRows, completedTodayRows),
    [activeRows, completedTodayRows],
  );

  const workspaceParity = React.useMemo(
    () => buildStoreMonitorWorkspaceParity(activeRows),
    [activeRows],
  );

  const machines = React.useMemo(
    () => collectMonitorMachines(activeRows, completedTodayRows),
    [activeRows, completedTodayRows],
  );

  const visible = React.useMemo(
    () =>
      filterStoreProductionMonitorRows(activeRows, completedTodayRows, {
        filter,
        query,
        machine,
      }),
    [activeRows, completedTodayRows, filter, query, machine],
  );

  const expandRow = async (row: StoreProductionMonitorRow) => {
    const key = `${row.workOrderId}-${row.workOrderLineId ?? 0}`;
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(key);
    if (detailByWo[row.workOrderId]) return;
    setDetailByWo((prev) => ({ ...prev, [row.workOrderId]: "loading" }));
    try {
      const detail = await apiFetch<ExecutionDetail>(
        `/api/production/work-orders/${row.workOrderId}/production-execution`,
      );
      setDetailByWo((prev) => ({ ...prev, [row.workOrderId]: detail }));
    } catch {
      setDetailByWo((prev) => ({ ...prev, [row.workOrderId]: "error" }));
    }
  };

  return (
    <section
      className="space-y-2"
      data-testid="store-production-monitor"
      aria-label="Production Monitor"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[14px] font-extrabold text-slate-950">
            <Factory className="h-4 w-4 text-slate-600" aria-hidden />
            Production Monitor
          </h2>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-600">
            Read-only view of active work orders for RM coordination. Production actions stay in the
            Production Workspace.
          </p>
        </div>
        {refreshing ? <ErpRefreshingBadge className="shrink-0" /> : null}
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="store-production-monitor-counters">
        <CounterChip
          label="Ready to Start"
          value={counts.readyToStart}
          active={filter === "READY_TO_START"}
          onClick={() => setFilter("READY_TO_START")}
        />
        <CounterChip
          label="Running"
          value={counts.running}
          active={filter === "RUNNING"}
          onClick={() => setFilter("RUNNING")}
        />
        <CounterChip
          label="Paused"
          value={counts.paused}
          active={filter === "PAUSED"}
          onClick={() => setFilter("PAUSED")}
          warn
        />
        <CounterChip
          label="Blocked"
          value={counts.blocked}
          active={filter === "BLOCKED"}
          onClick={() => setFilter("BLOCKED")}
          warn
        />
        <CounterChip
          label="Awaiting Report"
          value={counts.awaitingReport}
          active={filter === "AWAITING_REPORT"}
          onClick={() => setFilter("AWAITING_REPORT")}
          warn
        />
        <CounterChip
          label="Completed Today"
          value={counts.completedToday}
          active={filter === "COMPLETED_TODAY"}
          onClick={() => setFilter("COMPLETED_TODAY")}
        />
      </div>

      {/* Hidden parity attributes for regression / debug alignment with Production Workspace */}
      <div
        className="sr-only"
        data-testid="store-production-monitor-workspace-parity"
        data-ready={workspaceParity.ready}
        data-active={workspaceParity.active}
        data-paused={workspaceParity.paused}
        data-report-pending={workspaceParity.reportPending}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              data-testid={`store-pm-filter-${f.id}`}
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-[13px] font-semibold",
                filter === f.id
                  ? "border-blue-300 bg-blue-50 text-blue-950"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search WO / product / SO"
            className="h-9 pl-8 text-[13px]"
            data-testid="store-pm-search"
          />
        </div>
        {machines.length > 0 ? (
          <select
            value={machine}
            onChange={(e) => setMachine(e.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-800"
            data-testid="store-pm-machine-filter"
            aria-label="Machine filter"
          >
            <option value="">All machines</option>
            {machines.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {loading ? (
        <p className="text-xs text-slate-600">Loading production monitor…</p>
      ) : error ? (
        <ErpEmptyState variant="inline" title="Unable to load" body={error} />
      ) : visible.length === 0 ? (
        <ErpEmptyState
          variant="inline"
          title={filter === "COMPLETED_TODAY" ? "No completions today" : "No matching work orders"}
          body="Active production will appear here when Work Orders are released."
        />
      ) : (
        <div className="max-w-full overflow-hidden rounded-lg border border-slate-200/90 bg-white">
          <div className="max-h-[min(70vh,36rem)] overflow-x-hidden overflow-y-auto">
            <table className="w-full min-w-0 table-fixed border-collapse text-left text-[13px]">
              <thead className="sticky top-0 z-[1] bg-slate-50 text-[12px] font-semibold text-slate-600">
                <tr className="h-10">
                  <th className="w-8 px-1.5 py-2" />
                  <th className="w-[9%] px-1.5 py-2">WO</th>
                  <th className="w-[16%] px-1.5 py-2">Product</th>
                  <th className="w-[10%] px-1.5 py-2">SO / Cycle</th>
                  <th className="w-[9%] px-1.5 py-2">Planned</th>
                  <th className="w-[9%] px-1.5 py-2">Good</th>
                  <th className="w-[9%] px-1.5 py-2">Remaining</th>
                  <th className="w-[11%] px-1.5 py-2">Status</th>
                  <th className="w-[8%] px-1.5 py-2">RM</th>
                  <th className="w-[16%] px-1.5 py-2">Next</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const key = `${row.workOrderId}-${row.workOrderLineId ?? 0}`;
                  const open = expandedKey === key;
                  const detail = detailByWo[row.workOrderId];
                  const soLabel = row.salesOrderId
                    ? displaySalesOrderNo(row.salesOrderId, row.salesOrderNo)
                    : row.salesOrderNo ?? "—";
                  const cycleLabel =
                    row.cycleNo != null && Number.isFinite(Number(row.cycleNo))
                      ? ` · C${row.cycleNo}`
                      : "";
                  const productTitle = row.itemCode
                    ? `${row.itemName} (${row.itemCode})`
                    : row.itemName;
                  const lastActivity = row.lastProductionActivityAt ?? row.pausedAt ?? null;
                  return (
                    <React.Fragment key={key}>
                      <tr
                        className={cn(
                          "h-12 border-t border-slate-100 align-middle hover:bg-slate-50/80",
                          open && "bg-slate-50/90",
                        )}
                        data-testid={`store-pm-row-${row.workOrderId}`}
                        data-monitor-status={row.monitorStatus}
                      >
                        <td className="px-1 py-0 align-middle">
                          <button
                            type="button"
                            className="rounded p-0.5 text-slate-500 hover:bg-slate-200/80 hover:text-slate-800"
                            aria-expanded={open}
                            aria-label={open ? "Collapse details" : "View details"}
                            data-testid={`store-pm-expand-${row.workOrderId}`}
                            onClick={() => void expandRow(row)}
                          >
                            {open ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="truncate px-1.5 py-0 align-middle text-[14px] font-medium text-slate-900">
                          {displayWorkOrderNo(row.workOrderId, row.workOrderNo)}
                        </td>
                        <td
                          className="truncate px-1.5 py-0 align-middle text-[14px] font-medium text-slate-900"
                          title={productTitle}
                        >
                          {row.itemName}
                        </td>
                        <td className="truncate whitespace-nowrap px-1.5 py-0 align-middle text-[13px] text-slate-800">
                          {soLabel}
                          {cycleLabel}
                        </td>
                        <td className="truncate whitespace-nowrap px-1.5 py-0 align-middle text-[13px] tabular-nums text-slate-800">
                          {formatMonitorQty(row.requiredQty, row.itemUnit)}
                        </td>
                        <td className="truncate whitespace-nowrap px-1.5 py-0 align-middle text-[13px] tabular-nums text-slate-800">
                          {formatMonitorQty(row.producedQty, row.itemUnit)}
                        </td>
                        <td className="truncate whitespace-nowrap px-1.5 py-0 align-middle text-[13px] font-medium tabular-nums text-slate-900">
                          {formatMonitorQty(row.balanceQty, row.itemUnit)}
                        </td>
                        <td className="px-1.5 py-0 align-middle">
                          <span
                            className={cn(
                              "inline-flex max-w-full truncate whitespace-nowrap rounded px-1.5 py-0.5 text-[13px] font-semibold ring-1",
                              storeMonitorStatusToneClass(row.monitorStatus),
                            )}
                            title={
                              row.machineLabel
                                ? `${storeMonitorStatusLabel(row.monitorStatus)} · ${row.machineLabel}`
                                : storeMonitorStatusLabel(row.monitorStatus)
                            }
                          >
                            {storeMonitorStatusLabel(row.monitorStatus)}
                          </span>
                        </td>
                        <td className="truncate whitespace-nowrap px-1.5 py-0 align-middle text-[13px] text-slate-700">
                          {RmReadinessLabel(row)}
                        </td>
                        <td className="px-1.5 py-0 align-middle">
                          <span
                            className="block truncate whitespace-nowrap text-[13px] font-medium text-slate-800"
                            title={row.nextActionTooltip || row.nextActionText}
                          >
                            {row.nextActionText}
                          </span>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="border-t border-slate-100 bg-slate-50/70" data-testid={`store-pm-detail-${row.workOrderId}`}>
                          <td colSpan={10} className="px-3 py-2.5">
                            <div className="grid gap-2 text-[13px] text-slate-800 sm:grid-cols-2 lg:grid-cols-3">
                              <div>
                                <div className="text-[12px] font-semibold text-slate-500">RM readiness</div>
                                <div>{RmReadinessLabel(row)}</div>
                                {row.rmProductionAllowedNowQty != null ? (
                                  <div className="text-slate-600">
                                    Allowed now: {formatMonitorQty(row.rmProductionAllowedNowQty, row.itemUnit)}
                                  </div>
                                ) : null}
                              </div>
                              <div>
                                <div className="text-[12px] font-semibold text-slate-500">Quantities</div>
                                <div>Good: {formatMonitorQty(row.producedQty, row.itemUnit)}</div>
                                <div>Remaining: {formatMonitorQty(row.balanceQty, row.itemUnit)}</div>
                                {row.pendingQcQty != null && Number(row.pendingQcQty) > 0 ? (
                                  <div>Pending QC: {formatMonitorQty(row.pendingQcQty, row.itemUnit)}</div>
                                ) : null}
                              </div>
                              <div>
                                <div className="text-[12px] font-semibold text-slate-500">Execution</div>
                                <div>Status: {row.productionExecutionStatus ?? row.status ?? "—"}</div>
                                {row.productionBlockReasonLabel || row.holdReason ? (
                                  <div>
                                    Block: {row.productionBlockReasonLabel || row.holdReason}
                                  </div>
                                ) : null}
                                {row.pausedAt ? (
                                  <div className="whitespace-nowrap">
                                    Paused: {formatWhenCompact(row.pausedAt)}
                                  </div>
                                ) : null}
                                <div className="whitespace-nowrap text-slate-600">
                                  Last activity: {formatWhenCompact(lastActivity)}
                                </div>
                                {row.machineLabel ? <div>Machine: {row.machineLabel}</div> : null}
                                <div className="font-medium text-slate-900" title={row.nextActionTooltip}>
                                  Next: {row.nextActionText}
                                </div>
                              </div>
                              <div className="sm:col-span-2 lg:col-span-3">
                                {detail === "loading" ? (
                                  <p className="text-slate-500">Loading execution detail…</p>
                                ) : detail === "error" ? (
                                  <p className="text-slate-500">Execution detail unavailable.</p>
                                ) : detail && typeof detail === "object" ? (
                                  <div className="rounded border border-slate-200 bg-white px-2.5 py-2">
                                    <div className="text-[12px] font-semibold text-slate-500">
                                      Execution summary (read-only)
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                                      <span>
                                        Planned: {formatMonitorQty(detail.plannedQty, row.itemUnit)}
                                      </span>
                                      <span>
                                        Produced: {formatMonitorQty(detail.producedQty, row.itemUnit)}
                                      </span>
                                      <span>
                                        Remainder: {formatMonitorQty(detail.remainderQty, row.itemUnit)}
                                      </span>
                                      {detail.blockReasonLabel ? (
                                        <span>Block reason: {detail.blockReasonLabel}</span>
                                      ) : null}
                                      {detail.blockedAt ? (
                                        <span className="whitespace-nowrap">
                                          Blocked at: {formatWhenCompact(String(detail.blockedAt))}
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="mt-1.5 text-[12px] text-slate-500">
                                      Store cannot start, pause, resume, record, finalize, or close production from
                                      this monitor.
                                    </p>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 px-2.5 py-1.5 text-[12px] text-slate-500">
            Showing {visible.length} line(s) · {new Set(visible.map((r) => r.workOrderId)).size} WO(s)
          </div>
        </div>
      )}
    </section>
  );
}
