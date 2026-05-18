import { cn } from "../../../lib/utils";
import { displaySalesOrderNo } from "../../../lib/docNoDisplay";
import { NoQtyErpPlanningAuditDetail } from "./NoQtyErpPlanningAuditDetail";

function fmtQty(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  if (Math.abs(v) <= 1e-9) return null;
  const r = Math.round(v * 1000) / 1000;
  return Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : String(r);
}

export type NoQtyCycleContextBarProps = {
  soId: number;
  soDocNo?: string | null;
  customerName?: string | null;
  cycleNo?: number | null;
  operatorPendingQty?: number | null;
  lastShortageQty?: number | null;
  erpAdjustedPlanningQty?: number | null;
  currentRequirementQty?: number | null;
  totalToProduceQty?: number | null;
  qcPassedQty?: number | null;
  dispatchPendingQty?: number | null;
  itemName?: string | null;
  compact?: boolean;
  className?: string;
};

export function NoQtyCycleContextBar({
  soId,
  soDocNo,
  customerName,
  cycleNo,
  operatorPendingQty,
  erpAdjustedPlanningQty,
  lastShortageQty,
  currentRequirementQty,
  totalToProduceQty,
  qcPassedQty,
  dispatchPendingQty,
  itemName,
  compact = false,
  className,
}: NoQtyCycleContextBarProps) {
  const pending = fmtQty(operatorPendingQty);
  const erpQty = erpAdjustedPlanningQty ?? lastShortageQty;
  const newReq = fmtQty(currentRequirementQty);
  const totalProd = fmtQty(totalToProduceQty);
  const qc = fmtQty(qcPassedQty);
  const disp = fmtQty(dispatchPendingQty);

  const Tag = "div" as const;
  const Outer = Tag;
  const Panel = Tag;
  const Row = Tag;
  const Metrics = Tag;

  return (
    <Outer className={cn(compact ? "space-y-0.5" : "space-y-1", className)}>
      <Panel
        className={cn(
          "rounded-md border border-slate-200/90 bg-gradient-to-r from-slate-50/95 to-white shadow-sm",
          compact ? "px-2 py-1" : "px-2.5 py-1.5",
        )}
        role="region"
        aria-label="NO_QTY cycle context"
      >
        <Row className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-violet-800">NO_QTY</span>
          <span className="font-mono text-[12px] font-bold tabular-nums text-slate-900">
            {displaySalesOrderNo(soId, soDocNo ?? null)}
          </span>
          {customerName ? (
            <>
              <span className="text-slate-300" aria-hidden>
                ·
              </span>
              <span className="max-w-[14rem] truncate text-[11px] font-medium text-slate-700">{customerName}</span>
            </>
          ) : null}
          <span className="text-slate-300" aria-hidden>
            ·
          </span>
          <span className="text-[11px] font-semibold text-slate-800">
            Cycle {cycleNo != null && Number.isFinite(Number(cycleNo)) ? Number(cycleNo) : "—"}
          </span>
          {itemName ? (
            <>
              <span className="text-slate-300" aria-hidden>
                ·
              </span>
              <span className="max-w-[16rem] truncate text-[11px] font-medium text-slate-800">{itemName}</span>
            </>
          ) : null}
        </Row>
        <Metrics className={cn("flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-700", compact ? "mt-0.5" : "mt-1")}>
          {pending ? (
            <span>
              <span className="text-slate-500">Pending qty</span>{" "}
              <span className="font-semibold tabular-nums text-slate-900">{pending}</span>
            </span>
          ) : null}
          {newReq ? (
            <span>
              <span className="text-slate-500">New requirement</span>{" "}
              <span className="font-semibold tabular-nums text-slate-900">{newReq}</span>
            </span>
          ) : null}
          {totalProd ? (
            <span>
              <span className="text-slate-500">Planned qty</span>{" "}
              <span className="font-semibold tabular-nums text-slate-900">{totalProd}</span>
            </span>
          ) : null}
          {qc ? (
            <span>
              <span className="text-slate-500">Produced</span>{" "}
              <span className="font-semibold tabular-nums text-emerald-900">{qc}</span>
            </span>
          ) : null}
          {disp ? (
            <span>
              <span className="text-slate-500">Dispatch pending</span>{" "}
              <span className="font-semibold tabular-nums text-slate-900">{disp}</span>
            </span>
          ) : null}
        </Metrics>
      </Panel>
      <NoQtyErpPlanningAuditDetail qty={erpQty} />
    </Outer>
  );
}
