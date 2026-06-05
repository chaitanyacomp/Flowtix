import * as React from "react";
import { PageContainer, PageHeader, StickyWorkspaceHead } from "../components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "../components/erp/foundation";
import { useAuth } from "../hooks/useAuth";
import {
  CONTROL_TOWER_BOARD_GROUP_ORDER,
  CONTROL_TOWER_BOARD_GROUP_LABELS,
  type ControlTowerBoardGroup,
  type ControlTowerBoardMeta,
  type ControlTowerPanelMetricsData,
  type ControlTowerRoleQueueMeta,
  type ControlTowerRow,
  fetchControlTowerBoard,
  fetchControlTowerPanelMetrics,
  fetchControlTowerRoleQueue,
  sortControlTowerBoardGroups,
} from "../lib/controlTowerApi";
import {
  formatControlTowerLoadedAt,
  formatControlTowerOwner,
  formatControlTowerStatus,
} from "../lib/controlTowerDisplay";
import { cn } from "../lib/utils";

type EndpointDebug = {
  status: "ok" | "error" | "skipped";
  message?: string;
  rowCount?: number | null;
  totalRows?: number | null;
  groupedCount?: number | null;
  mode?: string | null;
  page?: number | null;
  pageSize?: number | null;
  role?: string | null;
};

function fmtCount(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return String(n);
}

function ErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <Card className="border-red-200 bg-red-50/80">
      <CardContent className="px-4 py-3 text-sm text-red-900">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-red-800">{message}</p>
      </CardContent>
    </Card>
  );
}

function GroupEmptyState({ groupCount }: { groupCount: number }) {
  if (groupCount > 0) {
    return (
      <p className="px-3 py-2 text-sm text-slate-600">
        No rows on this page ({groupCount} total in group)
      </p>
    );
  }
  return <p className="px-3 py-2 text-sm text-slate-600">Nothing pending in this group</p>;
}

function MyWorkEmptyState({ role }: { role: string }) {
  return (
    <p className="px-1 py-2 text-sm text-slate-600">
      {role ? `No work assigned to ${role}.` : "No work assigned to your role."}
    </p>
  );
}

function WorkItemCard({
  row,
  showOwner = false,
}: {
  row: ControlTowerRow;
  showOwner?: boolean;
}) {
  const nextAction = row.nextAction?.trim() || "—";
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm">
      <div className="font-medium text-slate-900">{row.documentNo ?? "—"}</div>
      <div className="mt-1.5 text-[13px] font-semibold leading-snug text-slate-900">{nextAction}</div>
      <div className="mt-1.5 space-y-0.5 text-[12px] text-slate-600">
        <div>
          <span className="text-slate-500">Status: </span>
          {formatControlTowerStatus(row.currentStatus)}
        </div>
        {showOwner ? (
          <div>
            <span className="text-slate-500">Owner: </span>
            {formatControlTowerOwner(row.currentOwner)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BoardGroupSection({ group }: { group: ControlTowerBoardGroup }) {
  const hasRows = group.rows.length > 0;
  return (
    <Card>
      <CardHeader className="border-b border-slate-100 px-4 py-3">
        <CardTitle className="flex items-baseline justify-between gap-2 text-base font-semibold text-slate-900">
          <span>{group.label}</span>
          <span className="text-sm font-normal text-slate-500">({group.count})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-4 py-3">
        {hasRows ? (
          group.rows.map((row) => (
            <WorkItemCard key={row.rowKey ?? `${group.groupKey}-${row.documentNo}-${row.currentStatus}`} row={row} showOwner />
          ))
        ) : (
          <GroupEmptyState groupCount={group.count} />
        )}
      </CardContent>
    </Card>
  );
}

function MyWorkGroupSection({ group }: { group: ControlTowerBoardGroup }) {
  const visibleRows = group.rows.filter(Boolean);
  if (group.count === 0 && visibleRows.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-800">
        {group.label} <span className="font-normal text-slate-500">({group.count})</span>
      </h3>
      {visibleRows.length > 0 ? (
        <div className="space-y-2">
          {visibleRows.map((row) => (
            <WorkItemCard key={row.rowKey ?? `${group.groupKey}-${row.documentNo}-${row.currentStatus}`} row={row} />
          ))}
        </div>
      ) : (
        <GroupEmptyState groupCount={group.count} />
      )}
    </div>
  );
}

function KpiStrip({ metrics, isAdmin }: { metrics: ControlTowerPanelMetricsData; isAdmin: boolean }) {
  const lf = metrics.liveFactoryPanel;
  const lp = metrics.liveProcessBoard;
  const alerts = metrics.criticalAlerts;
  const noQty = metrics.noQtyControlPanel;
  const commercial = metrics.commercialControl;

  return (
    <ErpKpiStrip role="region" aria-label="Control Tower KPI strip">
      <ErpKpiSegment as="div">
        <ErpKpiLabel>Live Factory</ErpKpiLabel>
        <ErpKpiValue>
          RM {fmtCount(lf.rmShortageCount)} · Prod {fmtCount(lf.productionPendingCount)} · QA{" "}
          {fmtCount(lf.qaPendingCount)}
        </ErpKpiValue>
        <span className="mt-0.5 block text-[11px] text-slate-500">
          Dispatch {fmtCount(lf.dispatchPendingLineCount)} lines · SO {fmtCount(lf.activeSalesOrders)} · WO{" "}
          {fmtCount(lf.activeWorkOrders)}
        </span>
      </ErpKpiSegment>

      <ErpKpiSegment as="div">
        <ErpKpiLabel>Live Process</ErpKpiLabel>
        <ErpKpiValue>
          Pending {fmtCount(lp.pendingProcesses)} · Delayed {fmtCount(lp.delayedProcesses)}
        </ErpKpiValue>
      </ErpKpiSegment>

      <ErpKpiSegment as="div">
        <ErpKpiLabel>Critical Alerts</ErpKpiLabel>
        <ErpKpiValue tone={alerts.alertTotal > 0 ? "warn" : "default"}>{fmtCount(alerts.alertTotal)}</ErpKpiValue>
        <span className="mt-0.5 block text-[11px] text-slate-500">
          RM {fmtCount(alerts.rmCriticalCount)} · Blocked WO {fmtCount(alerts.blockedWorkOrders)} · Exceptions{" "}
          {fmtCount(alerts.systemExceptions)}
        </span>
      </ErpKpiSegment>

      <ErpKpiSegment as="div">
        <ErpKpiLabel>Commercial</ErpKpiLabel>
        {isAdmin ? (
          <>
            <ErpKpiValue>
              Bill ready {fmtCount(commercial.billingReady)} · pending {fmtCount(commercial.billingPending)}
            </ErpKpiValue>
            <span className="mt-0.5 block text-[11px] text-slate-500">
              Export {fmtCount(commercial.exportPending)} · Payment {fmtCount(commercial.paymentPending)}
            </span>
          </>
        ) : (
          <ErpKpiValue tone="muted">Admin only</ErpKpiValue>
        )}
      </ErpKpiSegment>

      <ErpKpiSegment as="div">
        <ErpKpiLabel>NO_QTY</ErpKpiLabel>
        <ErpKpiValue>
          Active {fmtCount(noQty.activeNoQtyOrders)} · Planning {fmtCount(noQty.planningPending)}
        </ErpKpiValue>
      </ErpKpiSegment>
    </ErpKpiStrip>
  );
}

function DataStatusBar({
  boardTotalRows,
  myWorkTotalRows,
  mode,
  page,
  pageSize,
  loadedAt,
}: {
  boardTotalRows: number | null;
  myWorkTotalRows: number | null;
  mode: string | null;
  page: number | null;
  pageSize: number | null;
  loadedAt: Date | null;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2 text-[12px] text-slate-700"
      aria-label="Control Tower data status"
    >
      <span>
        <span className="text-slate-500">Board rows:</span> {fmtCount(boardTotalRows)}
      </span>
      <span>
        <span className="text-slate-500">My Work rows:</span> {fmtCount(myWorkTotalRows)}
      </span>
      <span>
        <span className="text-slate-500">Mode:</span> {mode ?? "—"}
      </span>
      <span>
        <span className="text-slate-500">Page:</span> {fmtCount(page)} · size {fmtCount(pageSize)}
      </span>
      <span className="text-slate-500">
        Loaded {loadedAt ? formatControlTowerLoadedAt(loadedAt.toISOString()) : "—"}
      </span>
    </div>
  );
}

function ApiDebugPanel({
  panel,
  board,
  roleQueue,
}: {
  panel: EndpointDebug;
  board: EndpointDebug;
  roleQueue: EndpointDebug;
}) {
  function row(endpoint: string, info: EndpointDebug) {
    const statusLabel = info.status === "ok" ? "OK" : info.status === "skipped" ? "Skipped" : "Error";
    const statusClass =
      info.status === "ok" ? "text-emerald-700" : info.status === "skipped" ? "text-slate-500" : "text-red-700";

    return (
      <div key={endpoint} className="space-y-0.5 border-b border-slate-100 py-2 last:border-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium text-slate-900">{endpoint}</span>
          <span className={cn("text-[11px] font-semibold uppercase tracking-wide", statusClass)}>{statusLabel}</span>
        </div>
        {info.message ? <p className="text-red-800">{info.message}</p> : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
          {info.role != null ? (
            <>
              <dt>Role</dt>
              <dd>{info.role}</dd>
            </>
          ) : null}
          {info.mode != null ? (
            <>
              <dt>Mode</dt>
              <dd>{info.mode}</dd>
            </>
          ) : null}
          {info.page != null ? (
            <>
              <dt>Page</dt>
              <dd>{info.page}</dd>
            </>
          ) : null}
          {info.pageSize != null ? (
            <>
              <dt>Page size</dt>
              <dd>{info.pageSize}</dd>
            </>
          ) : null}
          {info.totalRows != null ? (
            <>
              <dt>Total rows</dt>
              <dd>{info.totalRows}</dd>
            </>
          ) : null}
          {info.rowCount != null ? (
            <>
              <dt>Page rows</dt>
              <dd>{info.rowCount}</dd>
            </>
          ) : null}
          {info.groupedCount != null ? (
            <>
              <dt>Grouped count</dt>
              <dd>{info.groupedCount}</dd>
            </>
          ) : null}
        </dl>
      </div>
    );
  }

  return (
    <Card className="border-dashed border-slate-300 bg-slate-50/50">
      <CardContent className="px-4 py-3 text-sm">
        {row("GET /api/control-tower/panel-metrics", panel)}
        {row("GET /api/control-tower/board", board)}
        {row(`GET /api/control-tower/role-queue/${roleQueue.role ?? ":role"}`, roleQueue)}
      </CardContent>
    </Card>
  );
}

function sumGroupCounts(groups: ControlTowerBoardGroup[]): number {
  return groups.reduce((sum, g) => sum + (Number(g.count) || 0), 0);
}

export function ControlTowerPage() {
  const { user } = useAuth();
  const role = String(user?.role ?? "").trim().toUpperCase();
  const isAdmin = role === "ADMIN";

  const [panelMetrics, setPanelMetrics] = React.useState<ControlTowerPanelMetricsData | null>(null);
  const [boardGroups, setBoardGroups] = React.useState<ControlTowerBoardGroup[]>([]);
  const [boardMeta, setBoardMeta] = React.useState<ControlTowerBoardMeta>({});
  const [myWorkGroups, setMyWorkGroups] = React.useState<ControlTowerBoardGroup[]>([]);
  const [roleQueueMeta, setRoleQueueMeta] = React.useState<ControlTowerRoleQueueMeta>({});
  const [myWorkPageCount, setMyWorkPageCount] = React.useState<number | null>(null);
  const [panelError, setPanelError] = React.useState<string | null>(null);
  const [boardError, setBoardError] = React.useState<string | null>(null);
  const [roleQueueError, setRoleQueueError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [lastLoadedAt, setLastLoadedAt] = React.useState<Date | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setPanelError(null);
      setBoardError(null);
      setRoleQueueError(null);

      const panelPromise = fetchControlTowerPanelMetrics()
        .then((res) => {
          if (!cancelled) setPanelMetrics(res.data);
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setPanelError(err instanceof Error ? err.message : "Failed to load panel metrics");
          }
        });

      const boardPromise = fetchControlTowerBoard()
        .then((res) => {
          if (!cancelled) {
            setBoardGroups(sortControlTowerBoardGroups(res.groups ?? []));
            setBoardMeta(res.meta ?? {});
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setBoardError(err instanceof Error ? err.message : "Failed to load process board");
          }
        });

      const rolePromise =
        role && role.length > 0
          ? fetchControlTowerRoleQueue(role)
              .then((res) => {
                if (!cancelled) {
                  setMyWorkGroups(sortControlTowerBoardGroups(res.groups ?? []));
                  setRoleQueueMeta(res.meta ?? {});
                  setMyWorkPageCount(res.count ?? null);
                }
              })
              .catch((err: unknown) => {
                if (!cancelled) {
                  setRoleQueueError(err instanceof Error ? err.message : "Failed to load role queue");
                }
              })
          : Promise.resolve();

      await Promise.all([panelPromise, boardPromise, rolePromise]);
      if (!cancelled) {
        setLastLoadedAt(new Date());
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [role]);

  const orderedBoardGroups = React.useMemo(() => {
    const byKey = new Map(boardGroups.map((g) => [g.groupKey, g]));
    return sortControlTowerBoardGroups(
      CONTROL_TOWER_BOARD_GROUP_ORDER.map((key) => {
        const existing = byKey.get(key);
        if (existing) return existing;
        return {
          groupKey: key,
          label: CONTROL_TOWER_BOARD_GROUP_LABELS[key],
          ownerRole: "",
          order: 0,
          count: 0,
          rows: [],
        };
      }),
    );
  }, [boardGroups]);

  const myWorkVisibleGroups = myWorkGroups.filter((g) => g.count > 0 || g.rows.length > 0);
  const myWorkHasItems =
    myWorkVisibleGroups.some((g) => g.rows.length > 0) ||
    myWorkGroups.some((g) => g.count > 0);

  const boardTotalRows =
    boardMeta.totalRows ?? (boardError ? null : sumGroupCounts(orderedBoardGroups));
  const myWorkTotalRows =
    roleQueueMeta.totalRows ??
    roleQueueMeta.totalRowsAfterRoleDedupe ??
    (roleQueueError ? null : sumGroupCounts(myWorkGroups));

  const panelDebug: EndpointDebug = panelError
    ? { status: "error", message: panelError }
    : panelMetrics
      ? { status: "ok" }
      : loading
        ? { status: "skipped" }
        : { status: "error", message: "No data returned" };

  const boardDebug: EndpointDebug = boardError
    ? { status: "error", message: boardError }
    : {
        status: "ok",
        mode: boardMeta.mode ?? null,
        page: boardMeta.page ?? null,
        pageSize: boardMeta.pageSize ?? null,
        totalRows: boardMeta.totalRows ?? null,
        rowCount: boardMeta.rowCount ?? null,
        groupedCount: boardMeta.groupedCount ?? null,
      };

  const roleQueueDebug: EndpointDebug = !role
    ? { status: "skipped", role: null }
    : roleQueueError
      ? { status: "error", message: roleQueueError, role }
      : {
          status: "ok",
          role,
          mode: roleQueueMeta.mode ?? null,
          page: roleQueueMeta.page ?? null,
          pageSize: roleQueueMeta.pageSize ?? null,
          totalRows: roleQueueMeta.totalRows ?? roleQueueMeta.totalRowsAfterRoleDedupe ?? null,
          rowCount: myWorkPageCount,
        };

  return (
    <PageContainer className="space-y-4">
      <StickyWorkspaceHead>
        <PageHeader
          title="Control Tower (Beta)"
          subtitle="Read-only verification view — panel metrics, process board, and role queue."
        />
      </StickyWorkspaceHead>

      {loading && !panelMetrics && !panelError ? (
        <p className="text-sm text-slate-600">Loading Control Tower…</p>
      ) : null}

      {panelError ? <ErrorPanel title="Panel metrics failed" message={panelError} /> : null}
      {panelMetrics ? <KpiStrip metrics={panelMetrics} isAdmin={isAdmin} /> : null}

      <p className="text-[11px] text-slate-500">
        KPI counts and board counts may differ during beta validation.
      </p>

      {!loading ? (
        <DataStatusBar
          boardTotalRows={boardTotalRows}
          myWorkTotalRows={myWorkTotalRows}
          mode={boardMeta.mode ?? roleQueueMeta.mode ?? null}
          page={boardMeta.page ?? roleQueueMeta.page ?? null}
          pageSize={boardMeta.pageSize ?? roleQueueMeta.pageSize ?? null}
          loadedAt={lastLoadedAt}
        />
      ) : null}

      <details className="group rounded-md border border-slate-200 bg-white">
        <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-medium text-slate-600 marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-1.5">
            <span className="text-slate-400 transition group-open:rotate-90">▸</span>
            API debug
          </span>
        </summary>
        <div className="border-t border-slate-100 px-1 pb-1">
          <ApiDebugPanel panel={panelDebug} board={boardDebug} roleQueue={roleQueueDebug} />
        </div>
      </details>

      <section className="space-y-3" aria-labelledby="control-tower-board-heading">
        <h2 id="control-tower-board-heading" className="text-lg font-semibold text-slate-900">
          Process Board
        </h2>
        {loading ? <p className="text-sm text-slate-600">Loading process board…</p> : null}
        {!loading && boardError ? <ErrorPanel title="Process board failed" message={boardError} /> : null}
        {!loading && !boardError ? (
          <div className={cn("grid gap-3", "grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3")}>
            {orderedBoardGroups.map((group) => (
              <BoardGroupSection key={group.groupKey} group={group} />
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-3" aria-labelledby="control-tower-my-work-heading">
        <h2 id="control-tower-my-work-heading" className="text-lg font-semibold text-slate-900">
          {role ? `My Work – ${role}` : "My Work"}
        </h2>
        {loading ? <p className="text-sm text-slate-600">Loading my work…</p> : null}
        {!loading && roleQueueError ? <ErrorPanel title="Role queue failed" message={roleQueueError} /> : null}
        {!loading && !roleQueueError ? (
          <Card>
            <CardContent className="space-y-4 px-4 py-4">
              {!myWorkHasItems ? (
                <MyWorkEmptyState role={role} />
              ) : (
                myWorkVisibleGroups.map((group) => <MyWorkGroupSection key={group.groupKey} group={group} />)
              )}
            </CardContent>
          </Card>
        ) : null}
      </section>
    </PageContainer>
  );
}
