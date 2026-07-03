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
            <th scope="col" className="text-right">
              New req.
            </th>
            <th scope="col" className="text-right">
              Total to Produce
            </th>
            <th scope="col" className="text-right">
              Prev cycles
            </th>
            <th scope="col" className="text-right">
              All cycles
            </th>
            <th scope="col" className="text-right">
              Usable (info)
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
                  : pendingDisp > PLAN_EPS
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

            return (
              <React.Fragment key={l.itemId}>
                <tr className="erp-workbench-grid-row align-middle">
                  <td>
                    <div className="font-medium text-slate-900">{l.itemName}</div>
                    {l.qcStockNote ? <div className="text-[11px] text-slate-600">{l.qcStockNote}</div> : null}
                  </td>
                  <td className="text-right">
                    <Input
                      className="erp-workbench-grid-input ml-auto h-8 w-24 text-right tabular-nums"
                      disabled={editingDisabled}
                      value={newWo}
                      onChange={(e) => onLineChange(l.itemId, e.target.value)}
                      onBlur={onLineBlur}
                      placeholder="Qty"
                      aria-label={`New requirement qty for ${l.itemName}`}
                    />
                  </td>
                  <td className="erp-table-num font-semibold text-slate-950">{fmtPlan(productionRequired)}</td>
                  <td className="erp-table-num">{fmtPlan(prevCyclesQty)}</td>
                  <td className="erp-table-num">{fmtPlan(allCyclesQty)}</td>
                  <td className="erp-table-num text-slate-700">{fmtPlan(usable)}</td>
                  <td>
                    <Badge variant={badgeVariant}>{badgeLabel}</Badge>
                  </td>
                  <td className="erp-table-action-col">
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900"
                      aria-expanded={detailOpen}
                      onClick={() => setExpandedItemId(detailOpen ? null : l.itemId)}
                    >
                      {detailOpen ? "Hide" : "More"}
                    </button>
                  </td>
                </tr>
                {detailOpen ? (
                  <tr className="erp-workbench-grid-detail-row">
                    <td colSpan={8}>
                      <div className="grid gap-1 text-[11px] text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                        {shortfall > PLAN_EPS ? (
                          <div className="flex justify-between gap-2 sm:col-span-2">
                            <span>Production shortfall (prior cycle)</span>
                            <span className="font-semibold tabular-nums">{fmtPlan(shortfall)}</span>
                          </div>
                        ) : null}
                        <div className="flex justify-between gap-2">
                          <span>Pending QC / In Process</span>
                          <span className="font-semibold tabular-nums">
                            {pendingDisp > PLAN_EPS ? fmtPlan(pendingDisp) : "—"}
                          </span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span>Post-cycle Approval</span>
                          <span className="font-semibold tabular-nums">{postCycle > PLAN_EPS ? fmtPlan(postCycle) : "—"}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span>Prior Undispatched QC</span>
                          <span className="font-semibold tabular-nums">
                            {undispatchedPrior > PLAN_EPS ? fmtPlan(undispatchedPrior) : "—"}
                          </span>
                        </div>
                        <div className="flex justify-between gap-2 sm:col-span-2">
                          <span>Current cycle requirement</span>
                          <span className="font-semibold tabular-nums">{fmtPlan(newReqNum)}</span>
                        </div>
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
