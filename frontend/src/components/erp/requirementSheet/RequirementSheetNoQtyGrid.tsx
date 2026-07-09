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

function fmtPlan(n: number): string {
  return n.toFixed(3).replace(/\.000$/, "");
}

export type RequirementSheetNoQtyGridLine = {
  itemId: number;
  itemName: string;
  requirementQty: string;
  shortfallQty?: number | null;
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

export type RequirementSheetNoQtyGridProps = {
  lines: RequirementSheetNoQtyGridLine[];
  locked: boolean;
  editingDisabled: boolean;
  needsRecalc: boolean;
  sheetDisplayCycleNo: number | null;
  rsCycleSummaries: NoQtyRsCycleSummaryEntry[];
  onLineChange: (itemId: number, value: string) => void;
  onLineBlur: () => void;
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
  onLineChange,
  onLineBlur,
}: RequirementSheetNoQtyGridProps) {
  const [expandedItemId, setExpandedItemId] = React.useState<number | null>(null);

  return (
    <WorkbenchGrid id="rs-items" aria-label="Requirement sheet line items" compact>
      <WorkbenchGridTable>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="text-right" title="Current cycle requirement qty entered on this sheet">
              Current requirement
            </th>
            <th scope="col" className="text-right" title="Prior-cycle production shortfall carried into this cycle">
              Prior shortfall
            </th>
            <th scope="col" className="text-right" title="Qty that must be produced this cycle (shortfall + current requirement)">
              Total to produce
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
            const shortfall = safeNum(l.shortfallQty);
            const pendingDisp = safeNum(l.pendingQcDispositionQty);
            const productionQcPending = safeNum(l.productionQcPendingQty);
            const rawNewWo = String(l.newWoQty ?? l.requirementQty ?? "");
            const newWo =
              !locked && (rawNewWo === "" || rawNewWo === "0" || Number(rawNewWo) === 0) ? "" : rawNewWo;
            const usable = usableDisplayStock(l.availableStockQty);
            const newReqNum = safeNum(rawNewWo);
            const postCycle = safeNum(l.postCycleApprovalQty);
            const undispatchedPrior = safeNum(l.previousCycleUndispatchedAcceptedQty);
            const productionRequired = locked
              ? safeNum(l.totalWoQty ?? l.productionRequiredQty)
              : needsRecalc
                ? computeDraftProductionRequired(l, true)
                : safeNum(l.totalWoQty ?? computeDraftProductionRequired(l, true));
            const prevCyclesQty = previousCyclesQtyForItem(rsCycleSummaries, l.itemId, sheetDisplayCycleNo);
            const allCyclesQty = allCyclesQtyForItem(rsCycleSummaries, l.itemId, newReqNum, sheetDisplayCycleNo);

            const effectiveDemand = shortfall + newReqNum;
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

            return (
              <React.Fragment key={l.itemId}>
                <tr className="erp-workbench-grid-row align-middle">
                  <td>
                    <div className="font-medium text-slate-900">{l.itemName}</div>
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
                      aria-label={`Current requirement qty for ${l.itemName}`}
                    />
                  </td>
                  <td className="erp-table-num font-semibold text-slate-900">
                    {shortfall > PLAN_EPS ? fmtPlan(shortfall) : "—"}
                  </td>
                  <td className="erp-table-num font-semibold text-slate-950">{fmtPlan(productionRequired)}</td>
                  <td className="erp-table-num font-semibold text-slate-900">
                    {pendingQcDisplay > PLAN_EPS ? fmtPlan(pendingQcDisplay) : "—"}
                  </td>
                  <td className="erp-table-num text-slate-800">
                    {pendingDisp > PLAN_EPS ? fmtPlan(pendingDisp) : "—"}
                  </td>
                  <td className="erp-table-num text-slate-700">{fmtPlan(usable)}</td>
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
                    <td colSpan={9}>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        <DetailMetric
                          label="Current cycle demand"
                          value={fmtPlan(newReqNum)}
                          emphasize
                        />
                        <DetailMetric
                          label="Prior shortfall (carry-forward)"
                          value={shortfall > PLAN_EPS ? fmtPlan(shortfall) : "—"}
                          emphasize={shortfall > PLAN_EPS}
                        />
                        <DetailMetric label="Total to produce" value={fmtPlan(productionRequired)} emphasize />
                        <DetailMetric
                          label="Pending QC (first-pass)"
                          value={productionQcPending > PLAN_EPS ? fmtPlan(productionQcPending) : "—"}
                        />
                        <DetailMetric
                          label="Hold / rework disposition"
                          value={pendingDisp > PLAN_EPS ? fmtPlan(pendingDisp) : "—"}
                        />
                        <DetailMetric
                          label="Prior undispatched QC-accepted FG"
                          value={undispatchedPrior > PLAN_EPS ? fmtPlan(undispatchedPrior) : "—"}
                        />
                        <DetailMetric
                          label="Post-cycle approval (usable)"
                          value={postCycle > PLAN_EPS ? fmtPlan(postCycle) : "—"}
                        />
                        <DetailMetric label="Usable FG (dispatch info)" value={fmtPlan(usable)} />
                        <DetailMetric label="Previous cycles requirement" value={fmtPlan(prevCyclesQty)} />
                        <DetailMetric label="All cycles requirement" value={fmtPlan(allCyclesQty)} />
                      </div>
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
