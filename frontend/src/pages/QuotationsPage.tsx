import * as React from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "../lib/utils";
import { buttonVariants } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch, getApiUrl } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../hooks/useAuth";
import { Download, Pencil, Trash2 } from "lucide-react";
import {
  type QuoteLineDraft,
  defaultQuoteLineDraft,
  draftLinesToApiPayload,
  lineTotalFromDraft,
  previewNum,
  validateQuoteLinesForSave,
} from "../lib/quotationLineDraft";

type Item = { id: number; itemName: string };
type Customer = { id: number; name: string };

type QRow = {
  id: number;
  quotationNo: string | null;
  enquiryId: number;
  workflowStatus: string;
  subtotal: string;
  gstTotal: string;
  totalAmount: string;
  terms: string | null;
  createdAt: string;
  salesOrder?: { id: number } | null;
  enquiry: { customer: Customer };
  lines: {
    id: number;
    itemId: number;
    qty: string;
    rate: string;
    discountPct: string;
    gstPct: string;
    lineTotal: string;
    isFree?: boolean;
    item: Item;
  }[];
};

type EnquiryOpt = {
  id: number;
  status: string;
  customer: Customer;
  lines: { itemId: number; item: Item; qty: string }[];
};

function lineTotal(qty: number, rate: number, discountPct: number, gstPct: number, isFree?: boolean) {
  const r = isFree ? 0 : rate;
  const base = qty * r * (1 - discountPct / 100);
  const gst = base * (gstPct / 100);
  return Math.round((base + gst) * 100) / 100;
}

function workflowBadgeVariant(ws: string): "default" | "success" | "rejected" {
  if (ws === "APPROVED") return "success";
  if (ws === "REJECTED") return "rejected";
  return "default";
}

function decisionSelectValue(ws: string): "" | "APPROVED" | "REJECTED" {
  return ws === "APPROVED" || ws === "REJECTED" ? ws : "";
}

function isApproved(ws: string) {
  return ws === "APPROVED";
}

function isLocked(ws: string) {
  return ws === "APPROVED" || ws === "REJECTED";
}

function canDeleteQuotation(ws: string) {
  return ws !== "APPROVED";
}

/** Only draft-like quotations can be edited; approved/rejected are locked. */
function canEditQuotation(ws: string) {
  return ws !== "APPROVED" && ws !== "REJECTED";
}

function editDisabledTitle(ws: string): string {
  if (ws === "APPROVED") return "Approved quotation cannot be edited";
  if (ws === "REJECTED") return "Rejected quotation cannot be edited";
  return "";
}

function QuotationNextStepCell({ r }: { r: QRow }) {
  if (r.salesOrder) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold tracking-tight text-emerald-900 ring-1 ring-emerald-200/90">
        Sales Order Created
      </span>
    );
  }
  if (r.workflowStatus === "REJECTED") {
    return <span className="text-sm font-medium text-slate-400">—</span>;
  }
  if (isApproved(r.workflowStatus)) {
    return <span className="text-sm text-slate-600">Pending SO creation</span>;
  }
  return (
    <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50/90 px-2.5 py-1 text-xs font-medium text-amber-950">
      Complete & Approve
    </span>
  );
}

async function downloadPdf(quotationId: number) {
  const token = localStorage.getItem("token");
  const res = await fetch(getApiUrl(`/api/quotations/${quotationId}/pdf`), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = "Could not generate PDF";
    const ct = res.headers.get("content-type");
    if (ct && ct.includes("application/json")) {
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        if (j?.error?.message) msg = j.error.message;
      } catch {
        /* ignore */
      }
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Quotation-${quotationId}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function QuotationsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const isAdmin = useAuth().user?.role === "ADMIN";
  const [searchParams] = useSearchParams();
  const preEnquiry = Number(searchParams.get("enquiryId")) || 0;

  const [items, setItems] = React.useState<Item[]>([]);
  const [rows, setRows] = React.useState<QRow[]>([]);
  const [feasibleEnquiries, setFeasibleEnquiries] = React.useState<EnquiryOpt[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const [quoteLines, setQuoteLines] = React.useState<QuoteLineDraft[]>([defaultQuoteLineDraft(0)]);
  const [terms, setTerms] = React.useState("");

  const [editQ, setEditQ] = React.useState<QRow | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = React.useState<number | null>(null);
  const [cancelApprovalOpen, setCancelApprovalOpen] = React.useState(false);
  const [cancelApprovalReason, setCancelApprovalReason] = React.useState("");
  const [cancelApprovalTarget, setCancelApprovalTarget] = React.useState<QRow | null>(null);
  const [listLoaded, setListLoaded] = React.useState(false);

  async function refresh() {
    try {
      const [i, q, enq] = await Promise.all([
        apiFetch<Item[]>("/api/items?type=FG"),
        apiFetch<QRow[]>("/api/quotations"),
        apiFetch<EnquiryOpt[]>("/api/enquiries"),
      ]);
      setItems(i);
      setRows(q);
      const feas = enq.filter((e) => e.status === "FEASIBLE" && !q.some((x) => x.enquiryId === e.id));
      setFeasibleEnquiries(feas);
    } finally {
      setListLoaded(true);
    }
  }

  React.useEffect(() => {
    if (preEnquiry) return;
    refresh().catch((err) => setError(err instanceof Error ? err.message : "Failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preEnquiry]);

  function openEdit(q: QRow) {
    if (!canEditQuotation(q.workflowStatus)) return;
    setEditQ(q);
    setQuoteLines(
      q.lines.map((l) => ({
        itemId: l.itemId,
        qty: String(l.qty),
        rate: String(l.rate),
        discountPct: String(l.discountPct),
        gstPct: String(l.gstPct),
        isFree: Boolean(l.isFree),
      })),
    );
    setTerms(q.terms ?? "");
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editQ) return;
    setError(null);
    const v = validateQuoteLinesForSave(quoteLines);
    if (v) {
      setError(v);
      toast.showError(v);
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/quotations/${editQ.id}`, {
        method: "PUT",
        body: JSON.stringify({
          terms: terms.trim() || null,
          lines: draftLinesToApiPayload(quoteLines),
        }),
      });
      setEditQ(null);
      await refresh();
      toast.showSuccess("Saved successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: number, workflowStatus: string) {
    const msg =
      workflowStatus === "REJECTED"
        ? "Are you sure you want to delete this rejected quotation?"
        : "Delete this quotation?";
    if (!confirm(msg)) return;
    try {
      await apiFetch(`/api/quotations/${id}`, { method: "DELETE" });
      await refresh();
      toast.showSuccess("Deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      toast.showError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function onPdf(id: number) {
    try {
      await downloadPdf(id);
    } catch (err) {
      const m = err instanceof Error ? err.message : "PDF failed";
      setError(m);
      toast.showError(m);
    }
  }

  async function onDecisionChange(id: number, value: string) {
    if (value !== "APPROVED" && value !== "REJECTED") return;
    setStatusUpdatingId(id);
    setError(null);
    try {
      await apiFetch(`/api/quotations/${id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status: value }),
      });
      await refresh();
      toast.showSuccess("Quotation status updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setStatusUpdatingId(null);
    }
  }

  function openCancelApproval(q: QRow) {
    if (!isAdmin) return;
    if (q.workflowStatus !== "APPROVED") return;
    setCancelApprovalTarget(q);
    setCancelApprovalReason("");
    setCancelApprovalOpen(true);
  }

  function closeCancelApproval() {
    setCancelApprovalOpen(false);
    setCancelApprovalReason("");
    setCancelApprovalTarget(null);
  }

  async function submitCancelApproval() {
    if (!isAdmin) return;
    if (!cancelApprovalTarget) return;
    if (cancelApprovalTarget.workflowStatus !== "APPROVED") return;
    const reason = cancelApprovalReason.trim();
    if (!reason) return;
    setStatusUpdatingId(cancelApprovalTarget.id);
    setError(null);
    try {
      await apiFetch(`/api/quotations/${cancelApprovalTarget.id}/cancel-approval`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      closeCancelApproval();
      await refresh();
      toast.showSuccess("Approval cancelled. You can now edit the quotation.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to cancel approval";
      setError(msg);
      toast.showError(msg);
    } finally {
      setStatusUpdatingId(null);
    }
  }

  if (preEnquiry) {
    return <Navigate to={`/quotations/new?enquiryId=${preEnquiry}`} replace />;
  }

  const hasApprovedPendingSo = rows.some((r) => isApproved(r.workflowStatus) && !r.salesOrder);

  const showEmptyStrip = listLoaded && rows.length === 0 && !error;
  /** Guidance only: at least one approved quotation still needs a Sales Order (row action). */
  const showQuotationConversionBanner = listLoaded && !showEmptyStrip && hasApprovedPendingSo;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-4 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Quotations</h1>
        {feasibleEnquiries.length ? (
          <Link to="/quotations/new" className={cn(buttonVariants(), "shrink-0")}>
            + New Quotation
          </Link>
        ) : (
          <span
            className={cn(buttonVariants(), "pointer-events-none shrink-0 cursor-not-allowed opacity-50")}
            title="No feasible enquiries without a quotation yet"
            aria-disabled
          >
            + New Quotation
          </span>
        )}
      </div>

      {showQuotationConversionBanner ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          <p className="font-medium text-slate-900">Approved quotations without a Sales Order</p>
          <p className="mt-0.5 text-slate-600">Use the row action on each quotation to create its Sales Order.</p>
        </div>
      ) : null}
      {showEmptyStrip ? (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
          <p className="font-medium text-slate-900">No quotations yet</p>
          <p className="mt-0.5 text-slate-600">Create a quotation to begin.</p>
          <div className="mt-2">
            <Button type="button" size="sm" disabled={!feasibleEnquiries.length} onClick={() => navigate("/quotations/new")}>
              New Quotation
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      {!feasibleEnquiries.length ? (
        <p className="text-[13px] leading-snug text-slate-600">
          No feasible enquiries without a quotation.{" "}
          <Link to="/enquiries" className="font-medium text-blue-700 underline-offset-2 hover:underline">
            Complete feasibility on Enquiries
          </Link>
          {" "}first.
        </p>
      ) : null}

      <section className="min-w-0">
        <div className="erp-table-wrap">
          <table className="erp-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Quotation No</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Next Step</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                    No quotations in the list.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString()}</td>
                      <td className="font-medium">{r.quotationNo || `#${r.id}`}</td>
                      <td>{r.enquiry.customer.name}</td>
                      <td>
                        <Badge variant={workflowBadgeVariant(r.workflowStatus)}>{r.workflowStatus.replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="min-w-[10rem]">
                        <QuotationNextStepCell r={r} />
                      </td>
                      <td>
                        <div className="flex flex-col items-end gap-2">
                          {isLocked(r.workflowStatus) ? (
                            <span
                              className="inline-flex h-8 min-w-[148px] max-w-[180px] items-center justify-end rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-800"
                              title={
                                r.workflowStatus === "APPROVED"
                                  ? "Approved. An administrator can cancel approval if no Sales Order exists yet."
                                  : "Rejected — approval is final for this quotation."
                              }
                            >
                              {r.workflowStatus === "APPROVED" ? "Approved" : "Rejected"}
                            </span>
                          ) : (
                            <>
                              <label className="sr-only" htmlFor={`q-decision-${r.id}`}>
                                Approval decision
                              </label>
                              <select
                                id={`q-decision-${r.id}`}
                                className="erp-select h-8 min-w-[148px] max-w-[180px] text-xs"
                                value={decisionSelectValue(r.workflowStatus)}
                                disabled={statusUpdatingId === r.id}
                                onChange={(e) => onDecisionChange(r.id, e.target.value)}
                              >
                                <option value="">Set approval…</option>
                                <option value="APPROVED">Approved</option>
                                <option value="REJECTED">Rejected</option>
                              </select>
                            </>
                          )}
                          <div className="erp-table-actions flex-wrap justify-end">
                            {!r.salesOrder && isApproved(r.workflowStatus) ? (
                              <Link
                                to={`/sales-orders?quotationId=${r.id}`}
                                data-testid="create-sales-order-btn"
                                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                              >
                                Create Sales Order
                              </Link>
                            ) : null}
                            {isApproved(r.workflowStatus) ? (
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                aria-label="Download PDF"
                                onClick={() => onPdf(r.id)}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            ) : (
                              <span className="inline-flex" title="Quotation must be approved before download">
                                <span
                                  className={cn(
                                    buttonVariants({ variant: "outline", size: "icon" }),
                                    "pointer-events-none cursor-not-allowed opacity-50",
                                  )}
                                  aria-disabled
                                >
                                  <Download className="h-4 w-4" />
                                </span>
                              </span>
                            )}
                            {canEditQuotation(r.workflowStatus) ? (
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                aria-label="Edit"
                                data-testid="edit-quotation-btn"
                                onClick={() => openEdit(r)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            ) : (
                              <span className="inline-flex" title={editDisabledTitle(r.workflowStatus)}>
                                <span
                                  className={cn(
                                    buttonVariants({ variant: "outline", size: "icon" }),
                                    "pointer-events-none cursor-not-allowed opacity-50",
                                  )}
                                  aria-disabled
                                >
                                  <Pencil className="h-4 w-4" />
                                </span>
                              </span>
                            )}
                            {isAdmin ? (
                              canDeleteQuotation(r.workflowStatus) ? (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="destructive"
                                  aria-label="Delete"
                                  data-testid="delete-quotation-btn"
                                  onClick={() => onDelete(r.id, r.workflowStatus)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              ) : (
                                <span className="inline-flex" title="Approved quotation cannot be deleted">
                                  <span
                                    className={cn(
                                      buttonVariants({ variant: "destructive", size: "icon" }),
                                      "pointer-events-none cursor-not-allowed opacity-50",
                                    )}
                                    aria-disabled
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </span>
                                </span>
                              )
                            ) : null}
                            {isAdmin && r.workflowStatus === "APPROVED" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8"
                                data-testid="cancel-quotation-approval-btn"
                                disabled={statusUpdatingId === r.id}
                                onClick={() => openCancelApproval(r)}
                                title={
                                  r.salesOrder
                                    ? "Admin only. Allowed only if Sales Order has no downstream transactions; otherwise blocked with a clear reason."
                                    : "Admin only"
                                }
                              >
                                Cancel approval
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {cancelApprovalOpen && cancelApprovalTarget ? (
        <div className="erp-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="cancel-approval-title">
          <Card className="w-full max-w-[520px] rounded-xl border border-slate-200 bg-white p-4 shadow-xl sm:p-5">
            <h2 id="cancel-approval-title" className="text-base font-bold leading-snug text-slate-900">
              Cancel quotation approval
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">
              This will move quotation <span className="font-medium">{cancelApprovalTarget.quotationNo || `#${cancelApprovalTarget.id}`}</span>{" "}
              back to <span className="font-medium">DRAFT</span> and reopen enquiry #{cancelApprovalTarget.enquiryId} to{" "}
              <span className="font-medium">FEASIBLE</span>.
            </p>
            <label className="mt-4 grid gap-2">
              <span className="text-sm font-medium text-slate-700">Reason (required)</span>
              <Input
                value={cancelApprovalReason}
                onChange={(e) => setCancelApprovalReason(e.target.value)}
                className="text-sm"
                autoComplete="off"
                placeholder=""
              />
            </label>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeCancelApproval} disabled={statusUpdatingId === cancelApprovalTarget.id}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void submitCancelApproval()}
                disabled={statusUpdatingId === cancelApprovalTarget.id || cancelApprovalReason.trim() === ""}
              >
                Confirm
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {editQ ? (
        <div className="erp-modal-backdrop" role="dialog">
          <Card className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <CardHeader className="shrink-0 pb-2">
              <CardTitle className="text-base">Edit quotation {editQ.quotationNo || `#${editQ.id}`}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-y-auto">
              <form onSubmit={saveEdit} className="erp-form">
                {quoteLines.map((l, i) => (
                  <div key={`eq-${i}`} className="erp-form-line-card">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      <div className="erp-form-field sm:col-span-2">
                        <span className="erp-form-label">Item</span>
                        <select
                          className="erp-select"
                          value={l.itemId}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setQuoteLines((p) => p.map((x, j) => (j === i ? { ...x, itemId: v } : x)));
                          }}
                        >
                          {items.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.itemName}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="erp-form-field">
                        <span className="erp-form-label">Qty</span>
                        <Input
                          type="number"
                          step="any"
                          min={0}
                          inputMode="decimal"
                          value={l.qty}
                          onChange={(e) => {
                            setQuoteLines((p) => p.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)));
                          }}
                        />
                      </div>
                      <div className="erp-form-field">
                        <span className="erp-form-label">Rate</span>
                        <Input
                          type="number"
                          step="any"
                          min={0}
                          inputMode="decimal"
                          value={l.isFree ? "0" : l.rate}
                          disabled={l.isFree}
                          onChange={(e) => {
                            setQuoteLines((p) => p.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)));
                          }}
                        />
                        {l.isFree ? (
                          <span className="mt-0.5 block text-xs font-medium text-emerald-800">(Free)</span>
                        ) : null}
                      </div>
                      <div className="erp-form-field">
                        <span className="erp-form-label">Disc %</span>
                        <Input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          value={l.discountPct}
                          onChange={(e) => {
                            setQuoteLines((p) => p.map((x, j) => (j === i ? { ...x, discountPct: e.target.value } : x)));
                          }}
                        />
                      </div>
                      <div className="erp-form-field">
                        <span className="erp-form-label">GST %</span>
                        <Input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          value={l.gstPct}
                          onChange={(e) => {
                            setQuoteLines((p) => p.map((x, j) => (j === i ? { ...x, gstPct: e.target.value } : x)));
                          }}
                        />
                      </div>
                    </div>
                    <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300"
                        checked={l.isFree}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setQuoteLines((p) =>
                            p.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    isFree: checked,
                                    rate: checked ? "0" : previewNum(x.rate) > 0 ? x.rate : "1",
                                  }
                                : x,
                            ),
                          );
                        }}
                      />
                      <span>
                        Free item <span className="text-slate-500">(rate must be 0)</span>
                      </span>
                    </label>
                    <div className="text-sm text-slate-600">
                      Line amount: {lineTotalFromDraft(l, lineTotal).toFixed(2)}
                    </div>
                  </div>
                ))}
                <div className="erp-form-field">
                  <span className="erp-form-label">Terms</span>
                  <Input value={terms} onChange={(e) => setTerms(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setEditQ(null)} disabled={saving}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
