/**
 * Step 4B — Controlled reopen request / decision panel.
 */
import * as React from "react";
import { Button } from "../../ui/button";
import { ErpModal } from "../ErpModal";
import {
  approveShiftReopen,
  denyShiftReopen,
  requestShiftReopen,
  type ShiftCapabilities,
  type ShiftReopenRequest,
  type ShiftSessionDetail,
} from "../../../lib/machineShiftSessionApi";
import {
  canShowManagerControls,
  formatIndiaDateTime,
  mapShiftApiError,
} from "../../../lib/machineShiftSessionUi";

type Props = {
  session: ShiftSessionDetail;
  caps: ShiftCapabilities | null;
  busy: boolean;
  onBusy: (v: boolean) => void;
  onNotice: (msg: string | null) => void;
  onRefresh: () => Promise<void>;
  onReopened: (sessionId: number) => void;
};

function statusLabel(s: string) {
  const u = String(s).toUpperCase();
  if (u === "REQUESTED") return "Requested";
  if (u === "APPROVED") return "Approved";
  if (u === "DENIED") return "Denied";
  return u || "—";
}

export function ShiftReopenPanel({
  session,
  caps,
  busy,
  onBusy,
  onNotice,
  onRefresh,
  onReopened,
}: Props) {
  const showManager = canShowManagerControls(caps);
  const requests = session.reopenRequests ?? [];
  const pending = requests.find((r) => String(r.status).toUpperCase() === "REQUESTED") ?? null;

  const [reason, setReason] = React.useState("");
  const [denyOpen, setDenyOpen] = React.useState(false);
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [denyNote, setDenyNote] = React.useState("");
  const [target, setTarget] = React.useState<ShiftReopenRequest | null>(null);

  async function requestReopen() {
    if (busy || !reason.trim()) return;
    onBusy(true);
    onNotice(null);
    try {
      await requestShiftReopen(session.id, { reopenReason: reason.trim() });
      setReason("");
      onNotice("Reopen requested.");
      await onRefresh();
    } catch (e) {
      onNotice(mapShiftApiError(e));
    } finally {
      onBusy(false);
    }
  }

  async function doApprove() {
    if (busy || !target) return;
    onBusy(true);
    try {
      await approveShiftReopen(target.id);
      setApproveOpen(false);
      setTarget(null);
      onNotice("Shift reopened. Production quantities are unlocked for the new draft.");
      await onRefresh();
      onReopened(session.id);
    } catch (e) {
      onNotice(mapShiftApiError(e));
    } finally {
      onBusy(false);
    }
  }

  async function doDeny() {
    if (busy || !target || !denyNote.trim()) return;
    onBusy(true);
    try {
      await denyShiftReopen(target.id, { decisionNote: denyNote.trim() });
      setDenyOpen(false);
      setDenyNote("");
      setTarget(null);
      onNotice("Reopen request denied.");
      await onRefresh();
    } catch (e) {
      onNotice(mapShiftApiError(e));
    } finally {
      onBusy(false);
    }
  }

  if (String(session.status).toUpperCase() !== "SHIFT_OVER") return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="shift-reopen-panel">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Controlled reopen</h2>
      <p className="mt-1 text-[12px] text-slate-500">
        Reopening is allowed only before the next shift starts on this machine.
      </p>

      {!pending ? (
        <div className="mt-3 space-y-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">Reason</span>
            <textarea
              className="min-h-[72px] rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={reason}
              disabled={busy}
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <Button type="button" disabled={busy || !reason.trim()} onClick={() => void requestReopen()}>
            Request Reopen
          </Button>
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <div className="font-semibold">Reopen requested</div>
          <p className="mt-0.5">{pending.reopenReason}</p>
          <p className="mt-1 text-[12px]">
            Requested {formatIndiaDateTime(pending.requestedAt)}
            {pending.requestedByName ? ` · ${pending.requestedByName}` : ""}
          </p>
          {showManager ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setTarget(pending);
                  setApproveOpen(true);
                }}
              >
                Approve
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setTarget(pending);
                  setDenyOpen(true);
                }}
              >
                Deny
              </Button>
            </div>
          ) : (
            <p className="mt-1 text-[12px]">Waiting for manager decision.</p>
          )}
        </div>
      )}

      {requests.length ? (
        <ul className="mt-3 space-y-1 text-xs text-slate-600">
          {requests
            .slice()
            .reverse()
            .map((r) => (
              <li key={r.id} className="rounded border border-slate-100 bg-slate-50 px-2 py-1">
                <span className="font-medium text-slate-800">{statusLabel(r.status)}</span>
                {" · "}
                {formatIndiaDateTime(r.requestedAt)}
                {r.requestedByName ? ` · ${r.requestedByName}` : ""}
                {r.decisionNote ? ` · Note: ${r.decisionNote}` : ""}
                {r.decidedAt ? ` · Decided ${formatIndiaDateTime(r.decidedAt)}` : ""}
                {r.decidedByName ? ` · ${r.decidedByName}` : ""}
              </li>
            ))}
        </ul>
      ) : null}

      <ErpModal
        open={approveOpen}
        onClose={() => !busy && setApproveOpen(false)}
        escapeDisabled={() => busy}
        aria-labelledby="shift-reopen-approve-title"
        className="items-start justify-center pt-8"
      >
        <div className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
          <h3 id="shift-reopen-approve-title" className="text-lg font-semibold">
            Approve reopen?
          </h3>
          <p className="mt-2 text-sm text-slate-700">
            Reopen this shift and create a new editable Shift Report draft. The previous verified report stays in
            history.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setApproveOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy} onClick={() => void doApprove()}>
              {busy ? "Approving…" : "Approve reopen"}
            </Button>
          </div>
        </div>
      </ErpModal>

      <ErpModal
        open={denyOpen}
        onClose={() => !busy && setDenyOpen(false)}
        escapeDisabled={() => busy}
        aria-labelledby="shift-reopen-deny-title"
        className="items-start justify-center pt-8"
      >
        <div className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
          <h3 id="shift-reopen-deny-title" className="text-lg font-semibold">
            Deny reopen
          </h3>
          <label className="mt-3 grid gap-1 text-sm">
            <span className="font-medium">Decision note</span>
            <textarea
              className="min-h-[80px] rounded-md border border-slate-200 px-3 py-2"
              value={denyNote}
              disabled={busy}
              maxLength={2000}
              onChange={(e) => setDenyNote(e.target.value)}
            />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDenyOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy || !denyNote.trim()} onClick={() => void doDeny()}>
              Deny
            </Button>
          </div>
        </div>
      </ErpModal>
    </section>
  );
}
