import * as React from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../../services/api";
import { buttonVariants } from "../../ui/button";
import { cn } from "../../../lib/utils";
import type { ProductionRmReadiness } from "../ProductionRmReadinessStrip";
import { isProductionBlockedByRmReadiness } from "../ProductionRmReadinessStrip";
import { rmControlCenterHref } from "../../../lib/materialWorkflowLinks";

type Props = {
  workOrderLineId: number;
  refreshKey?: number;
  workOrderNo?: string | null;
  onLoaded?: (data: ProductionRmReadiness | null) => void;
  onLoadingChange?: (loading: boolean) => void;
};

/**
 * P6B-1 — NO_QTY production RM status (read-only). No Store execution actions.
 */
export function NoQtyProductionRmStatusCard({
  workOrderLineId,
  refreshKey = 0,
  workOrderNo,
  onLoaded,
  onLoadingChange,
}: Props) {
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
  const rmControlHref = rmControlCenterHref({
    workOrderId: data.workOrderId,
    onlyBlocked: true,
    returnTo: "production-workspace",
  });

  if (!blocked && !data.bomMissing) {
    return (
      <section className="rounded-lg border border-emerald-400 bg-emerald-50 px-3 py-2 shadow-sm" data-testid="no-qty-rm-ready">
        <h2 className="text-sm font-bold text-emerald-950">RM ready for production</h2>
        <p className="mt-0.5 text-sm text-emerald-900">Store has issued required RM. Production entry is enabled.</p>
      </section>
    );
  }

  return (
    <section
      className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-3 shadow-sm"
      data-testid="no-qty-rm-waiting"
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-900">RM status</p>
      <h2 className="mt-0.5 text-[15px] font-bold text-slate-950">Waiting for Store RM Issue</h2>
      <p className="mt-1 text-sm text-slate-800">
        Store must issue required RM before production can start.
        {workOrderNo ? ` Work order: ${workOrderNo}` : ""}
      </p>
      {data.gate === "PARTIAL_READY" ? (
        <p className="mt-1 text-xs font-medium text-amber-900">
          Partially issued — production entry is capped until remaining RM arrives.
        </p>
      ) : null}
      <div className="mt-3">
        <Link
          to={rmControlHref}
          className={cn(
            buttonVariants({ variant: "outline", size: "default" }),
            "h-9 px-4 text-sm font-bold text-slate-900 no-underline",
          )}
          data-testid="no-qty-open-rm-control-center"
        >
          Open RM Control Center
        </Link>
      </div>
    </section>
  );
}
