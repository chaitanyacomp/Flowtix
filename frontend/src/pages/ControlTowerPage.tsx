import * as React from "react";
import { PageContainer, PageHeader, StickyWorkspaceHead } from "../components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "../components/erp/foundation";
import { useAuth } from "../hooks/useAuth";
import {
  CONTROL_TOWER_BOARD_GROUP_ORDER,
  CONTROL_TOWER_BOARD_GROUP_LABELS,
  type ControlTowerBoardGroup,
  type ControlTowerPanelMetricsData,
  type ControlTowerRow,
  fetchControlTowerBoard,
  fetchControlTowerPanelMetrics,
  fetchControlTowerRoleQueue,
  sortControlTowerBoardGroups,
} from "../lib/controlTowerApi";
import { cn } from "../lib/utils";

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

function EmptyWorkItems() {
  return <p className="px-3 py-2 text-sm text-slate-600">No work items</p>;
}

function WorkItemCard({
  row,
  showOwner = false,
}: {
  row: ControlTowerRow;
  showOwner?: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
      <div className="font-medium text-slate-900">{row.documentNo ?? "—"}</div>
      <div className="mt-1 space-y-0.5 text-slate-700">
        <div>
          <span className="text-slate-500">Status: </span>
          {row.currentStatus}
        </div>
        {showOwner ? (
          <div>
            <span className="text-slate-500">Owner: </span>
            {row.currentOwner}
          </div>
        ) : null}
        <div>
          <span className="text-slate-500">Next: </span>
          {row.nextAction}
        </div>
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
          <EmptyWorkItems />
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
        <EmptyWorkItems />
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

export function ControlTowerPage() {
  const { user } = useAuth();
  const role = String(user?.role ?? "").trim().toUpperCase();
  const isAdmin = role === "ADMIN";

  const [panelMetrics, setPanelMetrics] = React.useState<ControlTowerPanelMetricsData | null>(null);
  const [boardGroups, setBoardGroups] = React.useState<ControlTowerBoardGroup[]>([]);
  const [myWorkGroups, setMyWorkGroups] = React.useState<ControlTowerBoardGroup[]>([]);
  const [panelError, setPanelError] = React.useState<string | null>(null);
  const [boardError, setBoardError] = React.useState<string | null>(null);
  const [roleQueueError, setRoleQueueError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setPanelError(null);
      setBoardError(null);
      setRoleQueueError(null);

      const panelPromise = fetchControlTowerPanelMetrics()
        .then((data) => {
          if (!cancelled) setPanelMetrics(data);
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setPanelError(err instanceof Error ? err.message : "Failed to load panel metrics");
          }
        });

      const boardPromise = fetchControlTowerBoard()
        .then((data) => {
          if (!cancelled) setBoardGroups(sortControlTowerBoardGroups(data.groups ?? []));
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setBoardError(err instanceof Error ? err.message : "Failed to load process board");
          }
        });

      const rolePromise =
        role && role.length > 0
          ? fetchControlTowerRoleQueue(role)
              .then((data) => {
                if (!cancelled) setMyWorkGroups(sortControlTowerBoardGroups(data.groups ?? []));
              })
              .catch((err: unknown) => {
                if (!cancelled) {
                  setRoleQueueError(err instanceof Error ? err.message : "Failed to load role queue");
                }
              })
          : Promise.resolve();

      await Promise.all([panelPromise, boardPromise, rolePromise]);
      if (!cancelled) setLoading(false);
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
          My Work
          {role ? <span className="ml-2 text-sm font-normal text-slate-500">({role})</span> : null}
        </h2>
        {loading ? <p className="text-sm text-slate-600">Loading my work…</p> : null}
        {!loading && roleQueueError ? <ErrorPanel title="Role queue failed" message={roleQueueError} /> : null}
        {!loading && !roleQueueError ? (
          <Card>
            <CardContent className="space-y-4 px-4 py-4">
              {!myWorkHasItems ? (
                <EmptyWorkItems />
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
