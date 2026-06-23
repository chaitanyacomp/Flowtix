import * as React from "react";
import { Link } from "react-router-dom";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Badge } from "../../ui/badge";
import { apiFetch, ApiRequestError } from "../../../services/api";
import { workOrdersFocusHref } from "../../../lib/drillDownRoutes";
import { cn } from "../../../lib/utils";
import { useToast } from "../../../contexts/ToastContext";
import { formatPriorCycleExecutionBanner } from "../../../lib/requirementSheetExecutionWorkspaceUx";

type ProgressStatus = "NOT_STARTED" | "IN_PROGRESS" | "PARTIAL" | "COMPLETE" | "BLOCKED";
type ReadinessDecision =
  | "READY_TO_PLACE_WO"
  | "PARTIALLY_READY"
  | "AWAITING_PROCUREMENT"
  | "EXISTING_WO_PENDING_RM_ISSUE"
  | "EXISTING_WO_RUNNING"
  | "BLOCKED";

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
  };
  totals: {
    rsDemandQty: number;
    woPlacedQty: number;
    rsBalanceQty: number;
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
  rmReadiness: {
    basis: "RS_BALANCE";
    fgBalanceLines: Array<{
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
    };
  };
  existingWoSummary: Array<{
    workOrderId: number;
    docNo: string | null;
    woQty: number;
    woStatus: string;
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
    message: string;
  };
  placement: {
    status: "READY" | "PARTIALLY_READY" | "AWAITING_PROCUREMENT" | "MISSING_BOM" | "ZERO_BALANCE";
    reason: string;
    canPlace: boolean;
    summary: {
      totalRsDemandQty: number;
      totalWoPlacedQty: number;
      totalRsBalanceQty: number;
      totalExecutableQty: number;
    };
    lines: Array<{
      itemId: number;
      itemName: string;
      rsDemandQty: number;
      woPlacedQty: number;
      rsBalanceQty: number;
      suggestedExecutableQty: number;
      status: "READY" | "PARTIALLY_READY" | "AWAITING_PROCUREMENT" | "MISSING_BOM" | "ZERO_BALANCE";
      reason: string;
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
};

function fmtQty(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 1000) / 1000;
  return Math.abs(r - Math.round(r)) < 1e-9
    ? String(Math.round(r))
    : r.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function statusLabel(status: string): string {
  return String(status || "UNKNOWN").replace(/_/g, " ");
}

function decisionTone(status: ReadinessDecision): string {
  if (status === "READY_TO_PLACE_WO") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "PARTIALLY_READY") return "border-amber-200 bg-amber-50 text-amber-900";
  if (status === "AWAITING_PROCUREMENT") return "border-sky-200 bg-sky-50 text-sky-900";
  if (status === "EXISTING_WO_RUNNING") return "border-indigo-200 bg-indigo-50 text-indigo-900";
  return "border-red-200 bg-red-50 text-red-900";
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

function KpiTile({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("rounded-md border border-slate-200 bg-white px-3 py-2", className)}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

function TinyStatus({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold", statusBadgeClass(status))}>
      {statusLabel(status)}
    </span>
  );
}

export function RequirementSheetExecutionPanel({
  sheetId,
  salesOrderId,
  className,
  canPlaceWoBatch = false,
  priorCycleExecution = null,
}: {
  sheetId: number;
  salesOrderId: number;
  className?: string;
  canPlaceWoBatch?: boolean;
  priorCycleExecution?: { viewingCycleNo: number | null; isPriorCycle: true } | null;
}) {
  const [data, setData] = React.useState<RsExecutionSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const [draftQtyByItem, setDraftQtyByItem] = React.useState<Record<number, string>>({});
  const [submitBusy, setSubmitBusy] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSubmitError(null);
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
      next[line.itemId] = String(Math.max(0, Math.round(line.suggestedExecutableQty * 1000) / 1000)).replace(/\.000$/, "");
    }
    setDraftQtyByItem(next);
  }, [data?.placement?.lines]);

  const validationByItem = React.useMemo(() => {
    const map = new Map<number, string>();
    for (const line of data?.placement?.lines ?? []) {
      const raw = draftQtyByItem[line.itemId];
      const qty = Number(raw ?? 0);
      if (!(qty > 0)) continue;
      if (line.rsBalanceQty <= 0) {
        map.set(line.itemId, "No RS balance remains.");
        continue;
      }
      if (qty > line.rsBalanceQty + 1e-6) {
        map.set(line.itemId, "Exceeds RS balance.");
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
        map.set(line.itemId, "Exceeds executable quantity.");
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

  const canSubmit = canPlaceWoBatch && !submitBusy && requestedLines.length > 0 && validationByItem.size === 0 && Boolean(data?.placement?.canPlace || data?.placement?.status === "PARTIALLY_READY" || data?.placement?.status === "READY");

  function resetDrafts() {
    const next: Record<number, string> = {};
    for (const line of data?.placement?.lines ?? []) {
      next[line.itemId] = String(Math.max(0, Math.round(line.suggestedExecutableQty * 1000) / 1000)).replace(/\.000$/, "");
    }
    setDraftQtyByItem(next);
    setSubmitError(null);
  }

  async function submitPlacement() {
    if (!data || !canSubmit) return;
    setSubmitBusy(true);
    setSubmitError(null);
    try {
      const res = await apiFetch<{
        workOrderId: number;
        workOrderDocNo?: string | null;
        workOrderIds?: number[];
        workOrders?: Array<{ workOrderId: number; workOrderDocNo?: string | null }>;
      }>(`/api/requirement-sheets/${sheetId}/create-wo`, {
        method: "POST",
        body: JSON.stringify({
          lines: requestedLines,
        }),
      });
      const createdLabels =
        res.workOrders?.length
          ? res.workOrders.map((wo) => wo.workOrderDocNo?.trim() || `WO-${wo.workOrderId}`)
          : [res.workOrderDocNo?.trim() || `WO-${res.workOrderId}`];
      toast.showSuccess(
        createdLabels.length > 1
          ? `Successfully created: ${createdLabels.join(", ")}`
          : `Work Order ${createdLabels[0]} created.`,
      );
      const next = await apiFetch<RsExecutionSummary>(`/api/requirement-sheets/${sheetId}/execution`);
      setData(next);
    } catch (e) {
      const msg = e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "WO placement failed.";
      setSubmitError(msg);
      toast.showError(msg);
    } finally {
      setSubmitBusy(false);
    }
  }

  if (loading) {
    return (
      <div className={cn("rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600", className)}>
        Loading execution workspace...
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

  return (
    <div
      id="rs-execution-workspace"
      className={cn("rounded-md border border-slate-200 bg-slate-50/80 px-3 py-3", className)}
      data-testid="rs-execution-workspace"
    >
      {priorCycleBanner ? (
        <div
          className="mb-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2"
          data-testid="rs-prior-cycle-execution-banner"
        >
          <div className="text-sm font-semibold text-violet-950">{priorCycleBanner.title}</div>
          <div className="mt-0.5 text-xs text-violet-900">{priorCycleBanner.detail}</div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">Execution Workspace</div>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-slate-600">
            Release creates Monthly Plan MR for procurement. Store reviews readiness here before future WO placement.
          </p>
        </div>
        <Badge variant={data.release.released ? "success" : "default"}>
          {data.release.released ? "Released to Procurement" : "Not Released"}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="RS Demand" value={fmtQty(data.totals.rsDemandQty)} />
        <KpiTile label="WO Placed" value={fmtQty(data.totals.woPlacedQty)} />
        <KpiTile label="RS Balance" value={fmtQty(data.totals.rsBalanceQty)} />
        <KpiTile label="Procurement" value={data.procurement.summaryLabel} className="sm:col-span-2 lg:col-span-1" />
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Execution Readiness</div>
        <div className={cn("mt-1 rounded-md border px-3 py-2", decisionTone(data.readiness.status))}>
          <div className="text-sm font-semibold">{data.readiness.label}</div>
          <div className="mt-0.5 text-xs">{data.readiness.reason}</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold text-slate-800">Procurement Progress</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {data.procurementProgress.steps.map((step) => (
            <div key={step.key} className="rounded-md border border-slate-200 bg-white px-2 py-2">
              <div className="truncate text-[11px] font-medium text-slate-700">{step.label}</div>
              <div className="mt-1">
                <TinyStatus status={step.status} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-800">RM Readiness</div>
          <div className="text-[11px] text-slate-500">Basis: RS Balance</div>
        </div>
        {data.rmReadiness.missingBoms.length > 0 ? (
          <div className="mt-1 space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {data.rmReadiness.missingBoms.map((m, index) => {
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
        ) : data.rmReadiness.lines.length === 0 ? (
          <p className="mt-1 text-xs text-slate-600">
            {data.totals.rsBalanceQty <= 0
              ? "No remaining RS balance."
              : "No RM requirement to preview for the current RS Balance."}
          </p>
        ) : (
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pr-2">RM Item</th>
                  <th className="py-1.5 pr-2 text-right">Required</th>
                  <th className="py-1.5 pr-2 text-right">Available</th>
                  <th className="py-1.5 pr-2 text-right">Shortage</th>
                  <th className="py-1.5 pr-2 text-right">Incoming</th>
                  <th className="py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rmReadiness.lines.map((line) => (
                  <tr key={line.rmItemId} className="border-b border-slate-100 text-slate-800">
                    <td className="py-1.5 pr-2 font-medium">{line.rmItemName}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(line.requiredQty)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(line.availableQty)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(line.shortageQty)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(line.incomingQty)}</td>
                    <td className="py-1.5">
                      <TinyStatus status={line.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-slate-800">WO Batch Placement</div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
              Place one WO at a time from the current RS Balance. Store can reduce the quantity per FG line before
              submitting.
            </p>
          </div>
          <Badge
            variant={
              data.placement.status === "READY"
                ? "success"
                : data.placement.status === "PARTIALLY_READY"
                  ? "warning"
                  : "rejected"
            }
          >
            {statusLabel(data.placement.status)}
          </Badge>
        </div>

        <div className="mt-2 text-xs text-slate-600">{data.placement.reason}</div>
        {!canPlaceWoBatch ? (
          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Read-only role. WO placement is available to Store and Admin only.
          </div>
        ) : null}

        {data.placement.lines.length === 0 ? (
          <div className="mt-3 text-xs text-slate-600">No FG balance remains for WO placement.</div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[62rem] border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pr-2">FG Item</th>
                  <th className="py-1.5 pr-2 text-right">RS Demand</th>
                  <th className="py-1.5 pr-2 text-right">WO Placed</th>
                  <th className="py-1.5 pr-2 text-right">Remaining Balance</th>
                  <th className="py-1.5 pr-2 text-right">Suggested Executable Qty</th>
                  <th className="py-1.5 pr-2 text-right">Enter WO Qty</th>
                  <th className="py-1.5">RM Status</th>
                </tr>
              </thead>
              <tbody>
                {data.placement.lines.map((line) => {
                  const draft = draftQtyByItem[line.itemId] ?? "";
                  const lineError = validationByItem.get(line.itemId) ?? null;
                  const disabledInput = !canPlaceWoBatch || line.rsBalanceQty <= 0 || line.suggestedExecutableQty <= 0;
                  return (
                    <tr key={line.itemId} className="border-b border-slate-100 text-slate-800">
                      <td className="py-1.5 pr-2 font-medium">{line.itemName}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(line.rsDemandQty)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(line.woPlacedQty)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">{fmtQty(line.rsBalanceQty)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(line.suggestedExecutableQty)}</td>
                      <td className="py-1.5 pr-2 text-right">
                        <Input
                          className={cn("h-8 w-28 text-right tabular-nums", lineError && "border-red-300 bg-red-50")}
                          value={draft}
                          disabled={disabledInput}
                          onChange={(e) => {
                            const value = e.target.value;
                            setDraftQtyByItem((prev) => ({ ...prev, [line.itemId]: value }));
                            setSubmitError(null);
                          }}
                        />
                        {lineError ? <div className="mt-1 text-[10px] text-red-700">{lineError}</div> : null}
                      </td>
                      <td className="py-1.5">
                        <div className="space-y-1">
                          <TinyStatus status={line.status} />
                          <div className="text-[10px] text-slate-500">{line.reason}</div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-slate-600">
            Suggested total:{" "}
            <span className="font-semibold tabular-nums text-slate-900">{fmtQty(data.placement.summary.totalExecutableQty)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" disabled={!canPlaceWoBatch || submitBusy} onClick={resetDrafts}>
              Cancel
            </Button>
            <Button type="button" disabled={!canSubmit} onClick={() => void submitPlacement()}>
              {submitBusy ? "Placing..." : "Place WO"}
            </Button>
          </div>
        </div>

        {submitError ? <div className="mt-2 text-xs text-red-700">{submitError}</div> : null}
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold text-slate-800">Existing WO Summary</div>
        {data.existingWoSummary.length === 0 ? (
          <p className="mt-1 text-xs text-slate-600">No WO placed yet for this Requirement Sheet.</p>
        ) : (
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pr-2">WO No</th>
                  <th className="py-1.5 pr-2 text-right">WO Qty</th>
                  <th className="py-1.5 pr-2">WO Status</th>
                  <th className="py-1.5 pr-2">PMR Status</th>
                  <th className="py-1.5 pr-2">RM Issue Status</th>
                  <th className="py-1.5 pr-2">Production Status</th>
                  <th className="py-1.5 text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {data.existingWoSummary.map((wo) => (
                  <tr key={wo.workOrderId} className="border-b border-slate-100 text-slate-800">
                    <td className="py-1.5 pr-2 font-medium">{wo.docNo?.trim() || `WO-${wo.workOrderId}`}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(wo.woQty)}</td>
                    <td className="py-1.5 pr-2">{statusLabel(wo.woStatus)}</td>
                    <td className="py-1.5 pr-2">
                      {wo.pmrId ? (
                        <Link
                          to={`/material-issue?pmrId=${wo.pmrId}`}
                          className="font-medium text-primary underline underline-offset-2"
                        >
                          {wo.pmrDocNo?.trim() || `PMR-${wo.pmrId}`} ({statusLabel(wo.pmrStatus ?? "")})
                        </Link>
                      ) : (
                        <span className="text-slate-500">None</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      <TinyStatus status={wo.rmIssueStatus} />
                    </td>
                    <td className="py-1.5 pr-2">{statusLabel(wo.productionStatus)}</td>
                    <td className="py-1.5 text-right">
                      <Link
                        to={`${workOrdersFocusHref(wo.workOrderId)}&source=no_qty_so&salesOrderId=${salesOrderId}`}
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        Open WO
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold text-slate-800">Line Balance</div>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[28rem] border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-1.5 pr-2">FG Item</th>
                <th className="py-1.5 pr-2 text-right">RS Demand</th>
                <th className="py-1.5 pr-2 text-right">WO Placed</th>
                <th className="py-1.5 text-right">RS Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line) => (
                <tr key={line.itemId} className="border-b border-slate-100 text-slate-800">
                  <td className="py-1.5 pr-2 font-medium">{line.itemName}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(line.rsDemandQty)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtQty(line.woPlacedQty)}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">{fmtQty(line.rsBalanceQty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600">
        RS Balance represents demand not yet placed on Work Orders. Production, QA, Dispatch, Carry Forward and
        suggested production snapshots do not reduce RS Balance.
      </div>
    </div>
  );
}
