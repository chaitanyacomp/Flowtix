import * as React from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PageContainer, PageSmartBackLink, StickyWorkspaceHead } from "../../components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { apiFetch } from "../../services/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useAuth } from "../../hooks/useAuth";
import { useShortcutHints } from "../../hooks/useShortcutHints";
import { ShortcutHintBar, ShortcutFirstUseTip } from "../../components/ui/ShortcutHintBar";
import { FieldShortcutHint } from "../../components/ui/FieldShortcutHint";
import {
  FIELD_HINT_CONFIRM,
  FIELD_HINT_GRID_NAV,
  FIELD_HINT_PO_SUPPLIER,
  FIELD_HINT_SAVE,
  RM_PO_GRN_SHORTCUT_BAR,
} from "../../lib/shortcutHintCopy";
import {
  buildInitialPoLine,
  computeLineAmount,
  deriveRmLineDisplayFromItem,
  formatRmPoNo,
  type GrnLineDraft,
  grnStatusDotClass,
  grnStatusLabel,
  hasActiveGrnRecord,
  type Item,
  lineItemLocked,
  type PoLineDraft,
  poOrderedReceivedPending,
  poResponseLineToDraft,
  poStatusDotClass,
  poStatusLabel,
  receivedForLine,
  type RmPoRow,
  type Supplier,
} from "./rmPurchaseShared";
type PurchaseMeta = { testingModeRelaxedTaxFields: boolean };

export function RmPurchasePoDetailPage() {
  const { poId: poIdParam } = useParams();
  const poId = Number(poIdParam);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isAdmin = useAuth().user?.role === "ADMIN";

  const source = searchParams.get("source") ?? "";
  const resumeReturnTo = searchParams.get("returnTo") ?? "";
  const flowSoIdRaw = searchParams.get("salesOrderId") ?? searchParams.get("soId") ?? "";
  const flowSoId = Number(flowSoIdRaw);
  const hasFlowSalesOrder = Number.isFinite(flowSoId) && flowSoId > 0;

  const [purchaseMeta, setPurchaseMeta] = React.useState<PurchaseMeta | null>(null);
  const relaxedTax = Boolean(purchaseMeta?.testingModeRelaxedTaxFields);
  const [dismissedTaxBanner, setDismissedTaxBanner] = React.useState(false);
  const incomingTaxWarnings = (
    (location.state as { rmPoTaxWarnings?: string[] } | null)?.rmPoTaxWarnings ?? []
  ).filter(Boolean);

  const [po, setPo] = React.useState<RmPoRow | null>(null);
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [items, setItems] = React.useState<Item[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [grnModalOpen, setGrnModalOpen] = React.useState(false);
  const [grnLines, setGrnLines] = React.useState<GrnLineDraft[]>([]);
  const [grning, setGrning] = React.useState(false);
  const [grnSuccess, setGrnSuccess] = React.useState<string | null>(null);

  const [editOpen, setEditOpen] = React.useState(false);
  const [supplierId, setSupplierId] = React.useState(0);
  const [poRemarks, setPoRemarks] = React.useState("");
  const [poLines, setPoLines] = React.useState<PoLineDraft[]>([]);
  const [savingPo, setSavingPo] = React.useState(false);

  const [reversingGrnId, setReversingGrnId] = React.useState(0);

  const supplierSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const poQtyInputRefs = React.useRef<(HTMLInputElement | null)[]>([]);
  const grnQtyInputRefs = React.useRef<(HTMLInputElement | null)[]>([]);

  const load = React.useCallback(
    async (opts?: { silent?: boolean }): Promise<RmPoRow | null> => {
      if (!Number.isFinite(poId) || poId <= 0) {
        setError("Invalid purchase order");
        setLoading(false);
        return null;
      }
      const silent = Boolean(opts?.silent);
      if (!silent) setLoading(true);
      setError(null);
      try {
        const [p, s, i] = await Promise.all([
          apiFetch<RmPoRow>(`/api/purchase/rm-pos/${poId}`),
          apiFetch<Supplier[]>("/api/suppliers"),
          apiFetch<Item[]>("/api/items?type=RM"),
        ]);
        setPo(p);
        setSuppliers(s);
        setItems(i);
        return p;
      } catch (e) {
        setPo(null);
        setError(e instanceof Error ? e.message : "Failed to load purchase order");
        return null;
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [poId],
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    apiFetch<PurchaseMeta>("/api/purchase/meta")
      .then(setPurchaseMeta)
      .catch(() => setPurchaseMeta({ testingModeRelaxedTaxFields: false }));
  }, []);

  React.useEffect(() => {
    setDismissedTaxBanner(false);
  }, [poId]);

  React.useEffect(() => {
    if (!po || !grnModalOpen) return;
    const received = new Map<number, number>();
    for (const g of po.grns) {
      if (g.reversedAt) continue;
      for (const l of g.lines) {
        received.set(l.rmPoLineId, (received.get(l.rmPoLineId) || 0) + Number(l.receivedQty));
      }
    }
    setGrnLines(
      po.lines.map((ln) => ({
        rmPoLineId: ln.id,
        receivedQty: Math.max(0, Number(ln.qty) - (received.get(ln.id) || 0)),
      })),
    );
  }, [po?.id, grnModalOpen]);

  React.useEffect(() => {
    if (!grnModalOpen) return;
    window.setTimeout(() => {
      grnQtyInputRefs.current[0]?.focus();
      grnQtyInputRefs.current[0]?.select?.();
    }, 0);
  }, [grnModalOpen, grnLines.length]);

  function openEditModal() {
    if (!po) return;
    setEditOpen(true);
    setPoRemarks(po.remarks ?? "");
    setSupplierId(po.supplierId);
    setPoLines(po.lines.map((l) => poResponseLineToDraft(l)));
  }

  const editModalWarnings = React.useMemo(() => {
    const w: string[] = [];
    for (const l of poLines) {
      const it = items.find((x) => x.id === l.itemId);
      w.push(...deriveRmLineDisplayFromItem(it, relaxedTax).warnings);
    }
    return [...new Set(w)];
  }, [poLines, items, relaxedTax]);

  const receiveInfo = po ? poOrderedReceivedPending(po) : null;
  const billingByLine = po?.billingSummary?.finalizedBilledQtyByPoLineId ?? {};
  const cancelledByLine = po?.billingSummary?.cancelledBilledQtyByPoLineId ?? {};
  const billingTotals = React.useMemo(() => {
    if (!po) return { billed: 0, pendingBilling: 0, rebillable: 0 };
    let billed = 0;
    let pendingBilling = 0;
    let rebillable = 0;
    for (const ln of po.lines) {
      const received = receivedForLine(po, ln.id);
      const billedLn = Number(billingByLine[ln.id] ?? 0);
      const cancelledLn = Number(cancelledByLine[ln.id] ?? 0);
      billed += billedLn;
      rebillable += cancelledLn;
      pendingBilling += Math.max(0, received - billedLn);
    }
    return { billed, pendingBilling, rebillable };
  }, [po, billingByLine, cancelledByLine]);
  const grnAllowed =
    po &&
    po.status !== "CANCELLED" &&
    po.status !== "COMPLETED" &&
    receiveInfo &&
    receiveInfo.pending > 1e-6;

  async function onSavePoEdit() {
    if (!po) return;
    setSavingPo(true);
    setError(null);
    try {
      const updated = await apiFetch<RmPoRow & { taxWarnings?: string[] }>(`/api/purchase/rm-pos/${po.id}`, {
        method: "PUT",
        body: JSON.stringify({
          supplierId,
          remarks: poRemarks.trim() || null,
          lines: poLines.map((l) => ({
            ...(l.id != null ? { id: l.id } : {}),
            itemId: l.itemId,
            qty: l.qty,
            rate: l.rate,
          })),
        }),
      });
      setPo(updated);
      setEditOpen(false);
      if (updated.taxWarnings?.length) {
        navigate(`/rm-po-grn/${po.id}`, {
          replace: true,
          state: { rmPoTaxWarnings: updated.taxWarnings },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSavingPo(false);
    }
  }

  async function onGrnPost() {
    if (!po) return;
    setError(null);
    setGrnSuccess(null);
    setGrning(true);
    try {
      const pendingByPoLineId = new Map<number, number>();
      for (const ln of po.lines) {
        const got = receivedForLine(po, ln.id);
        pendingByPoLineId.set(ln.id, Math.max(0, Number(ln.qty) - got));
      }

      const lines = grnLines.filter((l) => Number.isFinite(l.receivedQty) && l.receivedQty > 0);
      if (!lines.length) {
        setError("Enter at least one receipt qty");
        setGrning(false);
        return;
      }

      for (const l of lines) {
        const pending = pendingByPoLineId.get(l.rmPoLineId) ?? 0;
        if (l.receivedQty > pending + 1e-6) {
          const nm = po.lines.find((x) => x.id === l.rmPoLineId)?.item?.itemName ?? `Line ${l.rmPoLineId}`;
          setError(`Receive qty cannot exceed pending qty for ${nm}. Pending: ${pending}`);
          setGrning(false);
          return;
        }
      }

      await apiFetch("/api/purchase/grns", {
        method: "POST",
        body: JSON.stringify({ rmPoId: po.id, lines }),
      });
      const refreshed = await load({ silent: true });
      setGrnModalOpen(false);
      if (refreshed?.status === "COMPLETED") {
        setGrnSuccess(
          "Goods receipt posted. This PO is fully received. RM is in usable stock and available for production.",
        );
      } else {
        setGrnSuccess(
          "Goods receipt posted. Quantities from this receipt are in usable stock. Receive remaining lines when ready.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setGrning(false);
    }
  }

  async function onReverseGrn(grnId: number) {
    const ok = window.confirm("Reverse this GRN? This will undo the stock receipt.");
    if (!ok) return;
    const reason = window.prompt("Reversal reason (required)") ?? "";
    if (!reason.trim()) {
      setError("Reversal reason is required");
      return;
    }
    setError(null);
    setReversingGrnId(grnId);
    try {
      await apiFetch(`/api/purchase/grns/${grnId}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      await load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setReversingGrnId(0);
    }
  }

  async function onCancelPo() {
    if (!po) return;
    const reason = window.prompt("Cancel reason (optional)") ?? "";
    try {
      await apiFetch(`/api/purchase/rm-pos/${po.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      await load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const saveEditDisabled =
    savingPo ||
    !supplierId ||
    poLines.length < 1 ||
    poLines.some(
      (l) =>
        !l.itemId ||
        !Number.isFinite(l.qty) ||
        l.qty <= 0 ||
        !Number.isFinite(l.rate) ||
        l.rate <= 0,
    );

  const shortcutHints = useShortcutHints({
    pageKey: "rm-po-grn-detail",
    fieldShortcuts: {
      poSupplier: FIELD_HINT_PO_SUPPLIER,
      poLineQty: FIELD_HINT_GRID_NAV,
      grnQty: FIELD_HINT_GRID_NAV,
      savePo: FIELD_HINT_SAVE,
      postGrn: FIELD_HINT_CONFIRM,
    },
    firstUseTipText: "Tip: Use Enter to move faster and Ctrl+Enter to confirm.",
  });

  const poSupplierBind = shortcutHints.bindField("poSupplier", {
    onChange: (e) => setSupplierId(Number((e.target as HTMLSelectElement).value)),
  });

  const savePoFocusBind = shortcutHints.bindField("savePo");
  const postGrnFocusBind = shortcutHints.bindField("postGrn");

  React.useEffect(() => {
    poQtyInputRefs.current = poQtyInputRefs.current.slice(0, poLines.length);
  }, [poLines.length]);

  React.useEffect(() => {
    const n = po?.lines.length ?? 0;
    grnQtyInputRefs.current = grnQtyInputRefs.current.slice(0, n);
  }, [po?.lines.length]);

  const shortcutFlagsRef = React.useRef({
    saveEditDisabled: true,
    grnModalOpen: false,
    grnAllowed: false,
    grning: false,
    editOpen: false,
  });
  shortcutFlagsRef.current = {
    saveEditDisabled,
    grnModalOpen,
    grnAllowed: Boolean(grnAllowed),
    grning,
    editOpen,
  };

  const actionsRef = React.useRef({
    onSavePoEdit,
    onGrnPost,
  });
  actionsRef.current = { onSavePoEdit, onGrnPost };

  const markShortcutRef = React.useRef(shortcutHints.markFieldShortcutUsed);
  markShortcutRef.current = shortcutHints.markFieldShortcutUsed;

  React.useEffect(() => {
    function onGlobalKey(ev: KeyboardEvent) {
      if (ev.defaultPrevented) return;
      const { editOpen: ed, saveEditDisabled: sd } = shortcutFlagsRef.current;

      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.code === "Digit1" && ed) {
        ev.preventDefault();
        markShortcutRef.current("poSupplier");
        supplierSelectRef.current?.focus();
        return;
      }

      if ((ev.ctrlKey || ev.metaKey) && ev.code === "KeyS") {
        ev.preventDefault();
        if (ed && !sd) {
          markShortcutRef.current("savePo");
          void actionsRef.current.onSavePoEdit();
        }
        return;
      }

      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        const flags = shortcutFlagsRef.current;
        if (flags.grnModalOpen && flags.grnAllowed && !flags.grning) {
          markShortcutRef.current("postGrn");
          void actionsRef.current.onGrnPost();
        } else if (flags.editOpen && !flags.saveEditDisabled) {
          markShortcutRef.current("savePo");
          void actionsRef.current.onSavePoEdit();
        }
        return;
      }

      if (ev.key === "Escape" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        if (grnModalOpen) setGrnModalOpen(false);
        else if (editOpen) setEditOpen(false);
        else setError((cur) => (cur ? null : cur));
      }
    }
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  }, [editOpen, grnModalOpen]);

  function onPoLineQtyKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || e.ctrlKey || e.altKey || e.metaKey) return;
    const len = poLines.length;
    if (len < 1) return;
    e.preventDefault();
    shortcutHints.markFieldShortcutUsed("poLineQty");
    const next = e.shiftKey ? Math.max(0, i - 1) : Math.min(len - 1, i + 1);
    poQtyInputRefs.current[next]?.focus();
  }

  function onGrnQtyKeyDown(_i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    shortcutHints.markFieldShortcutUsed("grnQty");
    void onGrnPost();
  }

  const canEditPo = po && (po.status === "PENDING" || po.status === "PARTIAL");
  const showCancel = isAdmin && po && (po.status === "PENDING" || po.status === "PARTIAL");

  const hasAnyActiveGrn = Boolean(po?.grns?.some((g) => !g.reversedAt));
  /** After GRN (or when returning with SO context), offer one-tap return to RM check / WO flow — not a list page strip. */
  const showFlowResumeBanner =
    hasFlowSalesOrder &&
    Boolean(po) &&
    (Boolean(grnSuccess) || hasAnyActiveGrn || po?.status === "COMPLETED" || po?.status === "PARTIAL");

  if (!Number.isFinite(poId) || poId <= 0) {
    return (
      <PageContainer>
        <StickyWorkspaceHead lead={<PageSmartBackLink defaultTo="/rm-po-grn" defaultLabel="Back to RM Purchase" />} />
        <p className="text-sm text-red-700">Invalid purchase order link.</p>
      </PageContainer>
    );
  }

  return (
    <div className="flex min-h-full flex-col pb-[5.5rem] sm:pb-20">
      <PageContainer>
        <ShortcutFirstUseTip
          visible={shortcutHints.firstUseTipVisible}
          message="Tip: Use Enter to move faster and Ctrl+Enter to confirm."
          onDismiss={shortcutHints.dismissFirstUseTip}
        />

        <StickyWorkspaceHead lead={<PageSmartBackLink defaultTo="/rm-po-grn" defaultLabel="Back to RM Purchase" />} className="mb-2" />

        {relaxedTax ? (
          <p className="mb-2 rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-950">
            Testing mode (TESTING_MODE_RELAXED_TAX_FIELDS): relaxed tax/unit fallbacks are enabled on the server.
          </p>
        ) : null}

        {!dismissedTaxBanner && incomingTaxWarnings.length > 0 ? (
          <div className="mb-2 flex flex-col gap-2 rounded-md border border-sky-200 bg-sky-50/90 px-3 py-2 text-xs text-sky-950 sm:flex-row sm:items-start sm:justify-between">
            <ul className="list-inside list-disc">
              {incomingTaxWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <button
              type="button"
              className="shrink-0 text-sky-800 underline underline-offset-2"
              onClick={() => setDismissedTaxBanner(true)}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {loading ? <p className="text-sm text-slate-600">Loading…</p> : null}
        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

        {showFlowResumeBanner ? (
          <div
            className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-950"
            data-testid="grn-flow-resume-banner"
          >
            <p className="font-semibold text-emerald-950">
              {grnSuccess ? "Material received. Continue Work Order" : "Continue Work Order"}
            </p>
            {grnSuccess ? <p className="mt-1 text-[13px] leading-snug text-emerald-900/95">{grnSuccess}</p> : null}
            {!grnSuccess ? (
              <p className="mt-1 text-[13px] leading-snug text-emerald-900/90">
                {source === "wo_rm_shortage"
                  ? "RM is in stock. Return to RM check or Work Orders to continue the sales order."
                  : "Use RM check or Work Orders to continue this sales order when ready."}
              </p>
            ) : null}
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                data-testid="grn-continue-work-order-btn"
                onClick={() => {
                  const fallback = `/rm-check?soId=${encodeURIComponent(String(flowSoId))}`;
                  const target = resumeReturnTo.trim() ? resumeReturnTo : fallback;
                  navigate(target);
                }}
              >
                Continue Work Order
              </Button>
            </div>
          </div>
        ) : null}

        {!loading && po ? (
          <>
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-lg font-semibold text-slate-900">{formatRmPoNo(po.id)}</h1>
                <p className="mt-1 text-sm text-slate-700">{po.supplier.name}</p>
                <div className="mt-3 grid gap-1 text-sm text-slate-700">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-800">Order Status:</span>
                    <span className="inline-flex items-center gap-2">
                      <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${poStatusDotClass(po.status)}`} aria-hidden />
                      <span>{poStatusLabel(po.status)}</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-800">Stock:</span>
                    <span>
                      {po.status === "COMPLETED"
                        ? "Fully Received"
                        : po.status === "PARTIAL"
                          ? "Partially Received"
                          : "Not Received"}
                      {po.grns.length === 0 ? <span className="ml-1 text-amber-700">→ Action required</span> : null}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-800">Billing:</span>
                    <span>{billingTotals.billed <= 1e-9 ? "Not Started" : billingTotals.pendingBilling > 1e-9 ? "In Progress" : "Completed"}</span>
                  </div>
                </div>
                {po.remarks ? <p className="mt-2 text-sm text-slate-600">Remarks: {po.remarks}</p> : null}
              </div>
              <div className="flex shrink-0 flex-col items-start gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {canEditPo ? (
                    <Button type="button" variant="outline" size="sm" onClick={openEditModal}>
                      Edit order
                    </Button>
                  ) : null}
                  {showCancel ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void onCancelPo()}
                      title="Closes this PO. Stock will not change unless you reverse a GRN."
                    >
                      Cancel order
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            {!hasActiveGrnRecord(po) && grnAllowed ? (
              <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3">
                <div className="text-sm font-semibold text-sky-950">Next Step: Create GRN to receive stock</div>
                <div className="mt-1 text-xs text-sky-900/80">Record goods receipt to move RM into usable stock.</div>
                <div className="mt-3">
                  <Button type="button" className="h-11 px-6 text-base" onClick={() => setGrnModalOpen(true)}>
                    Create GRN
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Stock summary</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                    Stock status:{" "}
                    {po.status === "COMPLETED"
                      ? "Fully Received"
                      : po.status === "PARTIAL"
                        ? "Partially Received"
                        : "Not Received"}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-xs text-slate-700">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-slate-600">Ordered qty</span>
                    <span className="tabular-nums font-medium">{receiveInfo ? receiveInfo.ordered.toFixed(3) : "—"}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-slate-600">Received qty</span>
                    <span className="tabular-nums font-medium">{receiveInfo ? receiveInfo.received.toFixed(3) : "—"}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-slate-600">Pending receipt qty</span>
                    <span className="tabular-nums font-medium">{receiveInfo ? receiveInfo.pending.toFixed(3) : "—"}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Billing summary</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
                    Billing status:{" "}
                    {billingTotals.billed <= 1e-9
                      ? "Not Billed"
                      : billingTotals.pendingBilling > 1e-9
                        ? "Partially Billed"
                        : "Fully Billed"}
                  </span>
                  {billingTotals.rebillable > 1e-9 ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-900">Billing Reopened</span>
                  ) : null}
                </div>
                <div className="mt-2 grid gap-1 text-xs text-slate-700">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-slate-600">Billed qty (finalized)</span>
                    <span className="tabular-nums font-medium">{billingTotals.billed.toFixed(3)}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-slate-600">Pending billing qty</span>
                    <span className="tabular-nums font-medium">{billingTotals.pendingBilling.toFixed(3)}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-slate-600">Re-billable qty</span>
                    <span className="tabular-nums font-medium">{billingTotals.rebillable.toFixed(3)}</span>
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-slate-600">
                  Purchase Bills affect supplier billing only. Stock does not change when a bill is cancelled.
                </div>
              </div>
            </div>

            {grnSuccess && !showFlowResumeBanner ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">{grnSuccess}</div>
            ) : null}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Line items</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-slate-600">
                      <th className="py-2 pr-2">RM</th>
                      <th className="py-2 pr-2 text-right">Ordered</th>
                      <th className="py-2 pr-2 text-right">Received</th>
                      <th className="py-2 pr-2">Unit</th>
                      <th className="py-2 pr-2">HSN</th>
                      <th className="py-2 pr-2 text-right">GST %</th>
                      <th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.lines.map((ln) => {
                      const amt =
                        ln.amount != null && String(ln.amount).trim() !== ""
                          ? Number(ln.amount)
                          : computeLineAmount(Number(ln.qty), Number(ln.rate ?? 0));
                      return (
                        <tr key={ln.id} className="border-b border-slate-100">
                          <td className="py-2 pr-2 font-medium text-slate-900">{ln.item?.itemName ?? `Item #${ln.itemId}`}</td>
                          <td className="py-2 pr-2 text-right tabular-nums">{ln.qty}</td>
                          <td className="py-2 pr-2 text-right tabular-nums">{receivedForLine(po, ln.id)}</td>
                          <td className="py-2 pr-2 text-slate-800">{ln.unit || "—"}</td>
                          <td className="py-2 pr-2 font-mono text-xs text-slate-800">{ln.hsn || "—"}</td>
                          <td className="py-2 pr-2 text-right tabular-nums text-slate-800">
                            {ln.gstRate != null && String(ln.gstRate).trim() !== "" ? ln.gstRate : "—"}
                          </td>
                          <td className="py-2 text-right tabular-nums text-slate-800">{Number.isFinite(amt) ? amt.toFixed(2) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Goods receipts (GRN)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <div className="font-medium text-slate-800">What this affects</div>
                  <div className="mt-0.5">
                    <span className="font-medium">GRN</span> affects stock received.{" "}
                    <span className="font-medium">Purchase Bill</span> affects supplier billing only (stock will NOT change).
                  </div>
                </div>
                {!po.grns.length ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-base font-semibold text-slate-900">📥 No goods received yet</div>
                    <div className="mt-1 text-sm text-slate-600">Create a GRN to record stock receipt.</div>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {po.grns.map((g) => (
                      <li
                        key={g.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-900">GRN-{g.id}</span>
                          <span className="inline-flex items-center gap-1.5 text-slate-700">
                            <span className={`inline-block h-2 w-2 rounded-full ${grnStatusDotClass(g)}`} aria-hidden />
                            {grnStatusLabel(g)}
                          </span>
                        </div>
                        {isAdmin && !g.reversedAt ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            disabled={reversingGrnId === g.id}
                            onClick={() => void onReverseGrn(g.id)}
                            title="Reverses the stock receipt and reduces received stock."
                          >
                            {reversingGrnId === g.id ? "Reversing…" : "Reverse GRN"}
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}

        {!loading && !po && !error ? (
          <p className="text-sm text-slate-600">Purchase order not found.</p>
        ) : null}
      </PageContainer>

      {editOpen && po ? (
        <div className="erp-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rm-po-edit-title">
          <Card className="erp-modal-shell max-h-[90vh] overflow-y-auto">
            <CardHeader className="pb-2">
              <CardTitle id="rm-po-edit-title" className="text-base">
                Edit {formatRmPoNo(po.id)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {relaxedTax ? (
                <p className="rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-950">
                  Testing mode: missing master fields use server fallbacks on save.
                </p>
              ) : null}
              {editModalWarnings.length > 0 ? (
                <ul className="list-inside list-disc rounded-md border border-sky-200 bg-sky-50/90 px-3 py-2 text-xs text-sky-950">
                  {editModalWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              <div className="grid gap-2 md:grid-cols-2">
                <FieldShortcutHint
                  show={shortcutHints.activeFieldId === "poSupplier"}
                  hint={shortcutHints.activeFieldHintText ?? ""}
                  placement="below"
                  className="min-w-0"
                >
                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600">Supplier</span>
                    <select
                      ref={supplierSelectRef}
                      className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                      value={supplierId}
                      {...poSupplierBind}
                    >
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </FieldShortcutHint>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="text-slate-600">Remarks</span>
                <Input className="h-9" value={poRemarks} onChange={(e) => setPoRemarks(e.target.value)} placeholder="Optional" />
              </label>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-slate-600">
                      <th className="py-2 pr-2">RM</th>
                      <th className="py-2 pr-2">Qty</th>
                      <th className="py-2 pr-2">Rate</th>
                      <th className="py-2 pr-2">Unit</th>
                      <th className="py-2 pr-2">HSN</th>
                      <th className="py-2 pr-2">GST %</th>
                      <th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poLines.map((l, i) => {
                      const poQtyBind = shortcutHints.bindField("poLineQty", {
                        onChange: (e) => {
                          const raw = (e.target as HTMLInputElement).value;
                          const v = raw.trim() === "" ? Number.NaN : Number(raw);
                          setPoLines((prev) =>
                            prev.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    qty: v,
                                    amount: Number.isFinite(v) && Number.isFinite(x.rate) ? computeLineAmount(v, x.rate) : 0,
                                  }
                                : x,
                            ),
                          );
                        },
                        onFocus: (e) => (e.target as HTMLInputElement).select(),
                      });
                      const locked = lineItemLocked(po, l.id);
                      return (
                        <tr key={l.id ?? `ln-${i}`} className="border-b">
                          <td className="py-1 pr-2">
                            <select
                              className="h-9 w-full min-w-[8rem] rounded border px-2 text-sm disabled:opacity-60"
                              value={l.itemId}
                              disabled={locked}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                const it = items.find((x) => x.id === v);
                                const d = deriveRmLineDisplayFromItem(it, relaxedTax);
                                setPoLines((prev) =>
                                  prev.map((x, j) =>
                                    j === i
                                      ? {
                                          ...x,
                                          itemId: v,
                                          unit: d.unit,
                                          hsn: d.hsn,
                                          gstRate: d.gstRate,
                                          amount: Number.isFinite(x.qty) && Number.isFinite(x.rate) ? computeLineAmount(x.qty, x.rate) : 0,
                                        }
                                      : x,
                                  ),
                                );
                              }}
                            >
                              {items.map((it) => (
                                <option key={it.id} value={it.id}>
                                  {it.itemName}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1 pr-2 align-top">
                            <Input
                              ref={(el) => {
                                poQtyInputRefs.current[i] = el;
                              }}
                              type="number"
                              className="h-9 w-24"
                              value={Number.isFinite(l.qty) ? String(l.qty) : ""}
                              min={0}
                              step="any"
                              onKeyDown={(e) => onPoLineQtyKeyDown(i, e)}
                              {...poQtyBind}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <Input
                              type="number"
                              className="h-9 w-28"
                              value={Number.isFinite(l.rate) ? String(l.rate) : ""}
                              min={0}
                              step="any"
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => {
                                const raw = (e.target as HTMLInputElement).value;
                                const v = raw.trim() === "" ? Number.NaN : Number(raw);
                                setPoLines((prev) =>
                                  prev.map((x, j) =>
                                    j === i
                                      ? {
                                          ...x,
                                          rate: v,
                                          amount: Number.isFinite(x.qty) && Number.isFinite(v) ? computeLineAmount(x.qty, v) : 0,
                                        }
                                      : x,
                                  ),
                                );
                              }}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <div className="flex h-9 items-center rounded border border-slate-100 bg-slate-50 px-2 text-xs text-slate-700">
                              {l.unit || "—"}
                            </div>
                          </td>
                          <td className="py-1 pr-2">
                            <div className="flex h-9 items-center rounded border border-slate-100 bg-slate-50 px-2 font-mono text-xs text-slate-700">
                              {l.hsn || "—"}
                            </div>
                          </td>
                          <td className="py-1 pr-2">
                            <div className="flex h-9 items-center rounded border border-slate-100 bg-slate-50 px-2 text-xs tabular-nums text-slate-700">
                              {l.gstRate == null ? "—" : l.gstRate}
                            </div>
                          </td>
                          <td className="py-1 text-right tabular-nums text-slate-800">{l.amount.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {po.status === "PENDING" && !hasActiveGrnRecord(po) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPoLines((p) => [...p, buildInitialPoLine(items[0], relaxedTax)])}
                >
                  Add line
                </Button>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={savingPo}>
                  Close
                </Button>
                <FieldShortcutHint
                  show={shortcutHints.activeFieldId === "savePo"}
                  hint={shortcutHints.activeFieldHintText ?? ""}
                  placement="above"
                  className="inline-block"
                >
                  <Button
                    type="button"
                    onClick={() => {
                      shortcutHints.markFieldShortcutUsed("savePo");
                      void onSavePoEdit();
                    }}
                    disabled={saveEditDisabled}
                    onFocus={savePoFocusBind.onFocus}
                    onBlur={savePoFocusBind.onBlur}
                  >
                    {savingPo ? "Saving…" : "Save changes"}
                  </Button>
                </FieldShortcutHint>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {grnModalOpen && po && grnAllowed ? (
        <div className="erp-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rm-grn-title">
          <Card className="erp-modal-shell max-h-[90vh] overflow-y-auto">
            <CardHeader className="pb-2">
              <CardTitle id="rm-grn-title" className="text-base">
                Post goods receipt — {formatRmPoNo(po.id)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-xs text-slate-600">
                  Enter receive quantities (pending shown per line). Tip: Tab moves to next line. Enter confirms receipt.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={grning}
                  onClick={() => {
                    setGrnLines(
                      po.lines.map((ln) => {
                        const got = receivedForLine(po, ln.id);
                        const pending = Math.max(0, Number(ln.qty) - got);
                        return { rmPoLineId: ln.id, receivedQty: pending };
                      }),
                    );
                    window.setTimeout(() => {
                      grnQtyInputRefs.current[0]?.focus();
                      grnQtyInputRefs.current[0]?.select?.();
                    }, 0);
                  }}
                >
                  Receive full
                </Button>
              </div>

              <div className="space-y-2">
                {po.lines.map((ln, i) => {
                  const got = receivedForLine(po, ln.id);
                  const pending = Math.max(0, Number(ln.qty) - got);
                  const gl = grnLines.find((g) => g.rmPoLineId === ln.id);
                  const grnQtyBind = shortcutHints.bindField("grnQty", {
                    onChange: (e) => {
                      const raw = (e.target as HTMLInputElement).value;
                      const v = raw.trim() === "" ? Number.NaN : Number(raw);
                      setGrnLines((prev) => {
                        const n = [...prev];
                        const ix = n.findIndex((x) => x.rmPoLineId === ln.id);
                        if (ix >= 0) n[ix] = { rmPoLineId: ln.id, receivedQty: v };
                        return n;
                      });
                    },
                    onFocus: (e) => (e.target as HTMLInputElement).select(),
                  });

                  return (
                    <div key={ln.id} className="rounded-md border border-slate-200 bg-white p-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-900">{ln.item?.itemName ?? "—"}</div>
                          <div className="text-xs text-slate-600">
                            Pending qty: <span className="tabular-nums text-slate-800">{pending}</span>
                          </div>
                        </div>

                        <div className="grid gap-1">
                          <div className="text-[11px] font-medium text-slate-600">Receive qty</div>
                          <FieldShortcutHint
                            show={i === 0 && shortcutHints.activeFieldId === "grnQty"}
                            hint={shortcutHints.activeFieldHintText ?? ""}
                            placement="below-end"
                          >
                            <Input
                              ref={(el) => {
                                grnQtyInputRefs.current[i] = el;
                              }}
                              type="number"
                              className="h-9 w-32"
                              value={gl && Number.isFinite(gl.receivedQty) ? String(gl.receivedQty) : ""}
                              min={0}
                              step="any"
                              onKeyDown={(e) => onGrnQtyKeyDown(i, e)}
                              {...grnQtyBind}
                            />
                          </FieldShortcutHint>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setGrnModalOpen(false)} disabled={grning}>
                  Close
                </Button>
                <FieldShortcutHint
                  show={shortcutHints.activeFieldId === "postGrn"}
                  hint={shortcutHints.activeFieldHintText ?? ""}
                  placement="above"
                  className="inline-block"
                >
                  <Button
                    type="button"
                    onClick={() => {
                      shortcutHints.markFieldShortcutUsed("postGrn");
                      void onGrnPost();
                    }}
                    disabled={grning}
                    onFocus={postGrnFocusBind.onFocus}
                    onBlur={postGrnFocusBind.onBlur}
                  >
                    {grning ? "Posting…" : "Confirm receipt"}
                  </Button>
                </FieldShortcutHint>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <ShortcutHintBar items={RM_PO_GRN_SHORTCUT_BAR} />
    </div>
  );
}
