import * as React from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { deleteUrlParamKeys } from "../../lib/urlSearchParamsPatch";
import { DrillFocusBanner } from "../../components/DrillFocusBanner";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../../hooks/useUrlQueryState";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import {
  DRILL_FOCUS_EMPTY_FILTERED_SUFFIX,
  DRILL_FOCUS_HINT_HIDDEN_BY_FILTERS,
  DRILL_FOCUS_HINT_NOT_IN_LIST,
  DRILL_RECOVERY_LABEL,
  drillFocusTitleRmPo,
} from "../../lib/drillFocusCopy";
import { DRILL_DATA, DRILL_QUERY, withReportsReturnContextIfPresent } from "../../lib/drillDownRoutes";
import { useDrillFocus } from "../../hooks/useDrillFocus";
import { apiFetch } from "../../services/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useShortcutHints } from "../../hooks/useShortcutHints";
import { ShortcutHintBar, ShortcutFirstUseTip } from "../../components/ui/ShortcutHintBar";
import { FieldShortcutHint } from "../../components/ui/FieldShortcutHint";
import {
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
  type Item,
  type PoLineDraft,
  type RmPoRow,
  poStatusDotClass,
  poStatusLabel,
  type Supplier,
} from "./rmPurchaseShared";
import { PageSmartBackLink, StickyWorkspaceHead } from "../../components/PageHeader";

type PurchaseMeta = { testingModeRelaxedTaxFields: boolean };

const RM_PO_GRN_URL_OMIT: Record<string, string> = { poStatus: "ALL" };

export function RmPurchaseListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [navSearchParams] = useSearchParams();
  const { searchParams, setSearchParams, patch, read } = useUrlQueryState(RM_PO_GRN_URL_OMIT);
  const focusPoId = Number(searchParams.get(DRILL_QUERY.rmPoId)) || 0;
  const poStatusFilter = read.enum("poStatus", ["ALL", "OPEN", "COMPLETED", "CANCELLED"] as const, "ALL");
  const qFromUrl = read.string("q");
  const [qDraft, setQDraft] = useDebouncedUrlStringParam({ urlValue: qFromUrl, patch, paramKey: "q" });

  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [items, setItems] = React.useState<Item[]>([]);
  const [rows, setRows] = React.useState<RmPoRow[]>([]);
  const [listLoaded, setListLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [newPoOpen, setNewPoOpen] = React.useState(false);
  const [supplierId, setSupplierId] = React.useState(0);
  const [poRemarks, setPoRemarks] = React.useState("");
  const [poLines, setPoLines] = React.useState<PoLineDraft[]>([]);
  const [purchaseMeta, setPurchaseMeta] = React.useState<PurchaseMeta | null>(null);
  const [creatingPo, setCreatingPo] = React.useState(false);

  const relaxedTax = Boolean(purchaseMeta?.testingModeRelaxedTaxFields);

  const supplierSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const poItemSelectRefs = React.useRef<(HTMLSelectElement | null)[]>([]);
  const poQtyInputRefs = React.useRef<(HTMLInputElement | null)[]>([]);
  const poRateInputRefs = React.useRef<(HTMLInputElement | null)[]>([]);

  const [lineTouched, setLineTouched] = React.useState<Record<number, { item?: boolean; qty?: boolean; rate?: boolean }>>({});
  const [lineAttemptedAdd, setLineAttemptedAdd] = React.useState<Record<number, boolean>>({});

  /** Legacy ?poId= deep-link → PO detail route */
  React.useEffect(() => {
    const legacy = Number(navSearchParams.get(DRILL_QUERY.rmPoId)) || 0;
    if (!legacy) return;
    navigate(withReportsReturnContextIfPresent(`/rm-po-grn/${legacy}`, location.search), { replace: true });
  }, [navigate, navSearchParams, location.search]);

  async function refresh(): Promise<void> {
    const fetchErr = (reason: unknown) => (reason instanceof Error ? reason.message : "Request failed");
    try {
      const [rS, rI, rP] = await Promise.allSettled([
        apiFetch<Supplier[]>("/api/suppliers"),
        apiFetch<Item[]>("/api/items?type=RM"),
        apiFetch<RmPoRow[]>("/api/purchase/rm-pos"),
      ]);
      const errors: string[] = [];
      if (rS.status === "fulfilled") {
        setSuppliers(rS.value);
        setSupplierId((cur) => {
          const s = rS.value;
          if (cur && s.some((x) => x.id === cur)) return cur;
          return s.length ? s[0].id : 0;
        });
      } else {
        errors.push(`Suppliers: ${fetchErr(rS.reason)}`);
      }
      if (rI.status === "fulfilled") {
        setItems(rI.value);
      } else {
        errors.push(`RM items: ${fetchErr(rI.reason)}`);
      }
      if (rP.status === "fulfilled") {
        setRows(rP.value);
      } else {
        errors.push(`RM POs: ${fetchErr(rP.reason)}`);
      }
      setError(errors.length ? errors.join(" · ") : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setListLoaded(true);
    }
  }

  React.useEffect(() => {
    void refresh();
  }, []);

  React.useEffect(() => {
    apiFetch<PurchaseMeta>("/api/purchase/meta")
      .then(setPurchaseMeta)
      .catch(() => setPurchaseMeta({ testingModeRelaxedTaxFields: false }));
  }, []);

  React.useEffect(() => {
    if (!items.length || !newPoOpen) return;
    setPoLines((pl) => {
      if (pl.length === 0) return [buildInitialPoLine(items[0], relaxedTax)];
      if (pl.length === 1 && pl[0].itemId === 0) return [buildInitialPoLine(items[0], relaxedTax)];
      return pl;
    });
  }, [items, newPoOpen, relaxedTax]);

  function openNewPoModal() {
    setError(null);
    setNewPoOpen(true);
    setPoRemarks("");
    setPoLines(items.length ? [buildInitialPoLine(items[0], relaxedTax)] : []);
    setSupplierId(suppliers[0]?.id ?? 0);
  }

  const modalTaxWarnings = React.useMemo(() => {
    const w: string[] = [];
    for (const l of poLines) {
      const it = items.find((x) => x.id === l.itemId);
      w.push(...deriveRmLineDisplayFromItem(it, relaxedTax).warnings);
    }
    return [...new Set(w)];
  }, [poLines, items, relaxedTax]);

  const visiblePoRows = React.useMemo(() => {
    const q = qDraft.trim().toLowerCase();
    return rows.filter((r) => {
      if (poStatusFilter === "OPEN" && (r.status === "COMPLETED" || r.status === "CANCELLED")) return false;
      if (poStatusFilter === "COMPLETED" && r.status !== "COMPLETED") return false;
      if (poStatusFilter === "CANCELLED" && r.status !== "CANCELLED") return false;
      if (q) {
        const inLines = r.lines.some((ln) => (ln.item?.itemName ?? "").toLowerCase().includes(q));
        const hit =
          String(r.id).includes(q) ||
          formatRmPoNo(r.id).toLowerCase().includes(q) ||
          r.supplier.name.toLowerCase().includes(q) ||
          inLines;
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, poStatusFilter, qDraft]);

  const poListFiltersActive = poStatusFilter !== "ALL" || qDraft.trim().length > 0;

  function clearPoListFilters() {
    setQDraft("");
    patch({ poStatus: null, q: null });
  }

  const clearPoDrillFocus = React.useCallback(() => {
    setSearchParams((prev) => deleteUrlParamKeys(prev, [DRILL_QUERY.rmPoId]), { replace: true });
  }, [setSearchParams]);

  const revealPoDrillTarget = React.useCallback(() => {
    setQDraft("");
    patch({ poStatus: null, q: null });
  }, [patch, setQDraft]);

  const poDrillInData = focusPoId > 0 && rows.some((r) => r.id === focusPoId);
  const poDrillVisible = focusPoId > 0 && visiblePoRows.some((r) => r.id === focusPoId);
  const poDrillHiddenByFilters = listLoaded && poDrillInData && !poDrillVisible;
  const focusedPoRow = rows.find((r) => r.id === focusPoId);

  useDrillFocus({
    attribute: DRILL_DATA.poId,
    id: focusPoId,
    ready: listLoaded,
    enabled: focusPoId > 0 && rows.some((r) => r.id === focusPoId),
    retryDeps: [rows.length, poDrillVisible],
  });

  const saveDisabled =
    creatingPo ||
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

  async function onCreatePo() {
    setError(null);
    setCreatingPo(true);
    try {
      const created = await apiFetch<RmPoRow & { taxWarnings?: string[] }>("/api/purchase/rm-pos", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          remarks: poRemarks.trim() || null,
          lines: poLines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate })),
        }),
      });
      setNewPoOpen(false);
      navigate(withReportsReturnContextIfPresent(`/rm-po-grn/${created.id}`, location.search), {
        state: { rmPoTaxWarnings: created.taxWarnings ?? [] },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreatingPo(false);
    }
  }

  const shortcutHints = useShortcutHints({
    pageKey: "rm-po-grn",
    fieldShortcuts: {
      poSupplier: FIELD_HINT_PO_SUPPLIER,
      poLineQty: FIELD_HINT_GRID_NAV,
      savePo: FIELD_HINT_SAVE,
    },
    firstUseTipText: "Tip: Use Enter to move faster and Ctrl+Enter to confirm.",
  });

  const poSupplierBind = shortcutHints.bindField("poSupplier", {
    onChange: (e) => {
      const v = Number((e.target as HTMLSelectElement).value);
      setSupplierId(v);
      patch({ supplier: v || null });
    },
  });

  const savePoFocusBind = shortcutHints.bindField("savePo");

  React.useEffect(() => {
    poQtyInputRefs.current = poQtyInputRefs.current.slice(0, poLines.length);
  }, [poLines.length]);

  React.useEffect(() => {
    poItemSelectRefs.current = poItemSelectRefs.current.slice(0, poLines.length);
    poRateInputRefs.current = poRateInputRefs.current.slice(0, poLines.length);
  }, [poLines.length]);

  React.useEffect(() => {
    if (!newPoOpen) return;
    const t = window.setTimeout(() => {
      poItemSelectRefs.current[0]?.focus();
    }, 50);
    return () => window.clearTimeout(t);
  }, [newPoOpen]);

  const shortcutFlagsRef = React.useRef({ saveDisabled: true });
  shortcutFlagsRef.current = { saveDisabled };

  const markShortcutRef = React.useRef(shortcutHints.markFieldShortcutUsed);
  markShortcutRef.current = shortcutHints.markFieldShortcutUsed;

  React.useEffect(() => {
    function onGlobalKey(ev: KeyboardEvent) {
      if (ev.defaultPrevented) return;
      if (!newPoOpen) {
        if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.code === "KeyN") {
          ev.preventDefault();
          openNewPoModal();
        }
        return;
      }
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.code === "Digit1") {
        ev.preventDefault();
        markShortcutRef.current("poSupplier");
        supplierSelectRef.current?.focus();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.code === "KeyS") {
        ev.preventDefault();
        if (!shortcutFlagsRef.current.saveDisabled) {
          markShortcutRef.current("savePo");
          void onCreatePo();
        }
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        if (!shortcutFlagsRef.current.saveDisabled) {
          markShortcutRef.current("savePo");
          void onCreatePo();
        }
        return;
      }
      if (ev.key === "Escape" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        setNewPoOpen(false);
        setError(null);
      }
    }
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  }, [newPoOpen]);

  function isLineValid(l: PoLineDraft): { item: boolean; qty: boolean; rate: boolean } {
    return {
      item: Boolean(l.itemId),
      qty: Number.isFinite(l.qty) && l.qty > 0,
      rate: Number.isFinite(l.rate) && l.rate > 0,
    };
  }

  function setTouched(i: number, field: "item" | "qty" | "rate") {
    setLineTouched((prev) => ({ ...prev, [i]: { ...(prev[i] || {}), [field]: true } }));
  }

  function shouldShowErr(i: number, field: "item" | "qty" | "rate") {
    return Boolean(lineAttemptedAdd[i] || lineTouched[i]?.[field]);
  }

  function focusFirstInvalid(i: number) {
    const v = isLineValid(poLines[i]);
    if (!v.item) return poItemSelectRefs.current[i]?.focus();
    if (!v.qty) return poQtyInputRefs.current[i]?.focus();
    if (!v.rate) return poRateInputRefs.current[i]?.focus();
  }

  function addLineFrom(i: number) {
    if (!items.length) return;
    setLineAttemptedAdd((prev) => ({ ...prev, [i]: true }));
    const v = isLineValid(poLines[i]);
    if (!v.item || !v.qty || !v.rate) {
      focusFirstInvalid(i);
      return;
    }
    setPoLines((p) => [...p, buildInitialPoLine(items[0], relaxedTax)]);
    window.setTimeout(() => {
      poItemSelectRefs.current[i + 1]?.focus();
    }, 0);
  }

  return (
    <div className="flex min-h-full flex-col pb-[5.5rem] sm:pb-20">
      <div className="grid flex-1 gap-3">
        <ShortcutFirstUseTip
          visible={shortcutHints.firstUseTipVisible}
          message="Tip: Use Enter to move faster and Ctrl+Enter to confirm."
          onDismiss={shortcutHints.dismissFirstUseTip}
        />

        <DrillFocusBanner
          active={focusPoId > 0}
          title={drillFocusTitleRmPo(focusPoId, focusedPoRow?.supplier.name)}
          variant={
            listLoaded && focusPoId > 0 && !poDrillInData ? "soft" : poDrillHiddenByFilters ? "soft" : "default"
          }
          hint={
            listLoaded && focusPoId > 0 && !poDrillInData
              ? DRILL_FOCUS_HINT_NOT_IN_LIST.purchaseOrder
              : poDrillHiddenByFilters
                ? DRILL_FOCUS_HINT_HIDDEN_BY_FILTERS.purchaseOrder
                : undefined
          }
          recoveryAction={
            poDrillHiddenByFilters ? { label: DRILL_RECOVERY_LABEL.purchaseOrder, onClick: revealPoDrillTarget } : undefined
          }
          onClearFocus={clearPoDrillFocus}
        />

        <StickyWorkspaceHead lead={<PageSmartBackLink defaultTo="/dashboard" defaultLabel="Back to Dashboard" />}>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <h1 className="text-lg font-semibold leading-snug text-slate-900">RM Purchase</h1>
              <p className="text-sm leading-relaxed text-slate-600">Pending purchase orders, GRN receipts, and receiving follow-up.</p>
            </div>
            <Button type="button" size="sm" className="h-9 w-fit shrink-0" onClick={openNewPoModal}>
              + New Purchase Order
            </Button>
          </div>
        </StickyWorkspaceHead>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-800">Search &amp; filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {error && !newPoOpen ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            ) : null}
            <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50/80 p-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-medium text-slate-600">
                PO status
                <select
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                  value={poStatusFilter}
                  onChange={(e) => patch({ poStatus: e.target.value as typeof poStatusFilter })}
                >
                  <option value="ALL">All</option>
                  <option value="OPEN">Open (pending / partial)</option>
                  <option value="COMPLETED">Fully received</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium text-slate-600">
                Search
                <Input className="h-9" value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="PO #, supplier, item…" />
              </label>
            </div>
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" className="h-8 w-fit" disabled={!poListFiltersActive} onClick={clearPoListFilters}>
                Clear list filters
              </Button>
            </div>
            {poListFiltersActive && rows.length > 0 ? (
              <p className="text-xs text-slate-600">
                Showing <span className="font-semibold tabular-nums">{visiblePoRows.length}</span> of{" "}
                <span className="tabular-nums">{rows.length}</span> purchase orders
              </p>
            ) : null}

            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr className="text-left text-xs font-medium uppercase text-slate-500">
                    <th className="px-3 py-2">PO number</th>
                    <th className="px-3 py-2">Supplier</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {!rows.length && listLoaded ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-8 text-center text-slate-600">
                        <div className="mx-auto max-w-[28rem] space-y-1">
                          <div className="text-base font-semibold text-slate-900">📦 No Purchase Orders yet</div>
                          <div className="text-sm text-slate-600">Click “+ New Purchase Order” to create your first PO.</div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {visiblePoRows.map((r) => (
                    <tr
                      key={r.id}
                      {...{ [DRILL_DATA.poId]: r.id }}
                      className="cursor-pointer border-b border-slate-100 hover:bg-sky-50/60"
                      onClick={() => navigate(withReportsReturnContextIfPresent(`/rm-po-grn/${r.id}`, location.search))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigate(withReportsReturnContextIfPresent(`/rm-po-grn/${r.id}`, location.search));
                        }
                      }}
                      tabIndex={0}
                      role="link"
                    >
                      <td className="px-3 py-2.5 font-medium text-slate-900">{formatRmPoNo(r.id)}</td>
                      <td className="px-3 py-2.5 text-slate-800">{r.supplier.name}</td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${poStatusDotClass(r.status)}`} aria-hidden />
                          <span>{poStatusLabel(r.status)}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length ? null : visiblePoRows.length === 0 ? (
              <p className="text-sm text-slate-600">
                No purchase orders match the current filters.
                {poDrillHiddenByFilters ? ` ${DRILL_FOCUS_EMPTY_FILTERED_SUFFIX.purchaseOrder}` : ""}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {newPoOpen ? (
        <div className="erp-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rm-po-new-title">
          <Card className="erp-modal-shell max-h-[90vh] overflow-y-auto">
            <CardHeader className="pb-2">
              <CardTitle id="rm-po-new-title" className="text-base">
                New purchase order
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              ) : null}
              {relaxedTax ? (
                <p className="rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-950">
                  Testing mode (TESTING_MODE_RELAXED_TAX_FIELDS): missing HSN / GST / unit on masters use temporary fallbacks so you can
                  continue. Complete masters for production.
                </p>
              ) : null}
              {modalTaxWarnings.length > 0 ? (
                <ul className="list-inside list-disc rounded-md border border-sky-200 bg-sky-50/90 px-3 py-2 text-xs text-sky-950">
                  {modalTaxWarnings.map((w) => (
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
              <div className="space-y-2">
                {poLines.map((l, i) => {
                  const it = items.find((x) => x.id === l.itemId);
                  const valid = isLineValid(l);
                  const showItemErr = shouldShowErr(i, "item") && !valid.item;
                  const showQtyErr = shouldShowErr(i, "qty") && !valid.qty;
                  const showRateErr = shouldShowErr(i, "rate") && !valid.rate;

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
                    onBlur: () => setTouched(i, "qty"),
                    onFocus: (e) => (e.target as HTMLInputElement).select(),
                  });

                  return (
                    <div key={`new-${i}`} className="rounded-md border border-slate-200 bg-white p-2">
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_130px] sm:items-start">
                        <label className="grid min-w-0 gap-1 text-xs font-medium text-slate-600">
                          Item
                          <select
                            ref={(el) => {
                              poItemSelectRefs.current[i] = el;
                            }}
                            className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm"
                            value={l.itemId}
                            onBlur={() => setTouched(i, "item")}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" || e.ctrlKey || e.altKey || e.metaKey) return;
                              e.preventDefault();
                              poQtyInputRefs.current[i]?.focus();
                            }}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              const it2 = items.find((x) => x.id === v);
                              const d = deriveRmLineDisplayFromItem(it2, relaxedTax);
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
                            {items.map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {opt.itemName}
                              </option>
                            ))}
                          </select>
                          {showItemErr ? <div className="text-[11px] font-normal text-red-700">Required</div> : null}
                        </label>

                        <label className="grid gap-1 text-xs font-medium text-slate-600">
                          Qty
                          <FieldShortcutHint
                            show={i === 0 && shortcutHints.activeFieldId === "poLineQty"}
                            hint={shortcutHints.activeFieldHintText ?? ""}
                            placement="below-end"
                          >
                            <Input
                              ref={(el) => {
                                poQtyInputRefs.current[i] = el;
                              }}
                              type="number"
                              className="h-9"
                              value={Number.isFinite(l.qty) ? String(l.qty) : ""}
                              min={0}
                              step="any"
                              onKeyDown={(e) => {
                                if (e.key !== "Enter" || e.ctrlKey || e.altKey || e.metaKey) return;
                                e.preventDefault();
                                poRateInputRefs.current[i]?.focus();
                              }}
                              {...poQtyBind}
                            />
                          </FieldShortcutHint>
                          <div className="text-[11px] font-normal text-slate-500">Enter received / ordered quantity</div>
                          {showQtyErr ? <div className="text-[11px] font-normal text-red-700">Must be &gt; 0</div> : null}
                        </label>

                        <label className="grid gap-1 text-xs font-medium text-slate-600">
                          Rate
                          <Input
                            ref={(el) => {
                              poRateInputRefs.current[i] = el;
                            }}
                            type="number"
                            className="h-9"
                            value={Number.isFinite(l.rate) ? String(l.rate) : ""}
                            min={0}
                            step="any"
                            onBlur={() => setTouched(i, "rate")}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" || e.ctrlKey || e.altKey || e.metaKey) return;
                              e.preventDefault();
                              addLineFrom(i);
                            }}
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
                          <div className="text-[11px] font-normal text-slate-500">Rate per unit</div>
                          {showRateErr ? <div className="text-[11px] font-normal text-red-700">Must be &gt; 0</div> : null}
                        </label>
                      </div>

                      {l.itemId ? (
                        <div className="mt-1 text-xs text-slate-600">
                          <span className="font-medium text-slate-700">{it?.itemName ?? "—"}</span>{" "}
                          <span className="text-slate-400">|</span> Unit: <span className="tabular-nums">{l.unit || "—"}</span>{" "}
                          <span className="text-slate-400">|</span> HSN: <span className="font-mono">{l.hsn || "—"}</span>{" "}
                          <span className="text-slate-400">|</span> GST: <span className="tabular-nums">{l.gstRate == null ? "—" : `${l.gstRate}%`}</span>{" "}
                          <span className="text-slate-400">|</span> Amount:{" "}
                          <span className="tabular-nums">{Number.isFinite(l.amount) ? l.amount.toFixed(2) : "—"}</span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const i = Math.max(0, poLines.length - 1);
                    addLineFrom(i);
                  }}
                >
                  Add line
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setNewPoOpen(false);
                    setError(null);
                  }}
                  disabled={creatingPo}
                >
                  Cancel
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
                      void onCreatePo();
                    }}
                    disabled={saveDisabled}
                    onFocus={savePoFocusBind.onFocus}
                    onBlur={savePoFocusBind.onBlur}
                  >
                    {creatingPo ? "Saving…" : "Save & open"}
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
