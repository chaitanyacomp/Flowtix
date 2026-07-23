import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ApiRequestError, apiFetch } from "../../services/api";
import { cn } from "../../lib/utils";
import {
  formatProductionQty,
  type DashboardProductionStatusRow,
  type DashboardProductionStatusSource,
} from "../../lib/dashboardProductionStatus";
import { displaySalesOrderNo, displayWorkOrderNo } from "../../lib/docNoDisplay";
import { productionHrefFromDashboardRow } from "../../lib/operationalWorkspaceLinks";
import {
  matchesProductionWorkspaceBucket,
  PRODUCTION_WORKSPACE_BUCKET_LABELS,
  type ProductionWorkspaceBucketFilter,
} from "../../lib/productionWorkspaceBucketFilter";
import { NO_QTY_TERMS } from "../../lib/flowTerminology";
import { useErpRefreshTick } from "../../hooks/useErpRefreshTick";
import {
  buildProductionWorkspaceSectionCounts,
  buildProductionWorkspaceSectionRows,
  classifyProductionWorkspaceSection,
  filterProductionWorkspaceRows,
  pauseReasonLabel,
  PRODUCTION_WORKSPACE_SECTION_LABELS,
  type ProductionWorkspaceSectionId,
} from "../../lib/productionWorkspaceSections";
import {
  classifyProductionWorkbenchState,
  entryQcWithBalanceHint,
  workbenchStatePrimaryActionLabel,
  workbenchStateStatusLabel,
} from "../../lib/productionWorkbenchState";
import {
  isCardActivationKey,
  productionWorkbenchCardAriaLabel,
  resolveProductionWorkbenchCardAction,
} from "../../lib/productionWorkbenchCardNavigation";
import { parseProductionWorkspaceFocusWo } from "../../lib/productionWorkspaceRouteContract";
import {
  applyProductionWorkspaceSectionToSearchParams,
  resolveProductionWorkspaceSectionFromSearch,
} from "../../lib/productionWorkspaceSectionNav";
import { resumeProductionExecutionApi } from "../../lib/productionExecutionApi";
import { resumeWorkOrderApi } from "../../lib/workOrderLifecycle";
import { bumpErpRefresh } from "../../lib/erpRefresh";
import { noQtyOperatorThirdColumn } from "../../lib/noQtyShortagePresentation";

type RmReturnPendingTaskRow = {
  id: number;
  workOrderId: number;
  workOrderNo: string | null;
  itemName: string;
  unit: string;
  requestedQty: number;
  status: string;
};

function flowBadge(orderType?: string | null) {
  if (orderType === "NO_QTY") return NO_QTY_TERMS.AGREEMENT_LABEL;
  if (orderType === "GREEN_LEVEL") return "Green Level";
  return "REGULAR";
}

function ageLabel(iso?: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export function PendingStoreTasksPanel({ className }: { className?: string }) {
  const liveTick = useErpRefreshTick(["production", "dashboard"], { pollIntervalMs: 30000 });
  const [rows, setRows] = React.useState<RmReturnPendingTaskRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    void apiFetch<RmReturnPendingTaskRow[]>("/api/production-material-returns/pending?status=PENDING")
      .then((data) => {
        if (mounted) {
          setRows(Array.isArray(data) ? data : []);
          setError(null);
        }
      })
      .catch((cause) => {
        console.error("Awaiting Store reconciliation request failed", {
          endpoint: "/api/production-material-returns/pending?status=PENDING",
          status: cause instanceof ApiRequestError ? cause.status : null,
          code: cause instanceof ApiRequestError ? cause.code : null,
        });
        if (mounted) {
          setRows([]);
          setError(
            cause instanceof ApiRequestError
              ? cause.message
              : "Could not load Store reconciliation tasks. Refresh or contact your administrator.",
          );
        }
      });
    return () => {
      mounted = false;
    };
  }, [liveTick]);

  if (rows.length === 0 && !error) return null;

  return (
    <Card className={cn("min-w-0", className)} data-testid="production-pending-store-tasks">
      <CardHeader className="border-b border-slate-100 bg-white px-2.5 py-1.5">
        <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">
          {PRODUCTION_WORKSPACE_SECTION_LABELS.awaitingStore}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 p-2">
        {error ? (
          <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">{error}</p>
        ) : null}
        {rows.map((row) => (
          <div key={row.id} className="rounded-md border border-amber-200 bg-amber-50/80 px-2.5 py-2 text-[11px] text-amber-950">
            <div className="font-bold">RM Return Reconciliation — Store Action Required</div>
            <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
              <dt className="font-medium text-amber-900">WO No</dt>
              <dd className="tabular-nums">{displayWorkOrderNo(row.workOrderId, row.workOrderNo)}</dd>
              <dt className="font-medium text-amber-900">RM Item</dt>
              <dd className="truncate" title={row.itemName}>
                {row.itemName}
              </dd>
              <dt className="font-medium text-amber-900">Qty</dt>
              <dd className="tabular-nums">
                {formatProductionQty(row.requestedQty)}
                {row.unit ? ` ${row.unit}` : ""}
              </dd>
              <dt className="font-medium text-amber-900">Required action</dt>
              <dd>Store must receive and reconcile this returned RM.</dd>
            </dl>
            <Link
              to={`/production/rm-returns?pendingId=${encodeURIComponent(String(row.id))}&workOrderId=${encodeURIComponent(String(row.workOrderId))}&from=production-workspace`}
              className="mt-2 inline-flex h-8 items-center rounded-md border border-amber-300 bg-white px-2.5 text-[12px] font-semibold text-amber-950 no-underline hover:bg-amber-100"
              data-testid={`production-awaiting-store-review-${row.id}`}
            >
              Review Store Reconciliation
            </Link>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const SECTION_TABS: ProductionWorkspaceSectionId[] = [
  "reportPending",
  "draftPending",
  "paused",
  "active",
  "ready",
  "pendingQa",
  "awaitingStore",
  "recent",
];

function parseWorkspaceSection(
  raw: string | null,
  productionBucket: ProductionWorkspaceBucketFilter | null,
): ProductionWorkspaceSectionId {
  return resolveProductionWorkspaceSectionFromSearch(raw, productionBucket);
}

function remainingQtyForCard(row: DashboardProductionStatusRow): number {
  const thirdCol = noQtyOperatorThirdColumn({
    orderType: row.orderType,
    lastShortageQty: row.lastShortageQty,
    nextAction: row.nextAction,
    operationalStatus: row.operationalStatus,
    remainingQty: row.remainingQty,
    requiredQty: row.requiredQty,
    producedQty: row.producedQty,
  });
  if (row.orderType === "GREEN_LEVEL") return row.shortageQty;
  return thirdCol.qty;
}

export function OperationalProductionWorkspace({
  onOpenRow,
  productionBucket = null,
  className,
}: {
  /** Optional in-page handoff (e.g. applyLine) instead of navigation. */
  onOpenRow?: (row: DashboardProductionStatusSource) => void;
  productionBucket?: ProductionWorkspaceBucketFilter | null;
  className?: string;
}) {
  const navigate = useNavigate();
  const liveTick = useErpRefreshTick(["production", "dashboard"], { pollIntervalMs: 0 });
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = React.useState<DashboardProductionStatusSource[] | null>(null);
  const [rmPending, setRmPending] = React.useState<RmReturnPendingTaskRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState(() => searchParams.get("pwq") ?? "");
  const [flowFilter, setFlowFilter] = React.useState(() => searchParams.get("pwFlow") ?? "ALL");
  const [sortMode, setSortMode] = React.useState(() => searchParams.get("pwSort") ?? "priority");
  const [pageSize, setPageSize] = React.useState(() => {
    const n = Number(searchParams.get("pwSize") ?? 20);
    return n === 12 || n === 25 ? n : 20;
  });
  const [page, setPage] = React.useState(() => Math.max(1, Number(searchParams.get("pwPage") ?? 1) || 1));
  const [resumeBusyId, setResumeBusyId] = React.useState<number | null>(null);
  const [resumeError, setResumeError] = React.useState<string | null>(null);
  const [staleNotice, setStaleNotice] = React.useState<string | null>(() => searchParams.get("pwNotice"));

  const section = parseWorkspaceSection(searchParams.get("pwSection"), productionBucket);
  const focusWoId = parseProductionWorkspaceFocusWo(searchParams.get("pwFocus"));

  React.useEffect(() => {
    let mounted = true;
    void Promise.all([
      apiFetch<DashboardProductionStatusSource[]>("/api/dashboard/production-queue"),
      apiFetch<RmReturnPendingTaskRow[]>("/api/production-material-returns/pending?status=PENDING"),
    ])
      .then(([queue, pending]) => {
        if (!mounted) return;
        setRows(Array.isArray(queue) ? queue : []);
        setRmPending(Array.isArray(pending) ? pending : []);
        setError(null);
      })
      .catch((e) => {
        if (!mounted) return;
        setRows([]);
        setRmPending([]);
        setError(e instanceof Error ? e.message : "Failed to load production queue");
      });
    return () => {
      mounted = false;
    };
  }, [liveTick]);

  const sections = React.useMemo(() => buildProductionWorkspaceSectionRows(rows ?? []), [rows]);
  const counts = React.useMemo(
    () => buildProductionWorkspaceSectionCounts(rows ?? [], rmPending),
    [rows, rmPending],
  );

  // Stale deep-link: focused WO no longer belongs to the requested tab → redirect to its current state.
  React.useEffect(() => {
    if (!(focusWoId > 0) || rows == null) return;
    const all = sections.all;
    const match = all.find((r) => r.workOrderId === focusWoId);
    if (!match) return;
    const currentSection = classifyProductionWorkspaceSection(match);
    if (!currentSection || currentSection === section) return;
    const nextParams = applyProductionWorkspaceSectionToSearchParams(searchParams, currentSection, {
      pwFocus: focusWoId,
      clearNotice: false,
    });
    nextParams.set(
      "pwNotice",
      `Status changed — ${displayWorkOrderNo(match.workOrderId, match.workOrderNo)} is now under ${PRODUCTION_WORKSPACE_SECTION_LABELS[currentSection]}.`,
    );
    setSearchParams(nextParams, { replace: true });
    setStaleNotice(nextParams.get("pwNotice"));
  }, [focusWoId, rows, sections.all, section, searchParams, setSearchParams]);

  const sectionRows = React.useMemo(() => {
    let list: DashboardProductionStatusRow[] =
      section === "ready"
        ? sections.ready
        : section === "draftPending"
          ? sections.draftPending
          : section === "paused"
            ? sections.paused
            : section === "reportPending"
              ? sections.reportPending
              : section === "pendingQa"
                ? sections.pendingQa
                : section === "awaitingStore" || section === "recent"
                  ? []
                  : sections.active;
    // Bucket filter applies on the matching tab only (Ready or Continue).
    if (productionBucket && (section === "active" || section === "ready")) {
      list = list.filter((row) => matchesProductionWorkspaceBucket(row, productionBucket));
    }
    return filterProductionWorkspaceRows(list, {
      query,
      flow: flowFilter,
      sort: sortMode as "priority" | "woDesc" | "woAsc" | "product" | "remainingDesc" | "ageDesc",
    });
  }, [section, sections, productionBucket, query, flowFilter, sortMode]);

  const pageCount = Math.max(1, Math.ceil(sectionRows.length / pageSize));
  const visibleSectionRows = sectionRows.slice(
    (Math.min(page, pageCount) - 1) * pageSize,
    Math.min(page, pageCount) * pageSize,
  );

  React.useEffect(() => {
    if (!(focusWoId > 0)) return;
    const index = sectionRows.findIndex((row) => row.workOrderId === focusWoId);
    if (index < 0) return;
    const targetPage = Math.floor(index / pageSize) + 1;
    if (targetPage !== page) setPage(targetPage);
  }, [sectionRows, pageSize, page, focusWoId]);

  React.useEffect(() => {
    if (!(focusWoId > 0)) return;
    const el = document.querySelector(`[data-work-order-id="${focusWoId}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusWoId, visibleSectionRows]);

  function persistViewValue(key: string, value: string, defaultValue?: string) {
    const nextParams = new URLSearchParams(searchParams);
    if (!value || value === defaultValue) nextParams.delete(key);
    else nextParams.set(key, value);
    setSearchParams(nextParams, { replace: true });
  }

  function setSection(next: ProductionWorkspaceSectionId, opts?: { pwFocus?: number | null }) {
    const nextParams = applyProductionWorkspaceSectionToSearchParams(searchParams, next, {
      pwFocus: opts?.pwFocus,
      clearNotice: true,
    });
    setSearchParams(nextParams, { replace: true });
    setStaleNotice(null);
    setPage(1);
  }

  function persistQuery(next: string) {
    setQuery(next);
    setPage(1);
    const nextParams = new URLSearchParams(searchParams);
    if (next.trim()) nextParams.set("pwq", next.trim());
    else nextParams.delete("pwq");
    nextParams.delete("pwPage");
    setSearchParams(nextParams, { replace: true });
  }

  async function onResume(row: DashboardProductionStatusRow) {
    setResumeError(null);
    setResumeBusyId(row.workOrderId);
    try {
      if (row.orderType === "NO_QTY" || row.orderType === "GREEN_LEVEL") {
        await resumeProductionExecutionApi(row.workOrderId);
      } else {
        await resumeWorkOrderApi(row.workOrderId);
      }
      // Optimistic local move out of Paused so the stale-focus effect cannot snap back
      // before the production-queue refresh lands.
      setRows((prev) =>
        (prev ?? []).map((r) =>
          r.workOrderId === row.workOrderId
            ? {
                ...r,
                status: "IN_PROGRESS",
                productionExecutionStatus: "RUNNING",
                productionWorkState: "CONTINUE_PRODUCTION",
                nextAction: "PRODUCTION_PENDING",
                pausedAt: null,
                canAcceptProductionEntry: true,
              }
            : r,
        ),
      );
      bumpErpRefresh(["production", "dashboard", "pending-actions"]);
      // Canonical Continue bucket — must clear stale readyToStart so the tab actually activates.
      setSection("active", { pwFocus: row.workOrderId });
    } catch (e) {
      setResumeError(e instanceof Error ? e.message : "Resume failed");
    } finally {
      setResumeBusyId(null);
    }
  }

  function cardHref(row: DashboardProductionStatusRow): string {
    const state = classifyProductionWorkbenchState(row);
    if (state === "QC_PENDING_ONLY") {
      const base = row.actionHref && String(row.actionHref).includes("qc-entry")
        ? String(row.actionHref)
        : `/qc-entry?workOrderId=${row.workOrderId}`;
      return base;
    }
    return productionHrefFromDashboardRow({
      orderType: row.orderType,
      sourceType: row.sourceType,
      salesOrderId: row.salesOrderId,
      workOrderId: row.workOrderId,
      workOrderLineId: row.workOrderLineId,
      cycleId: row.cycleId ?? null,
      actionHref: row.actionHref,
    });
  }

  function openCard(row: DashboardProductionStatusRow) {
    const state = classifyProductionWorkbenchState(row);
    const action = resolveProductionWorkbenchCardAction({
      state,
      href: cardHref(row),
      hasOpenRowHandler: Boolean(onOpenRow),
    });
    if (action.kind === "resume") {
      void onResume(row);
      return;
    }
    if (action.kind === "openRow" && onOpenRow) {
      onOpenRow(row);
      return;
    }
    if (action.kind === "navigate") navigate(action.href);
  }

  const bucketLabel = productionBucket ? PRODUCTION_WORKSPACE_BUCKET_LABELS[productionBucket] : null;
  const title =
    section === "active"
      ? bucketLabel && bucketLabel !== PRODUCTION_WORKSPACE_SECTION_LABELS.active
        ? `${PRODUCTION_WORKSPACE_SECTION_LABELS.active} · ${bucketLabel}`
        : PRODUCTION_WORKSPACE_SECTION_LABELS.active
      : PRODUCTION_WORKSPACE_SECTION_LABELS[section];

  const sharedUnit =
    visibleSectionRows.length > 0
      ? (() => {
          const units = new Set(
            visibleSectionRows.map((r) => String(r.itemUnit ?? "").trim()).filter(Boolean),
          );
          return units.size === 1 ? [...units][0] : null;
        })()
      : null;

  return (
    <Card className={cn("erp-op-workspace-primary min-w-0", className)} data-testid="production-workspace-sections">
      <CardHeader className="border-b border-slate-100 bg-white px-2.5 py-1.5">
        <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">{title}</CardTitle>
        <p className="text-[11px] text-slate-500">
          Partial finalized batches may be Pending QC while the same WO stays Ready, Continue, or Paused with remaining
          quantity.
        </p>
        {staleNotice ? (
          <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-950" role="status">
            {staleNotice}
          </p>
        ) : null}
        <div className="mt-1.5 flex flex-wrap gap-1" role="tablist" aria-label="Production workspace sections">
          {SECTION_TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={section === id}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums",
                section === id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
              )}
              onClick={() => setSection(id)}
            >
              {PRODUCTION_WORKSPACE_SECTION_LABELS[id]} ({counts[id]})
            </button>
          ))}
        </div>
        {section !== "awaitingStore" && section !== "recent" ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <input
              type="search"
              value={query}
              onChange={(e) => persistQuery(e.target.value)}
              placeholder="Search WO, SO, customer, item"
              className="h-8 min-w-[12rem] flex-1 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-900"
              aria-label="Search production workspace"
            />
            <select
              value={flowFilter}
              onChange={(e) => {
                setFlowFilter(e.target.value);
                setPage(1);
                const nextParams = new URLSearchParams(searchParams);
                if (e.target.value === "ALL") nextParams.delete("pwFlow");
                else nextParams.set("pwFlow", e.target.value);
                nextParams.delete("pwPage");
                setSearchParams(nextParams, { replace: true });
              }}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[12px]"
              aria-label="Filter by flow"
            >
              <option value="ALL">All flows</option>
              <option value="NO_QTY">NO_QTY</option>
              <option value="NORMAL">REGULAR</option>
              <option value="GREEN_LEVEL">Green Level</option>
            </select>
            <select
              value={sortMode}
              onChange={(e) => {
                setSortMode(e.target.value);
                setPage(1);
                persistViewValue("pwSort", e.target.value, "priority");
              }}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[12px]"
              aria-label="Sort production jobs"
            >
              <option value="priority">Priority</option>
              <option value="ageDesc">Oldest pending</option>
              <option value="woAsc">WO number</option>
              <option value="product">Product</option>
              <option value="remainingDesc">Remaining quantity</option>
            </select>
            <select
              value={pageSize}
              onChange={(e) => {
                const size = Number(e.target.value);
                setPageSize(size);
                setPage(1);
                persistViewValue("pwSize", String(size), "20");
              }}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[12px]"
              aria-label="Production jobs per page"
            >
              <option value={12}>12 per page</option>
              <option value={20}>20 per page</option>
              <option value={25}>25 per page</option>
            </select>
          </div>
        ) : null}
        {resumeError ? <p className="mt-1 text-[12px] text-red-700">{resumeError}</p> : null}
      </CardHeader>
      <CardContent className="p-2 pb-3">
        {error ? <p className="mb-1 text-[12px] text-red-700">{error}</p> : null}
        {section === "awaitingStore" ? (
          <PendingStoreTasksPanel />
        ) : section === "recent" ? (
          <p className="px-1 py-2 text-[13px] text-slate-600">
            Recent and completed production entries are shown in the history below.
          </p>
        ) : rows === null ? (
          <p className="px-1 py-2 text-[13px] text-slate-600">Loading production queue…</p>
        ) : sectionRows.length === 0 ? (
          <p className="px-1 py-2 text-[13px] text-slate-600">No {title.toLowerCase()} right now.</p>
        ) : (
          <>
            {sharedUnit ? (
              <p className="mb-1.5 px-0.5 text-[11px] text-slate-500">
                Quantities in <span className="font-semibold text-slate-700">{sharedUnit}</span>
              </p>
            ) : null}
            <div
              className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              data-testid="production-workbench-card-grid"
            >
              {visibleSectionRows.map((row) => {
                const state = classifyProductionWorkbenchState(row);
                const statusLabel = workbenchStateStatusLabel(state);
                const actionLabel =
                  section === "paused"
                    ? resumeBusyId === row.workOrderId
                      ? "Resuming…"
                      : "Resume Production"
                    : workbenchStatePrimaryActionLabel(state);
                const rem = remainingQtyForCard(row);
                const focused = focusWoId === row.workOrderId;
                const qcHint = entryQcWithBalanceHint(row);
                const reportHref = row.productionReportConfirmed
                  ? `/production?salesOrderId=${encodeURIComponent(String(row.salesOrderId ?? ""))}&workOrderId=${encodeURIComponent(String(row.workOrderId))}${row.workOrderLineId ? `&workOrderLineId=${encodeURIComponent(String(row.workOrderLineId))}` : ""}&reportId=${encodeURIComponent(String(row.productionReportId ?? ""))}&focusReport=1&viewReport=1&from=production-workspace`
                  : null;
                const soLabel =
                  row.orderType === "GREEN_LEVEL"
                    ? (row.salesOrderNo ?? "Stock Replenishment")
                    : displaySalesOrderNo(row.salesOrderId ?? 0, row.salesOrderNo);
                const cycleLabel =
                  row.orderType === "GREEN_LEVEL"
                    ? null
                    : row.cycleNo != null
                      ? `Cycle ${row.cycleNo}`
                      : null;
                const cardLabel = productionWorkbenchCardAriaLabel({
                  state,
                  workOrderNo: displayWorkOrderNo(row.workOrderId, row.workOrderNo),
                  itemName: row.itemName,
                });

                return (
                  <div
                    key={`${row.workOrderId}-${row.workOrderLineId ?? row.itemName}`}
                    data-work-order-id={row.workOrderId}
                    data-testid="production-workbench-card"
                    data-workbench-state={state}
                    role="button"
                    tabIndex={0}
                    aria-label={cardLabel}
                    className={cn(
                      "flex min-h-[176px] min-w-0 flex-col rounded-lg border bg-white p-2.5 shadow-sm outline-none transition",
                      "hover:border-slate-300 hover:shadow-md",
                      "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1",
                      focused ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200",
                    )}
                    onClick={() => openCard(row)}
                    onKeyDown={(e) => {
                      if (isCardActivationKey(e.key)) {
                        e.preventDefault();
                        openCard(row);
                      }
                    }}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-1.5">
                      <Badge variant="default" className="h-5 shrink-0 px-1.5 text-[10px] font-semibold">
                        {flowBadge(row.orderType)}
                      </Badge>
                      <div className="min-w-0 text-right">
                        <div className="truncate text-sm font-bold tabular-nums text-slate-900">
                          {displayWorkOrderNo(row.workOrderId, row.workOrderNo)}
                        </div>
                        <div className="truncate text-[11px] tabular-nums text-slate-600" title={[soLabel, cycleLabel].filter(Boolean).join(" · ")}>
                          {soLabel}
                          {cycleLabel ? ` · ${cycleLabel}` : ""}
                        </div>
                      </div>
                    </div>

                    <div
                      className="mt-1.5 line-clamp-2 min-h-[2.25rem] text-[13px] font-semibold leading-snug text-slate-900"
                      title={`${row.itemName}${row.itemCode ? ` · ${row.itemCode}` : ""}`}
                    >
                      {row.itemName}
                      {row.itemCode ? <span className="ml-1 font-normal text-slate-500">· {row.itemCode}</span> : null}
                    </div>

                    {/* Reserved slot for future optional Machine field — do not invent data. */}
                    <div className="mt-0.5 hidden text-[10px] text-slate-400" data-machine-slot aria-hidden />

                    <div className="mt-1.5 grid grid-cols-3 gap-1 text-[11px]">
                      <div className="min-w-0 rounded bg-slate-50 px-1.5 py-1">
                        <div className="text-[10px] font-medium text-slate-500">Planned</div>
                        <div className="truncate font-semibold tabular-nums text-slate-900">
                          {formatProductionQty(row.requiredQty)}
                        </div>
                      </div>
                      <div className="min-w-0 rounded bg-slate-50 px-1.5 py-1">
                        <div className="text-[10px] font-medium text-slate-500">Finalized</div>
                        <div className="truncate font-semibold tabular-nums text-slate-900">
                          {formatProductionQty(row.producedQty)}
                        </div>
                      </div>
                      <div className="min-w-0 rounded bg-amber-50 px-1.5 py-1">
                        <div className="text-[10px] font-medium text-amber-800">Remaining</div>
                        <div className="truncate font-semibold tabular-nums text-amber-950">
                          {formatProductionQty(rem)}
                          {!sharedUnit && row.itemUnit ? (
                            <span className="ml-0.5 text-[10px] font-medium text-slate-600">{row.itemUnit}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {qcHint ? (
                      <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-slate-500" title={qcHint}>
                        {qcHint}
                      </p>
                    ) : null}
                    {row.regularClosurePending ? (
                      <p className="mt-1 text-[10px] font-medium leading-snug text-amber-800">
                        WO closure reconciliation pending · Shortfall{" "}
                        {formatProductionQty(row.regularShortfallQty ?? rem)}
                        {row.itemUnit ? ` ${row.itemUnit}` : ""}
                      </p>
                    ) : null}

                    <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                      <div className="min-w-0">
                        {section === "paused" ? (
                          <div className="text-[11px] leading-snug">
                            <div className="truncate font-semibold text-amber-900" title={pauseReasonLabel(row)}>
                              {pauseReasonLabel(row)}
                            </div>
                            <div className="text-slate-500">Age {ageLabel(row.pausedAt)}</div>
                          </div>
                        ) : (
                          <span
                            className={cn(
                              "inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold",
                              state === "READY_TO_START" && "bg-emerald-50 text-emerald-900",
                              state === "CONTINUE_PRODUCTION" && "bg-sky-50 text-sky-900",
                              state === "DRAFT_PENDING" && "bg-violet-50 text-violet-900",
                              state === "PAUSED_PRODUCTION" && "bg-amber-50 text-amber-900",
                              state === "QC_PENDING_ONLY" && "bg-amber-50 text-amber-900",
                              state === "BLOCKED" && "bg-rose-50 text-rose-900",
                            )}
                          >
                            {statusLabel}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {reportHref && state !== "PRODUCTION_REPORT_PENDING" ? (
                          <Link
                            to={reportHref}
                            className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 no-underline hover:bg-slate-50"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`view-production-report-${row.workOrderId}`}
                          >
                            View Report
                          </Link>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0 px-2.5 text-[12px] font-semibold"
                          disabled={section === "paused" && resumeBusyId === row.workOrderId}
                          onClick={(e) => {
                            e.stopPropagation();
                            openCard(row);
                          }}
                        >
                          {actionLabel}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {pageCount > 1 ? (
              <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
                <span>
                  Page {Math.min(page, pageCount)} of {pageCount}
                </span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => {
                      const next = Math.max(1, page - 1);
                      setPage(next);
                      persistViewValue("pwPage", String(next), "1");
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={page >= pageCount}
                    onClick={() => {
                      const next = Math.min(pageCount, page + 1);
                      setPage(next);
                      persistViewValue("pwPage", String(next), "1");
                    }}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
