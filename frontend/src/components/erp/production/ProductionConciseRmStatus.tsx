import * as React from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../../services/api";
import { cn } from "../../../lib/utils";
import type { ProductionRmReadiness } from "../ProductionRmReadinessStrip";
import {
  deriveProductionConciseRmLabel,
  productionConciseRmTone,
  type ProductionConciseRmLabel,
} from "../../../lib/productionRmConciseStatus";
import { rmControlCenterHref } from "../../../lib/materialWorkflowLinks";

type Props = {
  workOrderLineId: number;
  refreshKey?: number;
  onLoaded?: (data: ProductionRmReadiness | null) => void;
  onLoadingChange?: (loading: boolean) => void;
  className?: string;
  showControlCenterLink?: boolean;
};

const TONE_CLASS: Record<ReturnType<typeof productionConciseRmTone>, string> = {
  ready: "border-emerald-300 bg-emerald-50 text-emerald-950",
  partial: "border-amber-300 bg-amber-50 text-amber-950",
  waiting: "border-amber-300 bg-amber-50 text-amber-950",
};

/** P6B-2 — concise RM status for Production workspace (READY / PARTIAL / WAITING RM). */
export function ProductionConciseRmStatus({
  workOrderLineId,
  refreshKey = 0,
  onLoaded,
  onLoadingChange,
  className,
  showControlCenterLink = true,
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
      <div
        className={cn(
          "inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600",
          className,
        )}
        data-testid="production-rm-status-loading"
      >
        Material status…
      </div>
    );
  }

  if (err) {
    return (
      <p className={cn("rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-950", className)}>
        {err}
      </p>
    );
  }

  const label: ProductionConciseRmLabel | null = deriveProductionConciseRmLabel(data);
  if (!label) return null;

  const tone = productionConciseRmTone(label);
  const rmControlHref =
    data && showControlCenterLink
      ? rmControlCenterHref({
          workOrderId: data.workOrderId,
          onlyBlocked: true,
          returnTo: "production-workspace",
        })
      : null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5",
        TONE_CLASS[tone],
        className,
      )}
      data-testid="production-concise-rm-status"
    >
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">Material</p>
        <p className="text-[13px] font-semibold">{label}</p>
        {label === "WAITING RM" ? (
          <p className="text-[11px] leading-snug opacity-90">Waiting for Store RM issue before production.</p>
        ) : label === "PARTIAL" ? (
          <p className="text-[11px] leading-snug opacity-90">Partial issue — entry may be capped until Store completes issue.</p>
        ) : (
          <p className="text-[11px] leading-snug opacity-90">Store has issued required RM.</p>
        )}
      </div>
      {rmControlHref && label !== "READY" ? (
        <Link
          to={rmControlHref}
          className="shrink-0 text-[11px] font-semibold underline underline-offset-2"
          data-testid="production-rm-control-link"
        >
          RM Control Center
        </Link>
      ) : null}
    </div>
  );
}
