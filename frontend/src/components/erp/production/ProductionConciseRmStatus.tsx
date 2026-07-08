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
import { isSeededQueueRmReadiness } from "../../../lib/productionWorkspaceReadinessUx";
import { rmControlCenterHref } from "../../../lib/materialWorkflowLinks";

type Props = {
  workOrderLineId: number;
  refreshKey?: number;
  onLoaded?: (data: ProductionRmReadiness | null) => void;
  onLoadingChange?: (loading: boolean) => void;
  className?: string;
  showControlCenterLink?: boolean;
  initialData?: ProductionRmReadiness | null;
  /** Workstation layout — label only, no helper subtext. */
  dense?: boolean;
  /** Premium operator console — stronger presence, no helper subtext. */
  workstation?: boolean;
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
  initialData = null,
  dense = false,
  workstation = false,
}: Props) {
  const initialDataMatchesLine = initialData?.workOrderLineId === workOrderLineId;
  const [data, setData] = React.useState<ProductionRmReadiness | null>(
    initialDataMatchesLine ? initialData : null,
  );
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
    const seeded = initialData?.workOrderLineId === workOrderLineId ? initialData : null;
    const skipFetch = Boolean(seeded && isSeededQueueRmReadiness(seeded) && refreshKey === 0);
    if (seeded) {
      setData(seeded);
      setLoading(false);
      onLoaded?.(seeded);
      onLoadingChange?.(false);
    } else {
      setLoading(true);
      onLoadingChange?.(true);
      onLoaded?.(null);
    }
    setErr(null);
    if (skipFetch) {
      return () => {
        cancelled = true;
        onLoadingChange?.(false);
      };
    }
    apiFetch<ProductionRmReadiness | { skipped: boolean }>(
      `/api/production/work-order-lines/${workOrderLineId}/rm-readiness${refreshKey > 0 ? `?fresh=${Date.now()}` : ""}`,
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
  }, [workOrderLineId, refreshKey, initialData, onLoaded, onLoadingChange]);

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
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2",
        workstation && "rounded-lg px-3 py-2.5 shadow-sm",
        dense && !workstation && "px-2 py-1",
        TONE_CLASS[tone],
        className,
      )}
      data-testid="production-concise-rm-status"
    >
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">Material</p>
        <p className={cn("font-semibold", workstation ? "text-[14px]" : dense ? "text-[12px]" : "text-[13px]")}>
          {label}
        </p>
        {!dense && !workstation && label === "WAITING RM" ? (
          <p className="text-[11px] leading-snug opacity-90">Waiting for Store RM issue before production.</p>
        ) : !dense && !workstation && label === "PARTIAL" ? (
          <p className="text-[11px] leading-snug opacity-90">Partial issue — entry may be capped until Store completes issue.</p>
        ) : !dense && !workstation ? (
          <p className="text-[11px] leading-snug opacity-90">Store has issued required RM.</p>
        ) : null}
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
