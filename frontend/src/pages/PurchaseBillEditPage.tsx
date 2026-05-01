import * as React from "react";
import { useLocation, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch } from "../services/api";
import { getApiUrl } from "../services/api";
import { computeLineTaxSplit, sumBillLines } from "../lib/purchaseBillCalc";
import { useAuth } from "../hooks/useAuth";
import { PageContainer, PageSmartBackLink, StickyWorkspaceHead } from "../components/PageHeader";
import { ActivityHistoryCard } from "../components/ActivityHistoryCard";
import { BillExportStatusPanel } from "../components/BillExportStatusPanel";

type BillLine = {
  id: number;
  itemId: number;
  qty: string;
  unitSnapshot: string;
  hsnCodeSnapshot?: string;
  rate: string;
  basicAmount: string;
  gstRate: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
  grnId?: number | null;
  grnLineId?: number | null;
  rmPoId?: number | null;
  grnLine?: { id: number; receivedQty: string | number; grn?: { id: number; date: string; rmPoId: number } | null } | null;
  item: { id: number; itemName: string; unit: string; gstRate?: string | null };
};

type Bill = {
  id: number;
  billNo: string | null;
  billDate: string;
  dueDate: string | null;
  remarks: string | null;
  status: string;
  isExported?: boolean;
  exportedAt?: string | null;
  exportResetAt?: string | null;
  supplierId: number;
  grnId: number | null;
  totalBasic: string;
  totalCgst: string;
  totalSgst: string;
  totalIgst: string;
  totalTax: string;
  netAmount: string;
  finalizedAt: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  hasTemporaryTaxData?: boolean;
  taxIntraState: boolean;
  supplier: { id: number; name: string; state?: string | null };
  grn?: { id: number; date: string; rmPo: { id: number } } | null;
  lines: BillLine[];
};

function toDateInputValue(value: unknown): string {
  if (value == null) return "";
  if (value === 0 || value === "0") return "";
  const iso = typeof value === "string" ? value.trim() : String(value);
  if (!iso) return "";
  const d = value instanceof Date ? value : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Defensive: treat epoch as "unset" in UI to avoid showing 1970 for null-ish DB values.
  if (d.getUTCFullYear() === 1970) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PurchaseBillEditPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const location = useLocation();
  const billId = Number(idParam);
  const isAdmin = useAuth().user?.role === "ADMIN";

  const [bill, setBill] = React.useState<Bill | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [formInfo, setFormInfo] = React.useState<string | null>(null);
  const [billNo, setBillNo] = React.useState("");
  const [billDate, setBillDate] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [remarks, setRemarks] = React.useState("");
  const [finalizeAttempted, setFinalizeAttempted] = React.useState(false);
  const [rates, setRates] = React.useState<Record<number, number>>({});
  const [qtys, setQtys] = React.useState<Record<number, number>>({});
  const [saving, setSaving] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  // Deletion disabled (audit-safe lifecycle uses CANCELLED).
  const [resetting, setResetting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [lineTouched, setLineTouched] = React.useState<Record<number, { qty?: boolean; rate?: boolean }>>({});
  const [adminCancelAuth, setAdminCancelAuth] = React.useState<{
    open: boolean;
    reason: string;
    password: string;
  } | null>(null);
  const qtyRefs = React.useRef<Array<HTMLInputElement | null>>([]);
  const rateRefs = React.useRef<Array<HTMLInputElement | null>>([]);
  const didFocusRates = React.useRef(false);

  const readOnly = bill?.status === "FINALIZED";
  const cancelled = bill?.status === "CANCELLED";
  const editLocked = Boolean(readOnly || cancelled);
  const incomingWarnings = ((location.state as { pbWarnings?: string[] } | null)?.pbWarnings ?? []).filter(Boolean);

  React.useEffect(() => {
    if (!Number.isFinite(billId) || billId <= 0) {
      setLoadError("Invalid bill.");
      return;
    }
    setLoadError(null);
    apiFetch<Bill>(`/api/purchase-bills/${billId}`)
      .then((b) => {
        setBill(b);
        setExportError(null);
        setFormInfo(null);
        setFormError(null);
        setBillNo(b.billNo?.trim() ?? "");
        setBillDate(toDateInputValue(b.billDate));
        setDueDate(toDateInputValue(b.dueDate));
        setRemarks(b.remarks?.trim() ?? "");
        setFinalizeAttempted(false);
        const next: Record<number, number> = {};
        const qNext: Record<number, number> = {};
        for (const ln of b.lines) {
          next[ln.id] = Number(ln.rate);
          qNext[ln.id] = Number(ln.qty);
        }
        setRates(next);
        setQtys(qNext);
        didFocusRates.current = false;
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Could not load this bill.";
        if (/P20\d\d|prisma|database|schema is out of date|missing column/i.test(msg)) {
          setLoadError("Something went wrong while loading data. Please refresh.");
        } else {
          setLoadError(msg);
        }
      });
  }, [billId]);

  React.useEffect(() => {
    if (readOnly || !bill || bill.lines.length === 0 || didFocusRates.current) return;
    const t = window.setTimeout(() => {
      const el = qtyRefs.current[0] || rateRefs.current[0];
      if (el) {
        el.focus();
        el.select();
        didFocusRates.current = true;
      }
    }, 100);
    return () => window.clearTimeout(t);
  }, [bill, readOnly]);

  function setRate(lineId: number, value: number) {
    setRates((prev) => ({ ...prev, [lineId]: value }));
  }
  function setQty(lineId: number, value: number) {
    setQtys((prev) => ({ ...prev, [lineId]: value }));
  }

  function setTouched(lineId: number, field: "qty" | "rate") {
    setLineTouched((prev) => ({ ...prev, [lineId]: { ...(prev[lineId] || {}), [field]: true } }));
  }

  function shouldShowErr(lineId: number, field: "qty" | "rate") {
    return Boolean(lineTouched[lineId]?.[field]);
  }

  function onQtyKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    rateRefs.current[idx]?.focus();
  }

  function onRateKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const next = qtyRefs.current[idx + 1];
    if (next) {
      next.focus();
      next.select();
    }
  }

  function buildLinePayload() {
    if (!bill) return [];
    return bill.lines.map((ln) => ({
      id: ln.id,
      qty: qtys[ln.id] ?? Number(ln.qty),
      rate: rates[ln.id] ?? Number(ln.rate),
    }));
  }

  function previewLines() {
    if (!bill) return [];
    const intra = bill.taxIntraState;
    return bill.lines.map((ln) => {
      const qty = qtys[ln.id] ?? Number(ln.qty);
      const rate = rates[ln.id] ?? Number(ln.rate);
      const gst = Number(ln.gstRate);
      return computeLineTaxSplit(qty * rate, gst, intra);
    });
  }

  const preview = bill ? sumBillLines(previewLines()) : null;

  async function saveDraft() {
    if (!bill || editLocked) return;
    setFormError(null);
    setFormInfo(null);
    setSaving(true);
    try {
      const body = {
        billNo: billNo.trim() || null,
        billDate,
        dueDate: dueDate.trim() || null,
        remarks: remarks.trim() || null,
        lines: buildLinePayload(),
      };
      const updated = await apiFetch<Bill>(`/api/purchase-bills/${bill.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setBill(updated);
      setBillNo(updated.billNo?.trim() ?? "");
      setBillDate(toDateInputValue(updated.billDate));
      setDueDate(toDateInputValue(updated.dueDate));
      setRemarks(updated.remarks?.trim() ?? "");
      const next: Record<number, number> = {};
      for (const ln of updated.lines) {
        next[ln.id] = Number(ln.rate);
      }
      setRates(next);
      setFormInfo("Purchase Bill saved.");
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Could not save.";
      setFormError(/over.?bill|cannot bill/i.test(String(raw)) ? String(raw) : "Could not save. Please check the values and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function finalize() {
    if (!bill || editLocked) return;
    setFinalizeAttempted(true);
    if (!billNo.trim()) {
      setFormError("Enter supplier invoice number before finalizing.");
      return;
    }
    setFormError(null);
    setFormInfo(null);
    setSaving(true);
    try {
      const body = {
        billNo: billNo.trim() || null,
        billDate,
        dueDate: dueDate.trim() || null,
        remarks: remarks.trim() || null,
        lines: buildLinePayload(),
      };
      await apiFetch<Bill>(`/api/purchase-bills/${bill.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      const finalized = await apiFetch<Bill>(`/api/purchase-bills/${bill.id}/finalize`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setBill(finalized);
      setBillNo(finalized.billNo?.trim() ?? "");
      setBillDate(toDateInputValue(finalized.billDate));
      setDueDate(toDateInputValue(finalized.dueDate));
      setRemarks(finalized.remarks?.trim() ?? "");
      const next: Record<number, number> = {};
      const qNext: Record<number, number> = {};
      for (const ln of finalized.lines) {
        next[ln.id] = Number(ln.rate);
        qNext[ln.id] = Number(ln.qty);
      }
      setRates(next);
      setQtys(qNext);
      setFormInfo("Purchase Bill finalized.");
    } catch (e) {
      const raw = e instanceof Error ? String(e.message || "").trim() : "";
      setFormError(raw || "Could not finalize. Please review bill details and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function exportToTally() {
    if (!bill || bill.status !== "FINALIZED" || bill.isExported || exporting) return;
    setExporting(true);
    setFormError(null);
    setExportError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(getApiUrl(`/api/purchase-bills/${bill.id}/export/tally.xml`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let msg = "Could not export to Tally";
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
      const safeNo = (bill.billNo?.trim() ? bill.billNo.trim() : `PB-${bill.id}`).replace(/[^\w\-\.]+/g, "-");
      a.download = `purchase-bill-${safeNo}.xml`;
      a.click();
      URL.revokeObjectURL(a.href);
      setFormInfo("Tally XML downloaded.");
      // Backend marks exported on success; refresh so UI switches to Exported state.
      const refreshed = await apiFetch<Bill>(`/api/purchase-bills/${bill.id}`);
      setBill(refreshed);
      setExportError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not export to Tally";
      setExportError(msg);
      setFormError(msg);
    } finally {
      setExporting(false);
    }
  }

  const exportBlockedReason =
    !bill
      ? null
      : bill.status === "CANCELLED"
        ? "Cancelled bills cannot be exported."
        : bill.hasTemporaryTaxData
          ? "Cannot export: bill contains temporary tax values from testing mode."
          : null;

  const billingStatusBadge =
    bill?.status === "CANCELLED" ? "Cancelled" : bill?.status === "FINALIZED" ? "Finalized" : "Draft";

  async function cancelFinalized() {
    if (!bill || bill.status !== "FINALIZED" || !isAdmin) return;
    const ok = window.confirm("Cancel this bill? This removes the billing effect only. Stock will remain received.");
    if (!ok) return;
    const reasonRaw = window.prompt("Cancellation reason?");
    const reason = (reasonRaw || "").trim();
    if (!reason) return;
    if (bill.isExported) {
      setAdminCancelAuth({ open: true, reason, password: "" });
      return;
    }
    setSaving(true);
    setFormError(null);
    setFormInfo(null);
    try {
      const cancelledBill = await apiFetch<Bill>(`/api/purchase-bills/${bill.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setBill(cancelledBill);
      setFormInfo("Purchase Bill cancelled. Quantity available for re-billing.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not cancel bill.";
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function approveExportedCancel() {
    if (!bill || bill.status !== "FINALIZED" || !bill.isExported || !isAdmin || !adminCancelAuth?.open || saving) return;
    const password = adminCancelAuth.password.trim();
    if (!password) {
      setFormError("Admin password is required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    setFormInfo(null);
    try {
      const cancelledBill = await apiFetch<Bill>(`/api/purchase-bills/${bill.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: adminCancelAuth.reason, adminPassword: password }),
      });
      setBill(cancelledBill);
      setAdminCancelAuth(null);
      setFormInfo("Purchase Bill cancelled. Quantity available for re-billing.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not cancel bill.";
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function resetExport() {
    if (!bill || !bill.isExported || !isAdmin || resetting) return;
    const reasonRaw = window.prompt("Reason for resetting export?");
    const reason = (reasonRaw || "").trim();
    if (!reason) {
      setFormError("Please enter a reason to reset export.");
      return;
    }
    setResetting(true);
    setFormError(null);
    setFormInfo(null);
    try {
      await apiFetch(`/api/purchase-bills/${bill.id}/reset-export`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      const refreshed = await apiFetch<Bill>(`/api/purchase-bills/${bill.id}`);
      setBill(refreshed);
      setExportError(null);
      setFormInfo("Export reset successfully.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not reset export.";
      setFormError(msg);
    } finally {
      setResetting(false);
    }
  }

  if (loadError) {
    return (
      <PageContainer className="space-y-4">
        <StickyWorkspaceHead lead={<PageSmartBackLink defaultTo="/purchase-bills" defaultLabel="Back to purchase bills" />} />
        <div className="min-w-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-800 break-words">
          {loadError}
        </div>
      </PageContainer>
    );
  }

  if (!bill) {
    return (
      <PageContainer className="overflow-x-hidden px-0 py-2 text-sm text-slate-600" aria-busy="true">
        Loading…
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {adminCancelAuth?.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="text-sm font-semibold text-slate-900">Admin Authorization Required</div>
              <div className="mt-1 text-xs text-slate-600">
                This transaction is already exported to Tally. Reversing it may affect accounting.
              </div>
            </div>
            <div className="px-4 py-3">
              <label className="block text-xs font-medium text-slate-700">Admin password</label>
              <Input
                type="password"
                className="mt-1 h-9"
                value={adminCancelAuth.password}
                onChange={(e) => setAdminCancelAuth((s) => (s ? { ...s, password: e.target.value } : s))}
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => setAdminCancelAuth(null)} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" className="h-8 text-xs" onClick={() => void approveExportedCancel()} disabled={saving}>
                {saving ? "…" : "Approve Reverse"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {incomingWarnings.length ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
          <ul className="list-inside list-disc">
            {incomingWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {bill.hasTemporaryTaxData ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          ⚠ This bill contains temporary tax values (testing mode).
        </div>
      ) : null}
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700" title="GRN affects stock received">
            Stock status: Goods received via GRN
          </span>
          <span
            className={
              bill.status === "CANCELLED"
                ? "rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-800"
                : bill.status === "FINALIZED"
                  ? "rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800"
                  : "rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-900"
            }
          >
            Billing status: {billingStatusBadge}
          </span>
        </div>
        {bill.status === "CANCELLED" ? (
          <div className="mt-1 text-rose-800">
            This bill is cancelled. Goods remain received in stock. The cancelled quantity is available for re-billing.
          </div>
        ) : null}
      </div>
      <StickyWorkspaceHead lead={<PageSmartBackLink defaultTo="/purchase-bills" defaultLabel="Back to purchase bills" />}>
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
          <div className="min-w-0 space-y-1">
            <h1 className="text-lg font-semibold leading-snug text-slate-900">Purchase bill</h1>
            <p className="text-sm leading-relaxed text-slate-600">
              {cancelled ? "Cancelled purchase bill (read-only)" : readOnly ? "View finalized Purchase Bill" : "Edit Purchase Bill"}
            </p>
          </div>
          {!cancelled ? (
            <div className="flex shrink-0 flex-col items-start gap-2">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <div className="font-medium text-slate-800">What this action does</div>
              <div className="mt-0.5">
                <span className="font-medium">Cancel Bill (invoice only)</span>: cancels supplier invoice effect.{" "}
                <span className="font-medium">Stock will NOT change.</span>
              </div>
              <div className="mt-0.5">
                <span className="font-medium">Reverse GRN</span>: undo goods receipt (stock change). Use only when receipt itself is wrong.
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-1">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Billing actions</div>

                {bill.status === "DRAFT" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" disabled={editLocked || saving} onClick={() => void saveDraft()}>
                      Save Draft
                    </Button>
                    <Button type="button" disabled={editLocked || saving} onClick={() => void finalize()}>
                      Finalize
                    </Button>
                  </div>
                ) : null}

                {isAdmin && bill.status === "FINALIZED" ? (
                  <div className="flex flex-col gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={() => void cancelFinalized()}
                      title={
                        bill.isExported ? "Exported bills require admin authorization to cancel." : "Cancels the supplier invoice. Stock will NOT change."
                      }
                    >
                      Cancel Bill (invoice only)
                    </Button>
                    {bill.isExported ? (
                      <div className="text-xs text-slate-600">Exported to Tally: cancelling requires Admin password.</div>
                    ) : null}
                  </div>
                ) : null}
              </div>

            </div>
          </div>
        ) : null}
        </div>
      </StickyWorkspaceHead>

      {formError ? (
        <div className="min-w-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-950 break-words">
          {formError}
        </div>
      ) : null}
      {formInfo ? (
        <div className="min-w-0 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm leading-relaxed text-emerald-950 break-words">
          {formInfo}
        </div>
      ) : null}

      <BillExportStatusPanel
        lifecycle={cancelled ? "CANCELLED" : readOnly ? "FINALIZED" : "DRAFT"}
        isExported={Boolean(bill.isExported)}
        exportedAt={bill.exportedAt}
        exportedByName={null}
        exportBlockedReason={exportBlockedReason}
        exportAttemptError={exportError}
        exportResetAt={bill.exportResetAt ?? null}
        isAdmin={isAdmin}
        exporting={exporting}
        resetting={resetting}
        onExport={exportToTally}
        onResetExport={resetExport}
      />

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6">
        <div className="min-w-0 space-y-6">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">GRN + bill details</CardTitle>
            </CardHeader>
            <CardContent className="grid min-w-0 gap-4 sm:grid-cols-2">
              <div className="grid min-w-0 gap-1 sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">GRN ref</span>
                <Input value={bill.grn?.id ? `GRN-${bill.grn.id}` : "Multiple GRNs"} readOnly className="min-w-0 bg-slate-50" />
              </div>
              <div className="grid min-w-0 gap-1">
                <span className="text-xs font-medium text-slate-600">GRN date</span>
                <Input value={bill.grn?.date ? toDateInputValue(bill.grn.date) : ""} readOnly className="min-w-0 bg-slate-50" />
              </div>
              <div className="grid min-w-0 gap-1">
                <span className="text-xs font-medium text-slate-600">Supplier</span>
                <Input value={bill.supplier.name} readOnly className="min-w-0 bg-slate-50" />
              </div>
              <div className="grid min-w-0 gap-1 sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Supplier invoice no.</span>
                <Input
                  value={billNo}
                  onChange={(e) => setBillNo(e.target.value)}
                  placeholder="Supplier bill / invoice number"
                  disabled={readOnly}
                  className="min-w-0"
                />
                {bill.status === "DRAFT" && finalizeAttempted && !billNo.trim() ? (
                  <div className="text-xs text-red-700">Enter supplier invoice number before finalizing</div>
                ) : (
                  <div className="text-xs text-slate-500">Required to finalize</div>
                )}
              </div>
              <div className="grid min-w-0 gap-1">
                <span className="text-xs font-medium text-slate-600">Bill date</span>
                <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} disabled={editLocked} className="min-w-0" />
              </div>
              <div className="grid min-w-0 gap-1">
                <span className="text-xs font-medium text-slate-600">Due date (optional)</span>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={editLocked} className="min-w-0" />
              </div>
              <div className="grid min-w-0 gap-1 sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Remarks (optional)</span>
                <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={editLocked} placeholder="Notes for this bill" className="min-w-0" />
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Items</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0 p-0 sm:p-6 sm:pt-0">
              <div className="space-y-2 px-3 pb-4 sm:px-0 sm:pb-0">
                {bill.lines.map((ln, idx) => {
                  const qty = qtys[ln.id] ?? Number(ln.qty);
                  const rate = rates[ln.id] ?? Number(ln.rate);
                  const received = ln.grnLine ? Number(ln.grnLine.receivedQty) : NaN;
                  const alreadyBilled = Number(ln.qty);
                  const remaining = Number.isFinite(received) ? Math.max(0, received - alreadyBilled) : NaN;
                  const gst = Number(ln.gstRate);
                  const p = computeLineTaxSplit(qty * rate, gst, bill.taxIntraState);
                  const gstAmt = p.cgstAmount + p.sgstAmount + p.igstAmount;

                  const qtyOk = Number.isFinite(qty) && qty > 0;
                  const rateOk = Number.isFinite(rate) && rate > 0;
                  const showQtyErr = shouldShowErr(ln.id, "qty") && !qtyOk;
                  const showRateErr = shouldShowErr(ln.id, "rate") && !rateOk;

                  return (
                    <div key={ln.id} className="rounded-md border border-slate-200 bg-white p-2">
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_130px] sm:items-start">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900 break-words">{ln.item.itemName}</div>
                          <div className="mt-1 text-xs text-slate-600">
                            Unit: <span className="tabular-nums">{ln.unitSnapshot || ln.item.unit || "—"}</span>{" "}
                            <span className="text-slate-400">|</span> HSN:{" "}
                            <span className="font-mono">{ln.hsnCodeSnapshot?.trim() ? ln.hsnCodeSnapshot : "—"}</span>{" "}
                            <span className="text-slate-400">|</span> GST: <span className="tabular-nums">{Number.isFinite(gst) ? `${gst}%` : "—"}</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-600">
                            Received: <span className="tabular-nums">{Number.isFinite(received) ? received : "—"}</span>{" "}
                            <span className="text-slate-400">|</span> Billed: <span className="tabular-nums">{Number.isFinite(alreadyBilled) ? alreadyBilled : "—"}</span>{" "}
                            <span className="text-slate-400">|</span> Remaining:{" "}
                            <span className="tabular-nums font-medium text-amber-800">{Number.isFinite(remaining) ? remaining : "—"}</span>
                          </div>
                        </div>

                        <label className="grid gap-1 text-xs font-medium text-slate-600">
                          Qty
                          <Input
                            ref={(el) => {
                              qtyRefs.current[idx] = el;
                            }}
                            className="h-9 text-right tabular-nums"
                            type="number"
                            step="any"
                            min={0}
                            disabled={editLocked}
                            value={Number.isFinite(qty) ? String(qty) : ""}
                            onBlur={() => setTouched(ln.id, "qty")}
                            onKeyDown={(e) => onQtyKeyDown(idx, e)}
                            onChange={(e) => setQty(ln.id, Number(e.target.value))}
                            onFocus={(e) => e.target.select()}
                          />
                          {showQtyErr ? <div className="text-[11px] font-normal text-red-700">Must be &gt; 0</div> : null}
                        </label>

                        <label className="grid gap-1 text-xs font-medium text-slate-600">
                          Rate
                          <Input
                            ref={(el) => {
                              rateRefs.current[idx] = el;
                            }}
                            className="h-9 text-right tabular-nums"
                            type="number"
                            step="any"
                            min={0}
                            disabled={editLocked}
                            value={Number.isFinite(rate) ? String(rate) : ""}
                            onBlur={() => setTouched(ln.id, "rate")}
                            onChange={(e) => setRate(ln.id, Number(e.target.value))}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => onRateKeyDown(idx, e)}
                          />
                          {showRateErr ? <div className="text-[11px] font-normal text-red-700">Must be &gt; 0</div> : null}
                        </label>
                      </div>

                      <div className="mt-2 text-xs text-slate-600">
                        Basic: <span className="tabular-nums text-slate-800">{formatMoney(p.basicAmount)}</span>{" "}
                        <span className="text-slate-400">|</span> GST amt: <span className="tabular-nums text-slate-800">{formatMoney(gstAmt)}</span>{" "}
                        <span className="text-slate-400">|</span> Total:{" "}
                        <span className="tabular-nums font-medium text-slate-900">{formatMoney(p.lineTotal)}</span>{" "}
                        <span className="text-slate-400">|</span> PO:{" "}
                        <span className="tabular-nums">{ln.rmPoId ? `RMPO-${ln.rmPoId}` : "—"}</span>{" "}
                        <span className="text-slate-400">|</span> GRN:{" "}
                        <span className="tabular-nums">{ln.grnId ? `GRN-${ln.grnId}` : "—"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 lg:sticky lg:top-6 lg:z-10 lg:self-start">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <div className="flex min-w-0 items-baseline justify-between gap-3 border-b border-slate-100 pb-2">
                <span className="min-w-0 shrink text-slate-600">Total basic</span>
                <span className="shrink-0 tabular-nums font-medium text-slate-900">{preview ? formatMoney(preview.totalBasic) : "—"}</span>
              </div>
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="min-w-0 shrink text-slate-600">CGST</span>
                <span className="shrink-0 tabular-nums text-slate-800">{preview ? formatMoney(preview.totalCgst) : "—"}</span>
              </div>
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="min-w-0 shrink text-slate-600">SGST</span>
                <span className="shrink-0 tabular-nums text-slate-800">{preview ? formatMoney(preview.totalSgst) : "—"}</span>
              </div>
              <div className="flex min-w-0 items-baseline justify-between gap-3 border-b border-slate-100 pb-2">
                <span className="min-w-0 shrink text-slate-600">IGST</span>
                <span className="shrink-0 tabular-nums text-slate-800">{preview ? formatMoney(preview.totalIgst) : "—"}</span>
              </div>
              <div className="flex min-w-0 items-baseline justify-between gap-3 border-b border-slate-100 pb-2">
                <span className="min-w-0 shrink text-slate-600">Total tax</span>
                <span className="shrink-0 tabular-nums font-medium text-slate-900">{preview ? formatMoney(preview.totalTax) : "—"}</span>
              </div>
              <div className="flex min-w-0 items-baseline justify-between gap-3 font-semibold">
                <span className="min-w-0 shrink text-slate-800">Net amount</span>
                <span className="shrink-0 tabular-nums text-slate-900">{preview ? formatMoney(preview.netAmount) : "—"}</span>
              </div>

              <div className="mt-2 min-w-0 rounded-md border border-slate-100 bg-slate-50/80 p-3 text-xs leading-relaxed text-slate-700">
                <div className="break-words">
                  <span className="font-medium text-slate-800">Supplier:</span> {bill.supplier.name}
                </div>
                <div>
                  <span className="font-medium text-slate-800">GRN ref:</span> {bill.grn?.id ? `GRN-${bill.grn.id}` : "Multiple GRNs"}
                </div>
                <div>
                  <span className="font-medium text-slate-800">Status:</span>{" "}
                  {readOnly ? <span className="text-emerald-800">Finalized</span> : <span className="text-amber-900">Draft</span>}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {bill ? (
        <div className="mt-4 max-w-3xl">
          <ActivityHistoryCard title="History" query={`entityType=PURCHASE_BILL&entityId=${bill.id}&limit=50`} />
        </div>
      ) : null}
    </PageContainer>
  );
}
