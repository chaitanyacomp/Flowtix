import * as React from "react";
import { ErpModal } from "../ErpModal";
import { Button } from "../../ui/button";
import { cancelShiftSession } from "../../../lib/machineShiftSessionApi";
import { mapShiftApiError } from "../../../lib/machineShiftSessionUi";

type Props = {
  open: boolean;
  sessionId: number;
  shiftSessionNo?: string | null;
  onClose: () => void;
  onCancelled: () => void;
};

export function CancelShiftModal({ open, sessionId, shiftSessionNo, onClose, onCancelled }: Props) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setReason("");
    setBusy(false);
    setNotice(null);
    setConfirming(false);
  }, [open]);

  const canProceed = reason.trim().length > 0 && !busy;

  async function doCancel() {
    if (!canProceed) return;
    setBusy(true);
    setNotice(null);
    try {
      await cancelShiftSession(sessionId, { reason: reason.trim() });
      onCancelled();
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
      aria-labelledby="cancel-shift-title"
      className="items-start justify-center pt-4 sm:pt-8"
    >
      <div className="mx-auto w-full max-w-lg overflow-hidden rounded-lg border border-rose-200 bg-white p-5 shadow-xl">
        <h2 id="cancel-shift-title" className="text-lg font-semibold text-slate-900">
          Cancel Shift
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Use this only when the shift was started by mistake
          {shiftSessionNo ? (
            <>
              {" "}
              (<span className="font-medium">{shiftSessionNo}</span>)
            </>
          ) : null}
          . This is not for a legitimate zero-production shift.
        </p>

        <div
          className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900"
          role="status"
        >
          Cancelling permanently closes this session. The machine and operators become available again.
          You cannot undo this from Shift Production.
        </div>

        {!confirming ? (
          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Cancellation reason (required)</span>
              <textarea
                className="min-h-[88px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
                maxLength={2000}
                placeholder="e.g. Started on the wrong machine"
              />
            </label>
            {notice ? (
              <p className="text-sm text-rose-700" role="alert">
                {notice}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                Keep shift
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!canProceed}
                onClick={() => setConfirming(true)}
              >
                Continue
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-700">
              Confirm cancellation of this mistaken shift? The original start will remain in history for
              audit, but the session cannot be reopened.
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
              <Button type="button" variant="destructive" disabled={busy} onClick={() => void doCancel()}>
                {busy ? "Cancelling…" : "Cancel Shift"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ErpModal>
  );
}
