import * as React from "react";
import { Badge } from "../../ui/badge";
import { Input } from "../../ui/input";
import { WorkbenchGrid, WorkbenchGridTable } from "../workbench/WorkbenchGrid";
import { computeDraftProductionRequired } from "../../../pages/RequirementSheetPage";
import {
  allCyclesQtyForItem,
  previousCyclesQtyForItem,
  type NoQtyRsCycleSummaryEntry,
} from "../../../lib/noQtyRsCycleSummary";

const PLAN_EPS = 1e-6;

function safeNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function usableDisplayStock(v: unknown): number {
  return Math.max(0, safeNum(v));
}

function fmtPlan(n: number, unit?: string | null): string {
  const text = n.toFixed(3).replace(/\.000$/, "");
  return unit?.trim() ? `${text} ${unit.trim()}` : text;
}

export type RequirementSheetNoQtyGridLine = {
  itemId: number;
  itemName: string;
  unit?: string | null;
  requirementQty: string;
  shortfallQty?: number | null;
  productionShortfallQty?: number | null;
  qcRejectionRecoveryQty?: number | null;
  totalRsQty?: number | null;
  qcStockNote?: string | null;
  newWoQty?: string;
  totalWoQty?: number | null;
  productionRequiredQty?: number | null;
  availableStockQty?: number | null;
  postCycleApprovalQty?: number | null;
  pendingQcDispositionQty?: number | null;
  /** First-pass production QC still pending: produced − accepted − rejected. */
  productionQcPendingQty?: number | null;
  previousCycleUndispatchedAcceptedQty?: number | null;
};

export type QcRecoveryAvailabilityRow = {
  recoverySourceId: number;
  itemId: number;
  itemName?: string | null;
  uom?: string | null;
  availableQty: number;
};

export type RequirementSheetNoQtyGridProps = {
  lines: RequirementSheetNoQtyGridLine[];
  locked: boolean;
  editingDisabled: boolean;
  needsRecalc: boolean;
  sheetDisplayCycleNo: number | null;
  rsCycleSummaries: NoQtyRsCycleSummaryEntry[];
  availableQcRecovery?: QcRecoveryAvailabilityRow[];
  onLineChange: (itemId: number, value: string) => void;
  onLineBlur: () => void;
  onAllocateQcRecovery?: (recoverySourceId: number, qty: number) => void;
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

export function RequirementSheetNoQtyGrid({
  lines,
  locked,
  editingDisabled,
  needsRecalc,
  sheetDisplayCycleNo,
  rsCycleSummaries,
  availableQcRecovery = [],
  onLineChange,
  onLineBlur,
  onAllocateQcRecovery,
}: RequirementSheetNoQtyGridProps) {
  const [expandedItemId, setExpandedItemId] = React.useState<number | null>(null);

  return (
    <WorkbenchGrid id="rs-items" aria-label="Requirement sheet line items" compact>
      <WorkbenchGridTable>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="text-right" title="Customer / current-cycle demand entered on this sheet">
              Customer Demand
            </th>
            <th
              scope="col"
              className="text-right"
              title="System PRODUCTION_SHORTFALL carry-forward (read-only; from CarryForwardPending)"
            >
              Production Shortfall Carry Forward
            </th>
            <th scope="col" className="text-right" title="Final QC rejection recovery allocated to this sheet">
              QC recovery
            </th>
            <th
              scope="col"
              className="text-right"
              title="Total RS quantity = Customer Demand + Production Shortfall + QC recovery"
            >
              Total RS Quantity
            </th>
            <th scope="col" className="text-right" title="First-pass production QC still awaiting inspection">
              Pending QC
            </th>
            <th scope="col" className="text-right" title="Prior-cycle rejected qty still in hold/rework disposition">
              Hold / rework
            </th>
            <th scope="col" className="text-right" title="Usable FG available for optional dispatch (informational)">
              Usable FG
            </th>
            <th scope="col">Status</th>
            <th scope="col" className="erp-table-action-col">
              Detail
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const shortfall = safeNum(l.productionShortfallQty ?? l.shortfallQty);
            const qcRecovery = safeNum(l.qcRejectionRecoveryQty);
            const pendingDisp = safeNum(l.pendingQcDispositionQty);
            const productionQcPending = safeNum(l.productionQcPendingQty);
            const unit = l.unit ?? null;
            const rawNewWo = String(l.newWoQty ?? l.requirementQty ?? "");
            const newWo =
              !locked && (rawNewWo === "" || rawNewWo === "0" || Number(rawNewWo) === 0) ? "" : rawNewWo;
            const usable = usableDisplayStock(l.availableStockQty);
            const newReqNum = safeNum(rawNewWo);
            const postCycle = safeNum(l.postCycleApprovalQty);
            const undispatchedPrior = safeNum(l.previousCycleUndispatchedAcceptedQty);
            const productionRequired = locked
              ? safeNum(l.totalWoQty ?? l.productionRequiredQty ?? l.totalRsQty)
              : needsRecalc
                ? computeDraftProductionRequired(l, true)
                : safeNum(l.totalRsQty ?? l.totalWoQty ?? computeDraftProductionRequired(l, true));
            const prevCyclesQty = previousCyclesQtyForItem(rsCycleSummaries, l.itemId, sheetDisplayCycleNo);
            const allCyclesQty = allCyclesQtyForItem(rsCycleSummaries, l.itemId, newReqNum, sheetDisplayCycleNo);
            const itemQcAvailable = availableQcRecovery.filter((r) => r.itemId === l.itemId && r.availableQty > PLAN_EPS);

            const effectiveDemand = shortfall + newReqNum + qcRecovery;
            const status =
              effectiveDemand <= PLAN_EPS
                ? { kind: "neutral" as const, label: "Awaiting requirement" }
                : productionRequired > PLAN_EPS
                  ? { kind: "required" as const, label: "WO required" }
                  : pendingDisp > PLAN_EPS || productionQcPending > PLAN_EPS
                    ? { kind: "neutral" as const, label: "In process qty" }
                    : { kind: "neutral" as const, label: "No production qty" };

            const badgeVariant =
              status.kind === "required"
                ? ("info" as const)
                : productionRequired <= PLAN_EPS && effectiveDemand > PLAN_EPS
                  ? ("success" as const)
                  : ("default" as const);
            const badgeLabel =
              status.kind === "required"
                ? "WO Required"
                : productionRequired <= PLAN_EPS && effectiveDemand > PLAN_EPS
                  ? "No production"
                  : status.label;

            const detailOpen = expandedItemId === l.itemId;
            const pendingQcDisplay = productionQcPending > PLAN_EPS ? productionQcPending : 0;
            const isCarryForwardOnly = shortfall > PLAN_EPS && newReqNum <= PLAN_EPS;

            return (
              <React.Fragment key={l.itemId}>
                <tr className="erp-workbench-grid-row align-middle">
                  <td>
                    <div className="font-medium text-slate-900">{l.itemName}</div>
                    {unit ? <div className="text-[11px] text-slate-500">{unit}</div> : null}
                    {isCarryForwardOnly && !locked ? (
                      <div className="text-[11px] font-medium text-amber-800">Carry-forward only</div>
                    ) : null}
                    {l.qcStockNote ? <div className="text-[12px] text-slate-600">{l.qcStockNote}</div> : null}
                  </td>
                  <td className="text-right">
                    <Input
                      className="erp-workbench-grid-input ml-auto h-8 w-24 text-right tabular-nums"
                      disabled={editingDisabled}
                      value={newWo}
                      onChange={(e) => onLineChange(l.itemId, e.target.value)}
                      onBlur={onLineBlur}
                      placeholder="Qty"
                      aria-label={`Customer demand qty for ${l.itemName}`}
                    />
                  </td>
                  <td className="erp-table-num font-semibold text-slate-900" title="System-generated; not editable">
                    {shortfall > PLAN_EPS ? fmtPlan(shortfall, unit) : "—"}
                  </td>
                  <td className="erp-table-num font-semibold text-slate-900">
                    {qcRecovery > PLAN_EPS ? fmtPlan(qcRecovery, unit) : "—"}
                  </td>
                  <td className="erp-table-num font-semibold text-slate-950">{fmtPlan(productionRequired, unit)}</td>
                  <td className="erp-table-num font-semibold text-slate-900">
                    {pendingQcDisplay > PLAN_EPS ? fmtPlan(pendingQcDisplay, unit) : "—"}
                  </td>
                  <td className="erp-table-num text-slate-800">
                    {pendingDisp > PLAN_EPS ? fmtPlan(pendingDisp, unit) : "—"}
                  </td>
                  <td className="erp-table-num text-slate-700">{fmtPlan(usable, unit)}</td>
                  <td>
                    <Badge variant={badgeVariant}>{badgeLabel}</Badge>
                  </td>
                  <td className="erp-table-action-col">
                    <button
                      type="button"
                      className="text-[12px] font-semibold text-slate-700 underline underline-offset-2 hover:text-slate-950"
                      aria-expanded={detailOpen}
                      onClick={() => setExpandedItemId(detailOpen ? null : l.itemId)}
                    >
                      {detailOpen ? "Hide detail" : "Show detail"}
                    </button>
                  </td>
                </tr>
                {detailOpen ? (
                  <tr className="erp-workbench-grid-detail-row">
                    <td colSpan={10}>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        <DetailMetric
                          label="Customer Demand"
                          value={fmtPlan(newReqNum, unit)}
                          emphasize
                        />
                        <DetailMetric
                          label="Production Shortfall Carry Forward"
                          value={shortfall > PLAN_EPS ? fmtPlan(shortfall, unit) : "—"}
                          emphasize={shortfall > PLAN_EPS}
                        />
                        <DetailMetric
                          label="QC recovery (allocated)"
                          value={qcRecovery > PLAN_EPS ? fmtPlan(qcRecovery, unit) : "—"}
                          emphasize={qcRecovery > PLAN_EPS}
                        />
                        <DetailMetric label="Total RS Quantity" value={fmtPlan(productionRequired, unit)} emphasize />
                        <DetailMetric
                          label="Pending QC (first-pass)"
                          value={productionQcPending > PLAN_EPS ? fmtPlan(productionQcPending, unit) : "—"}
                        />
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
                      {!locked && itemQcAvailable.length > 0 ? (
                        <div className="mt-3 space-y-2 rounded border border-slate-200 bg-slate-50/80 px-3 py-2">
                          <div className="text-[12px] font-semibold text-slate-800">Available QC recovery</div>
                          {itemQcAvailable.map((src) => (
                            <div
                              key={src.recoverySourceId}
                              className="flex flex-wrap items-center gap-2 text-[12px] text-slate-700"
                            >
                              <span className="tabular-nums font-semibold">
                                {fmtPlan(src.availableQty)}
                                {src.uom ? ` ${src.uom}` : ""}
                              </span>
                              <button
                                type="button"
                                className="rounded border border-slate-300 bg-white px-2 py-0.5 font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                                disabled={editingDisabled || !onAllocateQcRecovery}
                                onClick={() => onAllocateQcRecovery?.(src.recoverySourceId, src.availableQty)}
                              >
                                Add full
                              </button>
                              <button
                                type="button"
                                className="rounded border border-slate-300 bg-white px-2 py-0.5 font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                                disabled={editingDisabled || !onAllocateQcRecovery}
                                onClick={() => {
                                  const raw = window.prompt(
                                    `Allocate partial QC recovery (max ${fmtPlan(src.availableQty)}):`,
                                    String(src.availableQty),
                                  );
                                  if (raw == null) return;
                                  const qty = Number(raw);
                                  if (!Number.isFinite(qty) || qty <= 0) return;
                                  onAllocateQcRecovery?.(src.recoverySourceId, qty);
                                }}
                              >
                                Add partial
                              </button>
                              <span className="text-slate-500">Skip for now leaves this source available.</span>
                            </div>
                          ))}
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
