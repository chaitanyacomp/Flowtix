import * as React from "react";
import { ErpModal } from "../ErpModal";
import { Button } from "../../ui/button";
import { NativeSelect } from "../../ui/native-select";
import { completeShiftOver } from "../../../lib/machineShiftSessionApi";
import {
  HANDOVER_OPTIONS,
  mapShiftApiError,
  type HandoverStatusUi,
} from "../../../lib/machineShiftSessionUi";

type Props = {
  open: boolean;
  sessionId: number;
  hasOpenDowntime: boolean;
  onClose: () => void;
  onCompleted: () => void;
};

export function ShiftOverModal({ open, sessionId, hasOpenDowntime, onClose, onCompleted }: Props) {
  const [handoverStatus, setHandoverStatus] = React.useState<HandoverStatusUi | "">("");
  const [remarks, setRemarks] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setHandoverStatus("");
    setRemarks("");
    setBusy(false);
    setNotice(null);
    setConfirming(false);
  }, [open]);

  const selected = HANDOVER_OPTIONS.find((o) => o.value === handoverStatus);
  const remarksRequired = handoverStatus === "UNKNOWN";
  const canProceed =
    Boolean(handoverStatus) && (!remarksRequired || remarks.trim().length > 0) && !busy;

  async function doComplete() {
    if (!handoverStatus || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await completeShiftOver(sessionId, {
        handoverState: handoverStatus,
        handoverRemarks: remarks.trim() || null,
      });
      onCompleted();
      onClose();
    } catch (e) {
      setNotice(mapShiftApiError(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <ErpModal
      open={open}
      onClose={busy ? () => undefined : onClose}
      escapeDisabled={() => busy}
      aria-labelledby="shift-over-title"
      className="items-start justify-center pt-4 sm:pt-8"
    >
      <div className="mx-auto w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <h2 id="shift-over-title" className="text-lg font-semibold text-slate-900">
          Complete Shift Over
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Closes the shift after a verified Shift Report. The active production run will close during Shift Over.
        </p>

        {hasOpenDowntime ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
            Downtime will continue into the next shift until resumed.
          </p>
        ) : null}

        {!confirming ? (
          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Material / machine handover</span>
              <NativeSelect
                value={handoverStatus}
                onChange={(e) => setHandoverStatus(e.target.value as HandoverStatusUi | "")}
                disabled={busy}
              >
                <option value="">Select…</option>
                {HANDOVER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {selected ? <p className="text-xs text-slate-600">{selected.hint}</p> : null}
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Remarks{remarksRequired ? " (required)" : " (optional)"}
              </span>
              <textarea
                className="min-h-[72px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                disabled={busy}
                maxLength={2000}
              />
            </label>
            {notice ? (
              <p className="text-sm text-rose-700" role="alert">
                {notice}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" disabled={!canProceed} onClick={() => setConfirming(true)}>
                Continue
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-700">
              Confirm Shift Over with handover: <strong>{selected?.label}</strong>. This cannot be undone from
              this screen without a controlled reopen.
            </p>
            {notice ? (
              <p className="text-sm text-rose-700" role="alert">
                {notice}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
                Back
              </Button>
              <Button type="button" disabled={busy} onClick={() => void doComplete()}>
                {busy ? "Completing…" : "Complete Shift Over"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ErpModal>
  );
}
