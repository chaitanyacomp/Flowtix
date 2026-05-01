import { Button } from "../ui/button";

type Props = {
  selectedCount: number;
  onClear: () => void;
  onDeleteClick: () => void;
  disabled?: boolean;
};

/** Consistent top bar for master list bulk actions */
export function BulkSelectionToolbar({ selectedCount, onClear, onDeleteClick, disabled }: Props) {
  if (selectedCount <= 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
      <div className="text-slate-800">
        <span className="font-semibold tabular-nums">{selectedCount}</span> selected
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={onClear} disabled={disabled}>
          Clear
        </Button>
        <Button type="button" variant="destructive" size="sm" className="h-9" onClick={onDeleteClick} disabled={disabled}>
          Delete Selected
        </Button>
      </div>
    </div>
  );
}
