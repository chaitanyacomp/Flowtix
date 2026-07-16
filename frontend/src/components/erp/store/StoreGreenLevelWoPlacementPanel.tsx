import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";

import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { apiFetch } from "../../../services/api";
import { cn } from "../../../lib/utils";
import { useErpRefreshTick } from "../../../hooks/useErpRefreshTick";
import { displayWorkOrderTraceNo } from "../../../lib/docNoDisplay";
import {
  formatPostWoCreateSuccessMessage,
  materialIssueWorkspaceHref,
  postWoMaterialIssueHref,
  rmControlCenterHref,
} from "../../../lib/materialWorkflowLinks";
import { useToast } from "../../../contexts/ToastContext";

export type GreenLevelPlacement = {
  available: boolean;
  plan: { id: number; docNo?: string | null; periodKey?: string | null; releasedAt?: string | null } | null;
  summary: { selectedQty: number; placedQty: number; remainingQty: number; canCreateWorkOrder: boolean };
  lines: Array<{
    fgItemId: number;
    itemName: string;
    selectedQty: number;
    placedQty: number;
    remainingQty: number;
  }>;
  workOrders: Array<{
    id: number;
    docNo?: string | null;
    status: string;
    totalQty: number;
    pmrId?: number | null;
    pmrDocNo?: string | null;
    pmrStatus?: string | null;
  }>;
  rmReadiness?: {
    lines?: Array<{ rmItemName: string; requiredQty: number; availableQty: number; shortageQty: number }>;
    missingBoms?: Array<{ fgItemName?: string; sfgName?: string; message?: string }>;
    summary?: { shortageQty?: number; missingBomCount?: number };
    canPlace?: boolean;
  };
};

const RETURN_TO = "green-level-wo";

function fmtQty(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function pmrStatusLabel(status?: string | null): string {
  const token = String(status ?? "").trim().toUpperCase();
  if (!token) return "None";
  return token.replace(/_/g, " ");
}

function isIssuedPmr(status?: string | null): boolean {
  const token = String(status ?? "").trim().toUpperCase();
  return token === "FULLY_ISSUED" || token === "SHORT_ISSUE_ACCEPTED" || token === "RELEASED";
}

export function StoreGreenLevelWoPlacementPanel({
  planId,
  className,
}: {
  planId?: number | null;
  className?: string;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const liveTick = useErpRefreshTick(["production", "dashboard", "workorders"], { pollIntervalMs: 0 });
  const [placement, setPlacement] = React.useState<GreenLevelPlacement | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let mounted = true;
    const q =
      planId != null && Number(planId) > 0
        ? `?planId=${encodeURIComponent(String(planId))}`
        : "";
    void apiFetch<GreenLevelPlacement>(`/api/production/green-level-work-orders/placement${q}`)
      .then((data) => {
        if (!mounted) return;
        setPlacement(data ?? null);
        setError(null);
      })
      .catch((e) => {
        if (!mounted) return;
        setPlacement(null);
        setError(e instanceof Error ? e.message : "Failed to load Green Level WO placement");
      });
    return () => {
      mounted = false;
    };
  }, [liveTick, reloadKey, planId]);

  const loading = placement === null && !error;
  const hasPlacement =
    Boolean(placement?.available) &&
    ((placement?.summary?.remainingQty ?? 0) > 0 || (placement?.workOrders?.length ?? 0) > 0);
  const rmShortage = (placement?.rmReadiness?.summary?.shortageQty ?? 0) > 0;
  const missingBomCount = placement?.rmReadiness?.summary?.missingBomCount ?? 0;

  async function createGreenLevelWorkOrders() {
    if (!placement?.plan?.id || creating) return;
    setCreating(true);
    try {
      const lines = (placement.lines ?? [])
        .filter((line) => Number(line.remainingQty) > 0)
        .map((line) => ({ fgItemId: line.fgItemId, qty: Number(line.remainingQty) }));
      const result = await apiFetch<{
        workOrderId?: number | null;
        pmrs?: Array<{ workOrderId: number; pmrId?: number | null; pmrDocNo?: string | null }>;
      }>("/api/production/green-level-work-orders", {
        method: "POST",
        body: JSON.stringify({ planId: placement.plan.id, lines }),
      });
      const woId = Number(result?.workOrderId ?? result?.pmrs?.[0]?.workOrderId ?? 0);
      const pmr = result?.pmrs?.find((row) => row.workOrderId === woId) ?? result?.pmrs?.[0];
      const woLabel = woId > 0 ? displayWorkOrderTraceNo(woId) : "Green Level WO";
      toast.showSuccess(formatPostWoCreateSuccessMessage(woLabel, pmr?.pmrDocNo));
      setReloadKey((x) => x + 1);
      setError(null);
      if (woId > 0) {
        const issueHref = postWoMaterialIssueHref({
          workOrderId: woId,
          pmrId: pmr?.pmrId,
          returnTo: RETURN_TO,
        });
        window.setTimeout(() => {
          navigate(issueHref);
        }, 400);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create Green Level WO");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return <p className="px-1 py-3 text-[13px] text-slate-600">Loading Green Level WO placement…</p>;
  }

  if (error && !placement?.available) {
    return <p className="px-1 py-3 text-[13px] text-red-700">{error}</p>;
  }

  if (!hasPlacement) {
    return (
      <p className="px-1 py-4 text-[13px] text-slate-600">
        No Green Level replenishment is pending WO placement. Confirm monthly plan Green Level selection is released.
      </p>
    );
  }

  const planLabel =
    placement?.plan?.docNo?.trim() ||
    placement?.plan?.periodKey?.trim() ||
    (placement?.plan?.id ? `Plan ${placement.plan.id}` : "Monthly plan");

  return (
    <div className={cn("space-y-4", className)}>
      {error ? <p className="text-[12px] text-red-700">{error}</p> : null}

      <section
        aria-label="Green Level WO Placement"
        className="rounded-md border border-emerald-200 bg-emerald-50/40"
        data-testid="store-green-level-placement"
      >
        <div className="flex flex-col gap-2 border-b border-emerald-100 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-[13px] font-bold tracking-tight text-slate-900">Place Green Level WO</h2>
            <p className="text-[11px] text-slate-600">{planLabel}</p>
            <p className="mt-0.5 text-[11px] tabular-nums text-slate-600">
              Selected {fmtQty(placement?.summary.selectedQty)} · Placed {fmtQty(placement?.summary.placedQty)} ·
              Pending {fmtQty(placement?.summary.remainingQty)}
            </p>
          </div>
          {(placement?.summary.remainingQty ?? 0) > 0 ? (
            <Button
              type="button"
              size="sm"
              disabled={!placement?.summary.canCreateWorkOrder || creating}
              className="shrink-0 bg-emerald-700 hover:bg-emerald-800"
              data-testid="store-create-green-level-wo"
              onClick={() => void createGreenLevelWorkOrders()}
            >
              {creating ? "Creating…" : "Create Green Level WO"}
            </Button>
          ) : null}
        </div>

        <div className="px-3 py-2.5">
          {(placement?.summary.remainingQty ?? 0) > 0 ? (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(placement?.lines ?? [])
                .filter((line) => line.remainingQty > 0)
                .map((line) => (
                  <div key={line.fgItemId} className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="truncate font-medium text-slate-800">{line.itemName}</span>
                    <span className="shrink-0 tabular-nums text-slate-600">{fmtQty(line.remainingQty)}</span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-[12px] text-slate-600">All selected Green Level quantity is placed on work orders.</p>
          )}

          {!placement?.summary.canCreateWorkOrder && (placement?.summary.remainingQty ?? 0) > 0 ? (
            <p className="mt-2 text-[11px] text-amber-800">
              {missingBomCount > 0
                ? "Approved BOM is missing for one or more FG lines. Resolve BOM before WO placement."
                : rmShortage
                  ? "RM is not fully available. Track procurement in RM Control Center, then return to place WO."
                  : "Green Level Replenishment WO Pending — resolve RM readiness first."}
            </p>
          ) : null}

          {rmShortage || missingBomCount > 0 ? (
            <div className="mt-2">
              <Link
                to={rmControlCenterHref({ returnTo: RETURN_TO })}
                className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-emerald-800 underline underline-offset-2"
              >
                Open RM Control Center
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          ) : null}
        </div>
      </section>

      {(placement?.workOrders?.length ?? 0) > 0 ? (
        <section
          aria-label="Green Level work orders"
          className="rounded-md border border-slate-200 bg-white"
          data-testid="store-green-level-wo-handoff"
        >
          <div className="border-b border-slate-100 px-3 py-2">
            <h3 className="text-[12px] font-bold text-slate-900">Store handoff — PMR · RM Issue · Release</h3>
            <p className="text-[11px] text-slate-500">
              Production receives these work orders only after Store releases RM to production.
            </p>
          </div>
          <div className="overflow-x-auto px-3 py-2">
            <table className="w-full min-w-[40rem] border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pr-2">WO</th>
                  <th className="py-1.5 pr-2 text-right">Qty</th>
                  <th className="py-1.5 pr-2">PMR</th>
                  <th className="py-1.5 pr-2">RM Issue</th>
                  <th className="py-1.5 pr-2">Next step</th>
                </tr>
              </thead>
              <tbody>
                {(placement?.workOrders ?? []).map((wo) => {
                  const woLabel = wo.docNo?.trim() || displayWorkOrderTraceNo(wo.id);
                  const pmrHref =
                    wo.pmrId && wo.pmrId > 0
                      ? materialIssueWorkspaceHref({
                          pmrId: wo.pmrId,
                          workOrderId: wo.id,
                          returnTo: RETURN_TO,
                        })
                      : postWoMaterialIssueHref({ workOrderId: wo.id, returnTo: RETURN_TO });
                  const rmccHref = rmControlCenterHref({ workOrderId: wo.id, returnTo: RETURN_TO });
                  const releaseHref = `/production-release?workOrderId=${encodeURIComponent(String(wo.id))}`;
                  const issued = isIssuedPmr(wo.pmrStatus);
                  const released = String(wo.pmrStatus ?? "").toUpperCase() === "RELEASED";

                  return (
                    <tr key={wo.id} className="border-b border-slate-100 text-slate-800">
                      <td className="py-1.5 pr-2 font-medium">{woLabel}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(wo.totalQty)}</td>
                      <td className="py-1.5 pr-2">
                        {wo.pmrId ? (
                          <Link to={pmrHref} className="font-medium text-primary underline underline-offset-2">
                            {wo.pmrDocNo?.trim() || `PMR-${wo.pmrId}`}
                          </Link>
                        ) : (
                          <span className="text-slate-500">Pending</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2">
                        <Badge variant={issued || released ? "success" : "warning"} className="text-[10px]">
                          {pmrStatusLabel(wo.pmrStatus)}
                        </Badge>
                      </td>
                      <td className="py-1.5 pr-2">
                        {released ? (
                          <span className="text-[11px] font-medium text-emerald-800">Released to Production</span>
                        ) : issued ? (
                          <Link
                            to={releaseHref}
                            className="inline-flex items-center gap-0.5 font-semibold text-primary underline underline-offset-2"
                          >
                            Release to Production
                            <ChevronRight className="h-3 w-3" aria-hidden />
                          </Link>
                        ) : (
                          <Link
                            to={rmccHref}
                            className="inline-flex items-center gap-0.5 font-semibold text-primary underline underline-offset-2"
                          >
                            Continue in RM Control Center
                            <ChevronRight className="h-3 w-3" aria-hidden />
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <p className="text-[11px] leading-relaxed text-slate-500">
        Store owns Green Level WO placement through release — same ownership as customer requirement-sheet WOs. After
        release, Production executes from the Production Workspace.
      </p>
    </div>
  );
}
