import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/button";
import { displayDispatchNo, displaySalesOrderNo } from "../../lib/docNoDisplay";
import { navigateToWorkQueueIndex, type WorkQueueContext } from "../../lib/workQueueContext";
import { cn } from "../../lib/utils";

export function SalesBillWorkQueueHeader({
  workQueue,
  salesOrderId,
  salesOrderDocNo,
  dispatchId,
  dispatchDocNo,
  className,
}: {
  workQueue: WorkQueueContext;
  salesOrderId?: number;
  salesOrderDocNo?: string | null;
  dispatchId?: number;
  dispatchDocNo?: string | null;
  className?: string;
}) {
  const navigate = useNavigate();
  const total = workQueue.queueItems.length;
  const index = workQueue.currentIndex;
  const current = workQueue.queueItems[index];
  const canPrev = index > 0;
  const canNext = index < total - 1;

  if (total <= 1) return null;

  const soLabel =
    salesOrderId && salesOrderId > 0 ? displaySalesOrderNo(salesOrderId, salesOrderDocNo) : null;
  const dispatchLabel =
    dispatchId && dispatchId > 0 ? displayDispatchNo(dispatchId, dispatchDocNo) : null;

  return (
    <div
      className={cn(
        "rounded-lg border border-sky-200 bg-gradient-to-r from-sky-50 to-sky-50/40 px-4 py-3 shadow-sm",
        className,
      )}
      data-testid="sales-bill-work-queue-header"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-800">Create Sales Bills</div>
          <div className="text-sm font-semibold text-sky-950" data-testid="sales-bill-work-queue-position">
            Document {index + 1} of {total}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-sky-900">
            {soLabel ? <span className="font-mono font-medium tabular-nums">{soLabel}</span> : null}
            {dispatchLabel ? (
              <span className="text-sky-700">
                Dispatch <span className="font-mono font-medium tabular-nums text-sky-950">{dispatchLabel}</span>
              </span>
            ) : current?.documentNo ? (
              <span className="font-mono tabular-nums text-sky-900">{current.documentNo.split(" · ")[0]}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1 bg-white px-3 text-xs"
            disabled={!canPrev}
            data-testid="sales-bill-work-queue-prev"
            onClick={() => navigateToWorkQueueIndex(navigate, workQueue, index - 1)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Previous
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1 bg-white px-3 text-xs"
            disabled={!canNext}
            data-testid="sales-bill-work-queue-next"
            onClick={() => navigateToWorkQueueIndex(navigate, workQueue, index + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
