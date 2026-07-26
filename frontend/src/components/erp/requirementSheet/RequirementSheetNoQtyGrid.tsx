import * as React from "react";
import { Badge } from "../../ui/badge";
import { Input } from "../../ui/input";
import { WorkbenchGrid, WorkbenchGridTable } from "../workbench";
import {
  allCyclesQtyForItem,
  computeLiveNetProductionRequirement,
  computeProvisionalNetRecovery,
  fmtPlan,
  PLAN_EPS,
  previousCyclesQtyForItem,
  safeNum,
  usableDisplayStock,
  type NoQtyRsCycleSummaryEntry,
} from "../../../lib/requirementSheetNoQtyUx";

export type RequirementSheetNoQtyGridLine = {
  itemId: number;
  itemName: string;
  unit?: string | null;
  newWoQty?: string | number | null;
  requirementQty?: string | number | null;
  baseDemandQty?: number | null;
  shortfallQty?: number | null;
  productionShortfallQty?: number | null;
  qcRejectionRecoveryQty?: number | null;
  approvedManualAdjustmentQty?: number | null;
  totalRsQty?: number | null;
  availableStockQty?: number | null;
  totalWoQty?: number | null;
  productionRequiredQty?: number | null;
  priorAcceptedExcessQty?: number | null;
  unusedAcceptedExcessQty?: number | null;
  availableAcceptedSurplusQty?: number | null;
  netProductionRequirementQty?: number | null;
  acceptedExcessExplanation?: string | null;
  postCycleApprovalQty?: number | null;
  pendingQcDispositionQty?: number | null;
  productionQcPendingQty?: number | null;
  previousCycleUndispatchedAcceptedQty?: number | null;
  producedExcessPendingQcQty?: number | null;
  acceptedWoExcessQty?: number | null;
  rejectedWoExcessQty?: number | null;
  provisionalNetRecoveryQty?: number | null;
  provisionalNetRecoverySubjectToQc?: boolean | null;
  provisionalNetRecoveryExplanation?: string | null;
  producedExcessPendingQcBlocksFinalize?: boolean | null;
  producedExcessPendingQcFinalizeMessage?: string | null;
  qcStockNote?: string | null;
};

export type RecoveryDecisionSource = {
  recoverySourceId: number;
  recoveryType: string;
  availableQty?: number;
  effect?: string;
  sourceRsDocNo?: string | null;
  sourceRsId?: number | null;
  cycleNo?: number | null;
  cycleId?: number | null;
  sourceWorkOrderId?: number | null;
  workOrderDocNo?: string | null;
  recoveryStatus?: string;
};

export type RecoveryDecisionItem = {
  decisionId: number;
  itemId: number;
  itemName?: string | null;
  uom?: string | null;
  decisionStatus: "PENDING" | "KEPT" | "WAIVED" | "CANCELLED" | string;
  customerDemandQty: number;
  productionShortfallQty: number;
  qcFinalRejectionQty: number;
  pendingRecoveryQty: number;
  finalRsQty: number;
  reason?: string | null;
  sources?: RecoveryDecisionSource[];
};

export type RequirementSheetNoQtyGridProps = {
  lines: RequirementSheetNoQtyGridLine[];
  locked: boolean;
  editingDisabled: boolean;
  needsRecalc: boolean;
  sheetDisplayCycleNo: number | null;
  rsCycleSummaries: NoQtyRsCycleSummaryEntry[];
  recoveryDecisions?: RecoveryDecisionItem[];
  canWaive?: boolean;
  onLineChange: (itemId: number, value: string) => void;
  onLineBlur: () => void;
  onKeepRecovery?: (itemId: number) => void | Promise<void>;
  onWaiveRecovery?: (itemId: number, reason: string) => void | Promise<void>;
  onReverseRecoveryDecision?: (itemId: number) => void | Promise<void>;
  /** Draft-only: remove FG from this cycle (releases recovery decision reservation). */
  onRemoveItem?: (itemId: number) => void | Promise<void>;
};

function DetailMetric({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={
        emphasize
          ? "rounded border border-amber-200/80 bg-amber-50/70 px-2.5 py-1.5 sm:col-span-2"
          : "rounded border border-slate-200/80 bg-white px-2.5 py-1.5"
      }
    >
      <div className="text-[12px] font-semibold text-slate-700">{label}</div>
      <div className="mt-0.5 text-[14px] font-bold tabular-nums text-slate-950">{value}</div>
    </div>
  );
}

const COL_COUNT = 13;

export function RequirementSheetNoQtyGrid({
  lines,
  locked,
  editingDisabled,
  needsRecalc: _needsRecalc,
  sheetDisplayCycleNo,
  rsCycleSummaries,
  recoveryDecisions = [],
  canWaive = false,
  onLineChange,
  onLineBlur,
  onKeepRecovery,
  onWaiveRecovery,
  onReverseRecoveryDecision,
  onRemoveItem,
}: RequirementSheetNoQtyGridProps) {
  const [expandedItemId, setExpandedItemId] = React.useState<number | null>(null);
  const [busyItemId, setBusyItemId] = React.useState<number | null>(null);
  const decisionByItem = React.useMemo(() => {
    const m = new Map<number, RecoveryDecisionItem>();
    for (const d of recoveryDecisions) m.set(Number(d.itemId), d);
    return m;
  }, [recoveryDecisions]);

  async function runDecision(itemId: number, fn?: () => void | Promise<void>) {
    if (!fn) return;
    setBusyItemId(itemId);
    try {
      await fn();
    } finally {
      setBusyItemId(null);
    }
  }

  return (
    <WorkbenchGrid id="rs-items" aria-label="Requirement sheet line items" compact>
      <WorkbenchGridTable className="table-fixed w-full min-w-[64rem]">
        <colgroup>
          <col className="w-[11%]" />
          <col className="w-[8%]" />
          <col className="w-[7%]" />
          <col className="w-[7%]" />
          <col className="w-[7%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          <col className="w-[9%]" />
          <col className="w-[6%]" />
          <col className="w-[7%]" />
          <col className="w-[6%]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="text-left">
              Item
            </th>
            <th scope="col" className="text-right" title="Customer / current-cycle demand entered on this sheet">
              Customer Demand
            </th>
            <th scope="col" className="text-right" title="Gross WO-level PRODUCTION_SHORTFALL until Keep (before excess offset)">
              Production Shortage
            </th>
            <th scope="col" className="text-right" title="Available QC_FINAL_REJECTION until Keep">
              Final QC Rejection
            </th>
            <th scope="col" className="text-right" title="Pending recovery = Shortage + QC rejection">
              Pending Recovery
            </th>
            <th
              scope="col"
              className="text-right"
              title="WO over-production still awaiting first-pass QC — not Prior Accepted Excess"
            >
              Produced Excess Pending QC
            </th>
            <th
              scope="col"
              className="text-right"
              title="Gross shortage + QC rejection − pending/accepted WO excess (subject to QC while pending)"
            >
              Provisional Net Recovery
            </th>
            <th scope="col" className="text-right" title="QC-accepted excess FG from prior cycles allocated here">
              Prior Accepted Excess
            </th>
            <th scope="col" className="text-left" title="Keep or Waive when pending recovery &gt; 0">
              Decision
            </th>
            <th
              scope="col"
              className="text-right"
              title="Executable production qty = Demand + kept recovery after accepted WO excess − prior accepted excess"
            >
              Net Production Requirement
            </th>
            <th scope="col" className="text-right">
              Pending QC
            </th>
            <th scope="col" className="text-left">
              Status
            </th>
            <th scope="col" className="erp-table-action-col text-left">
              Detail
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const decision = decisionByItem.get(l.itemId);
            const unit = l.unit ?? decision?.uom ?? null;
            const rawNewWo = String(l.newWoQty ?? l.requirementQty ?? "");
            const newWo =
              !locked && (rawNewWo === "" || rawNewWo === "0" || Number(rawNewWo) === 0) ? "" : rawNewWo;
            const newReqNum = safeNum(rawNewWo);
            const decisionStatus = decision?.decisionStatus ?? null;
            const psQty =
              decisionStatus === "PENDING" || decisionStatus === "KEPT" || decisionStatus === "WAIVED"
                ? safeNum(decision?.productionShortfallQty)
                : safeNum(l.productionShortfallQty ?? l.shortfallQty);
            const qcQty =
              decisionStatus === "PENDING" || decisionStatus === "KEPT" || decisionStatus === "WAIVED"
                ? safeNum(decision?.qcFinalRejectionQty)
                : safeNum(l.qcRejectionRecoveryQty);
            const pendingRecovery =
              decisionStatus === "PENDING"
                ? safeNum(decision?.pendingRecoveryQty)
                : decisionStatus === "KEPT" || decisionStatus === "WAIVED"
                  ? safeNum(decision?.pendingRecoveryQty)
                  : safeNum(psQty + qcQty);
            const showDecision = pendingRecovery > PLAN_EPS || decisionStatus === "KEPT" || decisionStatus === "WAIVED";

            const keptPs = decisionStatus === "KEPT" ? psQty : decisionStatus === "WAIVED" || decisionStatus === "PENDING" ? 0 : safeNum(l.productionShortfallQty ?? l.shortfallQty);
            const keptQc = decisionStatus === "KEPT" ? qcQty : decisionStatus === "WAIVED" || decisionStatus === "PENDING" ? 0 : safeNum(l.qcRejectionRecoveryQty);

            const usable = usableDisplayStock(l.availableStockQty);
            const pendingDisp = safeNum(l.pendingQcDispositionQty);
            const productionQcPending = safeNum(l.productionQcPendingQty);
            const postCycle = safeNum(l.postCycleApprovalQty);
            const undispatchedPrior = safeNum(l.previousCycleUndispatchedAcceptedQty);
            const producedExcessPendingQc = safeNum(l.producedExcessPendingQcQty);
            const acceptedWoExcess = safeNum(l.acceptedWoExcessQty);
            const rejectedWoExcess = safeNum(l.rejectedWoExcessQty);
            const provisional = computeProvisionalNetRecovery({
              grossProductionShortageQty: psQty,
              keptFinalQcRejectionQty: qcQty,
              rejectedWoExcessQty: rejectedWoExcess,
              producedExcessPendingQcQty: producedExcessPendingQc,
              acceptedWoExcessQty: acceptedWoExcess,
            });
            const provisionalNetRecovery =
              l.provisionalNetRecoveryQty != null && Number.isFinite(Number(l.provisionalNetRecoveryQty))
                ? safeNum(l.provisionalNetRecoveryQty)
                : provisional.provisionalNetRecoveryQty;
            const provisionalSubjectToQc =
              l.provisionalNetRecoverySubjectToQc != null
                ? Boolean(l.provisionalNetRecoverySubjectToQc)
                : provisional.subjectToQc;

            // Live net: always recompute from current demand + server excess pool so edits refresh immediately.
            const live = computeLiveNetProductionRequirement({
              customerDemandQty: newReqNum,
              keptProductionShortageQty: keptPs,
              keptQcRejectionQty: keptQc,
              approvedManualAdjustmentQty: safeNum(l.approvedManualAdjustmentQty),
              acceptedWoExcessQty: acceptedWoExcess,
              priorAcceptedExcessQty: safeNum(l.priorAcceptedExcessQty),
              unusedAcceptedExcessQty: safeNum(l.unusedAcceptedExcessQty),
              availableAcceptedSurplusQty: l.availableAcceptedSurplusQty,
            });
            const priorAcceptedExcess = live.allocatedAcceptedSurplusQty;
            const netProductionRequirement = live.netProductionRequirementQty;
            const unusedExcess = live.unusedAcceptedSurplusQty;

            const prevCyclesQty = previousCyclesQtyForItem(rsCycleSummaries, l.itemId, sheetDisplayCycleNo);
            const allCyclesQty = allCyclesQtyForItem(rsCycleSummaries, l.itemId, newReqNum, sheetDisplayCycleNo);

            const status =
              decisionStatus === "PENDING" && pendingRecovery > PLAN_EPS
                ? { kind: "pending" as const, label: "Decision pending" }
                : netProductionRequirement <= PLAN_EPS
                  ? { kind: "neutral" as const, label: "Awaiting requirement" }
                  : { kind: "required" as const, label: "WO required" };

            const badgeVariant =
              status.kind === "pending"
                ? ("warning" as const)
                : status.kind === "required"
                  ? ("info" as const)
                  : ("default" as const);

            const detailOpen = expandedItemId === l.itemId;
            const busy = busyItemId === l.itemId;
            const sources = decision?.sources ?? [];

            return (
              <React.Fragment key={l.itemId}>
                <tr className="erp-workbench-grid-row align-top" data-testid={`rs-noqty-row-${l.itemId}`}>
                  <td className="text-left align-top">
                    <div className="font-medium text-slate-900">{l.itemName}</div>
                    {unit ? <div className="text-[11px] text-slate-500">{unit}</div> : null}
                  </td>
                  <td className="text-right align-top">
                    <Input
                      className="erp-workbench-grid-input ml-auto h-8 w-24 text-right tabular-nums"
                      disabled={editingDisabled}
                      value={newWo}
                      onChange={(e) => onLineChange(l.itemId, e.target.value)}
                      onBlur={onLineBlur}
                      placeholder="Qty"
                      aria-label={`Customer demand qty for ${l.itemName}`}
                      data-testid={`rs-customer-demand-${l.itemId}`}
                    />
                  </td>
                  <td className="erp-table-num text-right align-top font-semibold text-slate-900">
                    {psQty > PLAN_EPS ? fmtPlan(psQty, unit) : "—"}
                  </td>
                  <td className="erp-table-num text-right align-top font-semibold text-slate-900">
                    {qcQty > PLAN_EPS ? fmtPlan(qcQty, unit) : "—"}
                  </td>
                  <td className="erp-table-num text-right align-top font-semibold text-slate-950">
                    {pendingRecovery > PLAN_EPS ? fmtPlan(pendingRecovery, unit) : "—"}
                  </td>
                  <td
                    className="erp-table-num text-right align-top font-semibold text-amber-900"
                    data-testid={`rs-produced-excess-pending-qc-${l.itemId}`}
                  >
                    {producedExcessPendingQc > PLAN_EPS ? fmtPlan(producedExcessPendingQc, unit) : "—"}
                  </td>
                  <td
                    className="erp-table-num text-right align-top font-semibold text-slate-950"
                    data-testid={`rs-provisional-net-recovery-${l.itemId}`}
                  >
                    {provisionalNetRecovery > PLAN_EPS || psQty > PLAN_EPS || qcQty > PLAN_EPS ? (
                      <div>
                        {fmtPlan(provisionalNetRecovery, unit)}
                        {provisionalSubjectToQc ? (
                          <div className="mt-0.5 text-[10px] font-medium leading-snug text-amber-800">
                            Subject to QC
                            {producedExcessPendingQc > PLAN_EPS
                              ? ` (${fmtPlan(producedExcessPendingQc, unit)} excess pending)`
                              : ""}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="erp-table-num text-right align-top font-semibold text-emerald-800">
                    <div data-testid={`rs-prior-excess-${l.itemId}`}>
                      {priorAcceptedExcess > PLAN_EPS ? fmtPlan(priorAcceptedExcess, unit) : "—"}
                    </div>
                    {priorAcceptedExcess > PLAN_EPS || unusedExcess > PLAN_EPS ? (
                      <div className="mt-0.5 text-[10px] font-medium leading-snug text-emerald-700">
                        {priorAcceptedExcess > PLAN_EPS
                          ? (l.acceptedExcessExplanation ??
                            `${fmtPlan(priorAcceptedExcess, unit)} accepted in previous cycles applied here.`)
                          : null}
                        {unusedExcess > PLAN_EPS ? (
                          <div className="mt-0.5 text-slate-600">
                            Unused excess retained: {fmtPlan(unusedExcess, unit)}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                  <td className="text-left align-top">
                    {!showDecision ? (
                      <span className="text-[11px] text-slate-500">—</span>
                    ) : decisionStatus === "PENDING" && !locked ? (
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="rounded border border-emerald-600 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                          disabled={editingDisabled || busy || !onKeepRecovery}
                          onClick={() => runDecision(l.itemId, () => onKeepRecovery?.(l.itemId))}
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          className="rounded border border-slate-400 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                          disabled={editingDisabled || busy || !canWaive || !onWaiveRecovery}
                          title="Waive all pending recovery for this item (reason required)"
                          onClick={() => {
                            const reason = window.prompt(
                              `Waive all pending recovery for ${l.itemName}?\nEnter reason (required):`,
                              "",
                            );
                            if (reason == null) return;
                            if (String(reason).trim().length < 3) {
                              window.alert("Waiver reason must be at least 3 characters.");
                              return;
                            }
                            void runDecision(l.itemId, () => onWaiveRecovery?.(l.itemId, String(reason).trim()));
                          }}
                        >
                          Waive
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Badge variant={decisionStatus === "KEPT" ? "success" : decisionStatus === "WAIVED" ? "warning" : "default"}>
                          {decisionStatus === "KEPT" ? "Kept" : decisionStatus === "WAIVED" ? "Waived" : decisionStatus}
                        </Badge>
                        {!locked && (decisionStatus === "KEPT" || decisionStatus === "WAIVED") ? (
                          <button
                            type="button"
                            className="block text-[11px] font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900 disabled:opacity-50"
                            disabled={editingDisabled || busy || !onReverseRecoveryDecision}
                            onClick={() => runDecision(l.itemId, () => onReverseRecoveryDecision?.(l.itemId))}
                          >
                            Reverse
                          </button>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td
                    className="erp-table-num text-right align-top font-semibold text-slate-950"
                    data-testid={`rs-net-production-${l.itemId}`}
                  >
                    {fmtPlan(netProductionRequirement, unit)}
                  </td>
                  <td className="erp-table-num text-right align-top text-slate-800">
                    {productionQcPending > PLAN_EPS ? fmtPlan(productionQcPending, unit) : "—"}
                  </td>
                  <td className="text-left align-top">
                    <Badge variant={badgeVariant}>{status.label}</Badge>
                  </td>
                  <td className="erp-table-action-col text-left align-top">
                    <div className="flex flex-col items-start gap-1">
                      <button
                        type="button"
                        className="text-[12px] font-semibold text-slate-700 underline underline-offset-2 hover:text-slate-950"
                        aria-expanded={detailOpen}
                        onClick={() => setExpandedItemId(detailOpen ? null : l.itemId)}
                      >
                        {detailOpen ? "Hide detail" : "Show detail"}
                      </button>
                      {!locked && onRemoveItem ? (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-rose-700 underline underline-offset-2 hover:text-rose-900 disabled:opacity-50"
                          disabled={editingDisabled || busy}
                          title="Remove this FG from the current draft cycle"
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Remove ${l.itemName} from this Requirement Sheet cycle?\nReserved recovery for this item will be released.`,
                              )
                            ) {
                              return;
                            }
                            void runDecision(l.itemId, () => onRemoveItem(l.itemId));
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {detailOpen ? (
                  <tr className="erp-workbench-grid-detail-row">
                    <td colSpan={COL_COUNT}>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        <DetailMetric label="Customer Demand" value={fmtPlan(newReqNum, unit)} emphasize />
                        <DetailMetric
                          label="Production Shortage"
                          value={psQty > PLAN_EPS ? fmtPlan(psQty, unit) : "—"}
                          emphasize={psQty > PLAN_EPS}
                        />
                        <DetailMetric
                          label="Final QC Rejection"
                          value={qcQty > PLAN_EPS ? fmtPlan(qcQty, unit) : "—"}
                          emphasize={qcQty > PLAN_EPS}
                        />
                        <DetailMetric label="Pending Recovery" value={fmtPlan(pendingRecovery, unit)} emphasize />
                        <DetailMetric
                          label="Produced Excess Pending QC"
                          value={producedExcessPendingQc > PLAN_EPS ? fmtPlan(producedExcessPendingQc, unit) : "—"}
                          emphasize={producedExcessPendingQc > PLAN_EPS}
                        />
                        <DetailMetric
                          label="Provisional Net Recovery"
                          value={fmtPlan(provisionalNetRecovery, unit)}
                          emphasize
                        />
                        <DetailMetric
                          label="Prior Accepted Excess FG"
                          value={priorAcceptedExcess > PLAN_EPS ? fmtPlan(priorAcceptedExcess, unit) : "—"}
                          emphasize={priorAcceptedExcess > PLAN_EPS}
                        />
                        <DetailMetric
                          label="Net Production Requirement"
                          value={fmtPlan(netProductionRequirement, unit)}
                          emphasize
                        />
                        <DetailMetric
                          label="Decision"
                          value={decisionStatus ?? (pendingRecovery > PLAN_EPS ? "PENDING" : "—")}
                        />
                        {decision?.reason ? <DetailMetric label="Waive reason" value={decision.reason} /> : null}
                        <DetailMetric
                          label="Hold / rework disposition"
                          value={pendingDisp > PLAN_EPS ? fmtPlan(pendingDisp, unit) : "—"}
                        />
                        <DetailMetric
                          label="Prior undispatched QC-accepted FG"
                          value={undispatchedPrior > PLAN_EPS ? fmtPlan(undispatchedPrior, unit) : "—"}
                        />
                        <DetailMetric
                          label="Post-cycle approval (usable)"
                          value={postCycle > PLAN_EPS ? fmtPlan(postCycle, unit) : "—"}
                        />
                        <DetailMetric label="Usable FG (dispatch info)" value={fmtPlan(usable, unit)} />
                        <DetailMetric label="Previous cycles requirement" value={fmtPlan(prevCyclesQty, unit)} />
                        <DetailMetric label="All cycles requirement" value={fmtPlan(allCyclesQty, unit)} />
                      </div>
                      {sources.length > 0 ? (
                        <div className="mt-3 overflow-x-auto rounded border border-slate-200 bg-slate-50/80 px-3 py-2">
                          <div className="text-[12px] font-semibold text-slate-800">Recovery sources</div>
                          <table className="mt-1 w-full min-w-[640px] border-collapse text-left text-[11px]">
                            <thead>
                              <tr className="border-b border-slate-200 text-slate-600">
                                <th className="py-1 pr-2 font-medium">Type</th>
                                <th className="py-1 pr-2 font-medium text-right">Qty</th>
                                <th className="py-1 pr-2 font-medium">Source RS</th>
                                <th className="py-1 pr-2 font-medium">Cycle</th>
                                <th className="py-1 pr-2 font-medium">WO</th>
                                <th className="py-1 font-medium">Status / Effect</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sources.map((s) => (
                                <tr key={`${s.recoverySourceId}-${s.effect ?? "open"}`} className="border-b border-slate-100">
                                  <td className="py-1 pr-2">
                                    {s.recoveryType === "QC_FINAL_REJECTION"
                                      ? "Final QC rejection"
                                      : "Production shortage"}
                                  </td>
                                  <td className="py-1 pr-2 text-right tabular-nums">
                                    {fmtPlan(safeNum(s.availableQty), unit)}
                                  </td>
                                  <td className="py-1 pr-2">
                                    {s.sourceRsDocNo ?? (s.sourceRsId != null ? `RS-${s.sourceRsId}` : "—")}
                                  </td>
                                  <td className="py-1 pr-2 tabular-nums">
                                    {s.cycleNo != null ? s.cycleNo : s.cycleId != null ? s.cycleId : "—"}
                                  </td>
                                  <td className="py-1 pr-2">
                                    {s.workOrderDocNo ??
                                      (s.sourceWorkOrderId != null ? `WO #${s.sourceWorkOrderId}` : "—")}
                                  </td>
                                  <td className="py-1">{s.effect ?? s.recoveryStatus ?? "OPEN"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </WorkbenchGridTable>
    </WorkbenchGrid>
  );
}
