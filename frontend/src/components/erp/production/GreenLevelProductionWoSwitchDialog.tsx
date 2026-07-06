import { Button } from "../../ui/button";
import { ErpModal } from "../ErpModal";

type Props = {
  open: boolean;
  woLabel: string;
  onCancel: () => void;
  onDiscard: () => void;
  onKeepDraft: () => void;
};

/** Warn before switching GL WO when production report has unsaved edits. */
export function GreenLevelProductionWoSwitchDialog({
  open,
  woLabel,
  onCancel,
  onDiscard,
  onKeepDraft,
}: Props) {
  if (!open) return null;

  return (
    <ErpModal onClose={onCancel} backdropClassName="bg-slate-950/40" aria-label="Unsaved production report">
      <div className="w-[min(24rem,calc(100vw-2rem))] space-y-3 p-4">
        <h2 className="text-[15px] font-semibold text-slate-900">Unsaved production report</h2>
        <p className="text-[13px] leading-snug text-slate-700">
          {woLabel} has production report or wastage classification changes that are not confirmed yet.
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onDiscard}>
            Discard
          </Button>
          <Button type="button" size="sm" onClick={onKeepDraft}>
            Keep draft & switch
          </Button>
        </div>
      </div>
    </ErpModal>
  );
}
