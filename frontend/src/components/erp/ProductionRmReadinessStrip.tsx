import * as React from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../services/api";
import { buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import {
  buildMaterialIssueDeepLink,
  buildRmControlCenterDeepLink,
} from "../../lib/manufacturingNavigationContinuity";

export type RmReadinessLine = {
  rmItemId: number;
  rmItemName: string;
  unit: string;
  requiredForWo: number;
  issuedToProduction: number;
  alreadyConsumed: number;
  returnedToStore?: number;
  returnableQty?: number;
  availableInProduction: number;
  canSupportFgQty: number;
  status: string;
};

export type ProductionRmReadiness = {
  gate:
    | "NO_PMR"
    | "PMR_DRAFT_ONLY"
    | "WAITING_STORE_ISSUE"
    | "WAITING_RELEASE_TO_PRODUCTION"
    | "READY_FOR_PRODUCTION";
  fgItemName: string;
  fgUnit: string;
  woQty: number;
  /** Approved-only balance on the WO line (matches GET /work-orders line metrics). */
  woRemainingQty?: number;
  approvedProducedQty?: number;
  /** Sum of all production entry qty on the line (draft + approved). */
  draftAndApprovedQty?: number;
  productionAllowedNowQty: number;
  /** Approved production plus the FG capacity supported by RM still available. */
  rmSupportedCumulativeCapacityQty?: number;
  maxAdditionalQty: number;
  orderType?: string | null;
  unapprovedProducedQty?: number;
  latestPmrId: number | null;
  latestPmrDocNo: string | null;
  workOrderId: number;
  workOrderLineId?: number;
  rmLines: RmReadinessLine[];
  bomMissing?: boolean;
  flags?: {
    waitingForMaterialRequest?: boolean;
    waitingForStoreIssue?: boolean;
    waitingForReleaseToProduction?: boolean;
    readyForProduction?: boolean;
    partiallyReady?: boolean;
    materialReleasedToProduction?: boolean;
  };
};

export type RegularRmQtyCapOptions = {
  /** WO line balance from the work-order picker (fallback when API field absent). */
  lineWoRemaining: number;
  /**
   * Qty already on the entry being edited — excluded from line occupancy so edit/approve
   * caps match backend `excludeProductionId` semantics.
   */
  excludeProductionQty?: number;
};

function safeRmQty(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** WO balance for cap math — prefer readiness API over stale flat-line metrics. */
export function resolveRegularRmWoRemaining(
  data: ProductionRmReadiness,
  lineWoRemaining: number,
): number {
  if (data.woRemainingQty != null && Number.isFinite(Number(data.woRemainingQty))) {
    return safeRmQty(data.woRemainingQty);
  }
  return safeRmQty(lineWoRemaining);
}

/**
 * RM stock cap shown in the readiness strip headline ("Production allowed now").
 * Single source of truth for the "Max from issued RM" label on Production Entry.
 */
export function resolveRegularRmAllowedNowQty(data: ProductionRmReadiness | null): number | null {
  if (!data || isProductionBlockedByRmReadiness(data)) return null;
  return safeRmQty(data.productionAllowedNowQty);
}

/**
 * Max producible qty the user may enter on the production entry form (save/approve validation).
 *
 * `productionAllowedNowQty` is the RM-supported batch ceiling ("Production allowed now").
 * For REGULAR and NO_QTY, entry max follows issued RM — do **not** clamp to WO plan remaining
 * when intentional extra issue supports more FG. WO Target Remaining stays separate (Use Remaining).
 *
 * When editing an existing entry, subtract other unapproved qty on the line (backend exclude semantics).
 * Prefer server `maxAdditionalQty` when present (already accounts for unapproved drafts).
 */
export function resolveRegularRmEntryQtyCap(
  data: ProductionRmReadiness | null,
  options: RegularRmQtyCapOptions,
): number | null {
  if (!data || isProductionBlockedByRmReadiness(data)) return null;
  const rmCap = safeRmQty(data.productionAllowedNowQty);
  const exclude = safeRmQty(options.excludeProductionQty);
  const unapprovedOnLine = safeRmQty(data.unapprovedProducedQty);
  const others = exclude > 1e-6 ? Math.max(0, unapprovedOnLine - exclude) : unapprovedOnLine;
  const fromAllowedNow = Math.max(0, rmCap - others);
  const apiIncremental = safeRmQty(data.maxAdditionalQty);
  if (apiIncremental > 1e-6) {
    // When editing, maxAdditionalQty was computed without excluding this draft — prefer
    // the local envelope that restores the edited qty.
    if (exclude > 1e-6) return fromAllowedNow;
    return Math.min(fromAllowedNow, apiIncremental);
  }
  return fromAllowedNow;
}

type Props = {
  workOrderLineId: number;
  refreshKey?: number;
  onLoaded?: (data: ProductionRmReadiness | null) => void;
  onLoadingChange?: (loading: boolean) => void;
};

function fmtQty(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/\.?0+$/, "");
}

export function ProductionRmReadinessStrip({
  workOrderLineId,
  refreshKey = 0,
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
          setErr(e instanceof Error ? e.message : "Failed to load RM readiness");
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
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
        Loading RM readiness…
      </div>
    );
  }
  if (err) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
        {err}
      </div>
    );
  }
  if (!data) return null;

  const fgLabel = data.fgUnit ? `${data.fgItemName} (${data.fgUnit})` : data.fgItemName;
  const rmControlHref = buildRmControlCenterDeepLink({
    workOrderId: data.workOrderId,
    onlyBlocked: true,
    returnTo: "production-workspace",
  });
  const materialIssueHref = buildMaterialIssueDeepLink({
    workOrderId: data.workOrderId,
    returnTo: "production-workspace",
  });
  const blocked =
    data.gate === "NO_PMR" ||
    data.gate === "PMR_DRAFT_ONLY" ||
    data.gate === "WAITING_STORE_ISSUE" ||
    data.bomMissing;

  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-[12px]",
        blocked ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50/80",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-900">RM Readiness for this WO</h3>
        {!blocked ? (
          <p className="font-semibold text-emerald-900">
            Production allowed now: {fmtQty(data.productionAllowedNowQty)} {data.fgUnit || "units"}
          </p>
        ) : null}
      </div>

      {data.gate === "NO_PMR" || data.gate === "PMR_DRAFT_ONLY" ? (
        <div className="mt-1.5 space-y-1.5 text-amber-950">
          <p className="font-medium">Material request not raised. Create PMR before starting production.</p>
          <Link
            to={`/production/material-requests?workOrderId=${data.workOrderId}`}
            className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-7 text-[12px]")}
          >
            Raise PMR
          </Link>
        </div>
      ) : null}

      {data.gate === "WAITING_STORE_ISSUE" ? (
        <div className="mt-1.5 space-y-1.5 text-amber-950">
          <p className="font-medium">Waiting for Store RM Issue.</p>
          <div className="flex flex-wrap gap-1.5">
            <Link
              to={materialIssueHref}
              className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-7 text-[12px]")}
            >
              Open Material Issue Workspace
            </Link>
            <Link
              to={rmControlHref}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-[12px]")}
            >
              RM Control Center
            </Link>
          </div>
        </div>
      ) : null}

      {data.gate === "WAITING_RELEASE_TO_PRODUCTION" ? (
        <div className="mt-1.5 space-y-1.5 text-amber-950">
          <p className="font-medium">RM issued — waiting for Store to release this work order to production.</p>
          <Link
            to={materialIssueHref}
            className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-7 text-[12px]")}
          >
            Open Material Issue Workspace
          </Link>
        </div>
      ) : null}

      {data.gate === "READY_FOR_PRODUCTION" && !blocked ? (
        String(data.orderType ?? "").toUpperCase() === "NO_QTY" ? (
          <div className="mt-1 grid gap-1 text-slate-700 sm:grid-cols-3">
            <p>RM Production Capacity: <strong>{fmtQty(data.rmSupportedCumulativeCapacityQty ?? data.productionAllowedNowQty)} {data.fgUnit || "units"}</strong></p>
            <p>Produced Qty: <strong>{fmtQty(data.approvedProducedQty ?? 0)} {data.fgUnit || "units"}</strong></p>
            <p>RM-supported Remaining Capacity: <strong>{fmtQty(data.maxAdditionalQty)} {data.fgUnit || "units"}</strong></p>
          </div>
        ) : (
          <p className="mt-1 text-slate-700">
            Production may proceed up to {fmtQty(data.productionAllowedNowQty)} {data.fgUnit || "units"} based on issued RM
            at production location.
          </p>
        )
      ) : null}

      {Number(data.approvedProducedQty ?? 0) > 1e-6 &&
      data.rmLines.some((ln) => (ln.returnableQty ?? 0) > 0) ? (
        <div className="mt-1.5">
          <Link
            to={`/production/rm-returns?workOrderId=${data.workOrderId}${
              data.latestPmrId ? `&pmrId=${data.latestPmrId}` : ""
            }`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-[12px]")}
          >
            Return unused RM
          </Link>
        </div>
      ) : null}

      {data.rmLines.length > 0 ? (
        <div className="mt-2 max-h-40 overflow-auto rounded border border-slate-200/80 bg-white">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-2 py-1 font-medium">RM Item</th>
                <th className="px-2 py-1 text-right font-medium">Required</th>
                <th className="px-2 py-1 text-right font-medium">Issued</th>
                <th className="px-2 py-1 text-right font-medium">Consumed</th>
                <th className="px-2 py-1 text-right font-medium">Returned</th>
                <th className="px-2 py-1 text-right font-medium">Unused</th>
                <th className="px-2 py-1 text-right font-medium">Returnable</th>
                <th className="px-2 py-1 text-right font-medium">Supports FG</th>
                <th className="px-2 py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rmLines.map((ln) => (
                <tr key={ln.rmItemId} className="border-t border-slate-100">
                  <td className="px-2 py-0.5">{ln.rmItemName}</td>
                  <td className="px-2 py-0.5 text-right tabular-nums">
                    {fmtQty(ln.requiredForWo)} {ln.unit}
                  </td>
                  <td className="px-2 py-0.5 text-right tabular-nums">
                    {fmtQty(ln.issuedToProduction)} {ln.unit}
                  </td>
                  <td className="px-2 py-0.5 text-right tabular-nums">
                    {fmtQty(ln.alreadyConsumed)} {ln.unit}
                  </td>
                  <td className="px-2 py-0.5 text-right tabular-nums">
                    {fmtQty(ln.returnedToStore ?? 0)} {ln.unit}
                  </td>
                  <td className="px-2 py-0.5 text-right tabular-nums">
                    {fmtQty(ln.availableInProduction)} {ln.unit}
                  </td>
                  <td className="px-2 py-0.5 text-right tabular-nums">
                    {fmtQty(ln.returnableQty ?? 0)} {ln.unit}
                  </td>
                  <td className="px-2 py-0.5 text-right tabular-nums">{fmtQty(ln.canSupportFgQty)}</td>
                  <td className="px-2 py-0.5">{ln.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : data.bomMissing ? (
        <p className="mt-1 text-amber-900">Approved BOM missing for {fgLabel}.</p>
      ) : null}
    </div>
  );
}

export function isProductionBlockedByRmReadiness(data: ProductionRmReadiness | null): boolean {
  if (!data) return true;
  return (
    data.bomMissing === true ||
    data.gate === "NO_PMR" ||
    data.gate === "PMR_DRAFT_ONLY" ||
    data.gate === "WAITING_STORE_ISSUE" ||
    data.gate === "WAITING_RELEASE_TO_PRODUCTION"
  );
}

/** True when REGULAR production entry must stay disabled (loading, error, or gate). */
export function isRegularProductionEntryBlocked(
  data: ProductionRmReadiness | null,
  loading: boolean,
): boolean {
  if (loading) return true;
  return isProductionBlockedByRmReadiness(data);
}

/** @deprecated Use {@link resolveRegularRmEntryQtyCap} — kept for call-site stability. */
export function maxProductionQtyFromReadiness(
  data: ProductionRmReadiness | null,
  woRemaining: number,
  excludeProductionQty?: number,
): number | null {
  if (!data) return null;
  return resolveRegularRmEntryQtyCap(data, { lineWoRemaining: woRemaining, excludeProductionQty });
}
