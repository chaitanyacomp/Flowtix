import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../../services/api";
import { Button, buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import type { ProductionRmReadiness } from "./ProductionRmReadinessStrip";
import { isProductionBlockedByRmReadiness } from "./ProductionRmReadinessStrip";
import { rmControlCenterHref } from "../../lib/materialWorkflowLinks";
import { buildRmIssueNextStep } from "../../lib/regularSoOperationalGuidance";
type ContextStrip = {
  flowLabel?: string;
  soLabel?: string;
  woLabel?: string;
  fgName?: string;
  planned?: number;
  produced?: number;
  remaining?: number;
};

type Props = {
  workOrderLineId: number;
  refreshKey?: number;
  context?: ContextStrip;
  onLoaded?: (data: ProductionRmReadiness | null) => void;
  onLoadingChange?: (loading: boolean) => void;
  /** P6B-1 — Production workspace never executes Store issue; read-only + RM Control Center link. */
  hideStoreExecution?: boolean;
};

function fmtQty(n: number, unit?: string): string {
  const u = unit?.trim() ? ` ${unit}` : "";
  if (Number.isInteger(n)) return `${n}${u}`;
  return `${n.toFixed(3).replace(/\.?0+$/, "")}${u}`;
}

export function ProductionMaterialWorkflowCard({
  workOrderLineId,
  refreshKey = 0,
  context,
  onLoaded,
  onLoadingChange,
  hideStoreExecution = false,
}: Props) {
  const navigate = useNavigate();
  const [data, setData] = React.useState<ProductionRmReadiness | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (workOrderLineId <= 0) {
      setData(null);
      onLoaded?.(null);
      onLoadingChange?.(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    onLoadingChange?.(true);
    onLoaded?.(null);
    setErr(null);
    apiFetch<ProductionRmReadiness | { skipped: boolean }>(
      `/api/production/work-order-lines/${workOrderLineId}/rm-readiness`,
    )
      .then((res) => {
        if (cancelled) return;
        if ("skipped" in res && res.skipped) {
          setData(null);
          onLoaded?.(null);
          return;
        }
        const row = res as ProductionRmReadiness;
        setData(row);
        onLoaded?.(row);
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Failed to load material status");
          onLoaded?.(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          onLoadingChange?.(false);
        }
      });
    return () => {
      cancelled = true;
      onLoadingChange?.(false);
    };
  }, [workOrderLineId, refreshKey, onLoaded, onLoadingChange]);

  if (workOrderLineId <= 0) return null;

  if (loading && !data) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
        Loading material status…
      </div>
    );
  }

  if (err) {
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">{err}</p>
    );
  }

  if (!data) return null;

  const blocked = isProductionBlockedByRmReadiness(data);
  const rmIssueStep = blocked ? buildRmIssueNextStep(data, "production-workspace") : null;

  const rmControlHref = rmControlCenterHref({
    workOrderId: data.workOrderId,
    onlyBlocked: true,
    returnTo: "production-workspace",
  });

  const partialIssue = data.gate === "PARTIAL_READY";

  return (
    <div className="space-y-2">
      {context ? (
        <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {context.flowLabel ? (
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{context.flowLabel}</span>
            ) : null}
            <span className="font-bold text-slate-950">
              {[context.soLabel, context.woLabel, context.fgName].filter(Boolean).join(" · ")}
            </span>
          </div>
          {context.planned != null ? (
            <p className="mt-1 text-[13px] text-slate-700">
              Planned <span className="font-semibold tabular-nums">{context.planned}</span>
              {" · "}
              Produced <span className="font-semibold tabular-nums">{context.produced ?? 0}</span>
              {" · "}
              Remaining <span className="font-semibold tabular-nums">{context.remaining ?? 0}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {blocked || data.bomMissing ? (
        <section className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-900">RM status</p>
          {data.gate === "NO_PMR" || data.gate === "PMR_DRAFT_ONLY" ? (
            <>
              <h2 className="mt-0.5 text-[15px] font-bold text-slate-950">Waiting for RM Issue</h2>
              <p className="mt-1 text-sm text-slate-800">
                Store must issue required RM before production can start.
              </p>
            </>
          ) : data.bomMissing ? (
            <>
              <h2 className="mt-0.5 text-[15px] font-bold text-slate-950">BOM missing</h2>
              <p className="mt-1 text-sm text-amber-900">Approved BOM missing for this item.</p>
            </>
          ) : (
            <>
              <h2 className="mt-0.5 text-[15px] font-bold text-slate-950">Waiting for RM Issue</h2>
              <p className="mt-1 text-sm text-slate-800">
                Store must issue required RM before production can start.
              </p>
            </>
          )}
          {partialIssue ? (
            <p className="mt-1 text-xs font-medium text-amber-900">Partially issued — production entry is capped until remaining RM arrives.</p>
          ) : null}
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              {hideStoreExecution ? (
                <p className="text-sm font-semibold text-amber-950">Waiting for Store RM Issue.</p>
              ) : rmIssueStep ? (
                <Link
                  to={rmIssueStep.primaryAction.href ?? "#"}
                  className={cn(
                    buttonVariants({ size: "default" }),
                    "h-9 bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 no-underline",
                  )}
                  data-testid={rmIssueStep.primaryAction.testId}
                >
                  {rmIssueStep.primaryAction.label}
                </Link>
              ) : null}
              <Link
                to={rmControlHref}
                className={cn(
                  buttonVariants({ variant: "outline", size: "default" }),
                  "h-9 px-4 text-sm font-bold text-slate-900 no-underline",
                )}
              >
                Open RM Control Center
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {!blocked && !data.bomMissing ? (
        <section className="rounded-lg border border-emerald-400 bg-emerald-50 px-3 py-2 shadow-sm">
          <h2 className="text-sm font-bold text-emerald-950">RM ready for production</h2>
          <p className="mt-0.5 text-sm text-emerald-900">
            Production entry enabled — supports{" "}
            <span className="font-bold tabular-nums">
              {fmtQty(data.productionAllowedNowQty)} {data.fgUnit || "FG"}
            </span>
            .
          </p>
          {partialIssue ? (
            <p className="mt-1 text-xs text-emerald-900">Partial issue — entry capped by RM at production.</p>
          ) : null}
        </section>
      ) : null}

      {data.rmLines.some((ln) => (ln.returnableQty ?? 0) > 0) ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-[12px] text-slate-700"
            onClick={() =>
              navigate(
                `/production/rm-returns?workOrderId=${data.workOrderId}${
                  data.latestPmrId ? `&pmrId=${data.latestPmrId}` : ""
                }`,
              )
            }
          >
            Return unused RM
          </Button>
        </div>
      ) : null}
    </div>
  );
}
