import * as React from "react";
import { ErpModal } from "../erp/ErpModal";
import { Button } from "../ui/button";
import { apiFetch } from "../../services/api";
import {
  type ProcurementShortClosePreview,
  shortCloseReasonLabel,
} from "../../lib/procurementShortClose";

type Props = {
  rmPoId: number;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function ShortCloseProcurementDialog({ rmPoId, open, onClose, onSuccess }: Props) {
  const [preview, setPreview] = React.useState<ProcurementShortClosePreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [remarks, setRemarks] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReason("");
    setRemarks("");
    void apiFetch<ProcurementShortClosePreview>(`/api/purchase/rm-pos/${rmPoId}/short-close-preview`)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load short close preview");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, rmPoId]);

  async function onSubmit() {
    if (!preview?.canShortClose || !reason.trim()) {
      setError("Select a reason before short closing procurement.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/purchase/rm-pos/${rmPoId}/short-close`, {
        method: "POST",
        body: JSON.stringify({
          reason: reason.trim(),
          remarks: remarks.trim() || null,
        }),
      });
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Short close failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const impact = preview?.impactSummary;

  return (
    <ErpModal onClose={onClose} aria-labelledby="procurement-short-close-title">
      <div className="erp-modal-shell w-full max-w-xl space-y-4 p-4">
        <div>
          <h2 id="procurement-short-close-title" className="text-base font-semibold text-slate-900">
            Short Close Procurement
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Intentionally close the remaining procurement balance. This does not create stock or change required
            quantity.
          </p>
        </div>

        {loading ? <p className="text-sm text-slate-600">Loading impact summary…</p> : null}
        {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p> : null}

        {preview && !loading ? (
          <>
            {preview.blockReason && !preview.canShortClose ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                {preview.blockReason}
              </p>
            ) : null}

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="mb-2 font-semibold text-slate-800">Impact summary</div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
                <dt className="text-slate-600">Required</dt>
                <dd>{impact?.totalRequired.toFixed(3)}</dd>
                <dt className="text-slate-600">Received</dt>
                <dd>{impact?.totalReceived.toFixed(3)}</dd>
                <dt className="text-slate-600">Short closed</dt>
                <dd>{impact?.totalShortClosed.toFixed(3)}</dd>
                <dt className="text-slate-600">Outstanding after close</dt>
                <dd>{impact?.totalOutstandingAfterClose.toFixed(3)}</dd>
              </dl>
            </div>

            {preview.lines.length > 0 ? (
              <div className="max-h-40 overflow-auto rounded-md border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-2 py-1">Item</th>
                      <th className="px-2 py-1 text-right">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.lines.map((line) => (
                      <tr key={line.rmPoLineId} className="border-t border-slate-100">
                        <td className="px-2 py-1">{line.itemName}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{line.outstandingQty.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="space-y-2">
              <label htmlFor="short-close-reason" className="text-[11px] font-medium text-slate-600">
                Reason *
              </label>
              <select
                id="short-close-reason"
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={!preview.canShortClose || submitting}
              >
                <option value="">Select reason</option>
                {(preview.reasons || []).map((r) => (
                  <option key={r} value={r}>
                    {shortCloseReasonLabel(r)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="short-close-remarks" className="text-[11px] font-medium text-slate-600">
                Remarks
              </label>
              <textarea
                id="short-close-remarks"
                className="min-h-[4.5rem] w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={3}
                disabled={!preview.canShortClose || submitting}
              />
            </div>
          </>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Continue Procurement
          </Button>
          <Button
            type="button"
            onClick={() => void onSubmit()}
            disabled={!preview?.canShortClose || !reason.trim() || submitting}
            data-testid="procurement-short-close-submit"
          >
            {submitting ? "Short closing…" : "Short Close Procurement"}
          </Button>
        </div>
      </div>
    </ErpModal>
  );
}
