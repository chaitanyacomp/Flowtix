import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { ErpModal } from "../erp/ErpModal";

type Props = {
  open: boolean;
  count: number;
  /** e.g. "customer" / "supplier" / "item" — used in confirmation copy */
  entityLabel?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function BulkDeleteConfirmModal({ open, count, entityLabel = "record", loading, onCancel, onConfirm }: Props) {
  const noun = count === 1 ? entityLabel : `${entityLabel}s`;
  return (
    <ErpModal open={open} onClose={onCancel} aria-label="Confirm bulk delete">
      <Card className="erp-modal-shell w-[calc(100vw-2rem)] max-w-[520px] overflow-hidden">
        <CardContent className="p-4">
          <div className="text-base font-semibold text-slate-900">
            Permanently delete {count} {noun}?
          </div>
          <div className="mt-1 text-sm text-slate-600">
            This cannot be undone. Records referenced by orders, stock, BOM, production, or billing will be kept and
            reported as blocked.
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={onConfirm} disabled={loading}>
              {loading ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </ErpModal>
  );
}
