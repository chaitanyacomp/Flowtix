import { useNavigate } from "react-router-dom";
import { Button } from "../ui/button";
import { ErpModal } from "../erp/ErpModal";
import {
  navigateOpenNextWorkQueueItem,
  type WorkQueueContext,
} from "../../lib/workQueueContext";

export function SalesBillExportQueuePrompt({
  open,
  workQueue,
  remainingCount,
  onClose,
}: {
  open: boolean;
  workQueue: WorkQueueContext;
  remainingCount: number;
  onClose: () => void;
}) {
  const navigate = useNavigate();

  if (!open) return null;

  return (
    <ErpModal onClose={onClose} backdropClassName="bg-black/30" aria-label="Export complete">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-semibold text-slate-900">Tally XML downloaded</div>
          <p className="mt-1 text-xs text-slate-600">
            Marked exported in ERP. Import the XML in Tally to post the voucher
            {remainingCount > 0
              ? `. Remaining pending bills: ${remainingCount}`
              : ". All pending bills in this queue are complete."}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            className="h-8 text-xs"
            data-testid="sales-bill-export-queue-back-pending"
            onClick={() => {
              onClose();
              navigate("/pending-actions", { replace: true });
            }}
          >
            Back to Pending Actions
          </Button>
          {remainingCount > 0 ? (
            <Button
              type="button"
              className="h-8 text-xs"
              data-testid="sales-bill-export-queue-open-next"
              onClick={() => {
                onClose();
                navigateOpenNextWorkQueueItem(navigate, workQueue);
              }}
            >
              Next Pending Bill
            </Button>
          ) : null}
        </div>
      </div>
    </ErpModal>
  );
}
