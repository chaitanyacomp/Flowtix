import * as React from "react";
import { Link, Navigate, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { cn } from "../lib/utils";
import { buttonVariants } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch, getApiUrl } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../hooks/useAuth";
import { Download, Pencil, Trash2, X } from "lucide-react";
import {
  CommercialWorkflowStrip,
  commercialStageFromQuotationContext,
  commercialWorkflowStripDenseFramedClassName,
} from "../components/erp/CommercialWorkflowStrip";
import { NO_QTY_TERMS } from "../lib/flowTerminology";
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
  flowTypeSnapshot?: "REGULAR" | "NO_QTY";
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

type RateContractRow = {
  id: number;
  customerId: number;
  itemId: number;
  rate: string;
  gstRate: string;
  effectiveFrom: string;
  status: string;
};

type EnquiryOpt = {
  id: number;
  status: string;
  customer: Customer;
  lines: { itemId: number; item: Item; qty: string }[];
};

function flowTypeLabel(flowTypeSnapshot: QRow["flowTypeSnapshot"]): string {
  const ft = flowTypeSnapshot ?? "REGULAR";
  return ft === "NO_QTY" ? NO_QTY_TERMS.AGREEMENT_LABEL : "Regular Order";
}

function flowTypeBadge(flowTypeSnapshot: QRow["flowTypeSnapshot"]) {
  const ft = flowTypeSnapshot ?? "REGULAR";
  const label = ft === "NO_QTY" ? NO_QTY_TERMS.AGREEMENT_LABEL : "REGULAR";
  const variant: "info" | "warning" = ft === "NO_QTY" ? "warning" : "info";
  return <Badge variant={variant}>{label}</Badge>;
}

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

function QuotationNextStepCell({ r }: { r: QRow }) {
  if (r.salesOrder) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold tracking-tight text-emerald-900 ring-1 ring-emerald-200/90">
        Sales Order Created
      </span>
    );
  }
  if (r.workflowStatus === "REJECTED") {
    return <span className="text-sm font-medium text-slate-400">â€”</span>;
  }
  if (isApproved(r.workflowStatus)) {
    return (
      <span className="text-[13px] font-medium text-emerald-900">
        Ready for Sales Order
      </span>
    );
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
  const location = useLocation();
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
  const [selectedId, setSelectedId] = React.useState<number | null>(null);

  const selectedRow = React.useMemo(
    () => (selectedId == null ? null : rows.find((r) => r.id === selectedId) ?? null),
    [rows, selectedId],
  );

  const workflowStrip = commercialStageFromQuotationContext(selectedRow);

  function openQuotation(r: QRow) {
    setSelectedId(r.id);
  }

  function closePanel() {
    setSelectedId(null);
  }

  React.useEffect(() => {
    const hash = location.hash.replace(/^#/, "");
    if (!hash.startsWith("quotation-row-")) return;
    const id = Number(hash.replace("quotation-row-", ""));
    if (Number.isFinite(id) && id > 0) setSelectedId(id);
    const el = document.getElementById(hash);
    if (!el) return;
    const t = window.setTimeout(() => {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [location.hash, rows.length, listLoaded]);

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
    const quotation = editQ;
    setError(null);

    const isNoQty = (quotation.flowTypeSnapshot ?? "REGULAR") === "NO_QTY";
    async function resolveApplicableRate(customerId: number, itemId: number): Promise<{ rate: string; gstPct: string } | null> {
      const rows = await apiFetch<RateContractRow[]>(`/api/rate-contracts?customerId=${customerId}&itemId=${itemId}`);
      const asOf = new Date(quotation.createdAt).getTime();
      const applicable =
        rows
          .map((r) => ({ ...r, eff: new Date(r.effectiveFrom).getTime() }))
          .filter((r) => Number.isFinite(r.eff) && r.eff <= asOf)
          .sort((a, b) => (b.eff !== a.eff ? b.eff - a.eff : b.id - a.id))[0] ?? null;
      if (!applicable) return null;
      return { rate: String(applicable.rate), gstPct: String(applicable.gstRate) };
    }

    if (isNoQty) {
      // No manual override: block save if any line has no valid approved rate contract as-of quotation date.
      const custId = quotation.enquiry?.customer?.id ?? 0;
      for (const ln of quoteLines) {
        const rc = await resolveApplicableRate(custId, ln.itemId);
        if (!rc) {
          const msg = "No approved rate contract found for selected customer/item as of quotation date.";
          setError(msg);
          toast.showError(msg);
          return;
        }
      }
    }

    if (!isNoQty) {
      const v = validateQuoteLinesForSave(quoteLines);
      if (v) {
        setError(v);
        toast.showError(v);
        return;
      }
    }
    setSaving(true);
    try {
      await apiFetch(`/api/quotations/${quotation.id}`, {
        method: "PUT",
        body: JSON.stringify({
          terms: terms.trim() || null,
          lines: draftLinesToApiPayload(
            isNoQty
              ? quoteLines.map((l) => ({ ...l, qty: "0", discountPct: "0", isFree: false }))
              : quoteLines,
          ),
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
    <div className="flex min-h-[calc(100vh-8.5rem)] flex-col gap-2.5 pb-4">
      <div className="flex flex-col gap-2 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Quotations</h1>
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
        <CommercialWorkflowStrip
          active={workflowStrip.active}
          allComplete={workflowStrip.allComplete}
          className={commercialWorkflowStripDenseFramedClassName}
        />
      </div>

      {showQuotationConversionBanner ? (
        <div className="rounded-t-lg border border-b-0 border-blue-200/80 bg-gradient-to-r from-blue-50/95 to-sky-50/90 px-3 py-2.5 text-[13px] leading-snug text-slate-800 shadow-sm">
          <p className="font-semibold text-slate-900">Approved quotations are ready for Sales Order creation.</p>
          <p className="mt-0.5 text-slate-700">
            Select a quotation and use <span className="font-medium text-blue-900">Create Sales Order â†’</span> in the
            operator panel.
          </p>
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

      <div className="erp-workspace-2col min-h-0 flex-1">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-3 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Quotations</span>
            <span className="text-[11px] tabular-nums text-slate-500">{rows.length} total</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="erp-table-wrap border-0">
          <table className="erp-table erp-table-dense quotations-workspace-table w-full">
            <thead className="sticky top-0 z-10">
              <tr>
                <th>Date</th>
                <th>Quotation No</th>
                <th>Customer</th>
                <th>Flow</th>
                <th>Status</th>
                <th>Next Step</th>
                <th className="erp-table-action-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">
                    No quotations in the list.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const isSelected = r.id === selectedId;
                  return (
                    <tr
                      key={r.id}
                      id={`quotation-row-${r.id}`}
                      onClick={() => openQuotation(r)}
                      className={cn(
                        "cursor-pointer transition-colors",
                        isSelected
                          ? "!bg-blue-50/70 outline outline-1 -outline-offset-1 outline-blue-200"
                          : "hover:bg-slate-50/70",
                      )}
                    >
                      <td className="whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString()}</td>
                      <td className="font-medium">{r.quotationNo || `#${r.id}`}</td>
                      <td>{r.enquiry.customer.name}</td>
                      <td>{flowTypeBadge(r.flowTypeSnapshot)}</td>
                      <td>
                        <Badge variant={workflowBadgeVariant(r.workflowStatus)}>{r.workflowStatus.replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="min-w-[10rem]">
                        <QuotationNextStepCell r={r} />
                      </td>
                      <td className="erp-table-action-col" onClick={(e) => e.stopPropagation()}>
                        <QuotationRowSecondaryActions
                          row={r}
                          isAdmin={isAdmin}
                          statusUpdatingId={statusUpdatingId}
                          onOpen={() => openQuotation(r)}
                          onPdf={() => onPdf(r.id)}
                          onEdit={() => openEdit(r)}
                          onDelete={() => onDelete(r.id, r.workflowStatus)}
                          onCancelApproval={() => openCancelApproval(r)}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
            </div>
          </div>
        </div>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white px-3 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Operator Action
                </span>
                <span className="text-[12px] font-semibold text-slate-900">
                  {selectedRow
                    ? `Quotation ${selectedRow.quotationNo || `#${selectedRow.id}`}`
                    : "Workflow"}
                </span>
              </div>
              {selectedRow ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  aria-label="Close panel"
                  onClick={closePanel}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
            {selectedRow ? (
              <div className="mt-0.5 truncate text-[11px] text-slate-600">
                {selectedRow.enquiry.customer.name} · {selectedRow.workflowStatus.replace(/_/g, " ")}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            {selectedRow ? (
              <QuotationOperatorPanel
                row={selectedRow}
                isAdmin={isAdmin}
                statusUpdatingId={statusUpdatingId}
                onDecisionChange={onDecisionChange}
                onPdf={() => onPdf(selectedRow.id)}
                onEdit={() => openEdit(selectedRow)}
                onDelete={() => onDelete(selectedRow.id, selectedRow.workflowStatus)}
                onCancelApproval={() => openCancelApproval(selectedRow)}
              />
            ) : (
              <QuotationPanelIdleState hasRows={rows.length > 0} />
            )}
          </div>
        </aside>
      </div>


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
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <span>Edit quotation {editQ.quotationNo || `#${editQ.id}`}</span>
                {flowTypeBadge(editQ.flowTypeSnapshot)}
              </CardTitle>
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
                      {(editQ.flowTypeSnapshot ?? "REGULAR") === "NO_QTY" ? null : (
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
                      )}
                      <div className="erp-form-field">
                        <span className="erp-form-label">Rate</span>
                        <Input
                          type="number"
                          step="any"
                          min={0}
                          inputMode="decimal"
                          value={l.isFree ? "0" : l.rate}
                          disabled={l.isFree || (editQ.flowTypeSnapshot ?? "REGULAR") === "NO_QTY"}
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
                          disabled={(editQ.flowTypeSnapshot ?? "REGULAR") === "NO_QTY"}
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
                        disabled={(editQ.flowTypeSnapshot ?? "REGULAR") === "NO_QTY"}
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
                    {(editQ.flowTypeSnapshot ?? "REGULAR") === "NO_QTY" ? (
                      <div className="text-sm text-slate-600">
                        {NO_QTY_TERMS.AGREEMENT_LABEL}: quantities are planned later in Requirement Sheet cycles.
                      </div>
                    ) : (
                      <div className="text-sm text-slate-600">Line amount: {lineTotalFromDraft(l, lineTotal).toFixed(2)}</div>
                    )}
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
                    {saving ? "Savingâ€¦" : "Save"}
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

function QuotationPanelIdleState(props: { hasRows: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Workflow Action
      </div>
      <p className="max-w-xs text-[13px] leading-snug text-slate-600">
        {props.hasRows
          ? "Select a quotation from the list to review details, approve, or create a Sales Order."
          : "Create a quotation from a feasible enquiry to begin."}
      </p>
    </div>
  );
}

function QuotationRowSecondaryActions(props: {
  row: QRow;
  isAdmin: boolean;
  statusUpdatingId: number | null;
  onOpen: () => void;
  onPdf: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCancelApproval: () => void;
}) {
  const { row, isAdmin, statusUpdatingId, onOpen, onPdf, onEdit, onDelete, onCancelApproval } = props;
  const secondaryIconBtn = "h-7 w-7 text-slate-500 hover:bg-slate-100 hover:text-slate-900";

  return (
    <div className="erp-table-actions">
      <button type="button" className="erp-table-act erp-table-act--link text-[11px]" onClick={onOpen}>
        Open
      </button>
      {isApproved(row.workflowStatus) ? (
        <Button type="button" size="icon" variant="ghost" className={secondaryIconBtn} aria-label="Download PDF" onClick={onPdf}>
          <Download className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <span className="inline-flex" title="Quotation must be approved before download">
          <span
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "pointer-events-none h-7 w-7 cursor-not-allowed opacity-40",
            )}
            aria-disabled
          >
            <Download className="h-3.5 w-3.5" />
          </span>
        </span>
      )}
      {canEditQuotation(row.workflowStatus) ? (
        <Button type="button" size="icon" variant="ghost" className={secondaryIconBtn} aria-label="Edit" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      {isAdmin && canDeleteQuotation(row.workflowStatus) ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-slate-500 hover:bg-red-50 hover:text-red-700"
          aria-label="Delete"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      {isAdmin && row.workflowStatus === "APPROVED" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] font-normal text-slate-600"
          disabled={statusUpdatingId === row.id}
          onClick={onCancelApproval}
        >
          Undo
        </Button>
      ) : null}
    </div>
  );
}

function QuotationOperatorPanel(props: {
  row: QRow;
  isAdmin: boolean;
  statusUpdatingId: number | null;
  onDecisionChange: (id: number, value: string) => void;
  onPdf: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCancelApproval: () => void;
}) {
  const { row, isAdmin, statusUpdatingId, onDecisionChange, onPdf, onEdit, onDelete, onCancelApproval } = props;
  const isNoQty = (row.flowTypeSnapshot ?? "REGULAR") === "NO_QTY";
  const approved = isApproved(row.workflowStatus);
  const locked = isLocked(row.workflowStatus);
  const showApprove = !locked && !row.salesOrder;
  const showCreateSo = approved && !row.salesOrder;
  const createSoTo =
    isNoQty
      ? `/sales-orders/no-qty/from-quotation?quotationId=${row.id}&from=quotations`
      : `/sales-orders?quotationId=${row.id}&from=quotations`;

  const nextTitle = row.salesOrder
    ? "Sales Order created"
    : showCreateSo
      ? "Create Sales Order"
      : showApprove
        ? "Complete & Approve"
        : row.workflowStatus === "REJECTED"
          ? "Rejected"
          : "No further action";
  const nextSub = row.salesOrder
    ? "This quotation is linked to a sales order."
    : showCreateSo
      ? "Approved — continue to sales order creation."
      : showApprove
        ? isNoQty
          ? "Quotation locks commercial framework. Quantities are planned later in Requirement Sheet cycles."
          : "Review lines and terms, then approve or reject."
        : row.workflowStatus === "REJECTED"
          ? "This quotation was rejected."
          : "Workflow complete for this quotation.";

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="rounded-md border border-blue-200 bg-gradient-to-br from-blue-50 to-white px-3 py-2 shadow-sm">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Next action</div>
        <div className="mt-0.5 text-[14px] font-semibold leading-snug text-blue-900">{nextTitle}</div>
        <div className="text-[11px] leading-snug text-slate-600">{nextSub}</div>
      </div>

      <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[12px] text-slate-700">
        <div className="grid gap-1.5">
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Customer</span>
            <span className="truncate font-medium text-slate-900">{row.enquiry.customer.name}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Quotation no</span>
            <span className="font-mono font-semibold tabular-nums">{row.quotationNo || `#${row.id}`}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Flow</span>
            <span>{flowTypeLabel(row.flowTypeSnapshot)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Status</span>
            <span>{row.workflowStatus.replace(/_/g, " ")}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Items</span>
            <span className="tabular-nums">{row.lines.length}</span>
          </div>
          {isNoQty ? (
            <p className="border-t border-slate-100 pt-1.5 text-[11px] leading-snug text-amber-900">
              Rate contract-linked · qty managed later
            </p>
          ) : null}
        </div>
      </div>

      <div className="sticky bottom-0 -mx-3 -mb-3 mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        {approved ? (
          <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={onPdf}>
            PDF
          </Button>
        ) : null}
        {isAdmin && canEditQuotation(row.workflowStatus) ? (
          <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
        {isAdmin && canDeleteQuotation(row.workflowStatus) ? (
          <Button type="button" size="sm" variant="destructive" className="h-8 text-[12px]" onClick={onDelete}>
            Delete
          </Button>
        ) : null}
        {isAdmin && row.workflowStatus === "APPROVED" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-[12px]"
            disabled={statusUpdatingId === row.id}
            onClick={onCancelApproval}
          >
            Undo approval
          </Button>
        ) : null}
        {showApprove ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-[12px]"
              disabled={statusUpdatingId === row.id}
              onClick={() => onDecisionChange(row.id, "REJECTED")}
            >
              Reject
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 min-w-[9rem] text-[12px] font-semibold shadow-sm"
              disabled={statusUpdatingId === row.id}
              onClick={() => onDecisionChange(row.id, "APPROVED")}
            >
              Complete & Approve →
            </Button>
          </>
        ) : null}
        {showCreateSo ? (
          <Link
            to={createSoTo}
            data-testid="create-sales-order-btn"
            className="inline-flex h-8 min-w-[9.5rem] items-center justify-center rounded-md bg-blue-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            Create Sales Order →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
