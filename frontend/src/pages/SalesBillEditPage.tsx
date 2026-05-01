import * as React from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch } from "../services/api";
import { getApiUrl } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { PageContainer, PageNoQtyFlowBackLink, PageSmartBackLink, StickyWorkspaceHead } from "../components/PageHeader";
import { displayDispatchNo, displaySalesOrderNo } from "../lib/docNoDisplay";
import { withReportsReturnContextIfPresent } from "../lib/drillDownRoutes";
import { ActivityHistoryCard } from "../components/ActivityHistoryCard";
import { BillExportStatusPanel } from "../components/BillExportStatusPanel";

type BillLine = {
  id: number;
  itemId: number;
  itemNameSnapshot: string;
  hsnCodeSnapshot: string;
  unitSnapshot: string;
  qty: string;
  rate: string;
  basicAmount: string;
  gstRate: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
  item: { id: number; itemName: string; unit: string };
};

type Bill = {
  id: number;
  docNo?: string | null;
  billNo: string | null;
  billDate: string;
  remarks: string | null;
  status: string;
  isExported?: boolean;
  exportedAt?: string | null;
  exportResetAt?: string | null;
  exportedBy?: { id: number; name: string } | null;
  customerId: number;
  dispatchId: number;
  totalBasic: string;
  totalCgst: string;
  totalSgst: string;
  totalIgst: string;
  totalTax: string;
  netAmount: string;
  finalizedAt: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  taxIntraState?: boolean;
  customer: { id: number; name: string };
  dispatch: { id: number; date: string; soId: number; docNo?: string | null; salesOrder?: { docNo?: string | null } };
  lines: BillLine[];
};

function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function n(v: string | number): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function formatMoney(n0: string | number): string {
  const x = n(n0);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function SalesBillEditPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [sp] = useSearchParams();
  const fromNoQtySo = (sp.get("source") ?? "") === "no_qty_so";
  const billId = Number(idParam);
  const isAdmin = useAuth().user?.role === "ADMIN";

  const [bill, setBill] = React.useState<Bill | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [billNo, setBillNo] = React.useState("");
  const [billDate, setBillDate] = React.useState("");
  const [remarks, setRemarks] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [adminCancelAuth, setAdminCancelAuth] = React.useState<{
    open: boolean;
    reason: string;
    password: string;
  } | null>(null);

  const readOnly = bill?.status === "FINALIZED" || bill?.status === "CANCELLED";

  React.useEffect(() => {
    if (!Number.isFinite(billId) || billId <= 0) {
      setLoadError("Invalid bill.");
      return;
    }
    setLoadError(null);
    apiFetch<Bill>(`/api/sales-bills/${billId}`)
      .then((b) => {
        setBill(b);
        setExportError(null);
        setBillNo(b.billNo?.trim() ?? "");
        setBillDate(toDateInputValue(b.billDate));
        setRemarks(b.remarks?.trim() ?? "");
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load this bill."));
  }, [billId]);

  async function saveDraft() {
    if (!bill || readOnly) return;
    setFormError(null);
    setSaving(true);
    try {
      const body = { billNo: billNo.trim() || null, billDate, remarks: remarks.trim() || null };
      const updated = await apiFetch<Bill>(`/api/sales-bills/${bill.id}`, { method: "PUT", body: JSON.stringify(body) });
      setBill(updated);
      setBillNo(updated.billNo?.trim() ?? "");
      setBillDate(toDateInputValue(updated.billDate));
      setRemarks(updated.remarks?.trim() ?? "");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function finalize() {
    if (!bill || readOnly) return;
    setFormError(null);
    setSaving(true);
    try {
      const body = { billNo: billNo.trim() || null, billDate, remarks: remarks.trim() || null };
      await apiFetch<Bill>(`/api/sales-bills/${bill.id}`, { method: "PUT", body: JSON.stringify(body) });
      const finalized = await apiFetch<Bill>(`/api/sales-bills/${bill.id}/finalize`, { method: "POST", body: JSON.stringify({}) });
      setBill(finalized);
      setBillNo(finalized.billNo?.trim() ?? "");
      setBillDate(toDateInputValue(finalized.billDate));
      setRemarks(finalized.remarks?.trim() ?? "");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not finalize.");
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
      const res = await fetch(getApiUrl(`/api/sales-bills/${bill.id}/export/tally.xml`), {
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
      const safeNo = (bill.billNo?.trim() ? bill.billNo.trim() : `SB-${bill.id}`).replace(/[^\w\-\.]+/g, "-");
      a.download = `sales-bill-${safeNo}.xml`;
      a.click();
      URL.revokeObjectURL(a.href);
      alert("Tally XML downloaded.");
      const refreshed = await apiFetch<Bill>(`/api/sales-bills/${bill.id}`);
      setBill(refreshed);
      setExportError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not export to Tally";
      setExportError(msg);
      setFormError(msg);
      alert(msg);
    } finally {
      setExporting(false);
    }
  }

  async function deleteDraft() {
    if (!bill || bill.status !== "DRAFT" || bill.isExported || deleting) return;
    const ok = window.confirm("Delete this draft sales bill?");
    if (!ok) return;
    setDeleting(true);
    setFormError(null);
    try {
      await apiFetch(`/api/sales-bills/${bill.id}`, { method: "DELETE" });
      alert("Draft sales bill deleted.");
      navigate(withReportsReturnContextIfPresent("/sales-bills", location.search));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not delete draft bill.";
      setFormError(msg);
      alert(msg);
    } finally {
      setDeleting(false);
    }
  }

  async function resetExport() {
    if (!bill || !bill.isExported || !isAdmin || resetting) return;
    const reasonRaw = window.prompt("Reason for resetting export?");
    const reason = (reasonRaw || "").trim();
    if (!reason) {
      alert("Reason is required.");
      return;
    }
    setResetting(true);
    setFormError(null);
    try {
      await apiFetch(`/api/sales-bills/${bill.id}/reset-export`, { method: "POST", body: JSON.stringify({ reason }) });
      const refreshed = await apiFetch<Bill>(`/api/sales-bills/${bill.id}`);
      setBill(refreshed);
      setExportError(null);
      alert("Export reset successfully");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not reset export.";
      setFormError(msg);
      alert(msg);
    } finally {
      setResetting(false);
    }
  }

  async function cancelFinalized() {
    if (!bill || bill.status !== "FINALIZED" || cancelling) return;
    const reasonRaw = window.prompt("Cancellation reason?");
    const reason = (reasonRaw || "").trim();
    if (!reason) {
      alert("Cancellation reason is required.");
      return;
    }
    if (bill.isExported) {
      if (!isAdmin) {
        alert("This sales bill is exported to Tally. Admin authorization is required to cancel.");
        return;
      }
      setAdminCancelAuth({ open: true, reason, password: "" });
      return;
    }
    setCancelling(true);
    setFormError(null);
    try {
      const updated = await apiFetch<Bill>(`/api/sales-bills/${bill.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
      setBill(updated);
      alert("Sales bill cancelled.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not cancel.";
      setFormError(msg);
      alert(msg);
    } finally {
      setCancelling(false);
    }
  }

  async function approveExportedCancel() {
    if (!bill || bill.status !== "FINALIZED" || !bill.isExported || !adminCancelAuth?.open || cancelling) return;
    const password = adminCancelAuth.password.trim();
    if (!password) {
      setFormError("Admin password is required.");
      return;
    }
    setCancelling(true);
    setFormError(null);
    try {
      const updated = await apiFetch<Bill>(`/api/sales-bills/${bill.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: adminCancelAuth.reason, adminPassword: password }),
      });
      setBill(updated);
      setAdminCancelAuth(null);
      alert("Sales bill cancelled.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not cancel.";
      setFormError(msg);
      alert(msg);
    } finally {
      setCancelling(false);
    }
  }

  if (loadError) {
    return (
      <PageContainer className="space-y-4">
        <StickyWorkspaceHead
          lead={
            fromNoQtySo ? (
              <PageNoQtyFlowBackLink step="SALES_BILL" />
            ) : (
              <PageSmartBackLink defaultTo="/sales-bills" defaultLabel="Back to sales bills" />
            )
          }
        />
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
              <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => setAdminCancelAuth(null)} disabled={cancelling}>
                Cancel
              </Button>
              <Button type="button" className="h-8 text-xs" onClick={() => void approveExportedCancel()} disabled={cancelling}>
                {cancelling ? "…" : "Approve Reverse"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <StickyWorkspaceHead
        lead={
          fromNoQtySo ? (
            <PageNoQtyFlowBackLink step="SALES_BILL" />
          ) : (
            <PageSmartBackLink defaultTo="/sales-bills" defaultLabel="Back to sales bills" />
          )
        }
      >
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
          <div className="min-w-0 space-y-1">
            <h1 className="text-lg font-semibold leading-snug text-slate-900">Sales bill</h1>
            <p className="text-sm leading-relaxed text-slate-600">
              {bill.status === "CANCELLED" ? "Cancelled Sales Bill (view only)" : readOnly ? "View finalized Sales Bill" : "Edit Sales Bill"}
            </p>
            <p className="text-xs leading-relaxed text-slate-600">
              Sales Bill is created only from actual dispatch quantity (not from WO / Production / QC quantities).
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              data-testid="save-sales-bill-draft-btn"
              disabled={readOnly || saving}
              onClick={() => void saveDraft()}
            >
              Save draft
            </Button>
            <Button type="button" data-testid="finalize-sales-bill-btn" disabled={readOnly || saving} onClick={() => void finalize()}>
              Finalize bill
            </Button>
            {bill.status === "DRAFT" ? (
              <Button
                type="button"
                variant="destructive"
                data-testid="delete-sales-bill-draft-btn"
                disabled={deleting || bill.isExported}
                onClick={() => void deleteDraft()}
              >
                Delete draft
              </Button>
            ) : null}
            {bill.status === "FINALIZED" ? (
              <Button type="button" variant="outline" data-testid="cancel-sales-bill-btn" disabled={cancelling} onClick={() => void cancelFinalized()}>
                Cancel bill
              </Button>
            ) : null}
          </div>
        </div>
      </StickyWorkspaceHead>

      {formError ? (
        <div className="min-w-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-800 break-words">
          {formError}
        </div>
      ) : null}

      <BillExportStatusPanel
        lifecycle={bill.status === "CANCELLED" ? "CANCELLED" : bill.status === "FINALIZED" ? "FINALIZED" : "DRAFT"}
        isExported={Boolean(bill.isExported)}
        exportedAt={bill.exportedAt}
        exportedByName={bill.exportedBy?.name ?? null}
        exportBlockedReason={null}
        exportAttemptError={exportError}
        exportResetAt={bill.exportResetAt ?? null}
        isAdmin={isAdmin}
        exporting={exporting}
        resetting={resetting}
        onExport={exportToTally}
        onResetExport={resetExport}
      />

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Bill details</CardTitle>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-4">
            <div className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Customer</span>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">{bill.customer.name}</div>
            </div>
            <div className="grid gap-1 sm:grid-cols-2 sm:gap-4">
              <div className="grid gap-1">
                <span className="text-xs font-medium text-slate-600">Bill no.</span>
                <Input value={billNo} disabled={readOnly} onChange={(e) => setBillNo(e.target.value)} placeholder="Optional draft; required for export" />
              </div>
              <div className="grid gap-1">
                <span className="text-xs font-medium text-slate-600">Bill date</span>
                <Input type="date" value={billDate} disabled={readOnly} onChange={(e) => setBillDate(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Dispatch ref</span>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600">Dispatch No</span>
                    <span className="rounded border border-violet-200 bg-violet-50 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-violet-900">
                      {displayDispatchNo(bill.dispatchId, bill.dispatch.docNo)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600">Sales Order No</span>
                    <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-sky-900">
                      {displaySalesOrderNo(bill.dispatch.soId, bill.dispatch.salesOrder?.docNo)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Remarks</span>
              <Input value={remarks} disabled={readOnly} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
            </div>
            {bill.status === "CANCELLED" ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <div className="font-medium">Cancelled</div>
                {bill.cancelReason ? <div className="break-words">Reason: {bill.cancelReason}</div> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Totals</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-600">Taxable</span>
              <span className="tabular-nums">{formatMoney(bill.totalBasic)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-600">CGST</span>
              <span className="tabular-nums">{formatMoney(bill.totalCgst)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-600">SGST</span>
              <span className="tabular-nums">{formatMoney(bill.totalSgst)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-600">IGST</span>
              <span className="tabular-nums">{formatMoney(bill.totalIgst)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 font-medium">
              <span className="text-slate-900">Grand total</span>
              <span className="tabular-nums text-slate-900">{formatMoney(bill.netAmount)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Line items</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 p-0 sm:p-6 sm:pt-0">
          <div className="min-w-0 overflow-x-auto px-3 pb-4 sm:px-0 sm:pb-0">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">HSN</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2">Unit</th>
                  <th className="px-4 py-2 text-right">Rate</th>
                  <th className="px-4 py-2 text-right">Taxable</th>
                  <th className="px-4 py-2 text-right">Tax</th>
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {bill.lines.map((ln, _idx) => {
                  const tax = n(ln.cgstAmount) + n(ln.sgstAmount) + n(ln.igstAmount);
                  return (
                    <tr key={ln.id} className="border-b border-slate-100">
                      <td className="px-4 py-2 text-slate-800">{ln.itemNameSnapshot || ln.item.itemName}</td>
                      <td className="px-4 py-2 text-slate-700">{ln.hsnCodeSnapshot || "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-800">{ln.qty}</td>
                      <td className="px-4 py-2 text-slate-700">{ln.unitSnapshot}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                        <span className="inline-flex min-w-[6rem] justify-end rounded-md border border-slate-200 bg-slate-50 px-2 py-1 tabular-nums">
                          {Number(ln.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-800">{formatMoney(ln.basicAmount)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-800">{formatMoney(tax)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-900">{formatMoney(ln.lineTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {bill ? (
        <div className="mt-4 max-w-3xl">
          <ActivityHistoryCard title="History" query={`entityType=SALES_BILL&entityId=${bill.id}&limit=50`} />
        </div>
      ) : null}
    </PageContainer>
  );
}

