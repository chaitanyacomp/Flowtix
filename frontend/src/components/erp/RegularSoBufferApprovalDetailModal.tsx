/**
 * Admin review for REGULAR_SO production buffer approval (Pending Actions deep link).
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ApiRequestError } from "../../services/api";
import {
  approveRegularSoBufferApproval,
  fetchRegularSoBufferApprovalDetail,
  rejectRegularSoBufferApproval,
  type RegularSoBufferApprovalDetail,
} from "../../lib/regularSoBufferApprovalApi";
import { ErpModal } from "./ErpModal";
import { useToast } from "../../contexts/ToastContext";

type ViewState = "loading" | "error" | "ready";

type Props = {
  open: boolean;
  bufferApprovalId: number | null;
  onClose: () => void;
  onDecided: () => void;
};

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiRequestError) return e.message || fallback;
  if (e instanceof Error) return e.message || fallback;
  return fallback;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-slate-100 py-1.5 last:border-b-0">
      <dt className="text-[12px] font-medium text-slate-600">{label}</dt>
      <dd className="text-[13px] font-medium text-slate-900">{value}</dd>
    </div>
  );
}

export function RegularSoBufferApprovalDetailModal({
  open,
  bufferApprovalId,
  onClose,
  onDecided,
}: Props) {
  const toast = useToast();
  const [viewState, setViewState] = React.useState<ViewState>("loading");
  const [detail, setDetail] = React.useState<RegularSoBufferApprovalDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState<"approve" | "reject" | null>(null);
  const [rejecting, setRejecting] = React.useState(false);
  const [adminRemarks, setAdminRemarks] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setViewState("loading");
      setDetail(null);
      setError(null);
      setSubmitting(null);
      setRejecting(false);
      setAdminRemarks("");
      return;
    }
    if (!bufferApprovalId) return;

    let cancelled = false;
    setViewState("loading");
    setError(null);
    setDetail(null);

    fetchRegularSoBufferApprovalDetail(bufferApprovalId)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setViewState("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = errorMessage(e, "Failed to load the production buffer approval request.");
        setError(msg);
        setViewState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [open, bufferApprovalId]);

  async function onApprove() {
    if (!bufferApprovalId || submitting) return;
    setSubmitting("approve");
    setError(null);
    try {
      await approveRegularSoBufferApproval(bufferApprovalId, adminRemarks.trim() || undefined);
      toast.showSuccess("Production buffer request approved.");
      onDecided();
      onClose();
    } catch (e) {
      const msg = errorMessage(e, "Failed to approve the request.");
      setError(msg);
      toast.showError(msg);
    } finally {
      setSubmitting(null);
    }
  }

  async function onConfirmReject() {
    if (!bufferApprovalId || submitting) return;
    const remarks = adminRemarks.trim();
    if (!remarks) {
      toast.showError("Admin remarks are required when rejecting.");
      return;
    }
    setSubmitting("reject");
    setError(null);
    try {
      await rejectRegularSoBufferApproval(bufferApprovalId, remarks);
      toast.showSuccess("Production buffer request rejected.");
      onDecided();
      onClose();
    } catch (e) {
      const msg = errorMessage(e, "Failed to reject the request.");
      setError(msg);
      toast.showError(msg);
    } finally {
      setSubmitting(null);
    }
  }

  if (!open) return null;

  const busy = submitting != null;
  const pending = detail?.status === "PENDING_APPROVAL";

  const overlay = (
    <ErpModal
      onClose={onClose}
      backdropClassName="items-center"
      aria-labelledby="regular-so-buffer-approval-title"
      escapeDisabled={() => busy}
    >
      <Card className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden shadow-lg">
        <CardHeader className="flex flex-row items-start justify-between gap-2 border-b border-slate-100 py-3">
          <div>
            <CardTitle id="regular-so-buffer-approval-title" className="text-base font-semibold text-slate-900">
              Production Buffer Approval
            </CardTitle>
            <p className="mt-0.5 text-xs text-slate-600">
              {detail?.salesOrderNo ? `${detail.salesOrderNo} · ` : ""}
              {detail?.fgItemName ?? "Loading…"}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} disabled={busy}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto py-3">
          {viewState === "loading" ? (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-600">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-slate-500" aria-hidden />
              Loading request…
            </div>
          ) : null}

          {viewState === "error" ? (
            <div className="rounded-md border-2 border-red-300 bg-red-50 px-4 py-3 text-red-950" role="alert">
              <p className="text-sm font-semibold leading-snug">Could not load request</p>
              {error ? <p className="mt-1.5 text-sm leading-snug text-red-900">{error}</p> : null}
            </div>
          ) : null}

          {viewState === "ready" && detail ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <Badge
                  variant={
                    detail.status === "PENDING_APPROVAL"
                      ? "warning"
                      : detail.status === "APPROVED"
                        ? "success"
                        : detail.status === "REJECTED"
                          ? "rejected"
                          : "default"
                  }
                >
                  {detail.status.replace(/_/g, " ")}
                </Badge>
                {detail.requestNo ? (
                  <span className="text-[11px] font-medium text-slate-500">{detail.requestNo}</span>
                ) : null}
              </div>

              <dl className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-1">
                <DetailRow label="Sales Order" value={detail.salesOrderNo ?? `SO-${detail.salesOrderId}`} />
                <DetailRow label="Finished Good" value={detail.fgItemName ?? "—"} />
                <DetailRow label="Buffer %" value={`${detail.bufferPercent}%`} />
                <DetailRow label="Planned WO qty" value={detail.plannedProductionQty} />
                <DetailRow label="Store reason" value={detail.storeReason || "—"} />
                <DetailRow label="Requested by" value={detail.requestedByName ?? "—"} />
                <DetailRow label="Requested at" value={fmtDateTime(detail.requestedAt)} />
                {detail.reviewedAt ? (
                  <DetailRow label="Reviewed at" value={fmtDateTime(detail.reviewedAt)} />
                ) : null}
                {detail.adminRemarks ? <DetailRow label="Admin remarks" value={detail.adminRemarks} /> : null}
                {detail.rejectionReason ? (
                  <DetailRow label="Rejection reason" value={detail.rejectionReason} />
                ) : null}
              </dl>

              {error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
                  {error}
                </div>
              ) : null}

              {pending ? (
                <div className="space-y-2">
                  <label htmlFor="buffer-admin-remarks" className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Admin remarks{rejecting ? " (required)" : " (optional on approve)"}
                  </label>
                  <textarea
                    id="buffer-admin-remarks"
                    className="min-h-[3rem] w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                    value={adminRemarks}
                    disabled={busy}
                    onChange={(e) => setAdminRemarks(e.target.value)}
                    placeholder={rejecting ? "Required when rejecting" : "Optional note when approving"}
                  />
                  {!rejecting ? (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" disabled={busy} onClick={() => void onApprove()}>
                        {submitting === "approve" ? "Approving…" : "Approve"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setRejecting(true)}
                      >
                        Reject…
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busy || !adminRemarks.trim()}
                        onClick={() => void onConfirmReject()}
                      >
                        {submitting === "reject" ? "Rejecting…" : "Confirm Reject"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setRejecting(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
    </ErpModal>
  );

  return createPortal(overlay, document.body);
}
