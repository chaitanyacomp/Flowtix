import { cn } from "../../lib/utils";
import { formatRmQty } from "../../lib/rmQtyDisplay";
import {
  rmLineDisplayStatus,
  rmLineStatusChipClass,
  type RmLineDisplayStatus,
} from "../../lib/woPrepareWorkflowGuidance";

type RmRow = {
  rmItemId: number;
  itemName: string;
  unit?: string;
  requiredQty: number;
  availableQty: number;
  shortage: number;
  shortageQty?: number;
};

type Props = {
  rows: RmRow[];
  hasPendingMr: boolean;
  canCreateWorkOrder: boolean;
  extraFgLines?: Array<{
    fgName: string;
    customerCommittedQty?: number;
    orderQty: number;
    productionBufferPercent?: number;
    productionBufferQty?: number;
    plannedProductionQty?: number;
    fgStockAdjustmentQty?: number;
    fgStock: number;
    rmPlanningQty?: number;
    toProduce: number;
    note?: string;
  }>;
};

export function WoPrepareRmReadinessTable({
  rows,
  hasPendingMr,
  canCreateWorkOrder,
  extraFgLines,
}: Props) {
  if (!rows.length && !extraFgLines?.length) {
    return <p className="text-xs text-slate-600">No RM demand for current production quantities.</p>;
  }

  return (
    <div className="space-y-1.5">
      {rows.length > 0 ? (
        <div>
          <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">RM readiness</div>
          <table className="w-full table-fixed text-[12px]">
            <thead>
              <tr className="border-b border-slate-300 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                <th className="py-1 pr-2">RM item</th>
                <th className="w-[5.5rem] py-1 text-right">Required</th>
                <th className="w-[5.5rem] py-1 text-right">Available</th>
                <th className="w-[5.5rem] py-1 text-right">Shortage</th>
                <th className="w-[8.5rem] py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const shortage = Number(r.shortageQty ?? r.shortage) || 0;
                const lineStatus = rmLineDisplayStatus({
                  shortage,
                  available: Number(r.availableQty) || 0,
                  hasPendingMr,
                  canCreateWorkOrder,
                });
                return (
                  <tr
                    key={r.rmItemId}
                    className={cn(
                      "border-b border-slate-200/80",
                      lineStatus === "Blocked" && "bg-red-50",
                      lineStatus === "Partial" && "bg-amber-50/80",
                      lineStatus === "Waiting Procurement" && "bg-amber-50/60",
                    )}
                  >
                    <td className="truncate py-1 pr-2 font-medium text-slate-900" title={r.itemName}>
                      {r.itemName}
                    </td>
                    <td className="py-1 text-right tabular-nums text-slate-800">
                      {formatRmQty(r.requiredQty, r.unit)}
                    </td>
                    <td className="py-1 text-right tabular-nums text-slate-800">
                      {formatRmQty(r.availableQty, r.unit)}
                    </td>
                    <td className="py-1 text-right tabular-nums font-semibold text-red-700">
                      {formatRmQty(shortage, r.unit)}
                    </td>
                    <td className="py-1">
                      <StatusChip status={lineStatus} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {extraFgLines && extraFgLines.length > 0 ? (
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">Additional FG lines</div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-300 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                <th className="py-1">FG</th>
                <th className="py-1 text-right">Customer qty</th>
                <th className="py-1 text-right">Buffer %</th>
                <th className="py-1 text-right">Planned qty</th>
                <th className="py-1 text-right">FG stock</th>
                <th className="py-1 text-right">RM planning</th>
              </tr>
            </thead>
            <tbody>
              {extraFgLines.map((f) => (
                <tr key={f.fgName} className="border-b border-slate-200/80">
                  <td className="py-1 font-medium text-slate-900">{f.fgName}</td>
                  <td className="py-1 text-right tabular-nums">{f.customerCommittedQty ?? f.orderQty}</td>
                  <td className="py-1 text-right tabular-nums">{f.productionBufferPercent ?? 0}</td>
                  <td className="py-1 text-right tabular-nums">{f.plannedProductionQty ?? f.orderQty}</td>
                  <td className="py-1 text-right tabular-nums">{f.fgStock}</td>
                  <td className="py-1 text-right tabular-nums font-semibold">{f.rmPlanningQty ?? f.toProduce}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function StatusChip({ status }: { status: RmLineDisplayStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        rmLineStatusChipClass(status),
      )}
    >
      {status}
    </span>
  );
}
