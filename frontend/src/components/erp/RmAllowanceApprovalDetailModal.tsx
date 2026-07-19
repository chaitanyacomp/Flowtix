/**
 * Admin review for a single RM Allowance Approval request (Pending Actions deep link).
 * Compact inline detail panel — Approve, or Reject with a mandatory reason.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ApiRequestError } from "../../services/api";
import { formatRmQuantity } from "../../lib/quantityDisplay";
import {
  approveRmAllowanceApproval,
  fetchRmAllowanceApprovalDetail,
  rejectRmAllowanceApproval,
  type RmAllowanceApprovalDetail,
} from "../../lib/rmAllowanceApprovalApi";
import { ErpModal } from "./ErpModal";
import { useToast } from "../../contexts/ToastContext";

type ViewState = "loading" | "error" | "ready";

type Props = {
  open: boolean;
  allowanceApprovalId: number | null;
  onClose: () => void;
  /** Approve/reject completed — caller refreshes the pending actions list. */
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

export function RmAllowanceApprovalDetailModal({ open, allowanceApprovalId, onClose, onDecided }: Props) {
  const toast = useToast();
  const [viewState, setViewState] = React.useState<ViewState>("loading");
  const [detail, setDetail] = React.useState<RmAllowanceApprovalDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState<"approve" | "reject" | null>(null);
  const [rejecting, setRejecting] = React.useState(false);
  const [rejectionReason, setRejectionReason] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setViewState("loading");
      setDetail(null);
      setError(null);
      setSubmitting(null);
      setRejecting(false);
      setRejectionReason("");
      return;
    }
    if (!allowanceApprovalId) return;

    let cancelled = false;
    setViewState("loading");
    setError(null);
    setDetail(null);

    fetchRmAllowanceApprovalDetail(allowanceApprovalId)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setViewState("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = errorMessage(e, "Failed to load the RM allowance approval request.");
        setError(msg);
        setViewState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [open, allowanceApprovalId]);

  async function onApprove() {
    if (!allowanceApprovalId || submitting) return;
    setSubmitting("approve");
    setError(null);
    try {
      await approveRmAllowanceApproval(allowanceApprovalId);
      toast.showSuccess("RM allowance request approved.");
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
    if (!allowanceApprovalId || submitting) return;
    const reason = rejectionReason.trim();
    if (!reason) {
      toast.showError("Rejection reason is required.");
      return;
    }
    setSubmitting("reject");
    setError(null);
    try {
      await rejectRmAllowanceApproval(allowanceApprovalId, reason);
      toast.showSuccess("RM allowance request rejected.");
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
      aria-labelledby="rm-allowance-approval-title"
      escapeDisabled={() => busy}
    >
      <Card className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden shadow-lg">
        <CardHeader className="flex flex-row items-start justify-between gap-2 border-b border-slate-100 py-3">
          <div>
            <CardTitle id="rm-allowance-approval-title" className="text-base font-semibold text-slate-900">
              RM Allowance Approval
            </CardTitle>
            <p className="mt-0.5 text-xs text-slate-600">
              {detail?.workOrderNo ? `${detail.workOrderNo} · ` : ""}
              {detail?.itemName ?? "Loading…"}
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
            <div
              className="rounded-md border-2 border-red-300 bg-red-50 px-4 py-3 text-red-950"
              role="alert"
            >
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
                      : detail.status === "APPROVED" || detail.status === "ISSUED"
                        ? "success"
                        : detail.status === "REJECTED"
                          ? "rejected"
                          : "default"
                  }
                >
                  {detail.status.replace(/_/g, " ")}
                </Badge>
                {detail.requestNo ? (
                  <span className="text-[11px] text-slate-500">{detail.requestNo}</span>
                ) : null}
              </div>

              <dl className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1">
                <DetailRow label="Work Order" value={detail.workOrderNo ?? `WO-${detail.workOrderId}`} />
                <DetailRow label="PMR" value={detail.pmrDocNo ?? `PMR-${detail.productionMaterialRequestId}`} />
                {detail.salesOrderNo ? <DetailRow label="Sales Order" value={detail.salesOrderNo} /> : null}
                <DetailRow label="RM Item" value={detail.itemName ?? `Item #${detail.itemId}`} />
                <DetailRow
                  label="BOM Entitlement (remaining)"
                  value={formatRmQuantity(detail.applicableBomQty, detail.unit)}
                />
                <DetailRow
                  label="Already Issued"
                  value={formatRmQuantity(detail.alreadyIssuedQty, detail.unit)}
                />
                <DetailRow label="Add Qty" value={formatRmQuantity(detail.addQty, detail.unit)} />
                <DetailRow
                  label="Allowance %"
                  value={`${detail.allowancePct.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`}
                />
                <DetailRow label="Issue Now" value={formatRmQuantity(detail.issueQty, detail.unit)} />
                <DetailRow
                  label="Available Stock at Request"
                  value={
                    detail.availableQtyAtRequest == null
                      ? "—"
                      : formatRmQuantity(detail.availableQtyAtRequest, detail.unit)
                  }
                />
                <DetailRow label="Store Reason" value={detail.storeReason || "—"} />
                <DetailRow
                  label="Requested By"
                  value={`${detail.requestedByName ?? "—"} · ${fmtDateTime(detail.requestedAt)}`}
                />
                {detail.status !== "PENDING_APPROVAL" ? (
                  <DetailRow
                    label="Reviewed By"
                    value={`${detail.reviewedByName ?? "—"} · ${fmtDateTime(detail.reviewedAt)}`}
                  />
                ) : null}
                {detail.rejectionReason ? (
                  <DetailRow label="Rejection Reason" value={detail.rejectionReason} />
                ) : null}
              </dl>

              {!pending ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
                  This request is {detail.status.replace(/_/g, " ").toLowerCase()} and no longer awaiting review.
                </div>
              ) : null}

              {error ? (
                <div className="rounded-md border-2 border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-950">
                  {error}
                </div>
              ) : null}

              {pending && rejecting ? (
                <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
                  <label htmlFor="rm-allowance-reject-reason" className="text-[12px] font-medium text-red-900">
                    Rejection reason (required)
                  </label>
                  <textarea
                    id="rm-allowance-reject-reason"
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-red-300 bg-white px-2 py-1.5 text-[13px]"
                    placeholder="Explain why this allowance request is rejected…"
                    disabled={busy}
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRejecting(false);
                        setRejectionReason("");
                      }}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void onConfirmReject()}
                      disabled={busy || !rejectionReason.trim()}
                      className="bg-red-700 hover:bg-red-800"
                    >
                      {submitting === "reject" ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                          Rejecting…
                        </>
                      ) : (
                        "Confirm Reject"
                      )}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          <div className="mt-auto flex justify-end gap-2 border-t border-slate-100 pt-3">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Close
            </Button>
            {pending && !rejecting ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRejecting(true)}
                  disabled={busy}
                  className="border-red-300 text-red-800 hover:bg-red-50"
                >
                  Reject
                </Button>
                <Button type="button" size="sm" onClick={() => void onApprove()} disabled={busy}>
                  {submitting === "approve" ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                      Approving…
                    </>
                  ) : (
                    "Approve"
                  )}
                </Button>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </ErpModal>
  );

  if (typeof document === "undefined") return overlay;
  return createPortal(overlay, document.body);
}
