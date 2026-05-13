import * as React from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch } from "../services/api";
import { getApiUrl } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../contexts/ToastContext";
import { PageContainer, PageSmartBackLink } from "../components/PageHeader";
import { displayDispatchNo, displaySalesOrderNo } from "../lib/docNoDisplay";
import { withReportsReturnContextIfPresent } from "../lib/drillDownRoutes";
import { ActivityHistoryCard } from "../components/ActivityHistoryCard";
import { BillExportStatusPanel } from "../components/BillExportStatusPanel";
import { Badge } from "../components/ui/badge";
import {
  OperationalContextBar,
  OperationalContextSticky,
  OperationalWorkspaceFooter,
  OpCtxSep,
} from "../components/erp/OperationalWorkspaceChrome";
import { cn } from "../lib/utils";

type SalesBillReceiptRow = {
  id: number;
  receiptDate: string;
  amount: string | number;
  mode: string;
  referenceNo?: string | null;
  remarks?: string | null;
  createdAt: string;
  createdBy?: { id: number; name: string } | null;
};

function billOrderTypeLabel(ot?: string | null): string {
  if (ot === "NO_QTY") return "NO_QTY";
  if (ot === "NORMAL") return "REGULAR";
  if (ot === "REPLACEMENT") return "REPLACEMENT";
  return ot?.trim() ? String(ot) : "—";
}

type BillLine = {
  id: number;
  itemId: number;
  itemNameSnapshot: string;
  hsnCodeSnapshot: string;
  unitSnapshot: string;
  qty: string;
  rate: string;
  rateEffectiveFrom?: string | null;
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
  paymentStatus?: string;
  dueDate?: string | null;
  receivedAmount?: string;
  pendingAmount?: string;
  paymentRemarks?: string | null;
  finalizedAt: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  taxIntraState?: boolean;
  customer: { id: number; name: string };
  dispatch: {
    id: number;
    date: string;
    soId: number;
    docNo?: string | null;
    salesOrder?: { docNo?: string | null; orderType?: "NORMAL" | "REPLACEMENT" | "NO_QTY" };
  };
  lines: BillLine[];
  receipts?: SalesBillReceiptRow[];
};

type SoHeadLite = {
  orderType?: "NORMAL" | "REPLACEMENT" | "NO_QTY";
  internalStatus?: string;
  currentCycle?: { id?: number; cycleNo?: number | null } | null;
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

function formatEffectiveDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

const COMMERCIAL_PAYMENT_MODES = ["CASH", "BANK", "UPI", "CHEQUE", "OTHER"] as const;

function todayDateInput(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function SalesBillEditPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const billId = Number(idParam);
  const userRole = useAuth().user?.role;
  const toast = useToast();
  const isAdmin = userRole === "ADMIN";
  const canEditPaymentTracking = userRole === "ADMIN" || userRole === "SALES" || userRole === "ACCOUNTS";

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
  const [payDue, setPayDue] = React.useState("");
  const [payRemarks, setPayRemarks] = React.useState("");
  const [rcDate, setRcDate] = React.useState(() => todayDateInput());
  const [rcAmount, setRcAmount] = React.useState("");
  const [rcMode, setRcMode] = React.useState<(typeof COMMERCIAL_PAYMENT_MODES)[number]>("BANK");
  const [rcRef, setRcRef] = React.useState("");
  const [rcRemarks, setRcRemarks] = React.useState("");
  const [rcAdminPwd, setRcAdminPwd] = React.useState("");
  const [paySaving, setPaySaving] = React.useState(false);
  const [rcSaving, setRcSaving] = React.useState(false);
  const [adminCancelAuth, setAdminCancelAuth] = React.useState<{
    open: boolean;
    reason: string;
    password: string;
  } | null>(null);
  const [adminRateDlg, setAdminRateDlg] = React.useState<{ lineId: number; password: string } | null>(null);
  const [localRates, setLocalRates] = React.useState<Record<number, string>>({});
  const [applyingRate, setApplyingRate] = React.useState(false);
  const [soHead, setSoHead] = React.useState<SoHeadLite | null>(null);

  const readOnly = bill?.status === "FINALIZED" || bill?.status === "CANCELLED";
  const soId = bill?.dispatch.soId ?? 0;

  const loadSoHead = React.useCallback(async (salesOrderId: number) => {
    if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
      setSoHead(null);
      return;
    }
    try {
      const so = await apiFetch<SoHeadLite & { currentCycle?: SoHeadLite["currentCycle"] }>(`/api/sales-orders/${salesOrderId}`);
      setSoHead({
        orderType: so.orderType,
        internalStatus: so.internalStatus,
        currentCycle: so.currentCycle ?? null,
      });
    } catch {
      setSoHead(null);
    }
  }, []);

  React.useEffect(() => {
    if (!bill?.dispatch.soId || bill.dispatch.soId <= 0) {
      setSoHead(null);
      return;
    }
    void loadSoHead(bill.dispatch.soId);
  }, [bill?.dispatch.soId, loadSoHead]);

  const isNoQtyBill =
    (soHead?.orderType ?? bill?.dispatch?.salesOrder?.orderType) === "NO_QTY";

  /** REGULAR (NORMAL) SO: post–Tally export completion — not drafts, not NO_QTY (has its own card). */
  const resolvedOrderTypeForCompletion = soHead?.orderType ?? bill?.dispatch?.salesOrder?.orderType;
  const showRegularExportCompletePanel = Boolean(
    bill &&
      bill.status === "FINALIZED" &&
      bill.isExported === true &&
      resolvedOrderTypeForCompletion !== "NO_QTY" &&
      (resolvedOrderTypeForCompletion === "NORMAL" || resolvedOrderTypeForCompletion == null),
  );

  const netDeliveredQtyTotal = React.useMemo(() => {
    if (!bill?.lines?.length) return 0;
    return bill.lines.reduce((s, l) => s + n(l.qty), 0);
  }, [bill]);

  /** Informational only — no links (accounts screen). */
  const showNoQtyExportedOpsNote = Boolean(
    bill && isNoQtyBill && bill.status === "FINALIZED" && bill.isExported,
  );

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
        const nextRates: Record<number, string> = {};
        for (const ln of b.lines) {
          nextRates[ln.id] = String(Number(ln.rate));
        }
        setLocalRates(nextRates);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load this bill."));
  }, [billId]);

  React.useEffect(() => {
    if (!bill || bill.status !== "FINALIZED") return;
    setPayDue(bill.dueDate ? toDateInputValue(bill.dueDate) : "");
    setPayRemarks(bill.paymentRemarks?.trim() ?? "");
  }, [bill?.id, bill?.status, bill?.dueDate, bill?.paymentRemarks]);

  const showNoQtyRateUi = bill?.dispatch?.salesOrder?.orderType === "NO_QTY";
  const firstLine = bill?.lines?.[0];
  const headlineApplicableRate =
    firstLine != null ? formatMoney(firstLine.rate) : "—";
  const headlineEffective =
    firstLine?.rateEffectiveFrom != null ? formatEffectiveDate(firstLine.rateEffectiveFrom) : "—";

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
      await loadSoHead(finalized.dispatch.soId);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not finalize.");
    } finally {
      setSaving(false);
    }
  }

  async function savePaymentTracking() {
    if (!bill || bill.status !== "FINALIZED" || bill.cancelledAt || !canEditPaymentTracking) return;
    setPaySaving(true);
    setFormError(null);
    try {
      const body = {
        dueDate: payDue.trim() ? payDue : null,
        paymentRemarks: payRemarks.trim() || null,
      };
      const updated = await apiFetch<Bill>(`/api/sales-bills/${bill.id}/payment-tracking`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setBill(updated);
      toast.showSuccess("Payment tracking saved.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save payment tracking.";
      setFormError(msg);
      toast.showError(msg);
    } finally {
      setPaySaving(false);
    }
  }

  async function addReceipt() {
    if (!bill || bill.status !== "FINALIZED" || bill.cancelledAt || !canEditPaymentTracking) return;
    const amt = Number(rcAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.showError("Enter a positive receipt amount.");
      return;
    }
    setRcSaving(true);
    setFormError(null);
    try {
      const body: Record<string, unknown> = {
        receiptDate: rcDate,
        amount: amt,
        mode: rcMode,
        referenceNo: rcRef.trim() || null,
        remarks: rcRemarks.trim() || null,
      };
      if (rcAdminPwd.trim()) body.adminPassword = rcAdminPwd.trim();
      const updated = await apiFetch<Bill>(`/api/sales-bills/${bill.id}/receipts`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setBill(updated);
      setRcAmount("");
      setRcRef("");
      setRcRemarks("");
      setRcAdminPwd("");
      toast.showSuccess("Receipt added.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not add receipt.";
      setFormError(msg);
      toast.showError(msg);
    } finally {
      setRcSaving(false);
    }
  }

  async function deleteReceipt(receiptId: number) {
    if (!bill || bill.status !== "FINALIZED" || bill.cancelledAt || !canEditPaymentTracking) return;
    let adminPassword: string | undefined;
    if (!isAdmin) {
      const p = window.prompt("Enter an admin password to remove this receipt:");
      if (p == null) return;
      if (!String(p).trim()) {
        toast.showError("Admin password required to delete a receipt.");
        return;
      }
      adminPassword = String(p).trim();
    }
    setPaySaving(true);
    setFormError(null);
    try {
      const updated = await apiFetch<Bill>(`/api/sales-bills/${bill.id}/receipts/${receiptId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adminPassword ? { adminPassword } : {}),
      });
      setBill(updated);
      toast.showSuccess("Receipt removed.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not delete receipt.";
      setFormError(msg);
      toast.showError(msg);
    } finally {
      setPaySaving(false);
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
      await loadSoHead(refreshed.dispatch.soId);
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

  async function submitAdminRateCorrection() {
    if (!bill || !adminRateDlg) return;
    const pwd = adminRateDlg.password.trim();
    if (!pwd) {
      setFormError("Admin password is required.");
      return;
    }
    const rate = Number(localRates[adminRateDlg.lineId]);
    if (!Number.isFinite(rate) || rate <= 0) {
      setFormError("Enter a valid rate.");
      return;
    }
    setApplyingRate(true);
    setFormError(null);
    try {
      const updated = await apiFetch<Bill>(`/api/sales-bills/${bill.id}/lines/${adminRateDlg.lineId}/rate`, {
        method: "PATCH",
        body: JSON.stringify({ rate, adminPassword: pwd }),
      });
      setBill(updated);
      setAdminRateDlg(null);
      const nextRates: Record<number, string> = {};
      for (const ln of updated.lines) {
        nextRates[ln.id] = String(Number(ln.rate));
      }
      setLocalRates(nextRates);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not update rate.");
    } finally {
      setApplyingRate(false);
    }
  }

  if (loadError) {
    return (
      <PageContainer className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <PageSmartBackLink defaultTo="/sales-bills" defaultLabel="Back to sales bills" />
        </div>
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
      {adminRateDlg != null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="text-sm font-semibold text-slate-900">Confirm rate correction</div>
              <div className="mt-1 text-xs text-slate-600">Enter your admin password to apply the edited rate on this draft bill.</div>
            </div>
            <div className="px-4 py-3">
              <label className="block text-xs font-medium text-slate-700">Admin password</label>
              <Input
                type="password"
                className="mt-1 h-9"
                value={adminRateDlg.password}
                onChange={(e) => setAdminRateDlg((s) => (s ? { ...s, password: e.target.value } : s))}
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <Button
                type="button"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => setAdminRateDlg(null)}
                disabled={applyingRate}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="h-8 text-xs"
                onClick={() => void submitAdminRateCorrection()}
                disabled={applyingRate}
              >
                {applyingRate ? "…" : "Apply"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <OperationalContextSticky className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <PageSmartBackLink defaultTo="/sales-bills" defaultLabel="Back to sales bills" />
          <h1 className="text-sm font-semibold leading-tight text-slate-900">Sales bill</h1>
          <span className="text-[11px] text-slate-500">
            {bill.status === "CANCELLED"
              ? "Cancelled"
              : readOnly
                ? "View only"
                : "Draft"}
          </span>
        </div>
        <OperationalContextBar>
          <span className="font-semibold text-slate-600">SO</span>
          <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-sky-950">
            {displaySalesOrderNo(bill.dispatch.soId, bill.dispatch.salesOrder?.docNo)}
          </span>
          <OpCtxSep />
          <span className="max-w-[14rem] truncate font-medium text-slate-800" title={bill.customer.name}>
            {bill.customer.name}
          </span>
          <OpCtxSep />
          <Badge variant="default" className="h-5 rounded-md border-slate-200 px-1.5 text-[10px] font-semibold text-slate-700">
            {billOrderTypeLabel(soHead?.orderType ?? bill.dispatch.salesOrder?.orderType)}
          </Badge>
          {soHead?.currentCycle?.cycleNo != null && Number.isFinite(Number(soHead.currentCycle.cycleNo)) ? (
            <>
              <OpCtxSep />
              <span className="font-medium text-slate-700">Cycle {soHead.currentCycle.cycleNo}</span>
            </>
          ) : null}
          <OpCtxSep />
          <span className="font-semibold text-slate-600">Dispatch</span>
          <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-violet-900">
            {displayDispatchNo(bill.dispatchId, bill.dispatch.docNo)}
          </span>
          <OpCtxSep />
          <span className="font-semibold text-slate-600">Bill</span>
          <span className="font-mono text-[11px] font-semibold text-slate-900">
            {bill.docNo?.trim()
              ? bill.docNo.trim()
              : bill.billNo?.trim()
                ? bill.billNo.trim()
                : `#${bill.id}`}
          </span>
          <OpCtxSep />
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px] font-semibold",
              bill.status === "CANCELLED"
                ? "bg-red-50 text-red-900 ring-1 ring-red-200"
                : bill.status === "FINALIZED"
                  ? "bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200"
                  : "bg-amber-50 text-amber-950 ring-1 ring-amber-200",
            )}
          >
            {bill.status === "DRAFT" ? "Draft" : bill.status === "FINALIZED" ? "Finalized" : "Cancelled"}
          </span>
          {bill.status === "FINALIZED" ? (
            <>
              <OpCtxSep />
              <span className={cn("text-[11px] font-semibold", bill.isExported ? "text-emerald-800" : "text-slate-600")}>
                {bill.isExported ? "Exported" : "Not exported"}
              </span>
            </>
          ) : null}
        </OperationalContextBar>
      </OperationalContextSticky>

      {formError ? (
        <div className="min-w-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-800 break-words">
          {formError}
        </div>
      ) : null}

      <div className="erp-workspace-2col">
        <div className="min-w-0 space-y-3">
          <Card className="min-w-0 overflow-hidden shadow-sm ring-1 ring-slate-100">
            <CardHeader className="border-b border-slate-100 pb-2 pt-3">
              <CardTitle className="text-sm font-semibold text-slate-900">Bill details</CardTitle>
            </CardHeader>
            <CardContent className="grid min-w-0 gap-3 pt-3">
              <div className="grid gap-1">
                <span className="text-xs font-medium text-slate-600">Customer</span>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">{bill.customer.name}</div>
              </div>
              <div className="grid gap-1 sm:grid-cols-2 sm:gap-3">
                <div className="grid gap-1">
                  <span className="text-xs font-medium text-slate-600">Bill no.</span>
                  <Input value={billNo} disabled={readOnly} onChange={(e) => setBillNo(e.target.value)} placeholder="Optional draft; required for export" />
                </div>
                <div className="grid gap-1">
                  <span className="text-xs font-medium text-slate-600">Bill date *</span>
                  <Input type="date" value={billDate} disabled={readOnly} onChange={(e) => setBillDate(e.target.value)} />
                </div>
              </div>
              {showNoQtyRateUi ? (
                <div className="rounded-md border border-amber-100 bg-amber-50/90 px-3 py-2 text-sm text-amber-950">
                  <div className="font-semibold">
                    Applicable rate: ₹{headlineApplicableRate}{" "}
                    <span className="font-normal text-amber-900/90">(Effective from {headlineEffective})</span>
                  </div>
                  <p className="mt-1 text-xs leading-snug text-amber-900/85">Rate follows bill date.</p>
                </div>
              ) : null}
              <div className="erp-context-inline rounded border border-slate-200 bg-slate-50/80 px-2 py-1.5">
                <span className="text-slate-500">Dispatch</span>
                <span className="font-mono text-[11px] font-semibold text-violet-900">{displayDispatchNo(bill.dispatchId, bill.dispatch.docNo)}</span>
                <span className="text-slate-300">|</span>
                <span className="text-slate-500">SO</span>
                <span className="font-mono text-[11px] font-semibold text-sky-900">
                  {displaySalesOrderNo(bill.dispatch.soId, bill.dispatch.salesOrder?.docNo)}
                </span>
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

          <Card className="min-w-0 overflow-hidden shadow-sm ring-1 ring-slate-100">
            <CardHeader className="border-b border-slate-100 pb-2 pt-3">
              <CardTitle className="text-sm font-semibold text-slate-900">Line items</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0 p-0 sm:p-4 sm:pt-0">
              <div className="erp-table-wrap border-0 shadow-none">
                <div className="min-w-0 overflow-x-auto">
                  <table className="erp-table erp-table-dense w-full min-w-[980px] border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                        <th>Item</th>
                        <th>HSN</th>
                        <th className="text-right">Qty</th>
                        <th>Unit</th>
                        {showNoQtyRateUi ? <th className="text-right">Eff. from</th> : null}
                        <th className="text-right">Rate</th>
                        <th className="text-right">Taxable</th>
                        <th className="text-right">Tax</th>
                        <th className="text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bill.lines.map((ln, _idx) => {
                        const tax = n(ln.cgstAmount) + n(ln.sgstAmount) + n(ln.igstAmount);
                        return (
                          <tr key={ln.id} className="border-b border-slate-100">
                            <td className="text-slate-800">{ln.itemNameSnapshot || ln.item.itemName}</td>
                            <td className="text-slate-700">{ln.hsnCodeSnapshot || "—"}</td>
                            <td className="text-right tabular-nums text-slate-800">{ln.qty}</td>
                            <td className="text-slate-700">{ln.unitSnapshot}</td>
                            {showNoQtyRateUi ? (
                              <td className="text-right text-xs text-slate-600">{formatEffectiveDate(ln.rateEffectiveFrom)}</td>
                            ) : null}
                            <td className="text-right tabular-nums text-slate-800">
                              {showNoQtyRateUi && bill.status === "DRAFT" && !bill.isExported && isAdmin ? (
                                <div className="inline-flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                                  <Input
                                    className="h-8 w-28 tabular-nums"
                                    value={localRates[ln.id] ?? String(Number(ln.rate))}
                                    onChange={(e) =>
                                      setLocalRates((prev) => ({ ...prev, [ln.id]: e.target.value }))
                                    }
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 shrink-0 text-[11px]"
                                    onClick={() => setAdminRateDlg({ lineId: ln.id, password: "" })}
                                  >
                                    Apply
                                  </Button>
                                </div>
                              ) : (
                                <span className="inline-flex min-w-[6rem] justify-end rounded-md border border-slate-200 bg-slate-50 px-2 py-1 tabular-nums">
                                  {Number(ln.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                                </span>
                              )}
                            </td>
                            <td className="text-right tabular-nums text-slate-800">{formatMoney(ln.basicAmount)}</td>
                            <td className="text-right tabular-nums text-slate-800">{formatMoney(tax)}</td>
                            <td className="text-right tabular-nums font-medium text-slate-900">{formatMoney(ln.lineTotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0 space-y-3 lg:sticky lg:top-[4.5rem] lg:self-start">
          <Card className="overflow-hidden shadow-sm ring-1 ring-slate-100">
            <CardHeader className="border-b border-slate-100 pb-2 pt-3">
              <CardTitle className="text-sm font-semibold text-slate-900">Totals</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1.5 pt-3 text-sm">
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
              <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-2 font-medium">
                <span className="text-slate-900">Grand total</span>
                <span className="tabular-nums text-slate-900">{formatMoney(bill.netAmount)}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden shadow-sm ring-1 ring-slate-100">
            <CardHeader className="border-b border-slate-100 pb-2 pt-3">
              <CardTitle className="text-sm font-semibold text-slate-900">Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pt-3">
              <Button type="button" data-testid="finalize-sales-bill-btn" disabled={readOnly || saving} onClick={() => void finalize()}>
                Finalize bill
              </Button>
              <Button
                type="button"
                variant="outline"
                data-testid="save-sales-bill-draft-btn"
                disabled={readOnly || saving}
                onClick={() => void saveDraft()}
              >
                Save draft
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
            </CardContent>
          </Card>

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
            density="compact"
            className="shadow-none ring-1 ring-slate-100"
          />

          {bill.status === "FINALIZED" && !bill.cancelledAt ? (
            <Card className="overflow-hidden shadow-sm ring-1 ring-slate-100">
              <CardHeader className="border-b border-slate-100 pb-2 pt-3">
                <CardTitle className="text-sm font-semibold text-slate-900">Payment tracking</CardTitle>
                <p className="text-[11px] leading-snug text-slate-500">
                  Commercial follow-up only — not statutory accounting. Status updates from received vs net.
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-3">
                <div className="flex flex-wrap gap-3 text-[12px]">
                  <span className="text-slate-600">
                    Status:{" "}
                    <span className="font-semibold tabular-nums text-slate-900">{bill.paymentStatus ?? "—"}</span>
                  </span>
                  <span className="text-slate-600">
                    Net: <span className="font-semibold tabular-nums text-slate-900">{formatMoney(bill.netAmount)}</span>
                  </span>
                  <span className="text-slate-600">
                    Received:{" "}
                    <span className="font-semibold tabular-nums text-slate-900">
                      {bill.receivedAmount != null ? formatMoney(bill.receivedAmount) : "—"}
                    </span>
                  </span>
                  <span className="text-slate-600">
                    Pending:{" "}
                    <span className="font-semibold tabular-nums text-slate-900">
                      {bill.pendingAmount != null ? formatMoney(bill.pendingAmount) : formatMoney(bill.netAmount)}
                    </span>
                  </span>
                </div>

                <div className="overflow-x-auto rounded-md border border-slate-100">
                  <table className="erp-table erp-table-dense w-full min-w-[520px] text-[11px] [&_td]:py-1 [&_th]:py-1">
                    <thead>
                      <tr>
                        <th className="text-left">Date</th>
                        <th className="text-right">Amount</th>
                        <th className="text-left">Mode</th>
                        <th className="text-left">Ref</th>
                        <th className="text-left">Remarks</th>
                        <th className="text-right"> </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(bill.receipts ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-slate-500">
                            No receipts yet.
                          </td>
                        </tr>
                      ) : (
                        (bill.receipts ?? []).map((r) => (
                          <tr key={r.id}>
                            <td className="whitespace-nowrap">{formatEffectiveDate(r.receiptDate)}</td>
                            <td className="text-right tabular-nums font-medium">{formatMoney(r.amount)}</td>
                            <td>{r.mode}</td>
                            <td className="max-w-[6rem] truncate" title={r.referenceNo ?? ""}>
                              {r.referenceNo ?? "—"}
                            </td>
                            <td className="max-w-[8rem] truncate" title={r.remarks ?? ""}>
                              {r.remarks ?? "—"}
                            </td>
                            <td className="text-right">
                              {canEditPaymentTracking ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-[11px] text-rose-700"
                                  disabled={paySaving}
                                  onClick={() => void deleteReceipt(r.id)}
                                >
                                  Remove
                                </Button>
                              ) : null}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {canEditPaymentTracking ? (
                  <div className="grid gap-2 rounded-md border border-slate-100 bg-slate-50/50 p-2">
                    <div className="text-[11px] font-medium text-slate-700">Add receipt</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-0.5 text-[11px] text-slate-600">
                        Date
                        <Input type="date" value={rcDate} onChange={(e) => setRcDate(e.target.value)} disabled={rcSaving} />
                      </label>
                      <label className="grid gap-0.5 text-[11px] text-slate-600">
                        Amount
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={rcAmount}
                          onChange={(e) => setRcAmount(e.target.value)}
                          disabled={rcSaving}
                        />
                      </label>
                      <label className="grid gap-0.5 text-[11px] text-slate-600">
                        Mode
                        <select
                          className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                          value={rcMode}
                          onChange={(e) => setRcMode(e.target.value as (typeof COMMERCIAL_PAYMENT_MODES)[number])}
                          disabled={rcSaving}
                        >
                          {COMMERCIAL_PAYMENT_MODES.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-0.5 text-[11px] text-slate-600">
                        Reference no.
                        <Input value={rcRef} onChange={(e) => setRcRef(e.target.value)} disabled={rcSaving} />
                      </label>
                    </div>
                    <label className="grid gap-0.5 text-[11px] text-slate-600">
                      Line remarks
                      <Input value={rcRemarks} onChange={(e) => setRcRemarks(e.target.value)} disabled={rcSaving} />
                    </label>
                    <label className="grid gap-0.5 text-[11px] text-slate-600">
                      Admin password (only if the system asks for confirmation)
                      <Input
                        type="password"
                        autoComplete="off"
                        value={rcAdminPwd}
                        onChange={(e) => setRcAdminPwd(e.target.value)}
                        disabled={rcSaving}
                      />
                    </label>
                    <Button type="button" size="sm" disabled={rcSaving} onClick={() => void addReceipt()}>
                      {rcSaving ? "Adding…" : "Add receipt"}
                    </Button>
                  </div>
                ) : null}

                <div className="grid gap-2 border-t border-slate-100 pt-3">
                  <div className="text-[11px] font-medium text-slate-700">Due date &amp; bill remarks</div>
                  <label className="text-[11px] font-medium text-slate-600" htmlFor="sb-pay-due">
                    Due date
                  </label>
                  <Input
                    id="sb-pay-due"
                    type="date"
                    value={payDue}
                    onChange={(e) => setPayDue(e.target.value)}
                    disabled={!canEditPaymentTracking || paySaving}
                  />
                  <label className="text-[11px] font-medium text-slate-600" htmlFor="sb-pay-remarks">
                    Remarks
                  </label>
                  <textarea
                    id="sb-pay-remarks"
                    rows={2}
                    className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={payRemarks}
                    onChange={(e) => setPayRemarks(e.target.value)}
                    disabled={!canEditPaymentTracking || paySaving}
                  />
                  {canEditPaymentTracking ? (
                    <Button type="button" variant="secondary" size="sm" disabled={paySaving} onClick={() => void savePaymentTracking()}>
                      {paySaving ? "Saving…" : "Save due date & remarks"}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>

      <OperationalWorkspaceFooter
        sections={[
          ...(showRegularExportCompletePanel && soId > 0
            ? [
                {
                  key: "next",
                  title: "Next action",
                  children: (
                    <div className="erp-next-action-bar flex-wrap justify-between gap-2 border-emerald-200/80 bg-emerald-50/70">
                      <span className="min-w-0 text-[12px] text-emerald-950">
                        Order complete · Net delivered:{" "}
                        <span className="font-semibold tabular-nums">
                          {netDeliveredQtyTotal > 0
                            ? `${Number.isInteger(netDeliveredQtyTotal) ? String(netDeliveredQtyTotal) : netDeliveredQtyTotal.toFixed(3)}`
                            : "—"}
                        </span>
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          to={`/customer-tracking-flow?salesOrderId=${encodeURIComponent(String(soId))}&from=sales-bill`}
                          className={cn(buttonVariants({ variant: "default", size: "sm" }), "no-underline")}
                          data-testid="sales-bill-complete-customer-tracking"
                        >
                          Customer tracking
                        </Link>
                        <Link
                          to="/sales-orders"
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline")}
                          data-testid="sales-bill-complete-back-so"
                        >
                          Sales orders
                        </Link>
                        <Link
                          to="/sales-orders/new"
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline")}
                          data-testid="sales-bill-complete-new-so"
                        >
                          New SO
                        </Link>
                      </div>
                    </div>
                  ),
                },
              ]
            : []),
          ...(showNoQtyExportedOpsNote
            ? [
                {
                  key: "ops-note",
                  children: (
                    <p className="text-xs leading-relaxed text-slate-600">
                      Operational planning continues from the NO_QTY sales order.
                    </p>
                  ),
                },
              ]
            : []),
          {
            key: "history",
            title: "History",
            children: (
              <ActivityHistoryCard
                title=""
                density="compact"
                className="border-0 shadow-none bg-transparent"
                query={`entityType=SALES_BILL&entityId=${bill.id}&limit=50`}
              />
            ),
          },
          {
            key: "links",
            title: "Related links",
            children: (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Link
                  to={`/sales-bills/${bill.id}${location.search}`}
                  className="text-[12px] font-medium text-sky-800 underline decoration-sky-800/35 underline-offset-2"
                >
                  Reload bill
                </Link>
              </div>
            ),
          },
        ]}
      />
    </PageContainer>
  );
}

