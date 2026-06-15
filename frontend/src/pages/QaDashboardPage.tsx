import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, FileText } from "lucide-react";
import { apiFetch } from "../services/api";
import { PageContainer } from "../components/PageHeader";
import { ERP_DASHBOARD_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { DashboardOpsClearStrip, DashboardWorkspaceHeader } from "../components/erp/foundation";
import { PendingActionsDashboardCard } from "./PendingActionsPage";
import type { PendingActionsDashboardProps } from "../lib/pendingActionsApi";
import { ErpActionButton } from "../components/erp/foundation/ErpActionButton";
import { ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "../components/erp/foundation/ErpKpiStrip";
import { ErpEmptyState } from "../components/erp/foundation/ErpEmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { dashboardShell } from "../lib/dashboardShell";
import { PRODUCTION_QA_TERMS } from "../lib/productionQaTerminology";
import { cn } from "../lib/utils";
import { erpKpi } from "../lib/erpFoundationTokens";

type QcQueueRow = {
  id: number;
  salesOrderDocNo?: string | null;
  customerName?: string | null;
  itemName?: string | null;
  pendingQcQty?: number | null;
  href?: string | null;
};

const shell = dashboardShell.page;
const max = dashboardShell.max;
const card = dashboardShell.card;

export function QaDashboardPage({
  pendingActions,
}: {
  pendingActions?: PendingActionsDashboardProps;
} = {}) {
  const navigate = useNavigate();
  const liveTick = useErpRefreshTick(["dashboard"], { pollIntervalMs: ERP_DASHBOARD_POLL_MS });
  const [qcQueue, setQcQueue] = React.useState<QcQueueRow[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const queue = await apiFetch<QcQueueRow[]>("/api/dashboard/qc-queue");
        if (cancelled) return;
        setQcQueue(Array.isArray(queue) ? queue : []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load QA desk");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liveTick]);

  const clickTo = (to: string) => ({
    onClick: () => navigate(to, { state: { from: "dashboard" } }),
  });

  const batchCount = qcQueue?.length ?? 0;
  const pendingQty = (qcQueue ?? []).reduce((s, r) => s + Number(r.pendingQcQty ?? 0), 0);

  if (loading) {
    return (
      <div className={shell}>
        <PageContainer className={max}>
          {pendingActions ? (
            <div className="mb-3">
              <PendingActionsDashboardCard
                count={pendingActions.count}
                loading={pendingActions.loading}
                error={pendingActions.error}
              />
            </div>
          ) : null}
          <p className="text-sm text-slate-600">Loading QA desk…</p>
        </PageContainer>
      </div>
    );
  }

  if (err) {
    return (
      <div className={shell}>
        <PageContainer className={max}>
          {pendingActions ? (
            <div className="mb-3">
              <PendingActionsDashboardCard
                count={pendingActions.count}
                loading={pendingActions.loading}
                error={pendingActions.error}
              />
            </div>
          ) : null}
          <p className="text-sm text-red-700">{err}</p>
        </PageContainer>
      </div>
    );
  }

  const allQuiet = batchCount === 0;

  return (
    <div className={shell}>
      <PageContainer className={max}>
        <DashboardWorkspaceHeader role="QA" />

        {pendingActions ? (
          <div className="mb-2">
            <PendingActionsDashboardCard
              count={pendingActions.count}
              loading={pendingActions.loading}
              error={pendingActions.error}
            />
          </div>
        ) : null}

        <div className="mb-2 flex flex-wrap gap-1.5">
          <ErpActionButton tier="primary" className="gap-1.5" onClick={() => navigate("/qc-entry?source=dashboard")}>
            <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
            {PRODUCTION_QA_TERMS.WORKSPACE_NAV}
          </ErpActionButton>
          <ErpActionButton tier="secondary" className="gap-1.5" onClick={() => navigate("/qc-report?source=dashboard")}>
            <FileText className="h-3.5 w-3.5" aria-hidden />
            QC Report
          </ErpActionButton>
        </div>

        <div className="mb-3 max-w-full overflow-x-auto pb-0.5">
          <ErpKpiStrip className={erpKpi.stripCompact} role="toolbar" aria-label="QA desk metrics">
            <ErpKpiSegment type="button" {...clickTo("/qc-entry?source=dashboard")} aria-label={PRODUCTION_QA_TERMS.QA_BATCHES_KPI}>
              <ErpKpiLabel>Batches</ErpKpiLabel>
              <ErpKpiValue tone={batchCount > 0 ? "warn" : "muted"}>{batchCount}</ErpKpiValue>
            </ErpKpiSegment>
            <ErpKpiSegment type="button" {...clickTo("/qc-entry?source=dashboard")} aria-label={PRODUCTION_QA_TERMS.QA_QTY_PENDING_KPI}>
              <ErpKpiLabel>Qty pending</ErpKpiLabel>
              <ErpKpiValue tone={pendingQty > 0 ? "warn" : "muted"}>{pendingQty.toFixed(2)}</ErpKpiValue>
            </ErpKpiSegment>
          </ErpKpiStrip>
        </div>

        {allQuiet ? <DashboardOpsClearStrip role="QA" className="mb-3" /> : null}

        <Card className={cn(card, batchCount > 0 ? dashboardShell.cardPrimary : card)}>
          <CardHeader className="border-b border-slate-100 p-2.5 pb-2">
            <CardTitle className="text-[13px] font-extrabold text-slate-950">{PRODUCTION_QA_TERMS.QA_IN_PROGRESS_LABEL}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-2.5 pt-2">
            {!qcQueue?.length ? (
              <ErpEmptyState variant="inline" title="No batches awaiting QA" body="Production-posted batches appear here for inspection." />
            ) : (
              qcQueue.slice(0, 12).map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 px-2.5 py-2 text-left text-[12px] hover:border-sky-300 hover:bg-sky-50/40"
                  onClick={() => navigate(row.href ?? "/qc-entry?source=dashboard", { state: { from: "dashboard" } })}
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-900">{row.itemName ?? "Batch"}</div>
                    <div className="truncate text-slate-600">
                      {[row.customerName, row.salesOrderDocNo].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <span className="shrink-0 tabular-nums font-semibold text-slate-800">{Number(row.pendingQcQty ?? 0).toFixed(2)}</span>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </PageContainer>
    </div>
  );
}
