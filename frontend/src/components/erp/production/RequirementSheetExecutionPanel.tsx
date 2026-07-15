import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import { Button, buttonVariants } from "../../ui/button";
import { Input } from "../../ui/input";
import { Badge } from "../../ui/badge";
import { apiFetch, ApiRequestError } from "../../../services/api";
import { workOrdersFocusHref } from "../../../lib/drillDownRoutes";
import { displayPmrNo, displayWorkOrderNo } from "../../../lib/docNoDisplay";
import { cn } from "../../../lib/utils";
import { useToast } from "../../../contexts/ToastContext";
import { useStoreExecutionNavContext } from "../../../hooks/useStoreExecutionNavContext";
import { navContextMaterialIssueFromExecutionWorkspace, navStateWithNavContext } from "../../../lib/erpNavContext";
import { formatPostWoCreateSuccessMessage } from "../../../lib/materialWorkflowLinks";
import { buildMaterialIssueDeepLink } from "../../../lib/manufacturingNavigationContinuity";
import { placementQuantitiesMatchSuggested } from "../../../lib/materialIssueContinuousSession";
import {
  EXECUTION_WO_HISTORY_MAX_ROWS,
  executionWoHistoryVisibleCount,
  formatExecutionQty,
  formatPriorCycleExecutionBanner,
  fgItemRmStatusLabel,
  placementInlineReadinessMessage,
  procurementCollapsedSummary,
  rmCoverageChipClassName,
  rmCoverageLabelFromPlacement,
  rmDetailCollapsedSummary,
  WO_PLANNING_UX,
} from "../../../lib/requirementSheetExecutionWorkspaceUx";

type ProgressStatus = "NOT_STARTED" | "IN_PROGRESS" | "PARTIAL" | "COMPLETE" | "BLOCKED";
type ReadinessDecision =
  | "READY_TO_PLACE_WO"
  | "PARTIALLY_READY"
  | "AWAITING_PROCUREMENT"
  | "EXISTING_WO_PENDING_RM_ISSUE"
  | "EXISTING_WO_RUNNING"
  | "BLOCKED";

type RmReadinessBlock = {
  basis: "PROPOSED_WO_QTY" | "RS_BALANCE" | string;
  fgBalanceLines?: Array<{
    fgItemId: number;
    fgItemName: string;
    fgQty: number;
    bomMissing: boolean;
  }>;
  fgProposedLines?: Array<{
    fgItemId: number;
    fgItemName: string;
    fgQty: number;
    bomMissing: boolean;
  }>;
  lines: Array<{
    rmItemId: number;
    rmItemName: string;
    requiredQty: number;
    availableQty: number;
    shortageQty: number;
    incomingQty: number;
    status: "READY" | "PARTIALLY_READY" | "AWAITING_PROCUREMENT" | "MISSING_BOM";
  }>;
  missingBoms: Array<{
    type?: "TOP_LEVEL_MISSING_BOM" | "TOP_LEVEL_EMPTY_BOM" | "CHILD_MISSING_BOM";
    status?: "MISSING_BOM";
    fgItemId?: number;
    fgItemName?: string;
    fgQty?: number;
    sfgItemId?: number;
    sfgName?: string;
    message?: string;
  }>;
  summary: {
    requiredQty: number;
    availableQty: number;
    shortageQty: number;
    incomingQty: number;
    readyLineCount: number;
    partialLineCount: number;
    awaitingProcurementLineCount: number;
    missingBomCount: number;
    proposedFgQty?: number;
  };
};

export type RsExecutionSummary = {
  requirementSheetId: number;
  salesOrderId: number;
  cycleId: number | null;
  periodKey: string | null;
  status: string;
  release: {
    monthlyPlanId: number | null;
    released: boolean;
    releasedAt: string | null;
    releasedRevision: number | null;
    label: string | null;
    procurementNotRequiredWithoutPlan?: boolean;
    allowWoWithoutPlanRelease?: boolean;
  };
  totals: {
    rsDemandQty: number;
    woPlacedQty: number;
    rsBalanceQty: number;
    rmLimitedCapacityQty?: number;
  };
  kpis?: {
    customerDemandQty?: number;
    productionShortageQty?: number;
    qcFinalRejectionQty?: number;
    totalRecoveryQty?: number;
    totalRsRequirement: number;
    woQuantityPlaced: number;
    remainingRequirement: number;
    remainingToPlace?: number;
    rmLimitedCapacity: number;
    suggestedNextWoQty: number;
    numberOfWos: number;
  };
  lines: Array<{
    itemId: number;
    itemName: string;
    rsDemandQty: number;
    woPlacedQty: number;
    rsBalanceQty: number;
  }>;
  workOrders: Array<{
    id: number;
    docNo: string | null;
    status: string;
    createdAt: string | null;
    totalQty: number;
    pmrId: number | null;
    pmrDocNo: string | null;
    pmrStatus: string | null;
  }>;
  readiness: {
    status: ReadinessDecision;
    label: string;
    reason: string;
  };
  procurementProgress: {
    steps: Array<{
      key: string;
      label: string;
      status: ProgressStatus;
    }>;
    counts: {
      mrLineCount: number;
      prCount: number;
      poCount: number;
      grnCount: number;
      grnReceivedQty: number;
      pendingGrnQty: number;
    };
  };
  rmReadiness: RmReadinessBlock;
  existingWoSummary: Array<{
    workOrderId: number;
    docNo: string | null;
    woQty: number;
    woStatus: string;
    createdAt?: string | null;
    fgItemId?: number | null;
    fgItemName?: string | null;
    unit?: string | null;
    pmrId: number | null;
    pmrDocNo: string | null;
    pmrStatus: string | null;
    rmRequiredQty: number;
    rmIssuedQty: number;
    rmPendingIssueQty: number;
    rmIssueStatus: string;
    productionStatus: string;
  }>;
  procurement: {
    status: string;
    materialRequirementId: number | null;
    materialRequirementDocNo: string | null;
    summaryLabel: string;
  };
  rmPreview: {
    available: boolean;
    basis?: string;
    message: string;
  };
  placement: {
    status: "READY" | "PARTIALLY_READY" | "AWAITING_PROCUREMENT" | "MISSING_BOM" | "ZERO_BALANCE";
    reason: string;
    canPlace: boolean;
    sharedRmConflict?: boolean;
    snapshot?: {
      totalWoPlacedQty: number;
      totalRsBalanceQty: number;
      totalExecutableQty: number;
      placementStatus: string | null;
      woPlacedByItem: Record<string, number>;
      lines: Array<{
        itemId: number;
        rsBalanceQty: number;
        suggestedExecutableQty: number;
      }>;
    };
    summary: {
      totalRsDemandQty: number;
      totalWoPlacedQty: number;
      totalRsBalanceQty: number;
      totalExecutableQty: number;
      totalRmLimitedCapacityQty?: number;
    };
    lines: Array<{
      itemId: number;
      itemName: string;
      unit?: string | null;
      rsDemandQty: number;
      woPlacedQty: number;
      rsBalanceQty: number;
      rmLimitedCapacityQty?: number;
      suggestedExecutableQty: number;
      status: "READY" | "PARTIALLY_READY" | "AWAITING_PROCUREMENT" | "MISSING_BOM" | "ZERO_BALANCE";
      reason: string;
      limitingRmItemName?: string | null;
      operatorGuidance?: {
        code: string;
        message: string;
        limitingRmItemName?: string | null;
      } | null;
      rmLines: Array<{
        rmItemId: number;
        rmItemName: string;
        requiredQty: number;
        availableQty: number;
        shortageQty: number;
        incomingQty: number;
        status: "READY" | "PARTIALLY_READY" | "AWAITING_PROCUREMENT";
      }>;
    }>;
  };
  fgItemReadiness?: Array<{
    itemId: number;
    itemName: string;
    rsBalanceQty: number;
    suggestedExecutableQty: number;
    placementStatus: string;
    outcome: string;
    shortageSummary: string | null;
  }>;
  fgReadinessSummary?: {
    readyCount: number;
    shortageCount: number;
    totalWithBalance: number;
  };
  placementSnapshot?: {
    totalWoPlacedQty: number;
    totalRsBalanceQty: number;
    totalExecutableQty: number;
    placementStatus: string | null;
    woPlacedByItem: Record<string, number>;
    lines: Array<{
      itemId: number;
      rsBalanceQty: number;
      suggestedExecutableQty: number;
    }>;
  };
};

type CreatedWoBanner = {
  workOrderId: number;
  workOrderDocNo: string | null;
  fgItemName: string;
  qtyLabel: string;
  pmrId: number | null;
  pmrDocNo: string | null;
};

function fmtQty(n: number, unit?: string | null): string {
  return formatExecutionQty(n, unit);
}

function statusLabel(status: string): string {
  return String(status || "UNKNOWN").replace(/_/g, " ");
}

function statusBadgeClass(status: string): string {
  if (status === "COMPLETE" || status === "READY" || status === "FULLY_ISSUED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "PARTIAL" || status === "PARTIALLY_READY" || status === "PARTIALLY_ISSUED") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "IN_PROGRESS" || status === "AWAITING_PROCUREMENT" || status === "REQUESTED") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (status === "BLOCKED" || status === "MISSING_BOM") return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function HeroKpiTile({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div
      className={cn("rounded-md border border-slate-300 bg-white px-3 py-2.5 shadow-sm", className)}
      data-testid={`execution-kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

function ContextKpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-800">{value}</div>
    </div>
  );
}

function TinyStatus({ status, label }: { status: string; label?: string }) {
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold", statusBadgeClass(status))}>
      {label ?? statusLabel(status)}
    </span>
  );
}

function CollapsibleWorkspaceSection({
  title,
  summary,
  testId,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  testId: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="mt-4 rounded-md border border-slate-200 bg-white" data-testid={testId} data-collapsed={open ? "false" : "true"}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-800">{title}</div>
          {!open ? <div className="mt-0.5 truncate text-[11px] text-slate-500">{summary}</div> : null}
        </div>
        <span className="shrink-0 text-sm text-slate-400" aria-hidden>
          {open ? "−" : "+"}
        </span>
      </button>
      {open ? <div className="border-t border-slate-100 px-3 py-2">{children}</div> : null}
    </div>
  );
}

function RmDetailTable({ rm }: { rm: RmReadinessBlock }) {
  if (rm.missingBoms.length > 0) {
    return (
      <div className="space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
        {rm.missingBoms.map((m, index) => {
          const itemName = m.fgItemName || m.sfgName || (m.fgItemId ? `FG-${m.fgItemId}` : `SFG-${m.sfgItemId}`);
          return (
            <div key={`${m.type ?? "MISSING_BOM"}-${m.fgItemId ?? m.sfgItemId ?? index}`}>
              <span className="font-semibold">{statusLabel(m.status ?? "MISSING_BOM")}:</span>{" "}
              {itemName ? `${itemName} - ` : ""}
              {m.message ?? "Missing BOM. RM readiness cannot be previewed."}
            </div>
          );
        })}
      </div>
    );
  }
  if (rm.lines.length === 0) {
    return <p className="text-xs text-slate-600">No RM requirement for the proposed Work Order quantity.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] border-collapse text-xs" data-testid="execution-live-rm-table">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <th className="py-1.5 pr-2">RM Item</th>
            <th className="py-1.5 pr-2 text-right">Required</th>
            <th className="py-1.5 pr-2 text-right">Available</th>
            <th className="py-1.5 pr-2 text-right">Shortage</th>
            <th className="py-1.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {rm.lines.map((line) => (
            <tr key={line.rmItemId} className="border-b border-slate-100 text-slate-800">
              <td className="py-1.5 pr-2 font-medium">{line.rmItemName}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(line.requiredQty)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(line.availableQty)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(line.shortageQty)}</td>
              <td className="py-1.5">
                <TinyStatus status={line.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RequirementSheetExecutionPanel({
  sheetId,
  salesOrderId,
  className,
  canPlaceWoBatch = false,
  priorCycleExecution = null,
  executionMode = false,
}: {
  sheetId: number;
  salesOrderId: number;
  className?: string;
  canPlaceWoBatch?: boolean;
  priorCycleExecution?: { viewingCycleNo: number | null; isPriorCycle: true } | null;
  executionMode?: boolean;
}) {
  const location = useLocation();
  const executionNavContext = useStoreExecutionNavContext("execution-workspace");
  const workspaceHref = `${location.pathname}${location.search}`;
  const materialIssueFromWorkspaceState = React.useMemo(
    () =>
      navStateWithNavContext(
        navContextMaterialIssueFromExecutionWorkspace(workspaceHref, executionNavContext.origin),
      ),
    [workspaceHref, executionNavContext.origin],
  );
  const [data, setData] = React.useState<RsExecutionSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const [draftQtyByItem, setDraftQtyByItem] = React.useState<Record<number, string>>({});
  const [submitBusy, setSubmitBusy] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [woHistoryExpanded, setWoHistoryExpanded] = React.useState(false);
  const [liveRm, setLiveRm] = React.useState<RmReadinessBlock | null>(null);
  const [liveRmBusy, setLiveRmBusy] = React.useState(false);
  const [createdBanner, setCreatedBanner] = React.useState<CreatedWoBanner | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSubmitError(null);
    setCreatedBanner(null);
    void (async () => {
      try {
        const res = await apiFetch<RsExecutionSummary>(`/api/requirement-sheets/${sheetId}/execution`);
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) {
          setData(null);
          setError(e instanceof ApiRequestError ? e.message : "Failed to load execution summary.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sheetId]);

  React.useEffect(() => {
    if (!data?.placement?.lines) return;
    const next: Record<number, string> = {};
    for (const line of data.placement.lines) {
      next[line.itemId] = fmtQty(Math.max(0, line.suggestedExecutableQty));
    }
    setDraftQtyByItem(next);
    setLiveRm(data.rmReadiness);
  }, [data?.placement?.lines, data?.rmReadiness]);

  const validationByItem = React.useMemo(() => {
    const map = new Map<number, string>();
    for (const line of data?.placement?.lines ?? []) {
      const raw = draftQtyByItem[line.itemId];
      const qty = Number(raw ?? 0);
      if (!(qty > 0)) continue;
      if (line.rsBalanceQty <= 0) {
        map.set(line.itemId, "No remaining requirement.");
        continue;
      }
      if (qty > line.rsBalanceQty + 1e-6) {
        map.set(line.itemId, "Exceeds remaining requirement.");
        continue;
      }
      if (line.status === "MISSING_BOM") {
        map.set(line.itemId, "Approved BOM is missing.");
        continue;
      }
      if (line.status === "AWAITING_PROCUREMENT") {
        map.set(line.itemId, "Awaiting procurement.");
        continue;
      }
      if (qty > line.suggestedExecutableQty + 1e-6) {
        map.set(line.itemId, "Exceeds RM-limited capacity.");
      }
    }
    return map;
  }, [data?.placement?.lines, draftQtyByItem]);

  const requestedLines = React.useMemo(
    () =>
      (data?.placement?.lines ?? [])
        .map((line) => ({
          itemId: line.itemId,
          qty: Number(draftQtyByItem[line.itemId] ?? 0),
        }))
        .filter((line) => line.qty > 0),
    [data?.placement?.lines, draftQtyByItem],
  );

  const suggestedLines = React.useMemo(
    () =>
      (data?.placement?.lines ?? [])
        .filter((line) => line.suggestedExecutableQty > 0)
        .map((line) => ({ itemId: line.itemId, qty: line.suggestedExecutableQty })),
    [data?.placement?.lines],
  );

  const placementAllowsSubmit = Boolean(
    data?.placement?.canPlace ||
      data?.placement?.status === "PARTIALLY_READY" ||
      data?.placement?.status === "READY",
  );

  const canSubmitSuggested =
    canPlaceWoBatch && !submitBusy && suggestedLines.length > 0 && placementAllowsSubmit;

  const canSubmitCustom =
    canPlaceWoBatch &&
    !submitBusy &&
    requestedLines.length > 0 &&
    validationByItem.size === 0 &&
    placementAllowsSubmit;

  const useSuggestedAsPrimary = React.useMemo(
    () => placementQuantitiesMatchSuggested(data?.placement?.lines ?? [], draftQtyByItem),
    [data?.placement?.lines, draftQtyByItem],
  );

  React.useEffect(() => {
    if (!data) return;
    const lines = requestedLines.length
      ? requestedLines
      : suggestedLines.map((line) => ({ itemId: line.itemId, qty: line.qty }));
    if (!lines.length) {
      setLiveRm(data.rmReadiness);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLiveRmBusy(true);
      void (async () => {
        try {
          const res = await apiFetch<{ rmReadiness: RmReadinessBlock }>(
            `/api/requirement-sheets/${sheetId}/execution/rm-preview`,
            { method: "POST", body: JSON.stringify({ lines }) },
          );
          if (!cancelled) setLiveRm(res.rmReadiness);
        } catch {
          if (!cancelled) setLiveRm(data.rmReadiness);
        } finally {
          if (!cancelled) setLiveRmBusy(false);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sheetId, data, requestedLines, suggestedLines]);

  function resetDrafts() {
    const next: Record<number, string> = {};
    for (const line of data?.placement?.lines ?? []) {
      next[line.itemId] = fmtQty(Math.max(0, line.suggestedExecutableQty));
    }
    setDraftQtyByItem(next);
    setSubmitError(null);
  }

  async function reloadExecutionSummary() {
    const next = await apiFetch<RsExecutionSummary>(`/api/requirement-sheets/${sheetId}/execution`);
    setData(next);
    const nextDrafts: Record<number, string> = {};
    for (const line of next.placement?.lines ?? []) {
      nextDrafts[line.itemId] = fmtQty(Math.max(0, line.suggestedExecutableQty));
    }
    setDraftQtyByItem(nextDrafts);
    setLiveRm(next.rmReadiness);
    return next;
  }

  async function submitPlacement(mode: "suggested" | "custom") {
    if (!data) return;
    const lines = mode === "suggested" ? suggestedLines : requestedLines;
    if (mode === "suggested" && !canSubmitSuggested) return;
    if (mode === "custom" && !canSubmitCustom) return;
    if (!lines.length) return;

    const placementSnapshot = data.placementSnapshot ?? data.placement?.snapshot ?? null;

    setSubmitBusy(true);
    setSubmitError(null);
    try {
      const res = await apiFetch<{
        workOrderId: number;
        workOrderDocNo?: string | null;
        workOrderIds?: number[];
        workOrders?: Array<{ workOrderId: number; workOrderDocNo?: string | null }>;
        placedLines?: Array<{ itemId: number; qty: number; itemName?: string; unit?: string | null }>;
        nextStepLabel?: string;
        pmrs?: Array<{
          workOrderId: number;
          pmrId: number | null;
          pmrDocNo?: string | null;
          status?: string | null;
        }>;
      }>(`/api/requirement-sheets/${sheetId}/create-wo`, {
        method: "POST",
        body: JSON.stringify({ lines, placementSnapshot }),
      });
      const primaryWoId = Number(res.workOrders?.[0]?.workOrderId ?? res.workOrderId);
      const primaryDocNo = res.workOrders?.[0]?.workOrderDocNo ?? res.workOrderDocNo ?? null;
      const pmrRow =
        res.pmrs?.find((p) => Number(p.workOrderId) === primaryWoId) ?? res.pmrs?.[0] ?? null;
      const createdLabels =
        res.workOrders?.length
          ? res.workOrders.map((wo) => displayWorkOrderNo(wo.workOrderId, wo.workOrderDocNo))
          : [displayWorkOrderNo(res.workOrderId, res.workOrderDocNo)];
      const woLabel =
        createdLabels.length > 1 ? `Work orders ${createdLabels.join(", ")}` : `Work Order ${createdLabels[0]}`;
      toast.showSuccess(formatPostWoCreateSuccessMessage(woLabel, pmrRow?.pmrDocNo ?? null));

      const placed = res.placedLines?.[0];
      const fallbackLine = data.placement.lines.find((l) => l.itemId === lines[0]?.itemId);
      const qty = placed?.qty ?? lines[0]?.qty ?? 0;
      const unit = placed?.unit ?? fallbackLine?.unit ?? null;
      setCreatedBanner({
        workOrderId: primaryWoId,
        workOrderDocNo: primaryDocNo,
        fgItemName: placed?.itemName ?? fallbackLine?.itemName ?? "Finished Good",
        qtyLabel: fmtQty(qty, unit),
        pmrId: pmrRow?.pmrId ?? null,
        pmrDocNo: pmrRow?.pmrDocNo ?? null,
      });

      await reloadExecutionSummary();
    } catch (e) {
      const apiErr = e instanceof ApiRequestError ? e : null;
      const staleCodes = new Set(["NO_QTY_RS_CHANGED", "NO_QTY_RM_AVAILABILITY_CHANGED"]);
      if (apiErr?.code && staleCodes.has(apiErr.code)) {
        try {
          await reloadExecutionSummary();
          const msg =
            apiErr.message ||
            "Work Order Planning refreshed because placement inputs changed. Review the updated suggested quantity.";
          setSubmitError(msg);
          toast.showInfo(msg);
          return;
        } catch (refreshErr) {
          const refreshMsg =
            refreshErr instanceof ApiRequestError
              ? refreshErr.message
              : refreshErr instanceof Error
                ? refreshErr.message
                : "Failed to refresh Work Order Planning.";
          setSubmitError(refreshMsg);
          toast.showError(refreshMsg);
          return;
        }
      }
      const msg = apiErr ? apiErr.message : e instanceof Error ? e.message : "WO placement failed.";
      setSubmitError(msg);
      toast.showError(msg);
    } finally {
      setSubmitBusy(false);
    }
  }

  if (loading) {
    return (
      <div className={cn("rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600", className)}>
        Loading work order planning…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={cn("rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800", className)}>
        {error ?? "Execution summary unavailable."}
      </div>
    );
  }

  const priorCycleBanner =
    priorCycleExecution?.isPriorCycle === true
      ? formatPriorCycleExecutionBanner({
          viewingCycleNo: priorCycleExecution.viewingCycleNo,
          rsBalanceQty: data.totals.rsBalanceQty,
        })
      : null;

  const rmCoverageLabel = rmCoverageLabelFromPlacement({
    placementStatus: data.placement.status,
    rsBalanceQty: data.totals.rsBalanceQty,
    readyFgCount: data.fgReadinessSummary?.readyCount,
    shortageFgCount: data.fgReadinessSummary?.shortageCount,
    totalFgWithBalance: data.fgReadinessSummary?.totalWithBalance,
  });

  const placementMessage = placementInlineReadinessMessage({
    placementStatus: data.placement.status,
    totalExecutableQty: data.placement.summary.totalExecutableQty,
    rsBalanceQty: data.totals.rsBalanceQty,
    placementReason: data.placement.reason,
    readyFgCount: data.fgReadinessSummary?.readyCount,
    shortageFgCount: data.fgReadinessSummary?.shortageCount,
    allowWoWithoutPlanRelease: data.release.allowWoWithoutPlanRelease,
  });

  const kpis = data.kpis ?? {
    customerDemandQty: 0,
    productionShortageQty: 0,
    qcFinalRejectionQty: 0,
    totalRecoveryQty: 0,
    totalRsRequirement: data.totals.rsDemandQty,
    woQuantityPlaced: data.totals.woPlacedQty,
    remainingRequirement: data.totals.rsBalanceQty,
    remainingToPlace: data.totals.rsBalanceQty,
    rmLimitedCapacity: data.totals.rmLimitedCapacityQty ?? data.placement.summary.totalExecutableQty,
    suggestedNextWoQty: data.placement.summary.totalExecutableQty,
    numberOfWos: data.existingWoSummary.length,
  };
  const remainingToPlace = kpis.remainingToPlace ?? kpis.remainingRequirement;
  const customerDemandQty = Number(kpis.customerDemandQty ?? 0);
  const productionShortageQty = Number(kpis.productionShortageQty ?? 0);
  const qcFinalRejectionQty = Number(kpis.qcFinalRejectionQty ?? 0);
  const totalRecoveryQty = Number(
    kpis.totalRecoveryQty ?? productionShortageQty + qcFinalRejectionQty,
  );

  const displayRm = liveRm ?? data.rmReadiness;
  const proposedFgQty = displayRm.summary.proposedFgQty ?? requestedLines.reduce((s, l) => s + l.qty, 0);
  const woRows = data.existingWoSummary;
  const visibleWoCount = executionWoHistoryVisibleCount(woRows.length, woHistoryExpanded);
  const visibleWoRows = woRows.slice(0, visibleWoCount);
  const canCreateMore = data.totals.rsBalanceQty > 0 && data.placement.summary.totalExecutableQty > 0;

  return (
    <div
      id="rs-execution-workspace"
      className={cn("rounded-md border border-slate-200 bg-slate-50/80 px-3 py-3", className)}
      data-testid="rs-execution-workspace"
    >
      {priorCycleBanner ? (
        <div
          className="mb-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2"
          data-testid="rs-prior-cycle-execution-banner"
        >
          <div className="text-sm font-semibold text-violet-950">{priorCycleBanner.title}</div>
          <div className="mt-0.5 text-xs text-violet-900">{priorCycleBanner.detail}</div>
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {!executionMode ? (
            <div className="text-sm font-semibold text-slate-900">{WO_PLANNING_UX.PAGE_TITLE}</div>
          ) : null}
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
            data-testid="execution-workflow-stage-banner"
            role="status"
            aria-label="Workflow stage"
          >
            <span className="font-semibold text-emerald-800">✓ {WO_PLANNING_UX.STAGE_DONE}</span>
            <span className="text-slate-300" aria-hidden>
              →
            </span>
            <span className="rounded border border-primary/30 bg-primary/5 px-2 py-0.5 font-bold text-primary">
              {WO_PLANNING_UX.STAGE_CURRENT}
            </span>
            <span className="text-slate-300" aria-hidden>
              →
            </span>
            <span className="font-semibold text-slate-600">{WO_PLANNING_UX.STAGE_NEXT}</span>
          </div>
        </div>
        <Badge
          variant={
            data.release.released
              ? "success"
              : data.release.allowWoWithoutPlanRelease
                ? "warning"
                : "default"
          }
        >
          {data.release.released
            ? "Released to Procurement"
            : data.release.allowWoWithoutPlanRelease
              ? "WO Available (RM-ready FG)"
              : "Not Released"}
        </Badge>
      </div>

      {createdBanner ? (
        <div
          className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5"
          data-testid="execution-wo-created-banner"
          role="status"
        >
          <div className="text-sm font-bold text-emerald-950">Work Order Created</div>
          <div className="mt-1 grid gap-1 text-sm text-emerald-900 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">WO Number</span>
              <div className="font-semibold">{displayWorkOrderNo(createdBanner.workOrderId, createdBanner.workOrderDocNo)}</div>
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">FG Item</span>
              <div className="font-semibold">{createdBanner.fgItemName}</div>
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Planned Qty</span>
              <div className="font-semibold tabular-nums">{createdBanner.qtyLabel}</div>
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Next</span>
              <div className="font-semibold">{WO_PLANNING_UX.STAGE_NEXT}</div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link
              to={`${workOrdersFocusHref(createdBanner.workOrderId)}&source=no_qty_so&salesOrderId=${salesOrderId}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline")}
            >
              {WO_PLANNING_UX.OPEN_WO}
            </Link>
            {createdBanner.pmrId ? (
              <Link
                to={buildMaterialIssueDeepLink({
                  workOrderId: createdBanner.workOrderId,
                  pmrId: createdBanner.pmrId,
                  returnTo: "requirement-sheet-execution",
                  requirementSheetId: sheetId,
                  salesOrderId,
                })}
                state={materialIssueFromWorkspaceState}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline")}
              >
                {WO_PLANNING_UX.MATERIAL_ISSUE}
              </Link>
            ) : null}
            {canCreateMore ? (
              <Button
                type="button"
                size="sm"
                data-testid="execution-create-another-wo"
                onClick={() => {
                  setCreatedBanner(null);
                  resetDrafts();
                }}
              >
                {WO_PLANNING_UX.CREATE_ANOTHER}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Desktop-first workstation grid: left = RS context, right = full WO transaction (RM integrated) */}
      <div className="mt-2 grid gap-3 lg:grid-cols-12" data-testid="execution-two-column-work-area">
        {/* LEFT: RS context column — horizontal, balanced tiles (single primary display per value) */}
        <aside
          className="rounded-md border border-slate-200 bg-white px-3 py-3 lg:col-span-5"
          data-testid="execution-info-panel"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-bold text-slate-900">{WO_PLANNING_UX.INFO_PANEL_TITLE}</div>
            {data.cycleId != null ? (
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                Cycle {data.cycleId}
              </span>
            ) : null}
          </div>
          <div data-testid="execution-hero-kpis" className="mt-2 grid grid-cols-2 gap-2">
            <HeroKpiTile label={WO_PLANNING_UX.KPI_REMAINING_TO_PLACE} value={fmtQty(remainingToPlace)} />
            <HeroKpiTile label={WO_PLANNING_UX.KPI_WO_QTY_PLACED} value={fmtQty(kpis.woQuantityPlaced)} />
          </div>
          <div data-testid="execution-composition-kpis" className="mt-2 grid grid-cols-2 gap-2">
            <ContextKpiTile label={WO_PLANNING_UX.KPI_CUSTOMER_DEMAND} value={fmtQty(customerDemandQty)} />
            <ContextKpiTile label={WO_PLANNING_UX.KPI_PRODUCTION_SHORTAGE} value={fmtQty(productionShortageQty)} />
            <ContextKpiTile label={WO_PLANNING_UX.KPI_QC_FINAL_REJECTION} value={fmtQty(qcFinalRejectionQty)} />
            <ContextKpiTile label={WO_PLANNING_UX.KPI_TOTAL_RECOVERY} value={fmtQty(totalRecoveryQty)} />
            <ContextKpiTile label={WO_PLANNING_UX.KPI_TOTAL_RS_REQUIREMENT} value={fmtQty(kpis.totalRsRequirement)} />
            <ContextKpiTile label={WO_PLANNING_UX.KPI_NUMBER_OF_WOS} value={String(kpis.numberOfWos)} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-600" data-testid="execution-placement-readiness">
            {placementMessage}
          </p>
          {data.placement.lines.map((line) =>
            line.operatorGuidance?.message ? (
              <p
                key={line.itemId}
                className="mt-2 text-xs leading-relaxed text-slate-700"
                data-testid={`execution-operator-guidance-${line.itemId}`}
              >
                <span className="font-semibold text-slate-800">{line.itemName}: </span>
                {line.operatorGuidance.message}
              </p>
            ) : null,
          )}
        </aside>

        {/* RIGHT: full WO transaction with RM feasibility integrated — visible above the fold */}
        <section
          className="rounded-md border border-primary/25 bg-white px-3 py-3 shadow-sm lg:col-span-7"
          data-testid="execution-place-wo-block"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-slate-900">{WO_PLANNING_UX.WORK_AREA_TITLE}</div>
              <p className="mt-0.5 text-xs text-slate-600" data-testid="execution-place-wo-intro">
                {WO_PLANNING_UX.WORK_AREA_INTRO}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                {WO_PLANNING_UX.KPI_RM_LIMITED_CAPACITY}: <span className="tabular-nums">{fmtQty(kpis.rmLimitedCapacity)}</span>
              </span>
              <span
                className={cn("rounded-md border px-2.5 py-1 text-xs font-semibold", rmCoverageChipClassName(rmCoverageLabel))}
                data-testid="execution-kpi-rm-coverage"
              >
                {WO_PLANNING_UX.KPI_RM_COVERAGE}: {rmCoverageLabel}
              </span>
              {liveRmBusy ? <span className="text-[11px] text-slate-500">Updating RM…</span> : null}
            </div>
          </div>

          {!canPlaceWoBatch ? (
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Read-only role. WO placement is available to Store and Admin only.
            </div>
          ) : null}

          {data.placement.lines.length === 0 ? (
            <div className="mt-3 text-xs text-slate-600">No remaining requirement for Work Order creation.</div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[32rem] border-collapse" data-testid="execution-placement-grid">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">FG Item</th>
                    <th className="py-2 pr-3 text-right">Remaining</th>
                    <th className="py-2 pr-3 text-right">{WO_PLANNING_UX.KPI_SUGGESTED_NEXT_WO}</th>
                    <th className="py-2 pr-3 text-right">Enter Qty</th>
                    <th className="py-2 pr-3">RM Status</th>
                    <th className="py-2">Shortage Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {data.placement.lines.map((line) => {
                    const draft = draftQtyByItem[line.itemId] ?? "";
                    const lineError = validationByItem.get(line.itemId) ?? null;
                    const readinessRow = data.fgItemReadiness?.find((r) => r.itemId === line.itemId);
                    const rmStatusLabel = fgItemRmStatusLabel(readinessRow?.outcome ?? line.status);
                    const shortageText =
                      readinessRow?.shortageSummary ||
                      line.operatorGuidance?.message ||
                      (line.status === "AWAITING_PROCUREMENT"
                        ? line.reason || "RM shortage — Create WO disabled"
                        : line.status === "READY"
                          ? "Create WO enabled"
                          : line.reason || "—");
                    const disabledInput =
                      !canPlaceWoBatch || line.rsBalanceQty <= 0 || line.suggestedExecutableQty <= 0;
                    return (
                      <tr
                        key={line.itemId}
                        className="border-b border-slate-100 align-top text-slate-800"
                        data-testid={`execution-fg-line-${line.itemId}`}
                      >
                        <td className="py-2.5 pr-3">
                          <div className="text-sm font-semibold text-slate-900">{line.itemName}</div>
                        </td>
                        <td className="py-2.5 pr-3 text-right text-sm tabular-nums text-slate-700">
                          {fmtQty(line.rsBalanceQty, line.unit)}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-base font-semibold tabular-nums">
                          {fmtQty(line.suggestedExecutableQty, line.unit)}
                        </td>
                        <td className="py-2.5 pr-3 text-right">
                          <Input
                            className={cn(
                              "ml-auto h-10 w-36 text-right tabular-nums",
                              lineError && "border-red-300 bg-red-50",
                            )}
                            value={draft}
                            disabled={disabledInput}
                            onChange={(e) => {
                              setDraftQtyByItem((prev) => ({ ...prev, [line.itemId]: e.target.value }));
                              setSubmitError(null);
                            }}
                          />
                          {lineError ? <div className="mt-1 text-[11px] text-red-700">{lineError}</div> : null}
                        </td>
                        <td className="py-2.5 pr-3">
                          <TinyStatus status={line.status} label={rmStatusLabel} />
                        </td>
                        <td className="py-2.5 text-xs text-slate-600">{shortageText}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Live RM Requirement — compact, integrated directly below quantity entry */}
          <div
            className="mt-3 rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2.5"
            data-testid="execution-rm-capacity-panel"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-600">
                {WO_PLANNING_UX.CAPACITY_AREA_TITLE}
                <span className="ml-2 font-medium normal-case text-slate-500">
                  for entered <span className="tabular-nums text-slate-700">{fmtQty(proposedFgQty)}</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
                <span>
                  Required <span className="font-semibold tabular-nums text-slate-900">{fmtQty(displayRm.summary.requiredQty)}</span>
                </span>
                <span>
                  Available <span className="font-semibold tabular-nums text-slate-900">{fmtQty(displayRm.summary.availableQty)}</span>
                </span>
                <span>
                  Shortage <span className="font-semibold tabular-nums text-slate-900">{fmtQty(displayRm.summary.shortageQty)}</span>
                </span>
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-600" data-testid="execution-rm-preview-message">
              {data.rmPreview.message}
            </p>
            <div className="mt-2" data-testid="execution-rm-detail">
              <RmDetailTable rm={displayRm} />
            </div>
            {data.placement.lines.some((l) => l.limitingRmItemName) ? (
              <p className="mt-2 text-xs text-slate-700">
                Limiting RM:{" "}
                {data.placement.lines
                  .filter((l) => l.limitingRmItemName)
                  .map((l) => l.limitingRmItemName)
                  .join(", ")}
              </p>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={!canPlaceWoBatch || submitBusy} onClick={resetDrafts}>
              Reset
            </Button>
            <Button
              type="button"
              variant={useSuggestedAsPrimary ? "default" : "outline"}
              disabled={!canSubmitSuggested}
              data-testid="execution-create-suggested-wo"
              onClick={() => void submitPlacement("suggested")}
            >
              {submitBusy ? "Placing..." : WO_PLANNING_UX.CREATE_SUGGESTED}
            </Button>
            <Button
              type="button"
              variant={useSuggestedAsPrimary ? "outline" : "default"}
              disabled={!canSubmitCustom}
              data-testid="execution-create-custom-wo"
              onClick={() => void submitPlacement("custom")}
            >
              {submitBusy ? "Placing..." : WO_PLANNING_UX.CREATE_CUSTOM}
            </Button>
          </div>

          {submitError ? <div className="mt-2 text-xs text-red-700">{submitError}</div> : null}
        </section>
      </div>

      <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-3" data-testid="execution-wo-history">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-900">{WO_PLANNING_UX.CURRENT_WOS_TITLE}</div>
          {woRows.length > EXECUTION_WO_HISTORY_MAX_ROWS ? (
            <button
              type="button"
              className="text-xs font-medium text-primary underline underline-offset-2"
              data-testid="execution-wo-history-view-all"
              onClick={() => setWoHistoryExpanded((value) => !value)}
            >
              {woHistoryExpanded ? "Show less" : `View all (${woRows.length})`}
            </button>
          ) : null}
        </div>
        {woRows.length === 0 ? (
          <p className="mt-1 text-xs text-slate-600">No Work Orders placed yet for this Requirement Sheet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-xs" data-testid="execution-wo-history-table">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pr-2">WO Number</th>
                  <th className="py-1.5 pr-2">FG Item</th>
                  <th className="py-1.5 pr-2 text-right">Planned Qty</th>
                  <th className="py-1.5 pr-2">Status</th>
                  <th className="py-1.5 pr-2">RM Status</th>
                  <th className="py-1.5 pr-2">Production Status</th>
                  <th className="py-1.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleWoRows.map((wo) => (
                  <tr key={wo.workOrderId} className="border-b border-slate-100 text-slate-800">
                    <td className="py-1.5 pr-2 font-medium">{displayWorkOrderNo(wo.workOrderId, wo.docNo)}</td>
                    <td className="py-1.5 pr-2">{wo.fgItemName ?? "—"}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(wo.woQty, wo.unit)}</td>
                    <td className="py-1.5 pr-2">{statusLabel(wo.woStatus)}</td>
                    <td className="py-1.5 pr-2">
                      <TinyStatus status={wo.rmIssueStatus} />
                    </td>
                    <td className="py-1.5 pr-2">{statusLabel(wo.productionStatus)}</td>
                    <td className="py-1.5 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Link
                          to={`${workOrdersFocusHref(wo.workOrderId)}&source=no_qty_so&salesOrderId=${salesOrderId}`}
                          className="font-medium text-primary underline underline-offset-2"
                        >
                          {WO_PLANNING_UX.OPEN_WO}
                        </Link>
                        {wo.pmrId ? (
                          <Link
                            to={buildMaterialIssueDeepLink({
                              pmrId: wo.pmrId,
                              workOrderId: wo.workOrderId,
                              returnTo: "requirement-sheet-execution",
                              requirementSheetId: sheetId,
                              salesOrderId,
                            })}
                            state={executionMode ? materialIssueFromWorkspaceState : undefined}
                            className="font-medium text-primary underline underline-offset-2"
                          >
                            {WO_PLANNING_UX.MATERIAL_ISSUE}
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CollapsibleWorkspaceSection
        title="Procurement Progress"
        testId="execution-procurement-progress"
        defaultOpen={false}
        summary={procurementCollapsedSummary({
          steps: data.procurementProgress.steps,
          summaryLabel: data.procurement.summaryLabel,
        })}
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {data.procurementProgress.steps.map((step) => (
            <div key={step.key} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
              <div className="truncate text-[11px] font-medium text-slate-700">{step.label}</div>
              <div className="mt-1">
                <TinyStatus status={step.status} />
              </div>
            </div>
          ))}
        </div>
      </CollapsibleWorkspaceSection>

      <CollapsibleWorkspaceSection
        title="Coverage Calculations"
        testId="execution-coverage-calculations"
        defaultOpen={false}
        summary={`${data.placement.lines.length} FG line${data.placement.lines.length === 1 ? "" : "s"} · placement preview`}
      >
        <div className="space-y-3">
          {data.placement.lines.map((line) => (
            <div key={line.itemId} className="rounded-md border border-slate-100 bg-slate-50 px-2 py-2 text-xs">
              <div className="font-semibold text-slate-800">{line.itemName}</div>
              <div className="mt-1 text-slate-600">{line.reason}</div>
              {line.rmLines.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600">
                  {line.rmLines.map((rm) => (
                    <li key={rm.rmItemId}>
                      {rm.rmItemName}: req {fmtQty(rm.requiredQty)}, avail {fmtQty(rm.availableQty)}, short{" "}
                      {fmtQty(rm.shortageQty)} ({statusLabel(rm.status)})
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      </CollapsibleWorkspaceSection>

      <CollapsibleWorkspaceSection
        title="Audit / History"
        testId="execution-audit-history"
        defaultOpen={false}
        summary={`${data.existingWoSummary.length} WO${data.existingWoSummary.length === 1 ? "" : "s"} · readiness ${statusLabel(data.readiness.status)} · ${rmDetailCollapsedSummary({
          lineCount: displayRm.lines.length,
          readyLineCount: displayRm.summary.readyLineCount,
          partialLineCount: displayRm.summary.partialLineCount,
          shortageQty: displayRm.summary.shortageQty,
          missingBomCount: displayRm.summary.missingBomCount,
        })}`}
      >
        <div className="space-y-3 text-xs text-slate-700">
          <div>
            <div className="font-semibold text-slate-800">Execution readiness</div>
            <div className="mt-0.5">{data.readiness.label}</div>
            <div className="mt-0.5 text-slate-600">{data.readiness.reason}</div>
          </div>
          <p className="leading-relaxed text-slate-600">
            {WO_PLANNING_UX.KPI_REMAINING_TO_PLACE} is Total RS Requirement minus WO Qty Placed. Production,
            QC, Dispatch, Material Issue, and Carry Forward do not reduce placement balance. Suggested Next WO Qty is the
            minimum of remaining requirement and RM-limited capacity.
          </p>
          {createdBanner?.pmrDocNo && createdBanner.pmrId != null ? (
            <p className="text-slate-600">Latest PMR: {displayPmrNo(createdBanner.pmrId, createdBanner.pmrDocNo)}</p>
          ) : null}
        </div>
      </CollapsibleWorkspaceSection>
    </div>
  );
}
