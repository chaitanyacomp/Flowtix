import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { ClipboardList, PackageSearch, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button, buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import { apiFetch } from "../../services/api";
import { useToast } from "../../contexts/ToastContext";
import { ERP_DASHBOARD_POLL_MS, useErpRefreshTick } from "../../hooks/useErpRefreshTick";
import { ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "./foundation";
import { erpKpi } from "../../lib/erpFoundationTokens";
import { PROCUREMENT_TERMS } from "../../lib/procurementTerminology";
import {
  DEFAULT_PROCUREMENT_DEMAND_POOL,
  deriveDemandPoolCountsFromWorkspace,
  mrMatchesDemandPool,
  workspaceQueryForDemandPool,
  type ProcurementDemandPoolKey,
} from "../../lib/procurementWorkspaceQueues";
import { ProcurementWorkspaceQueueTabs } from "./ProcurementWorkspaceQueueTabs";
import { buildPurchaseRequestPayloadFromMr } from "../../lib/purchaseRequestFromMr";
import { buildRmPoDetailHref } from "../../lib/rmPurchaseWoContinuity";
import { purchaseGrnExecutionHref } from "../../lib/woPrepareOperationalStage";
import {
  buildStoreProcurementPreviewRows,
  computeStoreProcurementPulseMetrics,
  type StoreProcurementWorkspaceLike,
} from "../../lib/storeProcurementPulse";

type WorkspaceResponse = StoreProcurementWorkspaceLike;

function fmtQty(n: number, unit?: string): string {
  const u = unit?.trim() ? ` ${unit}` : "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;
}

function nextActionLabel(key: string): string {
  switch (key) {
    case "CREATE_PR":
      return PROCUREMENT_TERMS.CREATE_PURCHASE_REQUEST;
    case "OPEN_GRN":
      return PROCUREMENT_TERMS.OPEN_GRN;
    case "CREATE_PO":
      return "Awaiting Purchase PO";
    case "OPEN_PO":
      return PROCUREMENT_TERMS.OPEN_PO;
    default:
      return PROCUREMENT_TERMS.TRACK_PROCUREMENT;
  }
}

export function StoreProcurementPulse() {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const liveTick = useErpRefreshTick(["dashboard"], { pollIntervalMs: ERP_DASHBOARD_POLL_MS });
  const [workspace, setWorkspace] = React.useState<WorkspaceResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [creatingMrId, setCreatingMrId] = React.useState<number | null>(null);
  const [demandPool, setDemandPool] = React.useState<ProcurementDemandPoolKey>(DEFAULT_PROCUREMENT_DEMAND_POOL);
  const creatingRef = React.useRef(false);

  const load = React.useCallback(async (opts?: { silent?: boolean; pool?: ProcurementDemandPoolKey }) => {
    const activePool = opts?.pool ?? demandPool;
    if (!opts?.silent) setLoading(true);
    try {
      const q = workspaceQueryForDemandPool(activePool);
      const data = await apiFetch<WorkspaceResponse>(`/api/procurement-planning/workspace${q}`);
      setWorkspace(data);
    } catch (e) {
      if (!opts?.silent) {
        showError(e instanceof Error ? e.message : "Failed to load procurement workspace");
      }
      setWorkspace(null);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [demandPool, showError]);

  React.useEffect(() => {
    void load();
  }, [load, liveTick]);

  const handleDemandPoolChange = React.useCallback(
    (pool: ProcurementDemandPoolKey) => {
      setDemandPool(pool);
      void load({ silent: false, pool });
    },
    [load],
  );

  const queueCounts = React.useMemo(() => deriveDemandPoolCountsFromWorkspace(workspace), [workspace]);

  const metrics = computeStoreProcurementPulseMetrics(workspace);
  const previewRows = buildStoreProcurementPreviewRows(workspace, 8);

  const handleCreatePurchaseRequest = React.useCallback(
    async (row: (typeof previewRows)[number]) => {
      if (creatingRef.current || !row.canCreatePurchaseRequest) return;
      if (!mrMatchesDemandPool(row.mr, demandPool)) {
        showError("This material requirement is not in the selected demand pool.");
        return;
      }
      const payload = buildPurchaseRequestPayloadFromMr(
        {
          materialRequirementId: row.materialRequirementId,
          docNo: row.mr.docNo,
          lines: row.mr.lines?.map((ln) => ({
            lineId: ln.lineId ?? 0,
            rmItemId: ln.rmItemId,
            itemName: ln.itemName,
            unit: ln.unit,
            requiredQty: ln.requiredQty ?? ln.remainingQty,
            shortageQty: ln.shortageQty ?? ln.remainingQty,
            remainingQty: ln.remainingQty,
          })),
        },
        { demandPool },
      );
      if (!payload) {
        showError("No RM lines are eligible for a purchase request on this MR.");
        return;
      }
      creatingRef.current = true;
      setCreatingMrId(row.materialRequirementId);
      try {
        await apiFetch("/api/procurement-planning/send-requirement", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        showSuccess(PROCUREMENT_TERMS.PR_CREATE_SUCCESS);
        await load({ silent: true });
      } catch (e) {
        showError(e instanceof Error ? e.message : "Failed to create purchase request");
      } finally {
        creatingRef.current = false;
        setCreatingMrId(null);
      }
    },
    [demandPool, load, showError, showSuccess],
  );

  const workspaceHref = `/procurement-planning?demandPool=${encodeURIComponent(demandPool)}&returnTo=dashboard`;
  const grnHref = purchaseGrnExecutionHref({ source: "dashboard" });

  const clickTo = (to: string) => ({
    onClick: () => navigate(to, { state: { from: "dashboard" } }),
  });

  return (
    <Card
      className="border-violet-200/80 bg-gradient-to-b from-violet-50/25 to-white shadow-sm ring-1 ring-violet-100/50"
      data-testid="store-procurement-pulse"
    >
      <CardHeader className="border-b border-violet-100/80 py-2 pb-1.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-[13px] font-extrabold text-slate-950">
              <PackageSearch className="h-4 w-4 text-violet-700" aria-hidden />
              {PROCUREMENT_TERMS.STORE_PULSE_TITLE}
            </CardTitle>
            <p className="text-[11px] font-normal text-slate-600">{PROCUREMENT_TERMS.STORE_PULSE_SUBTITLE}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-[10px]"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} aria-hidden />
              Refresh
            </Button>
            <Link
              to={workspaceHref}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 px-2 text-[10px] no-underline")}
            >
              Open workspace
            </Link>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2.5 p-2.5 pt-2">
        <ProcurementWorkspaceQueueTabs
          activeTab={demandPool}
          counts={queueCounts}
          onChange={handleDemandPoolChange}
          disabled={loading}
        />
        <div className="max-w-full overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ErpKpiStrip className={erpKpi.stripCompact} aria-label="Store procurement metrics">
            <ErpKpiSegment type="button" {...clickTo(workspaceHref)} aria-label="Awaiting PR">
              <ErpKpiLabel>Awaiting PR</ErpKpiLabel>
              <ErpKpiValue tone={metrics.awaitingPr > 0 ? "warn" : "muted"}>{metrics.awaitingPr}</ErpKpiValue>
            </ErpKpiSegment>
            <ErpKpiSegment type="button" {...clickTo(workspaceHref)} aria-label="Awaiting PO">
              <ErpKpiLabel>Awaiting PO</ErpKpiLabel>
              <ErpKpiValue tone={metrics.awaitingPo > 0 ? "warn" : "muted"}>{metrics.awaitingPo}</ErpKpiValue>
            </ErpKpiSegment>
            <ErpKpiSegment type="button" {...clickTo(grnHref)} aria-label="GRN pending">
              <ErpKpiLabel>GRN pending</ErpKpiLabel>
              <ErpKpiValue tone={metrics.grnPending > 0 ? "warn" : "muted"}>{metrics.grnPending}</ErpKpiValue>
            </ErpKpiSegment>
            <ErpKpiSegment type="button" {...clickTo(workspaceHref)} aria-label="Uncovered demand">
              <ErpKpiLabel>Uncovered demand</ErpKpiLabel>
              <ErpKpiValue tone={metrics.uncoveredDemand > 0 ? "warn" : "muted"}>
                {metrics.uncoveredDemand}
              </ErpKpiValue>
            </ErpKpiSegment>
            <ErpKpiSegment type="button" {...clickTo(workspaceHref)} aria-label="Store action needed">
              <ErpKpiLabel>Store action needed</ErpKpiLabel>
              <ErpKpiValue tone={metrics.storeActionNeeded > 0 ? "warn" : "muted"}>
                {metrics.storeActionNeeded}
              </ErpKpiValue>
            </ErpKpiSegment>
          </ErpKpiStrip>
        </div>

        {loading ? (
          <p className="text-xs text-slate-600">Loading procurement queue…</p>
        ) : previewRows.length === 0 ? (
          <div className="rounded-md border border-slate-200/90 bg-slate-50/70 px-3 py-2 text-xs text-slate-600">
            No open procurement cases in{" "}
            {demandPool === "REGULAR_SO"
              ? PROCUREMENT_TERMS.DEMAND_POOL_REGULAR_SO
              : demandPool === "MPRS"
                ? PROCUREMENT_TERMS.DEMAND_POOL_MPRS
                : PROCUREMENT_TERMS.DEMAND_POOL_STOCK_REPLENISHMENT}{" "}
            need Store action right now.
          </div>
        ) : (
          <div className="min-w-0 overflow-x-auto rounded-md border border-slate-200/90">
            <table className="erp-table erp-table-dense w-full min-w-[44rem] text-[11px] [&_td]:align-middle [&_th]:whitespace-nowrap [&_td]:py-1.5 [&_th]:py-1.5">
              <thead>
                <tr>
                  <th className="text-left">Source / MR</th>
                  <th className="text-left">RM item</th>
                  <th className="text-right">Remaining qty</th>
                  <th className="text-left">Stage</th>
                  <th className="text-left">Next action</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => {
                  const poHref =
                    row.primaryPoId && row.primaryPoId > 0
                      ? buildRmPoDetailHref(row.primaryPoId, { from: "dashboard" })
                      : grnHref;
                  const workspaceRowHref = `/procurement-planning?demandPool=${encodeURIComponent(
                    demandPool,
                  )}&materialRequirementId=${encodeURIComponent(String(row.materialRequirementId))}&returnTo=dashboard`;
                  const isCreating = creatingMrId === row.materialRequirementId;

                  return (
                    <tr key={row.key}>
                      <td>
                        <div className="font-semibold text-slate-900">{row.sourceLabel}</div>
                        <div className="text-[10px] text-slate-500">{row.mrDocNo}</div>
                      </td>
                      <td className="text-slate-800">{row.rmItemName}</td>
                      <td className="text-right tabular-nums font-medium text-amber-950">
                        {fmtQty(row.remainingQty, row.unit)}
                      </td>
                      <td className="text-violet-900">{row.stageLabel}</td>
                      <td className="text-slate-700">{nextActionLabel(row.nextActionKey)}</td>
                      <td className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {row.canCreatePurchaseRequest ? (
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 px-2 text-[10px] font-bold"
                              disabled={isCreating}
                              onClick={() => void handleCreatePurchaseRequest(row)}
                            >
                              {isCreating ? "Creating…" : PROCUREMENT_TERMS.CREATE_PURCHASE_REQUEST}
                            </Button>
                          ) : null}
                          {row.nextActionKey === "OPEN_GRN" ? (
                            <Link
                              to={poHref}
                              className={cn(
                                buttonVariants({ variant: "outline", size: "sm" }),
                                "h-7 px-2 text-[10px] no-underline",
                              )}
                            >
                              {PROCUREMENT_TERMS.OPEN_GRN}
                            </Link>
                          ) : null}
                          <Link
                            to={workspaceRowHref}
                            className={cn(
                              buttonVariants({ variant: "ghost", size: "sm" }),
                              "h-7 gap-1 px-2 text-[10px] no-underline",
                            )}
                          >
                            <ClipboardList className="h-3 w-3" aria-hidden />
                            Workspace
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
