import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/button";
import { navigateToWorkQueueIndex, type WorkQueueContext } from "../../lib/workQueueContext";
import { cn } from "../../lib/utils";

export function SalesBillWorkQueueBar({
  workQueue,
  className,
}: {
  workQueue: WorkQueueContext;
  className?: string;
}) {
  const navigate = useNavigate();
  const total = workQueue.queueItems.length;
  const index = workQueue.currentIndex;
  const current = workQueue.queueItems[index];
  const canPrev = index > 0;
  const canNext = index < total - 1;

  if (total <= 1) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200 bg-sky-50/80 px-3 py-2",
        className,
      )}
      data-testid="sales-bill-work-queue-bar"
    >
      <div className="min-w-0 text-[12px] text-sky-950">
        <span className="font-medium">Pending Actions queue</span>
        {current?.documentNo ? (
          <span className="ml-2 font-mono tabular-nums text-sky-900">{current.documentNo}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-[11px]"
          disabled={!canPrev}
          data-testid="sales-bill-work-queue-prev"
          onClick={() => navigateToWorkQueueIndex(navigate, workQueue, index - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          Previous
        </Button>
        <span className="px-1 text-[11px] font-medium tabular-nums text-sky-900" data-testid="sales-bill-work-queue-position">
          Document {index + 1} of {total}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-[11px]"
          disabled={!canNext}
          data-testid="sales-bill-work-queue-next"
          onClick={() => navigateToWorkQueueIndex(navigate, workQueue, index + 1)}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
