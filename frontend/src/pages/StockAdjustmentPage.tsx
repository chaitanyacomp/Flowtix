import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "../services/api";
import { stockAdjustmentUserMessage } from "../lib/stockAdjustmentErrors";
import { useCanPostStockAdjustment } from "../hooks/useIsAdmin";
import { useAuth } from "../hooks/useAuth";
import { useFastEntryForm } from "../hooks/useFastEntryForm";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { type NumberDraft, toNumberDraft } from "../lib/numberDraft";
import {
  type StockAdjustmentPolicyDto,
  DEFAULT_STOCK_ADJUSTMENT_POLICY,
  parseStockAdjustmentPolicyDto,
  stockAdjustmentRuleHelperText,
  userCanCreatePerPolicy,
  userCanReversePerPolicy,
  reverseWithinWindowClient,
  canShowReverseAdjustmentButton,
} from "../lib/stockAdjustmentPolicyText";

type Item = { id: number; itemName: string; itemType: string; unit: string };

type StockSummaryRow = {
  itemId: number;
  item: { itemName: string; itemType: string; unit: string };
  qty: number;
};

type AdjustmentRow = {
  id: number;
  itemId: number;
  item: { itemName: string; itemType: string; unit: string };
  transactionType: string;
  qtyIn: string;
  qtyOut: string;
  reason?: string | null;
  date: string;
  reversalOfId?: number | null;
  reversedAt?: string | null;
  createdBy?: { id: number; name: string; email: string } | null;
  reversedBy?: { id: number; name: string; email: string } | null;
  reversalParent?: { id: number } | null;
};

function dash(s: string | null | undefined): string {
  const t = s?.trim();
  return t ? t : "—";
}

function adjustmentStatus(a: AdjustmentRow): "active" | "reversed" | "reversal_entry" {
  if (a.reversalOfId != null) return "reversal_entry";
  if (a.reversedAt) return "reversed";
  return "active";
}

const STRICT_ADJUSTMENT_MSG =
  "Strict Inventory Control is ON. Receive material through RM Purchase (purchase orders and goods receipts) only—manual stock adjustments are disabled.";

export function StockAdjustmentPage() {
  const auth = useAuth();
  const userRole = auth.user?.role;
  const canAdjust = useCanPostStockAdjustment();
  const [searchParams] = useSearchParams();
  const adjItemFromUrl = Number(searchParams.get("adjItem")) || 0;

  const [items, setItems] = React.useState<Item[]>([]);
  const [itemId, setItemId] = React.useState(0);
  const [adjustmentType, setAdjustmentType] = React.useState<"INCREASE" | "DECREASE">("INCREASE");
  const [qty, setQty] = React.useState<NumberDraft>("");
  // Keep legacy qtyIn/qtyOut values for API payloads and modal display.
  const [qtyIn, setQtyIn] = React.useState<NumberDraft>("");
  const [qtyOut, setQtyOut] = React.useState<NumberDraft>("");
  const [reason, setReason] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [adminPassword, setAdminPassword] = React.useState("");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [strictInventory, setStrictInventory] = React.useState(false);
  const [adjustments, setAdjustments] = React.useState<AdjustmentRow[]>([]);
  const [reverseTarget, setReverseTarget] = React.useState<AdjustmentRow | null>(null);
  const [reverseReason, setReverseReason] = React.useState("");
  const [reverseAdminPassword, setReverseAdminPassword] = React.useState("");
  const [reversing, setReversing] = React.useState(false);
  const [policy, setPolicy] = React.useState<StockAdjustmentPolicyDto>(() => ({ ...DEFAULT_STOCK_ADJUSTMENT_POLICY }));
  const [policyLoadWarning, setPolicyLoadWarning] = React.useState<string | null>(null);
  const [ledgerLoadError, setLedgerLoadError] = React.useState<string | null>(null);
  const [stockSummaryLoaded, setStockSummaryLoaded] = React.useState(false);
  const [stockSummaryError, setStockSummaryError] = React.useState<string | null>(null);
  const [stockQtyByItemId, setStockQtyByItemId] = React.useState<Record<number, number>>({});

  const formRef = React.useRef<HTMLFormElement | null>(null);
  const itemSelectRef = React.useRef<HTMLSelectElement | null>(null);
  useFastEntryForm({ containerRef: formRef, initialFocusRef: itemSelectRef });

  function loadAdjustments() {
    if (!canAdjust) return;
    setLedgerLoadError(null);
    apiFetch<AdjustmentRow[]>("/api/stock/adjustments")
      .then((rows) => setAdjustments(Array.isArray(rows) ? rows : []))
      .catch(() => {
        setAdjustments([]);
        setLedgerLoadError("Could not load adjustments list.");
      });
  }

  function loadStockSummary() {
    if (!canAdjust) return;
    setStockSummaryError(null);
    apiFetch<StockSummaryRow[]>("/api/stock/summary")
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        const map: Record<number, number> = {};
        for (const r of list) map[Number(r.itemId) || 0] = Number(r.qty) || 0;
        setStockQtyByItemId(map);
      })
      .catch((e) => setStockSummaryError(e instanceof Error ? e.message : "Could not load stock summary."))
      .finally(() => setStockSummaryLoaded(true));
  }

  React.useEffect(() => {
    apiFetch<Item[]>("/api/items")
      .then((list) => setItems(Array.isArray(list) ? list : []))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load items"));
  }, []);

  React.useEffect(() => {
    if (!items.length) return;
    setItemId((cur) => {
      if (adjItemFromUrl && items.some((i) => i.id === adjItemFromUrl)) return adjItemFromUrl;
      if (cur === 0) return items[0].id;
      return cur;
    });
  }, [items, adjItemFromUrl]);

  React.useEffect(() => {
    if (!canAdjust) {
      setStrictInventory(false);
      return;
    }
    apiFetch<{ strictInventoryControl: boolean }>("/api/settings/inventory-mode")
      .then((r) => setStrictInventory(!!r.strictInventoryControl))
      .catch(() => setStrictInventory(false));
  }, [canAdjust]);

  React.useEffect(() => {
    if (!canAdjust) return;
    let cancelled = false;
    apiFetch<unknown>("/api/settings/stock-adjustment-control")
      .then((raw) => {
        if (cancelled) return;
        setPolicy(parseStockAdjustmentPolicyDto(raw));
        setPolicyLoadWarning(null);
      })
      .catch(() => {
        if (cancelled) return;
        setPolicy({ ...DEFAULT_STOCK_ADJUSTMENT_POLICY });
        setPolicyLoadWarning(
          "Could not load stock adjustment policy. Default rules are being used.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [canAdjust]);

  React.useEffect(() => {
    loadAdjustments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAdjust]);

  React.useEffect(() => {
    loadStockSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAdjust]);

  React.useEffect(() => {
    // Map single Qty + type into qtyIn/qtyOut (no dual-input confusion).
    if (adjustmentType === "INCREASE") {
      setQtyIn(qty);
      setQtyOut("");
    } else {
      setQtyIn("");
      setQtyOut(qty);
    }
  }, [adjustmentType, qty]);

  const safePolicy = parseStockAdjustmentPolicyDto(policy);
  const canCreatePerSettings = userCanCreatePerPolicy(userRole, safePolicy);
  const canReversePerSettings = userCanReversePerPolicy(userRole, safePolicy);
  const selectedItem = items.find((i) => i.id === itemId);
  const selectedStockQty = itemId > 0 ? stockQtyByItemId[itemId] : undefined;
  const recentItemAdjustments = React.useMemo(() => {
    if (!itemId) return [];
    const list = (Array.isArray(adjustments) ? adjustments : []).filter((a) => a.itemId === itemId);
    list.sort((a, b) => (b.id || 0) - (a.id || 0));
    return list.slice(0, 3);
  }, [adjustments, itemId]);

  function adjRefNo(id: number): string {
    if (!Number.isFinite(id) || id <= 0) return "—";
    return `ADJ-${String(id).padStart(6, "0")}`;
  }

  const reasonOk = reason.trim().length > 0;
  const qtyNum = Number(qty);
  const qtyOk = Number.isFinite(qtyNum) && qtyNum > 0;
  const submitDisabled =
    saving || !reasonOk || !qtyOk || !itemId || !canAdjust || strictInventory || !canCreatePerSettings;

  function openConfirm() {
    setError(null);
    setSuccess(null);
    setAdminPassword("");
    setConfirmOpen(true);
  }

  function closeConfirm() {
    setConfirmOpen(false);
    setAdminPassword("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!canAdjust) {
      setError("Access denied. Only Admin and Store roles can post stock adjustments.");
      return;
    }
    if (strictInventory) {
      return;
    }
    if (!canCreatePerSettings) {
      setError("You are not allowed to post stock adjustments.");
      return;
    }
    const qIn = adjustmentType === "INCREASE" ? qtyNum : 0;
    const qOut = adjustmentType === "DECREASE" ? qtyNum : 0;
    if (!itemId) {
      setError("Select an item.");
      return;
    }
    if (!reasonOk) {
      setError("Reason is required.");
      return;
    }
    if (!Number.isFinite(qIn) || !Number.isFinite(qOut) || qIn < 0 || qOut < 0) {
      setError("Quantity must be a valid positive number.");
      return;
    }
    if ((qIn > 0 && qOut > 0) || (qIn === 0 && qOut === 0)) {
      setError("Select Increase or Decrease and enter a quantity greater than 0.");
      return;
    }
    // Do not post immediately — confirmation modal requires admin password.
    openConfirm();
  }

  async function confirmPost() {
    setError(null);
    setSuccess(null);
    if (!adminPassword.trim()) {
      setError("Admin password is required.");
      return;
    }
    const qIn = adjustmentType === "INCREASE" ? qtyNum : 0;
    const qOut = adjustmentType === "DECREASE" ? qtyNum : 0;
    const reasonTrim = reason.trim();
    if (!itemId) {
      setError("Select an item.");
      return;
    }
    if (!reasonTrim) {
      setError("Reason is required.");
      return;
    }
    if (!Number.isFinite(qIn) || !Number.isFinite(qOut) || qIn < 0 || qOut < 0) {
      setError("Quantity must be a valid positive number.");
      return;
    }
    if ((qIn > 0 && qOut > 0) || (qIn === 0 && qOut === 0)) {
      setError("Select Increase or Decrease and enter a quantity greater than 0.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/stock/adjustment", {
        method: "POST",
        body: JSON.stringify({ itemId, qtyIn: qIn, qtyOut: qOut, reason: reasonTrim, adminPassword }),
      });
      setSuccess("Stock adjustment posted.");
      setReason("");
      setQty("");
      closeConfirm();
      loadAdjustments();
      loadStockSummary();
    } catch (err) {
      setError(stockAdjustmentUserMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function openReverse(a: AdjustmentRow) {
    setError(null);
    setSuccess(null);
    setReverseTarget(a);
    setReverseReason("");
    setReverseAdminPassword("");
  }

  async function submitReverse(e: React.FormEvent) {
    e.preventDefault();
    if (!reverseTarget) return;
    const r = reverseReason.trim();
    if (!r) {
      setError("Reason is required.");
      return;
    }
    if (!reverseAdminPassword.trim()) {
      setError("Admin password is required.");
      return;
    }
    setReversing(true);
    setError(null);
    try {
      await apiFetch(`/api/stock/adjustments/${reverseTarget.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason: r, adminPassword: reverseAdminPassword }),
      });
      setReverseTarget(null);
      setReverseReason("");
      setReverseAdminPassword("");
      setSuccess("Adjustment reversed successfully.");
      loadAdjustments();
      loadStockSummary();
    } catch (err) {
      setError(stockAdjustmentUserMessage(err));
    } finally {
      setReversing(false);
    }
  }

  function reverseActionLabel(a: AdjustmentRow): { kind: "button" | "disabled"; label: string; reason?: string } {
    const st = adjustmentStatus(a);
    if (st === "reversal_entry") return { kind: "disabled", label: "Reversal entry" };
    if (st === "reversed") return { kind: "disabled", label: "Reversed" };
    if (strictInventory) return { kind: "disabled", label: "Reverse (Admin)", reason: "Strict inventory mode" };
    if (a.transactionType !== "ADJUSTMENT") return { kind: "disabled", label: "Reverse (Admin)", reason: "Not an adjustment entry" };
    if (!canReversePerSettings) return { kind: "disabled", label: "Reverse (Admin)", reason: "Not allowed by policy" };
    if (!reverseWithinWindowClient(a.date, safePolicy))
      return { kind: "disabled", label: "Reverse (Admin)", reason: "Reversal time window passed" };
    return { kind: "button", label: "Reverse (Admin)" };
  }

  if (!canAdjust) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Stock Adjustment</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-700" role="alert">
              Access denied. Only Admin and Store roles can post stock adjustments.
            </p>
            <p className="mt-3 text-sm text-slate-600">
              <Link to="/stock" className="font-medium text-primary underline">
                Back to Stock
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-900">Stock Adjustment</h1>
        <p className="text-sm text-slate-600">
          <Link to="/stock" className="font-medium text-primary underline">
            ← Stock balances
          </Link>
        </p>
      </div>

      {policyLoadWarning ? (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          role="status"
        >
          {policyLoadWarning}
        </div>
      ) : null}

      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        <span className="font-semibold">Manual stock changes directly affect inventory.</span> Admin password is required for every post and reverse.
      </div>

      <p className="rounded-md border border-slate-200 bg-slate-50/90 px-3 py-2 text-sm text-slate-800">
        {stockAdjustmentRuleHelperText(safePolicy)}
      </p>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="border-slate-200 shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Post Adjustment</CardTitle>
          </CardHeader>
          <CardContent>
            {loadError ? <div className="mb-3 text-sm text-red-700">{loadError}</div> : null}
            {error ? <div className="mb-3 text-sm text-red-700">{error}</div> : null}
            {success ? (
              <div
                className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                role="status"
              >
                {success}
              </div>
            ) : null}
            {strictInventory ? (
              <div className="space-y-3 text-sm text-slate-700">
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">{STRICT_ADJUSTMENT_MSG}</p>
                <p>
                  Use{" "}
                  <Link to="/rm-po-grn" className="font-medium text-primary underline">
                    RM Purchase
                  </Link>{" "}
                  to receive stock and update inventory.
                </p>
              </div>
            ) : !canCreatePerSettings ? (
              <p className="text-sm text-slate-700">
                Posting new adjustments is limited to administrators (see{" "}
                <Link to="/admin/settings" className="font-medium text-primary underline">
                  Admin settings
                </Link>
                ). You can still view the ledger below.
              </p>
            ) : (
              <form ref={formRef} onSubmit={onSubmit} className="erp-form max-w-md">
                <div className="erp-form-field">
                  <span className="erp-form-label">Item</span>
                  <select
                    ref={itemSelectRef}
                    className="erp-select"
                    value={itemId || ""}
                    onChange={(e) => setItemId(Number(e.target.value))}
                    disabled={!!loadError || items.length === 0}
                  >
                    {items.length === 0 ? (
                      <option value="">—</option>
                    ) : (
                      items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.itemName} ({i.itemType}, {i.unit})
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Adjustment type</span>
                  <div className="mt-1 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setAdjustmentType("INCREASE")}
                      className={
                        adjustmentType === "INCREASE"
                          ? "rounded-md border border-emerald-300 bg-emerald-50 px-3 py-3 text-left shadow-sm ring-2 ring-emerald-500/30"
                          : "rounded-md border border-slate-200 bg-white px-3 py-3 text-left hover:bg-slate-50"
                      }
                      aria-pressed={adjustmentType === "INCREASE"}
                    >
                      <div className="text-sm font-semibold text-emerald-900">+ Increase Stock</div>
                      <div className="mt-0.5 text-xs text-slate-600">Adds quantity to current stock</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjustmentType("DECREASE")}
                      className={
                        adjustmentType === "DECREASE"
                          ? "rounded-md border border-red-300 bg-red-50 px-3 py-3 text-left shadow-sm ring-2 ring-red-500/30"
                          : "rounded-md border border-slate-200 bg-white px-3 py-3 text-left hover:bg-slate-50"
                      }
                      aria-pressed={adjustmentType === "DECREASE"}
                    >
                      <div className="text-sm font-semibold text-red-900">– Decrease Stock</div>
                      <div className="mt-0.5 text-xs text-slate-600">Removes quantity from current stock</div>
                    </button>
                  </div>
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Quantity</span>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={qty}
                    onChange={(e) => setQty(toNumberDraft(e.target.value))}
                    placeholder="0"
                  />
                  <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    {(() => {
                      const cur = stockSummaryLoaded ? (selectedStockQty ?? 0) : 0;
                      const q = Number(qty);
                      const delta = Number.isFinite(q) ? q : 0;
                      const after = adjustmentType === "INCREASE" ? cur + delta : cur - delta;
                      return (
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="text-slate-600">Current:</span>
                          <span className="font-semibold tabular-nums text-slate-900">{stockSummaryLoaded ? cur : "—"}</span>
                          <span className="text-slate-400">→</span>
                          <span className="text-slate-600">After:</span>
                          <span
                            className={
                              adjustmentType === "INCREASE"
                                ? "font-bold tabular-nums text-emerald-900"
                                : "font-bold tabular-nums text-red-900"
                            }
                          >
                            {stockSummaryLoaded ? after : "—"}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Reason</span>
                  <textarea
                    className="min-h-[5rem] w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Explain why this stock change is needed"
                    rows={3}
                  />
                  <p className="mt-1 text-xs text-slate-500">Required</p>
                </div>
                <Button type="submit" disabled={submitDisabled}>
                  {saving
                    ? "Saving…"
                    : adjustmentType === "INCREASE"
                      ? "Post Increase (Admin)"
                      : "Post Decrease (Admin)"}
                </Button>
                <p className="mt-3 text-xs text-slate-500">
                  Creates an immutable ledger row (type ADJUSTMENT). Use <strong>Reverse</strong> below to undo an entry.
                </p>
              </form>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Item Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stockSummaryError ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                {stockSummaryError}
              </div>
            ) : null}

            {!selectedItem ? (
              <p className="text-sm text-slate-600">Select an item to view details</p>
            ) : (
              <div className="space-y-3">
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Impact preview</div>
                  {(() => {
                    const cur = stockSummaryLoaded ? (selectedStockQty ?? 0) : 0;
                    const q = Number(qty);
                    const delta = Number.isFinite(q) ? q : 0;
                    const signed = adjustmentType === "INCREASE" ? delta : -delta;
                    const after = adjustmentType === "INCREASE" ? cur + delta : cur - delta;
                    return (
                      <div className="mt-2 grid gap-2">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="text-slate-600">Current Stock</span>
                          <span className="tabular-nums font-semibold text-slate-900">{stockSummaryLoaded ? cur : "—"}</span>
                        </div>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="text-slate-600">Adjustment Change</span>
                          <span
                            className={
                              signed > 0
                                ? "tabular-nums font-semibold text-emerald-700"
                                : signed < 0
                                  ? "tabular-nums font-semibold text-red-700"
                                  : "tabular-nums text-slate-500"
                            }
                          >
                            {signed > 0 ? `+${signed}` : signed < 0 ? `${signed}` : "—"}
                          </span>
                        </div>
                        <div className="flex items-end justify-between gap-3">
                          <span className="text-sm font-medium text-slate-700">After Adjustment</span>
                          <span
                            className={
                              adjustmentType === "INCREASE"
                                ? "text-2xl font-bold tabular-nums text-emerald-900"
                                : "text-2xl font-bold tabular-nums text-red-900"
                            }
                          >
                            {stockSummaryLoaded ? after : "—"}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="text-slate-600">Unit</span>
                          <span className="text-slate-900">{selectedItem.unit}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {recentItemAdjustments.length ? (
                  <div className="pt-2">
                    <div className="mb-2 text-sm font-medium text-slate-900">Recent adjustments</div>
                    <div className="space-y-2">
                      {recentItemAdjustments.map((a) => {
                        const qty = Number(a.qtyIn) ? `+${Number(a.qtyIn)}` : Number(a.qtyOut) ? `-${Number(a.qtyOut)}` : "—";
                        return (
                          <div key={a.id} className="flex items-start justify-between gap-3 text-xs text-slate-700">
                            <div className="min-w-0">
                              <div className="truncate font-mono">{adjRefNo(a.id)}</div>
                              <div className="text-[11px] text-slate-500">
                                {a.date ? new Date(a.date).toLocaleString() : "—"}
                              </div>
                            </div>
                            <div className="whitespace-nowrap tabular-nums text-slate-900">
                              {qty} {selectedItem.unit}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {confirmOpen ? (
        <div className="erp-modal-backdrop" role="dialog" aria-label="Confirm stock adjustment">
          <Card className="erp-modal-shell flex w-[calc(100vw-2rem)] max-w-[640px] max-h-[85vh] flex-col overflow-hidden">
            <div className="sticky top-0 z-[2] flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
              <div className="text-base font-semibold text-slate-900">Confirm Stock Adjustment</div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label="Close"
                onClick={closeConfirm}
                disabled={saving}
              >
                ×
              </Button>
            </div>
            <CardContent className="min-h-0 flex-1 p-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void confirmPost();
                }}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-10">
                  <div className="space-y-3">
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                      <div className="grid gap-1">
                        <div>
                          <span className="text-slate-600">Item:</span>{" "}
                          <span className="font-medium">{selectedItem ? selectedItem.itemName : `Item #${itemId}`}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          <span>
                            <span className="text-slate-600">Qty In:</span>{" "}
                            <span className="font-semibold tabular-nums">{adjustmentType === "INCREASE" ? Number(qty) || 0 : 0}</span>
                          </span>
                          <span>
                            <span className="text-slate-600">Qty Out:</span>{" "}
                            <span className="font-semibold tabular-nums">{adjustmentType === "DECREASE" ? Number(qty) || 0 : 0}</span>
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-600">Reason:</span> <span className="font-medium">{reason.trim()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="erp-form-field">
                      <span className="erp-form-label">Admin Password</span>
                      <Input
                        type="password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        placeholder="Enter admin password to confirm"
                        autoFocus
                      />
                      <p className="mt-1 text-xs text-slate-500">Required to post stock changes.</p>
                    </div>
                  </div>
                </div>

                <div className="sticky bottom-0 z-[2] border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-8px_16px_-16px_rgba(0,0,0,0.55)]">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="outline" onClick={closeConfirm} disabled={saving}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={saving || !adminPassword.trim()}>
                      {saving ? "Posting…" : "Confirm Post"}
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Adjustments ledger</CardTitle>
        </CardHeader>
        <CardContent>
          {ledgerLoadError ? (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {ledgerLoadError}
            </div>
          ) : null}
          {strictInventory ? (
            <p className="mb-3 text-sm text-slate-600">
              Strict mode: ledger is read-only. Use RM Purchase to change stock levels.
            </p>
          ) : null}
          <div className="overflow-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b text-left text-slate-600">
                  <th className="py-2 pr-2">Ref No</th>
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">Item</th>
                  <th className="py-2 pr-2">Change</th>
                  <th className="py-2 pr-2">Reason</th>
                  <th className="py-2 pr-2">Created by</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Reversal info</th>
                  <th className="py-2 pr-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const list = Array.isArray(adjustments) ? adjustments : [];
                  const dayKey = (iso: string | null | undefined): "Today" | "Yesterday" | "Older" => {
                    if (!iso) return "Older";
                    const d = new Date(iso);
                    if (Number.isNaN(d.getTime())) return "Older";
                    const now = new Date();
                    const startToday = new Date(now);
                    startToday.setHours(0, 0, 0, 0);
                    const startYesterday = new Date(startToday);
                    startYesterday.setDate(startYesterday.getDate() - 1);
                    if (d >= startToday) return "Today";
                    if (d >= startYesterday) return "Yesterday";
                    return "Older";
                  };

                  const order: Array<"Today" | "Yesterday" | "Older"> = ["Today", "Yesterday", "Older"];
                  const grouped = new Map(order.map((k) => [k, [] as AdjustmentRow[]]));
                  for (const a of list) grouped.get(dayKey(a.date))?.push(a);

                  const rows: React.ReactNode[] = [];
                  for (const k of order) {
                    const grp = grouped.get(k) ?? [];
                    if (!grp.length) continue;
                    rows.push(
                      <tr key={`grp-${k}`} className="bg-slate-50">
                        <td colSpan={9} className="py-2 pr-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {k}
                        </td>
                      </tr>,
                    );
                    for (const a of grp) {
                      const st = adjustmentStatus(a);
                      const action = reverseActionLabel(a);
                      const itemLabel = a.item ? `${a.item.itemName ?? "?"} (${a.item.itemType ?? "?"})` : "—";
                      const inNum = Number(a.qtyIn) || 0;
                      const outNum = Number(a.qtyOut) || 0;
                      const delta = inNum - outNum;
                      rows.push(
                        <tr key={a.id} className="border-b">
                          <td className="whitespace-nowrap py-2 pr-2 font-mono text-xs text-slate-700">{adjRefNo(a.id)}</td>
                          <td className="whitespace-nowrap py-2 pr-2 text-slate-700">{a.date ? new Date(a.date).toLocaleString() : "—"}</td>
                          <td className="py-2 pr-2 font-medium">{itemLabel}</td>
                          <td className="py-2 pr-2 tabular-nums">
                            {delta > 0 ? (
                              <span className="font-semibold text-emerald-700">+{delta}</span>
                            ) : delta < 0 ? (
                              <span className="font-semibold text-red-700">{delta}</span>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                          <td className="max-w-[200px] py-2 pr-2 text-slate-700">{dash(a.reason ?? undefined)}</td>
                          <td className="max-w-[140px] py-2 pr-2 text-slate-700">{dash(a.createdBy?.name)}</td>
                          <td className="py-2 pr-2">
                            {st === "active" ? (
                              <Badge variant="success">Active</Badge>
                            ) : st === "reversed" ? (
                              <Badge variant="rejected">Reversed</Badge>
                            ) : (
                              <Badge variant="info">Reversal entry</Badge>
                            )}
                          </td>
                          <td className="max-w-[220px] py-2 pr-2 text-xs text-slate-600">
                            {st === "reversal_entry" ? (
                              <span>Reverses #{a.reversalParent?.id ?? a.reversalOfId ?? "—"}</span>
                            ) : st === "reversed" ? (
                              <span>
                                {a.reversedAt ? new Date(a.reversedAt).toLocaleString() : "—"}
                                {a.reversedBy?.name ? ` · ${a.reversedBy.name}` : ""}
                              </span>
                            ) : (
                              <span>—</span>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-right">
                            {action.kind === "button" && canShowReverseAdjustmentButton(a, strictInventory, safePolicy, userRole) ? (
                              <Button type="button" size="sm" variant="outline" onClick={() => openReverse(a)}>
                                Reverse (Admin)
                              </Button>
                            ) : (
                              <span className="inline-flex flex-col items-end gap-1 text-right text-xs text-slate-500">
                                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">{action.label}</span>
                                {action.reason ? <span className="max-w-[180px] text-[11px] text-slate-400">{action.reason}</span> : null}
                              </span>
                            )}
                          </td>
                        </tr>,
                      );
                    }
                  }
                  return rows;
                })()}
              </tbody>
            </table>
            {!adjustments.length ? <p className="mt-2 text-sm text-slate-600">No stock adjustments recorded yet.</p> : null}
          </div>
        </CardContent>
      </Card>

      {reverseTarget ? (
        <div className="erp-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="reverse-adj-title">
          <Card className="erp-modal-shell max-w-md">
            <CardHeader className="pb-2">
              <CardTitle id="reverse-adj-title" className="text-base">
                Reverse (Admin) · {adjRefNo(reverseTarget.id)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                <div className="grid gap-1">
                  <div>
                    <span className="text-slate-600">Item:</span>{" "}
                    <span className="font-medium">{reverseTarget.item?.itemName ?? `Item #${reverseTarget.itemId}`}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      <span className="text-slate-600">Qty In:</span>{" "}
                      <span className="font-semibold tabular-nums">{Number(reverseTarget.qtyIn) || 0}</span>
                    </span>
                    <span>
                      <span className="text-slate-600">Qty Out:</span>{" "}
                      <span className="font-semibold tabular-nums">{Number(reverseTarget.qtyOut) || 0}</span>
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-600">Original reason:</span>{" "}
                    <span className="font-medium">{dash(reverseTarget.reason ?? undefined)}</span>
                  </div>
                </div>
              </div>
              <form onSubmit={submitReverse} className="grid gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-slate-700">Reversal reason</span>
                  <Input
                    value={reverseReason}
                    onChange={(e) => setReverseReason(e.target.value)}
                    placeholder="Why are you reversing this adjustment?"
                    autoFocus
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-slate-700">Admin password</span>
                  <Input
                    type="password"
                    value={reverseAdminPassword}
                    onChange={(e) => setReverseAdminPassword(e.target.value)}
                    placeholder="Enter admin password to confirm reverse"
                  />
                </label>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={reversing}
                    onClick={() => {
                      setReverseTarget(null);
                      setReverseReason("");
                      setReverseAdminPassword("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={reversing || !reverseReason.trim() || !reverseAdminPassword.trim()}>
                    {reversing ? "Reversing…" : "Confirm Reverse (Admin)"}
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
