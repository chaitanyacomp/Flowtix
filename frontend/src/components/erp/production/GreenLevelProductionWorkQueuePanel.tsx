import { Button } from "../../ui/button";

import { cn } from "../../../lib/utils";

import type { GreenLevelProductionQueueRow } from "../../../lib/greenLevelProductionExecution";



type Props = {

  rows: GreenLevelProductionQueueRow[];

  selectedLineId: number;

  onRowAction: (row: GreenLevelProductionQueueRow) => void;

  fmtProdQty: (value: number) => string;

  containedScroll?: boolean;

  className?: string;

  variant?: "primary" | "secondary";

  title?: string;

  /** WO · Item · Remaining · Status · Action only */

  operatorQueueColumns?: boolean;

};



function QueueTable({

  rows,

  selectedLineId,

  onRowAction,

  fmtProdQty,

  compact,

  containedScroll = true,

  operatorQueueColumns = false,

}: {

  rows: GreenLevelProductionQueueRow[];

  selectedLineId: number;

  onRowAction: (row: GreenLevelProductionQueueRow) => void;

  fmtProdQty: (value: number) => string;

  compact?: boolean;

  containedScroll?: boolean;

  operatorQueueColumns?: boolean;

}) {

  return (

    <div

      className={cn(

        "overflow-auto rounded-md border border-slate-200/90 bg-white",

        containedScroll && (compact ? "max-h-[min(22vh,200px)]" : "max-h-[min(36vh,280px)]"),

      )}

    >

      <table className="w-full table-fixed text-[11px]">

        <thead className="sticky top-0 z-[2] border-b border-slate-200 bg-slate-50">

          <tr className="text-left text-[10px] text-slate-600">

            <th className="w-[5.5rem] px-2 py-0.5 font-medium">WO</th>

            <th className="px-2 py-0.5 font-medium">Item</th>

            {operatorQueueColumns ? (

              <>

                <th className="w-16 px-2 py-0.5 text-right font-medium">Remaining</th>

                <th className="w-[4.5rem] px-2 py-0.5 font-medium">Status</th>

              </>

            ) : (

              <>

                <th className="w-16 px-2 py-0.5 text-right font-medium">Planned</th>

                <th className="w-16 px-2 py-0.5 text-right font-medium">Produced</th>

                <th className="w-16 px-2 py-0.5 text-right font-medium">Balance</th>

                <th className="w-[5.5rem] px-2 py-0.5 font-medium">Status</th>

              </>

            )}

            <th className="w-[4.5rem] px-1 py-0.5 text-right font-medium">Action</th>

          </tr>

        </thead>

        <tbody>

          {rows.map((row) => {

            const selected = selectedLineId === row.workOrderLineId;

            return (

              <tr

                key={`${row.workOrderId}-${row.workOrderLineId}`}

                className={cn(

                  "border-t border-slate-100",

                  selected && "bg-emerald-50/90 ring-1 ring-inset ring-emerald-200/80",

                  row.action === "waiting_qa" && !selected && "bg-amber-50/50",

                  row.readOnly && row.action === "view" && !selected && "text-slate-600",

                )}

              >

                <td className="px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-slate-900">

                  {row.woLabel}

                </td>

                <td className="truncate px-2 py-0.5 font-medium text-slate-800" title={row.itemName}>

                  {row.itemName}

                </td>

                {operatorQueueColumns ? (

                  <>

                    <td className="px-2 py-0.5 text-right font-semibold tabular-nums">

                      {fmtProdQty(row.balanceQty)}

                    </td>

                    <td className="px-2 py-0.5 text-[10px] font-medium text-slate-700">{row.statusLabel}</td>

                  </>

                ) : (

                  <>

                    <td className="px-2 py-0.5 text-right tabular-nums">{fmtProdQty(row.plannedQty)}</td>

                    <td className="px-2 py-0.5 text-right tabular-nums">{fmtProdQty(row.producedQty)}</td>

                    <td className="px-2 py-0.5 text-right font-semibold tabular-nums">{fmtProdQty(row.balanceQty)}</td>

                    <td className="px-2 py-0.5 text-[11px] font-medium text-slate-700">{row.statusLabel}</td>

                  </>

                )}

                <td className="px-1 py-0.5 text-right">

                  <Button

                    type="button"

                    variant={selected ? "default" : "outline"}

                    size="sm"

                    className="h-6 px-1.5 text-[10px] font-semibold"

                    onClick={() => onRowAction(row)}

                    aria-label={`${row.actionLabel} ${row.woLabel} · ${row.itemName}`}

                  >

                    {row.action === "waiting_qa" && selected ? "Waiting for QA" : row.actionLabel}

                  </Button>

                </td>

              </tr>

            );

          })}

        </tbody>

      </table>

    </div>

  );

}



export function GreenLevelProductionWorkQueuePanel({

  rows,

  selectedLineId,

  onRowAction,

  fmtProdQty,

  className,

  variant = "primary",

  title,

  containedScroll = true,

  operatorQueueColumns = false,

}: Props) {

  if (rows.length === 0) {

    if (variant === "secondary") return null;

    return (

      <div

        className={cn(

          "rounded-lg border border-dashed border-emerald-200/90 bg-emerald-50/40 px-4 py-3",

          className,

        )}

        data-testid="green-level-production-work-queue-empty"

      >

        <p className="text-[13px] font-medium leading-snug text-emerald-950">No Green Level work orders in queue.</p>

      </div>

    );

  }



  const heading = title ?? (variant === "secondary" ? "Other Open WOs" : "Green Level work orders");

  const helper = variant === "secondary" ? "Switch work order" : "Stock replenishment · select a row to continue";

  const useOperatorColumns = operatorQueueColumns || variant === "secondary";



  return (

    <div className={cn("space-y-1", className)} data-testid="green-level-production-work-queue">

      <div className="flex flex-wrap items-baseline justify-between gap-2">

        <h3

          className={cn(

            "font-semibold uppercase tracking-wide text-emerald-900",

            variant === "secondary" ? "text-[10px] text-slate-600" : "text-[11px]",

          )}

        >

          {heading}

        </h3>

        <span className="text-[10px] text-slate-500">{helper}</span>

      </div>

      <QueueTable

        rows={rows}

        selectedLineId={selectedLineId}

        onRowAction={onRowAction}

        fmtProdQty={fmtProdQty}

        compact={variant === "secondary"}

        containedScroll={containedScroll}

        operatorQueueColumns={useOperatorColumns}

      />

    </div>

  );

}

