import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { ErpModal } from "../erp/ErpModal";

type Props = {
  open: boolean;
  count: number;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function BulkDeleteConfirmModal({ open, count, loading, onCancel, onConfirm }: Props) {
  return (
    <ErpModal open={open} onClose={onCancel} aria-label="Confirm bulk delete">
      <Card className="erp-modal-shell w-[calc(100vw-2rem)] max-w-[520px] overflow-hidden">
        <CardContent className="p-4">
          <div className="text-base font-semibold text-slate-900">Delete {count} selected records?</div>
          <div className="mt-1 text-sm text-slate-600">This action cannot be undone.</div>
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
