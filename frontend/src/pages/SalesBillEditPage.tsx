import * as React from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch } from "../services/api";
import { getApiUrl } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../contexts/ToastContext";
import { PageContainer, PageSmartBackLink } from "../components/PageHeader";
import { displayDispatchNo, displaySalesBillNo, displaySalesOrderNo } from "../lib/docNoDisplay";
import { withReportsReturnContextIfPresent } from "../lib/drillDownRoutes";
import { BillExportStatusPanel } from "../components/BillExportStatusPanel";
import { ErpModal } from "../components/erp/ErpModal";
import { OperationalWorkspaceFooter } from "../components/erp/OperationalWorkspaceChrome";
import { cn } from "../lib/utils";
import { SalesBillInvoiceDocument } from "../components/sales/SalesBillInvoiceDocument";
import { StickyWorkflowActionBar } from "../components/erp/StickyWorkflowActionBar";
import {
  hrefForEligibleDispatch,
  pickNextEligibleDispatch,
  type EligibleDispatchRow,
} from "../lib/salesBillBillingQueue";
import { useWorkQueueContext } from "../hooks/useWorkQueueContext";
import { navigateToWorkQueueIndex } from "../lib/workQueueContext";
import { SalesBillExportQueuePrompt } from "../components/sales/SalesBillExportQueuePrompt";
import { SalesBillLinkedDocuments } from "../components/sales/SalesBillLinkedDocuments";
import { SalesBillActivityTimeline } from "../components/sales/SalesBillActivityTimeline";
import { SalesBillDraftActionPanel } from "../components/sales/SalesBillDraftActionPanel";
import { SalesBillShipToField } from "../components/sales/SalesBillShipToField";
import {
  buildSalesBillFinalizeChecks,
  canFinalizeSalesBill,
  firstFinalizeBlocker,
} from "../lib/salesBillFinalizeValidation";
import { bumpErpRefresh } from "../lib/erpRefresh";
import { remainingWorkQueueCount } from "../lib/workQueueContext";

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
  createdAt?: string | null;
  updatedAt?: string | null;
  taxIntraState?: boolean;
  gstMode?: "LOCAL" | "INTERSTATE" | string | null;
  posStateCode?: string | null;
  posStateName?: string | null;
  posSource?: string | null;
  customerNameSnapshot?: string;
  customerStateNameSnapshot?: string;
  customerStateCodeSnapshot?: string;
  billToAddressSnapshot?: string;
  billToGstinSnapshot?: string;
  shipToLabelSnapshot?: string;
  shipToAddressSnapshot?: string;
  shipToGstinSnapshot?: string;
  shipToStateNameSnapshot?: string;
  shipToStateCodeSnapshot?: string;
  dispatchShipToLabelSnapshot?: string | null;
  dispatchShipToAddressSnapshot?: string | null;
  dispatchShipToStateCodeSnapshot?: string | null;
  shipToAddressId?: number | null;
  posStateNameSnapshot?: string;
  posStateCodeSnapshot?: string;
  posSourceSnapshot?: string;
  customer: { id: number; name: string };
  dispatch: {
    id: number;
    date: string;
    soId: number;
    docNo?: string | null;
    cycle?: { id: number; cycleNo: number } | null;
    salesOrder?: { docNo?: string | null; orderType?: "NORMAL" | "REPLACEMENT" | "NO_QTY" };
  };
  lines: BillLine[];
  /** Document-linked cycle for operator UI (from bill or dispatch), not SO planning pointer. */
  operationalCycleNo?: number | null;
  cycle?: { id: number; cycleNo: number } | null;
};

function billHeaderOperationalCycleNo(b: Bill): number | null {
  if (b.operationalCycleNo != null && Number.isFinite(Number(b.operationalCycleNo))) return Number(b.operationalCycleNo);
  if (b.cycle?.cycleNo != null && Number.isFinite(Number(b.cycle.cycleNo))) return Number(b.cycle.cycleNo);
  if (b.dispatch?.cycle?.cycleNo != null && Number.isFinite(Number(b.dispatch.cycle.cycleNo)))
    return Number(b.dispatch.cycle.cycleNo);
  return null;
}

type SoHeadLite = {
  orderType?: "NORMAL" | "REPLACEMENT" | "NO_QTY";
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

function printSalesBillInvoice() {
  document.body.classList.add("sales-bill-invoice-print");
  window.print();
  window.addEventListener(
    "afterprint",
    () => {
      document.body.classList.remove("sales-bill-invoice-print");
    },
    { once: true },
  );
}

export function SalesBillEditPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const billId = Number(idParam);
  const { workQueue, isPendingActionsQueue } = useWorkQueueContext();
  const fromPendingActions =
    new URLSearchParams(location.search).get("from") === "pending-actions" || isPendingActionsQueue;
  const userRole = useAuth().user?.role;
  const toast = useToast();
  const isAdmin = userRole === "ADMIN";

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
  const [reExportAuth, setReExportAuth] = React.useState<{ open: boolean; password: string } | null>(null);
  const [nextBillHref, setNextBillHref] = React.useState<string | null>(null);
  const [exportQueuePrompt, setExportQueuePrompt] = React.useState<{ remaining: number } | null>(null);

  const refreshBillingQueueHint = React.useCallback(async (excludeDispatchId?: number) => {
    try {
      const rows = await apiFetch<EligibleDispatchRow[]>("/api/sales-bills/eligible-dispatches");
      const next = pickNextEligibleDispatch(rows, { excludeDispatchId });
      setNextBillHref(next ? hrefForEligibleDispatch(next) : null);
    } catch {
      setNextBillHref(null);
    }
  }, []);
  const [adminRateDlg, setAdminRateDlg] = React.useState<{ lineId: number; password: string } | null>(null);
  const [localRates, setLocalRates] = React.useState<Record<number, string>>({});
  const [applyingRate, setApplyingRate] = React.useState(false);
  const [soHead, setSoHead] = React.useState<SoHeadLite | null>(null);
  const [showCommercialAddress, setShowCommercialAddress] = React.useState(false);
  const [invoicePreviewOpen, setInvoicePreviewOpen] = React.useState(false);

  const readOnly = bill?.status === "FINALIZED" || bill?.status === "CANCELLED";
  const soId = bill?.dispatch.soId ?? 0;

  const loadSoHead = React.useCallback(async (salesOrderId: number) => {
    if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
      setSoHead(null);
      return;
    }
    try {
      const so = await apiFetch<SoHeadLite>(`/api/sales-orders/${salesOrderId}`);
      setSoHead({
        orderType: so.orderType,
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

  const finalizeChecks = React.useMemo(
    () => (bill ? buildSalesBillFinalizeChecks(bill, billDate) : []),
    [bill, billDate],
  );
  const finalizeReady = canFinalizeSalesBill(finalizeChecks);

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
    const checks = buildSalesBillFinalizeChecks(bill, billDate);
    if (!canFinalizeSalesBill(checks)) {
      const blocker = firstFinalizeBlocker(checks);
      setFormError(blocker ?? "Complete all validation checks before finalizing.");
      return;
    }
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
      await refreshBillingQueueHint(finalized.dispatch.id);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not finalize.");
    } finally {
      setSaving(false);
    }
  }

  async function performSalesBillExport(adminPassword?: string) {
    if (!bill || bill.status !== "FINALIZED" || exporting) return;
    setExporting(true);
    setFormError(null);
    setExportError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(getApiUrl(`/api/sales-bills/${bill.id}/export/tally.xml`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(adminPassword ? { adminPassword } : {}),
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
      const refreshed = await apiFetch<Bill>(`/api/sales-bills/${bill.id}`);
      setBill(refreshed);
      setExportError(null);
      setReExportAuth(null);
      await loadSoHead(refreshed.dispatch.soId);
      bumpErpRefresh(["pending-actions", "dashboard"]);
      if (workQueue) {
        const remaining = remainingWorkQueueCount(workQueue, true);
        if (remaining === 0) {
          navigate("/pending-actions", { replace: true });
          return;
        }
        setExportQueuePrompt({ remaining });
        return;
      }
      alert("Tally XML downloaded.");
      await refreshBillingQueueHint(refreshed.dispatch.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not export to Tally";
      setExportError(msg);
      setFormError(msg);
      alert(msg);
    } finally {
      setExporting(false);
    }
  }

  async function exportToTally() {
    if (!bill || bill.status !== "FINALIZED" || exporting) return;
    if (bill.isExported) {
      setReExportAuth({ open: true, password: "" });
      return;
    }
    await performSalesBillExport();
  }

  async function approveReExport() {
    if (!bill || bill.status !== "FINALIZED" || !bill.isExported || !reExportAuth?.open || exporting) return;
    const password = reExportAuth.password.trim();
    if (!password) {
      setExportError("Admin password is required for re-export.");
      return;
    }
    await performSalesBillExport(password);
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
          <PageSmartBackLink
            defaultTo={fromPendingActions ? "/pending-actions" : "/sales-bills"}
            defaultLabel={fromPendingActions ? "Back to Pending Actions" : "Back to sales bills"}
          />
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

  const billOperationalCycleNo = billHeaderOperationalCycleNo(bill);
  const systemBillNo = displaySalesBillNo(bill.id, null, bill.docNo);
  const hasSystemBillNo = Boolean(bill.docNo?.trim());
  const isDraftBill = bill.status === "DRAFT";
  const isFinalizedBill = bill.status === "FINALIZED";
  const soLabel = displaySalesOrderNo(bill.dispatch.soId, bill.dispatch.salesOrder?.docNo);
  const dispatchLabel = displayDispatchNo(bill.dispatchId, bill.dispatch.docNo);
  const workQueueTotal = workQueue?.queueItems.length ?? 0;
  const workQueueIndex = workQueue?.currentIndex ?? 0;
  const showWorkQueueNav = workQueue != null && workQueueTotal > 1;
  const gstModeLabel =
    bill.gstMode === "INTERSTATE" || (bill.gstMode == null && bill.taxIntraState === false)
      ? "Interstate"
      : bill.gstMode === "LOCAL" || (bill.gstMode == null && bill.taxIntraState === true)
        ? "Local"
        : "POS Pending";

  return (
    <PageContainer className="erp-txn-workspace erp-txn-workspace--sticky-submit">
      {adminCancelAuth?.open ? (
        <ErpModal onClose={() => setAdminCancelAuth(null)} backdropClassName="bg-black/30" aria-label="Admin authorization">
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
        </ErpModal>
      ) : null}
      {reExportAuth?.open ? (
        <ErpModal onClose={() => setReExportAuth(null)} backdropClassName="bg-black/30" aria-label="Re-export authorization">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="text-sm font-semibold text-slate-900">Admin Authorization Required</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-600">
                This bill is already exported to Tally. Re-export may create duplicate voucher entries. Enter Admin password to continue.
              </div>
            </div>
            <div className="px-4 py-3">
              <label className="block text-xs font-medium text-slate-700">Admin password</label>
              <Input
                type="password"
                className="mt-1 h-9"
                value={reExportAuth.password}
                onChange={(e) => setReExportAuth((s) => (s ? { ...s, password: e.target.value } : s))}
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => setReExportAuth(null)} disabled={exporting}>
                Cancel
              </Button>
              <Button type="button" className="h-8 text-xs" onClick={() => void approveReExport()} disabled={exporting}>
                {exporting ? "Exporting…" : "Re-export"}
              </Button>
            </div>
          </div>
        </ErpModal>
      ) : null}
      {adminRateDlg != null ? (
        <ErpModal onClose={() => setAdminRateDlg(null)} backdropClassName="bg-black/30" aria-label="Rate correction authorization">
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
        </ErpModal>
      ) : null}
      {invoicePreviewOpen ? (
        <ErpModal
          onClose={() => setInvoicePreviewOpen(false)}
          backdropClassName="bg-black/40"
          aria-label="Invoice preview"
        >
          <div className="flex max-h-[min(92dvh,52rem)] w-[min(96vw,52rem)] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
              <div className="text-sm font-semibold text-slate-900">Invoice preview</div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-[11px]"
                  data-testid="print-sales-bill-invoice-btn"
                  onClick={printSalesBillInvoice}
                >
                  Print invoice
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-[11px]"
                  onClick={() => setInvoicePreviewOpen(false)}
                >
                  Close
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <SalesBillInvoiceDocument bill={bill} />
            </div>
          </div>
        </ErpModal>
      ) : null}
      {exportQueuePrompt && workQueue ? (
        <SalesBillExportQueuePrompt
          open
          workQueue={workQueue}
          remainingCount={exportQueuePrompt.remaining}
          onClose={() => setExportQueuePrompt(null)}
        />
      ) : null}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <PageSmartBackLink
            defaultTo={fromPendingActions ? "/pending-actions" : "/sales-bills"}
            defaultLabel={fromPendingActions ? "Back to Pending Actions" : "Back to sales bills"}
          />
          {showWorkQueueNav && workQueue ? (
            <>
              <span className="text-slate-300" aria-hidden>
                |
              </span>
              <span
                className="text-[12px] font-medium text-slate-700"
                data-testid="sales-bill-work-queue-position"
              >
                Bill {workQueueIndex + 1} of {workQueueTotal}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-0.5 bg-white px-2 text-xs"
                disabled={workQueueIndex <= 0}
                data-testid="sales-bill-work-queue-prev"
                onClick={() => navigateToWorkQueueIndex(navigate, workQueue, workQueueIndex - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-0.5 bg-white px-2 text-xs"
                disabled={workQueueIndex >= workQueueTotal - 1}
                data-testid="sales-bill-work-queue-next"
                onClick={() => navigateToWorkQueueIndex(navigate, workQueue, workQueueIndex + 1)}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </>
          ) : null}
        </div>

        <div
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm"
          data-testid="sales-bill-compact-header"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] leading-snug">
            <Link
              to={`/sales-orders/${bill.dispatch.soId}`}
              className="font-mono font-semibold tabular-nums text-sky-800 underline decoration-sky-800/30 underline-offset-2 hover:text-sky-950"
            >
              {soLabel}
            </Link>
            <span className="text-slate-300" aria-hidden>
              →
            </span>
            <Link
              to={`/dispatch?salesOrderId=${bill.dispatch.soId}`}
              className="font-mono font-semibold tabular-nums text-violet-800 underline decoration-violet-800/30 underline-offset-2 hover:text-violet-950"
            >
              {dispatchLabel}
            </Link>
            <span className="text-slate-300" aria-hidden>
              →
            </span>
            <span className="font-mono font-semibold tabular-nums text-emerald-900" data-testid="sales-bill-header-no">
              {systemBillNo}
            </span>
            <span className="text-slate-300" aria-hidden>
              ·
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                bill.status === "CANCELLED"
                  ? "bg-red-50 text-red-900 ring-1 ring-red-200"
                  : bill.status === "FINALIZED"
                    ? "bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200"
                    : "bg-amber-50 text-amber-950 ring-1 ring-amber-200",
              )}
            >
              {bill.status === "DRAFT" ? "Draft" : bill.status === "FINALIZED" ? "Finalized" : "Cancelled"}
            </span>
          </div>
          <div className="flex shrink-0 items-baseline gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Grand total</span>
            <span className="text-base font-bold tabular-nums text-slate-900">₹{formatMoney(bill.netAmount)}</span>
          </div>
        </div>
      </div>

      {formError ? (
        <div className="min-w-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-800 break-words">
          {formError}
        </div>
      ) : null}

      <div className="erp-workspace-2col">
        <div className="flex min-h-0 min-w-0 flex-col gap-2 lg:min-h-[calc(100dvh-12rem)]">
          <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden shadow-sm ring-1 ring-slate-100">
            <CardHeader className="erp-txn-card-header shrink-0 py-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold text-slate-900">Line items</CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  data-testid="open-sales-bill-invoice-preview"
                  onClick={() => setInvoicePreviewOpen(true)}
                >
                  Preview invoice
                </Button>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-auto p-0">
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
                        <th className="text-right">GST</th>
                        <th className="text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bill.lines.map((ln) => {
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

          {isFinalizedBill ? (
            <details
              id="sales-bill-business-details"
              className="min-w-0 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100"
              data-testid="sales-bill-business-details"
            >
              <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-slate-900 marker:content-none [&::-webkit-details-marker]:hidden">
                Business details
              </summary>
              <div className="erp-txn-card-body grid min-w-0 gap-2.5 border-t border-slate-100 pt-2">
              <div className="grid gap-2.5 lg:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-slate-50/70 p-2.5">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Commercial</h3>
                  <div className="mt-1.5 grid grid-cols-1 gap-2.5">
                    <div className="min-w-0 rounded border border-slate-200 bg-white px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-medium text-slate-600">Bill To</div>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                            bill.gstMode === "INTERSTATE" || (bill.gstMode == null && bill.taxIntraState === false)
                              ? "bg-purple-100 text-purple-900"
                              : bill.gstMode === "LOCAL" || (bill.gstMode == null && bill.taxIntraState === true)
                                ? "bg-emerald-100 text-emerald-900"
                                : "bg-slate-100 text-slate-700",
                          )}
                        >
                          {gstModeLabel}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[13px] font-semibold text-slate-900">
                        {bill.customerNameSnapshot?.trim() || bill.customer.name}
                      </div>
                      <div className="mt-0.5 text-[12px] text-slate-600">
                        {(bill.customerStateCodeSnapshot ?? "").trim() || (bill.customerStateNameSnapshot ?? "").trim() ? (
                          <>
                            {(bill.customerStateCodeSnapshot ?? "").trim()}
                            {(bill.customerStateCodeSnapshot ?? "").trim() &&
                            (bill.customerStateNameSnapshot ?? "").trim()
                              ? " · "
                              : ""}
                            {(bill.customerStateNameSnapshot ?? "").trim()}
                          </>
                        ) : (
                          "State not set"
                        )}
                        {bill.billToGstinSnapshot?.trim() ? (
                          <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-700">
                            {bill.billToGstinSnapshot.trim()}
                          </span>
                        ) : null}
                      </div>
                      {showCommercialAddress ? (
                        <div className="mt-1.5 rounded border border-slate-200 bg-slate-50 p-1.5 text-[11px] leading-snug text-slate-700">
                          <span className="font-medium text-slate-800">Address: </span>
                          <span className="whitespace-pre-wrap break-words">
                            {bill.billToAddressSnapshot?.trim() || "Not recorded"}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <SalesBillShipToField
                      bill={bill}
                      readOnly={readOnly}
                      showAddress={showCommercialAddress}
                      onToggleAddress={() => setShowCommercialAddress((s) => !s)}
                      onBillUpdated={(updated) => {
                        setBill(updated as Bill);
                        setFormError(null);
                      }}
                      onError={(msg) => setFormError(msg)}
                    />
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="rounded-md border border-slate-200 p-2.5">
                    <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Billing</h3>
                    <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                      <div className="grid gap-0.5 sm:col-span-1">
                        <span className="text-[11px] font-medium text-slate-600">Bill date *</span>
                        <Input type="date" className="h-9" value={billDate} disabled={readOnly} onChange={(e) => setBillDate(e.target.value)} />
                      </div>
                      <div className="grid gap-0.5 sm:col-span-1">
                        <span className="text-[11px] font-medium text-slate-600">Customer invoice no. (optional)</span>
                        <Input
                          className="h-9"
                          value={billNo}
                          disabled={readOnly}
                          onChange={(e) => setBillNo(e.target.value)}
                          placeholder="Customer reference"
                        />
                      </div>
                    </div>
                  </div>

                  {showNoQtyRateUi ? (
                    <div className="rounded-md border border-amber-100 bg-amber-50/90 px-2.5 py-1.5">
                      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-amber-900">Pricing</h3>
                      <div className="mt-0.5 text-[12px] font-semibold text-amber-950">
                        Applicable rate: ₹{headlineApplicableRate}{" "}
                        <span className="font-normal text-amber-900/90">(Effective from {headlineEffective})</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                <div className="rounded-md border border-slate-200 p-2.5">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Tax</h3>
                  <div className="mt-1.5 grid gap-2 text-sm sm:grid-cols-3">
                    <div>
                      <div className="text-[11px] text-slate-500">GST mode</div>
                      <div className="font-medium text-slate-900">{gstModeLabel}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">POS state</div>
                      <div className="font-medium text-slate-900">
                        {(bill.posStateCodeSnapshot ?? bill.posStateCode ?? "").trim() || "—"}
                        {(bill.posStateNameSnapshot ?? bill.posStateName)?.trim()
                          ? ` · ${(bill.posStateNameSnapshot ?? bill.posStateName)?.trim()}`
                          : ""}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Order type</div>
                      <div className="font-medium text-slate-900">
                        {billOrderTypeLabel(soHead?.orderType ?? bill.dispatch.salesOrder?.orderType)}
                        {billOperationalCycleNo != null ? ` · Cycle ${billOperationalCycleNo}` : ""}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 p-2.5">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Remarks</h3>
                  <div className="mt-1.5">
                    <Input
                      className="h-9"
                      value={remarks}
                      disabled={readOnly}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder="Optional notes for this bill"
                    />
                  </div>
                </div>
              </div>

              {bill.status === "CANCELLED" ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-sm text-red-800">
                  <div className="font-medium">Cancelled</div>
                  {bill.cancelReason ? <div className="break-words">Reason: {bill.cancelReason}</div> : null}
                </div>
              ) : null}
              </div>
            </details>
          ) : (
            <Card
              id="sales-bill-business-details"
              className="min-w-0 shrink-0 overflow-hidden shadow-sm ring-1 ring-slate-100"
              data-testid="sales-bill-business-details"
            >
              <CardHeader className="erp-txn-card-header py-2">
                <CardTitle className="text-sm font-semibold text-slate-900">Business details</CardTitle>
              </CardHeader>
              <CardContent className="erp-txn-card-body grid min-w-0 gap-2.5 pt-0">
              <div className="grid gap-2.5 lg:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-slate-50/70 p-2.5">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Commercial</h3>
                  <div className="mt-1.5 grid grid-cols-1 gap-2.5">
                    <div className="min-w-0 rounded border border-slate-200 bg-white px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-medium text-slate-600">Bill To</div>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                            bill.gstMode === "INTERSTATE" || (bill.gstMode == null && bill.taxIntraState === false)
                              ? "bg-purple-100 text-purple-900"
                              : bill.gstMode === "LOCAL" || (bill.gstMode == null && bill.taxIntraState === true)
                                ? "bg-emerald-100 text-emerald-900"
                                : "bg-slate-100 text-slate-700",
                          )}
                        >
                          {gstModeLabel}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[13px] font-semibold text-slate-900">
                        {bill.customerNameSnapshot?.trim() || bill.customer.name}
                      </div>
                      <div className="mt-0.5 text-[12px] text-slate-600">
                        {(bill.customerStateCodeSnapshot ?? "").trim() || (bill.customerStateNameSnapshot ?? "").trim() ? (
                          <>
                            {(bill.customerStateCodeSnapshot ?? "").trim()}
                            {(bill.customerStateCodeSnapshot ?? "").trim() &&
                            (bill.customerStateNameSnapshot ?? "").trim()
                              ? " · "
                              : ""}
                            {(bill.customerStateNameSnapshot ?? "").trim()}
                          </>
                        ) : (
                          "State not set"
                        )}
                        {bill.billToGstinSnapshot?.trim() ? (
                          <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-700">
                            {bill.billToGstinSnapshot.trim()}
                          </span>
                        ) : null}
                      </div>
                      {showCommercialAddress ? (
                        <div className="mt-1.5 rounded border border-slate-200 bg-slate-50 p-1.5 text-[11px] leading-snug text-slate-700">
                          <span className="font-medium text-slate-800">Address: </span>
                          <span className="whitespace-pre-wrap break-words">
                            {bill.billToAddressSnapshot?.trim() || "Not recorded"}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <SalesBillShipToField
                      bill={bill}
                      readOnly={readOnly}
                      showAddress={showCommercialAddress}
                      onToggleAddress={() => setShowCommercialAddress((s) => !s)}
                      onBillUpdated={(updated) => {
                        setBill(updated as Bill);
                        setFormError(null);
                      }}
                      onError={(msg) => setFormError(msg)}
                    />
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="rounded-md border border-slate-200 p-2.5">
                    <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Billing</h3>
                    <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                      <div className="grid gap-0.5 sm:col-span-1">
                        <span className="text-[11px] font-medium text-slate-600">Bill date *</span>
                        <Input type="date" className="h-9" value={billDate} disabled={readOnly} onChange={(e) => setBillDate(e.target.value)} />
                      </div>
                      <div className="grid gap-0.5 sm:col-span-1">
                        <span className="text-[11px] font-medium text-slate-600">Customer invoice no. (optional)</span>
                        <Input
                          className="h-9"
                          value={billNo}
                          disabled={readOnly}
                          onChange={(e) => setBillNo(e.target.value)}
                          placeholder="Customer reference"
                        />
                      </div>
                    </div>
                  </div>

                  {showNoQtyRateUi ? (
                    <div className="rounded-md border border-amber-100 bg-amber-50/90 px-2.5 py-1.5">
                      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-amber-900">Pricing</h3>
                      <div className="mt-0.5 text-[12px] font-semibold text-amber-950">
                        Applicable rate: ₹{headlineApplicableRate}{" "}
                        <span className="font-normal text-amber-900/90">(Effective from {headlineEffective})</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                <div className="rounded-md border border-slate-200 p-2.5">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Tax</h3>
                  <div className="mt-1.5 grid gap-2 text-sm sm:grid-cols-3">
                    <div>
                      <div className="text-[11px] text-slate-500">GST mode</div>
                      <div className="font-medium text-slate-900">{gstModeLabel}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">POS state</div>
                      <div className="font-medium text-slate-900">
                        {(bill.posStateCodeSnapshot ?? bill.posStateCode ?? "").trim() || "—"}
                        {(bill.posStateNameSnapshot ?? bill.posStateName)?.trim()
                          ? ` · ${(bill.posStateNameSnapshot ?? bill.posStateName)?.trim()}`
                          : ""}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Order type</div>
                      <div className="font-medium text-slate-900">
                        {billOrderTypeLabel(soHead?.orderType ?? bill.dispatch.salesOrder?.orderType)}
                        {billOperationalCycleNo != null ? ` · Cycle ${billOperationalCycleNo}` : ""}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 p-2.5">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Remarks</h3>
                  <div className="mt-1.5">
                    <Input
                      className="h-9"
                      value={remarks}
                      disabled={readOnly}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder="Optional notes for this bill"
                    />
                  </div>
                </div>
              </div>

              {bill.status === "CANCELLED" ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-sm text-red-800">
                  <div className="font-medium">Cancelled</div>
                  {bill.cancelReason ? <div className="break-words">Reason: {bill.cancelReason}</div> : null}
                </div>
              ) : null}
              </CardContent>
            </Card>
          )}
        </div>

        <aside
          className="min-w-0 space-y-2 lg:sticky lg:top-[2.75rem] lg:z-[1] lg:self-start"
          data-testid="sales-bill-action-sidebar"
        >
          <div
            className="rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 shadow-sm ring-1 ring-violet-100"
            data-testid="sales-bill-no-panel"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Sales Bill No. <span className="text-red-600" aria-hidden>*</span>
              </span>
              <span className="text-[10px] font-medium text-slate-500">
                {hasSystemBillNo ? "Auto-generated" : "Pending assignment"}
              </span>
            </div>
            <div className="mt-0.5 font-mono text-[15px] font-bold tabular-nums text-violet-950">{systemBillNo}</div>
          </div>

          <Card className="overflow-hidden shadow-sm ring-1 ring-slate-100">
            <CardHeader className="erp-txn-card-header py-2">
              <CardTitle className="text-sm font-semibold text-slate-900">Totals</CardTitle>
            </CardHeader>
            <CardContent className="erp-txn-card-body grid gap-1 pt-0 text-sm">
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

          {isFinalizedBill ? (
            <>
              <BillExportStatusPanel
                lifecycle="FINALIZED"
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
                allowReExport
                density="default"
                className="shadow-md ring-2 ring-emerald-200/90"
              />
              <Button
                type="button"
                variant="outline"
                className="h-9 w-full text-sm"
                data-testid="sidebar-preview-invoice-btn"
                onClick={() => setInvoicePreviewOpen(true)}
              >
                Preview / Print invoice
              </Button>
            </>
          ) : null}

          {isDraftBill ? (
            <SalesBillDraftActionPanel
              saving={saving}
              deleting={deleting}
              canFinalize={finalizeReady}
              checks={finalizeChecks}
              deleteDisabled={Boolean(bill.isExported)}
              onFinalize={() => void finalize()}
              onSaveDraft={() => void saveDraft()}
              onDeleteDraft={() => void deleteDraft()}
              className="shadow-sm ring-1 ring-slate-100"
            />
          ) : null}

          <SalesBillActivityTimeline
            billId={bill.id}
            createdAt={bill.createdAt}
            updatedAt={bill.updatedAt}
            finalizedAt={bill.finalizedAt}
            exportedAt={bill.exportedAt}
            exportedByName={bill.exportedBy?.name}
            cancelledAt={bill.cancelledAt}
          />

          {isFinalizedBill ? (
            <SalesBillLinkedDocuments
              billId={bill.id}
              billDocNo={bill.docNo}
              salesOrderId={bill.dispatch.soId}
              salesOrderDocNo={bill.dispatch.salesOrder?.docNo}
              dispatchId={bill.dispatchId}
              dispatchDocNo={bill.dispatch.docNo}
              customerId={bill.customerId}
              customerName={bill.customer.name}
              isExported={bill.isExported}
            />
          ) : null}

          {isDraftBill ? (
            <BillExportStatusPanel
              lifecycle="DRAFT"
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
              allowReExport
              density="compact"
              className="shadow-sm ring-1 ring-slate-100"
            />
          ) : null}

          {isFinalizedBill ? (
            <details className="rounded-lg border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100" data-testid="sales-bill-sidebar-details">
              <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-slate-900 marker:content-none [&::-webkit-details-marker]:hidden">
                Bill details
              </summary>
              <div className="space-y-2 border-t border-slate-100 px-3 py-2 text-[12px] text-slate-700">
                <div>
                  <span className="text-slate-500">Customer </span>
                  <span className="font-medium text-slate-900">{bill.customer.name}</span>
                </div>
                <div>
                  <span className="text-slate-500">Bill date </span>
                  <span className="tabular-nums">{billDate || "—"}</span>
                </div>
                <div>
                  <span className="text-slate-500">GST </span>
                  <span className="font-medium">{gstModeLabel}</span>
                </div>
                {billNo.trim() ? (
                  <div>
                    <span className="text-slate-500">Customer invoice </span>
                    <span className="font-mono">{billNo.trim()}</span>
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0 text-[12px] text-sky-800 underline"
                  onClick={() =>
                    document.getElementById("sales-bill-business-details")?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  View full business details
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-1 h-8 w-full text-xs"
                  data-testid="cancel-sales-bill-btn"
                  disabled={cancelling}
                  onClick={() => void cancelFinalized()}
                >
                  Cancel bill
                </Button>
              </div>
            </details>
          ) : null}

          {bill.status === "CANCELLED" ? (
            <BillExportStatusPanel
              lifecycle="CANCELLED"
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
              allowReExport
              density="compact"
              className="shadow-sm ring-1 ring-slate-100"
            />
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
                        {nextBillHref ? (
                          <Link
                            to={nextBillHref}
                            className={cn(buttonVariants({ variant: "default", size: "sm" }), "no-underline")}
                            data-testid="sales-bill-continue-next-pending"
                          >
                            Continue to next pending bill
                          </Link>
                        ) : null}
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
        ]}
      />
      {bill.status === "DRAFT" ? (
        <StickyWorkflowActionBar
          className="lg:hidden"
          title={`Draft · ₹${formatMoney(bill.netAmount)}`}
          subtitle={bill.customer.name}
          primaryAction={{
            label: saving ? "Working…" : "Finalize Bill",
            testId: "finalize-sales-bill-sticky-btn",
            disabled: readOnly || saving || !finalizeReady,
            onClick: () => void finalize(),
          }}
          secondaryAction={{
            label: saving ? "Saving…" : "Save Draft",
            testId: "save-sales-bill-sticky-btn",
            disabled: readOnly || saving,
            onClick: () => void saveDraft(),
          }}
        />
      ) : null}
    </PageContainer>
  );
}
