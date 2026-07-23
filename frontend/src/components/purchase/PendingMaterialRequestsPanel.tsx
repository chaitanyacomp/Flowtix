/**
 * Purchase dept — pending consolidated RM requirements from Store.
 */

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, X } from "lucide-react";
import { apiFetch, ApiRequestError } from "../../services/api";
import { Button } from "../ui/button";
import { ErpModal } from "../erp/ErpModal";
import { Input } from "../ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { useToast } from "../../contexts/ToastContext";
import { PROCUREMENT_TERMS } from "../../lib/procurementTerminology";
import {
  resolvePendingPrPoPrepUi,
  hasRmPoModalUnsavedEntry,
  RM_PO_MODAL_DISCARD_CONFIRM,
  RM_PO_MODAL_HEADER_FIELD_CLASS,
  RM_PO_MODAL_HEADER_GRID_CLASS,
  RM_PO_MODAL_QTY_INPUT_CLASS,
  RM_PO_MODAL_RATE_INPUT_CLASS,
  RM_PO_MODAL_LINE_INPUT_ROW_CLASS,
  RM_PO_MODAL_LINE_INPUT_HINT_CLASS,
  type RmPoModalEntryBaseline,
} from "../../lib/pendingMaterialRequestsPanelUx";
import { DecimalInput } from "../ui/DecimalInput";
import { useBulkSelection } from "../../hooks/useBulkSelection";
import {
  flattenOrderablePurchaseRequestLines,
  formatPurchaseRequestPoError,
  formatRmPoExcessConfirmationLine,
  purchaseRequestPoExcessToStock,
  buildRmPoCreatePayloadLines,
  previewConsolidatedRmPoLines,
  requirementSourceBadgeLabel,
  type PendingPurchaseRequest,
} from "../../lib/purchaseRequestPoSync";
import { RmPoCommercialPreview } from "./RmPoCommercialSummary";
import type { SupplierLocationOption } from "../../pages/rmPurchase/rmPurchaseShared";

type Supplier = { id: number; name: string };
type SupplierDetail = Supplier & {
  locations?: SupplierLocationOption[];
  gstin?: string | null;
  stateCode?: string | null;
  stateName?: string | null;
};

function gstStateFromGstin(gstin: string | null | undefined): string | null {
  const g = (gstin ?? "").trim().toUpperCase();
  if (g.length >= 2 && /^\d{2}/.test(g)) return g.slice(0, 2);
  return null;
}

function derivePreviewGstMode(companyStateCode: string | null, loc?: SupplierLocationOption | null): string {
  const source = (loc?.stateCode ?? "").trim() || gstStateFromGstin(loc?.gstin ?? null) || "";
  if (!companyStateCode || !source) return "UNKNOWN";
  return companyStateCode === source ? "LOCAL" : "INTERSTATE";
}

function fmtQty(n: number, unit?: string) {
  const u = unit?.trim() ? ` ${unit}` : "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;
}

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "INR", maximumFractionDigits: 2 });
}

function sourceBadgeClass(label: string): string {
  if (label === "Replenishment") return "bg-emerald-50 text-emerald-900 ring-emerald-200";
  if (label === "Monthly Plan") return "bg-violet-50 text-violet-900 ring-violet-200";
  if (label === "Sales Orders") return "bg-sky-50 text-sky-900 ring-sky-200";
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

type Props = {
  /** Strip outer card chrome when nested inside Purchase Action Center accordion. */
  embedded?: boolean;
  /** Purchase/Admin — select PR lines and create RM PO. Store sees read-only rows. */
  canPrepareRmPo?: boolean;
};

export function PendingMaterialRequestsPanel({ embedded = false, canPrepareRmPo = false }: Props) {
  const poPrepUi = resolvePendingPrPoPrepUi(canPrepareRmPo);
  const navigate = useNavigate();
  const { showSuccess, showError, showInfo } = useToast();
  const [requests, setRequests] = React.useState<PendingPurchaseRequest[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [poOpen, setPoOpen] = React.useState(false);
  const [modalLines, setModalLines] = React.useState<ReturnType<typeof flattenOrderablePurchaseRequestLines>>([]);
  const [modalIncludedIds, setModalIncludedIds] = React.useState<Set<number>>(() => new Set());
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = React.useState(0);
  const [supplierLocationId, setSupplierLocationId] = React.useState<number | null>(null);
  const [supplierDetail, setSupplierDetail] = React.useState<SupplierDetail | null>(null);
  const [companyStateCode, setCompanyStateCode] = React.useState<string | null>(null);
  const [rates, setRates] = React.useState<Record<number, string>>({});
  const [poQty, setPoQty] = React.useState<Record<number, string>>({});
  const [supplierPoNumber, setSupplierPoNumber] = React.useState("");
  const [supplierPoNumberError, setSupplierPoNumberError] = React.useState<string | null>(null);
  const supplierPoNumberRef = React.useRef<HTMLInputElement | null>(null);
  const [poRemarks, setPoRemarks] = React.useState("");
  const [poModalBaseline, setPoModalBaseline] = React.useState<RmPoModalEntryBaseline | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async (): Promise<PendingPurchaseRequest[]> => {
    setLoading(true);
    try {
      const rows = await apiFetch<PendingPurchaseRequest[]>("/api/purchase/purchase-requests/pending");
      setRequests(rows);
      return rows;
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to load pending requests");
      return [];
    } finally {
      setLoading(false);
    }
  }, [showError]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!poOpen || !supplierId) {
      setSupplierDetail(null);
      setSupplierLocationId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const detail = await apiFetch<SupplierDetail>(`/api/suppliers/${supplierId}`);
        if (cancelled) return;
        setSupplierDetail(detail);
        const active = (detail.locations ?? []).filter((l) => l.isActive !== false);
        const def = active.find((l) => l.isDefault) ?? active[0] ?? null;
        setSupplierLocationId(def?.id ?? null);
      } catch {
        if (!cancelled) {
          setSupplierDetail(null);
          setSupplierLocationId(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [poOpen, supplierId]);

  React.useEffect(() => {
    if (!poOpen) return;
    let cancelled = false;
    void apiFetch<{ companyStateCode?: string | null }>("/api/company-profile")
      .then((p) => {
        if (!cancelled) setCompanyStateCode(p.companyStateCode?.trim() || null);
      })
      .catch(() => {
        if (!cancelled) setCompanyStateCode(null);
      });
    return () => {
      cancelled = true;
    };
  }, [poOpen]);

  const activeSupplierLocations = React.useMemo(
    () => (supplierDetail?.locations ?? []).filter((l) => l.isActive !== false),
    [supplierDetail],
  );

  const selectedSupplyLocation = React.useMemo(
    () => activeSupplierLocations.find((l) => l.id === supplierLocationId) ?? null,
    [activeSupplierLocations, supplierLocationId],
  );

  const previewGstMode = React.useMemo(
    () => derivePreviewGstMode(companyStateCode, selectedSupplyLocation),
    [companyStateCode, selectedSupplyLocation],
  );

  const orderableLines = React.useMemo(() => flattenOrderablePurchaseRequestLines(requests), [requests]);
  const orderableLineIds = React.useMemo(() => orderableLines.map((ln) => ln.id), [orderableLines]);
  const bulk = useBulkSelection(orderableLineIds);
  const selectedLines = orderableLines.filter((ln) => bulk.selectedIds.has(ln.id));

  const activeModalLines = React.useMemo(
    () => modalLines.filter((ln) => modalIncludedIds.has(ln.id)),
    [modalLines, modalIncludedIds],
  );

  const consolidationPreview = React.useMemo(
    () => previewConsolidatedRmPoLines(activeModalLines, poQty, rates),
    [activeModalLines, poQty, rates],
  );

  const canSubmitPo =
    consolidationPreview.allocationsSelected > 0 &&
    consolidationPreview.consolidated.length > 0 &&
    Boolean(supplierId) &&
    !creating;

  const [expandedConsolidatedKeys, setExpandedConsolidatedKeys] = React.useState<Set<string>>(() => new Set());
  const [confirmExcessOpen, setConfirmExcessOpen] = React.useState(false);

  const excessConfirmationText = React.useMemo(
    () => consolidationPreview.confirmationLines.join("\n"),
    [consolidationPreview.confirmationLines],
  );

  const hasAnyExcessToStock = consolidationPreview.consolidated.some((c) => c.excessToStockQty > 1e-9);

  const currentPoModalEntry = React.useMemo<RmPoModalEntryBaseline>(
    () => ({
      supplierPoNumber,
      poRemarks,
      supplierId,
      poQty,
      rates,
    }),
    [supplierPoNumber, poRemarks, supplierId, poQty, rates],
  );

  const closePoModal = React.useCallback(() => {
    setPoOpen(false);
    setModalLines([]);
    setModalIncludedIds(new Set());
    setSupplierPoNumberError(null);
    setPoModalBaseline(null);
  }, []);

  const requestClosePoModal = React.useCallback(() => {
    if (creating) return;
    if (hasRmPoModalUnsavedEntry(poModalBaseline, currentPoModalEntry)) {
      if (!window.confirm(RM_PO_MODAL_DISCARD_CONFIRM)) return;
    }
    closePoModal();
  }, [creating, poModalBaseline, currentPoModalEntry, closePoModal]);

  const resolveLinesForIds = React.useCallback((rows: PendingPurchaseRequest[], ids: Set<number>) => {
    const orderable = flattenOrderablePurchaseRequestLines(rows);
    return orderable.filter((ln) => ids.has(ln.id));
  }, []);

  const syncRateForItem = React.useCallback((_rmItemId: number, rateValue: string, lineIds: number[]) => {
    setRates((prev) => {
      const next = { ...prev };
      for (const id of lineIds) next[id] = rateValue;
      return next;
    });
  }, []);

  const openPoModal = async () => {
    if (!canPrepareRmPo || !selectedLines.length || creating) return;
    const fresh = await load();
    const valid = resolveLinesForIds(fresh, bulk.selectedIds);
    if (!valid.length) {
      bulk.clear();
      showError("Selected lines are no longer open for RM PO. Refresh the list — a PO may already exist.");
      return;
    }
    if (valid.length < selectedLines.length) {
      showInfo("Some selected lines were removed — they are no longer open for ordering.");
      bulk.clear();
      for (const ln of valid) bulk.toggleOne(ln.id, true);
    }
    try {
      const sup = await apiFetch<Supplier[]>("/api/suppliers");
      setSuppliers(sup);
      const nextQty: Record<number, string> = {};
      const nextRates: Record<number, string> = {};
      for (const ln of valid) {
        nextQty[ln.id] = String(ln.pendingQty);
        nextRates[ln.id] = rates[ln.id] ?? "";
      }
      // Align rates for same RM so consolidation can succeed when user fills one rate cell.
      const byItem = new Map<number, number[]>();
      for (const ln of valid) {
        const ids = byItem.get(ln.rmItemId) || [];
        ids.push(ln.id);
        byItem.set(ln.rmItemId, ids);
      }
      for (const ids of byItem.values()) {
        const shared = ids.map((id) => nextRates[id]).find((r) => r.trim() !== "") ?? "";
        if (shared) for (const id of ids) nextRates[id] = shared;
      }
      setModalLines(valid);
      setModalIncludedIds(new Set(valid.map((ln) => ln.id)));
      setPoQty(nextQty);
      setRates(nextRates);
      const nextSupplierId = sup[0]?.id ?? 0;
      setSupplierId(nextSupplierId);
      setSupplierPoNumber("");
      setSupplierPoNumberError(null);
      setPoRemarks("");
      setPoModalBaseline({
        supplierPoNumber: "",
        poRemarks: "",
        supplierId: nextSupplierId,
        poQty: nextQty,
        rates: nextRates,
      });
      setPoOpen(true);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not load suppliers");
    }
  };

  const submitPo = async (opts?: { confirmExcess?: boolean }) => {
    if (!canPrepareRmPo || creating || !canSubmitPo) return;
    if (!supplierId) {
      showError("Select a supplier");
      return;
    }
    const supplierPoNumberTrim = supplierPoNumber.trim();
    if (!supplierPoNumberTrim) {
      setSupplierPoNumberError("Supplier PO Number is required.");
      supplierPoNumberRef.current?.focus();
      return;
    }
    if (hasAnyExcessToStock && !opts?.confirmExcess) {
      setConfirmExcessOpen(true);
      return;
    }
    setConfirmExcessOpen(false);
    setSupplierPoNumberError(null);
    setCreating(true);
    try {
      const fresh = await apiFetch<PendingPurchaseRequest[]>("/api/purchase/purchase-requests/pending");
      setRequests(fresh);
      const valid = resolveLinesForIds(fresh, modalIncludedIds);
      if (!valid.length) {
        setPoOpen(false);
        bulk.clear();
        setModalLines([]);
        setModalIncludedIds(new Set());
        setPoModalBaseline(null);
        showError("These purchase request lines are no longer open for RM PO. Refresh the list — PO may already exist.");
        return;
      }

      const lines = buildRmPoCreatePayloadLines(valid, poQty, rates);
      if (!lines.length) {
        showError("Select at least one line with order quantity greater than zero.");
        return;
      }

      const po = await apiFetch<{ id: number; taxWarnings?: string[] }>("/api/purchase/purchase-requests/create-po", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          supplierLocationId: supplierLocationId ?? undefined,
          supplierPoNumber: supplierPoNumberTrim,
          remarks: poRemarks.trim() || null,
          lines,
        }),
      });

      if (po.taxWarnings?.length) showInfo(po.taxWarnings.join(" "));
      showSuccess(`RM PO RMPO-${po.id} created`);
      setPoOpen(false);
      bulk.clear();
      setModalLines([]);
      setModalIncludedIds(new Set());
      setPoModalBaseline(null);
      await load();
      navigate(`/rm-po-grn/${po.id}`);
    } catch (e) {
      const msg = e instanceof ApiRequestError ? formatPurchaseRequestPoError(e) : formatPurchaseRequestPoError(e);
      showError(msg);
      await load();
      if (
        e instanceof ApiRequestError &&
        (e.code === "PR_ALREADY_ORDERED" ||
          e.code === "PR_LINE_ALREADY_ORDERED" ||
          e.code === "PR_NOT_OPEN_FOR_ORDERING" ||
          e.code === "PR_CANCELLED")
      ) {
        setPoOpen(false);
        bulk.clear();
        setModalLines([]);
        setModalIncludedIds(new Set());
        setPoModalBaseline(null);
      }
    } finally {
      setCreating(false);
    }
  };

  const empty = !loading && !orderableLines.length;

  const tableBody = loading ? (
    <p className="py-3 text-sm text-slate-500">Loading requests…</p>
  ) : empty ? (
    <p className="py-2 text-xs text-slate-500">No purchase request lines ready for RM PO.</p>
  ) : (
    <div className="min-w-0 overflow-x-auto">
      <table className="erp-table erp-table-dense w-full min-w-[48rem] text-[12px] [&_td]:py-1.5 [&_th]:py-1.5">
        <thead>
          <tr>
            {poPrepUi.showCheckboxes ? (
              <th className="w-10 px-2 text-left">
                <input
                  ref={bulk.selectAllRef}
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={bulk.allSelected}
                  disabled={!orderableLineIds.length || creating}
                  onChange={(e) => bulk.toggleSelectAll(e.target.checked)}
                  title="Select all pending request lines"
                  aria-label="Select all pending request lines"
                />
              </th>
            ) : null}
            <th className="text-left">RM item</th>
            <th className="text-left">Requirement source</th>
            <th className="text-left">Reference / cycle</th>
            <th className="text-left">PR number</th>
            <th className="text-right">Required qty</th>
            <th className="text-right">Already ordered</th>
            <th className="text-right">Still to order</th>
          </tr>
        </thead>
        <tbody>
          {orderableLines.map((ln) => {
            const badge = requirementSourceBadgeLabel(ln);
            return (
              <tr key={ln.id}>
                {poPrepUi.showCheckboxes ? (
                  <td className="w-10 px-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={bulk.selectedIds.has(ln.id)}
                      disabled={creating}
                      onChange={(e) => bulk.toggleOne(ln.id, e.target.checked)}
                      aria-label={`Select ${ln.itemName} for RM PO`}
                    />
                  </td>
                ) : null}
                <td className="font-medium text-slate-900">{ln.itemName}</td>
                <td>
                  <span
                    className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${sourceBadgeClass(badge)}`}
                  >
                    {badge}
                  </span>
                </td>
                <td className="max-w-[10rem] truncate text-[11px] text-slate-700" title={ln.referenceLabel ?? ""}>
                  {ln.referenceLabel || "—"}
                </td>
                <td className="font-medium text-slate-800">
                  {ln.requestDocNo}
                  {ln.requestStatus === "PARTIALLY_ORDERED" ? (
                    <span className="ml-1 text-[10px] font-semibold text-violet-800">Partial</span>
                  ) : null}
                </td>
                <td className="text-right tabular-nums">{fmtQty(ln.netRequiredQty, ln.unit)}</td>
                <td className="text-right tabular-nums text-slate-600">{fmtQty(ln.orderedQty, ln.unit)}</td>
                <td className="text-right tabular-nums font-semibold text-amber-950">
                  {ln.pendingQty > 1e-9 ? fmtQty(ln.pendingQty, ln.unit) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const readOnlyBanner =
    poPrepUi.readOnlyMessage && !empty && !loading ? (
      <p className="border-t border-slate-100 py-2 text-[11px] font-medium text-slate-600" data-testid="pr-po-readonly-hint">
        {poPrepUi.readOnlyMessage}
      </p>
    ) : null;

  const footer = poPrepUi.showPrepareButton ? (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!orderableLineIds.length || creating || bulk.allSelected}
          onClick={() => bulk.toggleSelectAll(true)}
        >
          Select all
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!selectedLines.length || creating}
          onClick={() => bulk.clear()}
        >
          Clear all
        </Button>
        {selectedLines.length > 0 ? (
          <span className="text-[11px] text-slate-600">{selectedLines.length} line(s) selected</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading || creating}>
          Refresh
        </Button>
        <Button type="button" size="sm" disabled={!selectedLines.length || creating} onClick={() => void openPoModal()}>
          {PROCUREMENT_TERMS.PREPARE_RM_PO}
        </Button>
      </div>
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 py-2">
      <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading || creating}>
        Refresh
      </Button>
    </div>
  );

  return (
    <>
      {embedded ? (
        <div className="min-w-0">
          {tableBody}
          {!empty && !loading ? readOnlyBanner : null}
          {!empty && !loading ? footer : null}
        </div>
      ) : (
        <Card id="rm-po-pending-requests" className="border-amber-200/80 bg-amber-50/30 shadow-sm">
          <CardHeader className="border-b border-amber-100/80 px-4 py-2.5">
            <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
              <ClipboardList className="h-5 w-5 text-amber-800" />
              Pending Material Requests
            </CardTitle>
            <p className="text-xs font-normal text-slate-600">
              {canPrepareRmPo
                ? "Select one or more PR lines (same or different sources), then create a combined or separate RM PO."
                : poPrepUi.readOnlyMessage}
            </p>
          </CardHeader>
          <CardContent className="px-3 py-0">
            {tableBody}
            {!empty && !loading ? readOnlyBanner : null}
            {!empty && !loading ? footer : null}
          </CardContent>
        </Card>
      )}

      {canPrepareRmPo && poOpen ? (
        <ErpModal
          onClose={requestClosePoModal}
          escapeDisabled={() => creating}
          backdropClassName="bg-black/40"
          aria-labelledby="rm-po-create-modal-title"
        >
          <div
            className="flex max-h-[90vh] w-full max-w-[72rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
            data-testid="rm-po-create-modal"
          >
            <div className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
              <div className="min-w-0">
                <h2 id="rm-po-create-modal-title" className="text-lg font-semibold text-slate-900">
                  Create RM Purchase Order
                </h2>
                <p className="mt-1 text-sm text-slate-600" data-testid="rm-po-create-summary">
                  {consolidationPreview.allocationsSelected} allocations selected ·{" "}
                  {consolidationPreview.consolidated.length} consolidated PO items · Total{" "}
                  {fmtMoney(consolidationPreview.totalAmount)}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 p-0"
                disabled={creating}
                onClick={requestClosePoModal}
                aria-label="Close create RM purchase order"
                data-testid="rm-po-create-modal-close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5">
              <div className="shrink-0 space-y-2.5 border-b border-slate-100 py-3" data-testid="rm-po-create-header-fields">
                <div className={RM_PO_MODAL_HEADER_GRID_CLASS} data-testid="rm-po-supplier-row">
                  <label className="block min-w-0 text-sm font-medium text-slate-700">
                    Supplier
                    <select
                      className={`${RM_PO_MODAL_HEADER_FIELD_CLASS} mt-1`}
                      value={supplierId}
                      disabled={creating}
                      data-testid="rm-po-supplier-select"
                      onChange={(e) => setSupplierId(Number(e.target.value))}
                    >
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block min-w-0 text-sm font-medium text-slate-700">
                    Supplier PO Number <span className="text-red-600">*</span>
                    <Input
                      ref={supplierPoNumberRef}
                      type="text"
                      autoComplete="off"
                      data-testid="rm-po-supplier-po-number"
                      className={`${RM_PO_MODAL_HEADER_FIELD_CLASS} mt-1 ${supplierPoNumberError ? "border-red-500 focus-visible:ring-red-400" : ""}`}
                      value={supplierPoNumber}
                      disabled={creating}
                      maxLength={100}
                      placeholder="e.g. PO/26-001"
                      aria-invalid={Boolean(supplierPoNumberError)}
                      onChange={(e) => {
                        setSupplierPoNumber(e.target.value.slice(0, 100));
                        if (supplierPoNumberError) setSupplierPoNumberError(null);
                      }}
                      onBlur={(e) => setSupplierPoNumber(e.target.value.trim())}
                    />
                    {supplierPoNumberError ? (
                      <span className="mt-1 block text-xs font-medium text-red-700">{supplierPoNumberError}</span>
                    ) : null}
                  </label>
                </div>

                {activeSupplierLocations.length > 0 ? (
                  <label className="block text-sm font-medium text-slate-700" data-testid="rm-po-supply-location-row">
                    Supply location
                    <select
                      className={`${RM_PO_MODAL_HEADER_FIELD_CLASS} mt-1`}
                      value={supplierLocationId ?? ""}
                      disabled={creating}
                      onChange={(e) => setSupplierLocationId(Number(e.target.value) || null)}
                    >
                      {activeSupplierLocations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.label}
                          {loc.isDefault ? " (default)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2" data-testid="rm-po-remarks-commercial-row">
                  <label className="block min-w-0 text-sm font-medium text-slate-700">
                    PO remarks <span className="font-normal text-slate-500">(optional)</span>
                    <Input
                      type="text"
                      data-testid="rm-po-remarks"
                      className={`${RM_PO_MODAL_HEADER_FIELD_CLASS} mt-1`}
                      value={poRemarks}
                      disabled={creating}
                      placeholder="Short note"
                      onChange={(e) => setPoRemarks(e.target.value)}
                    />
                  </label>
                  <div className="min-w-0 md:pt-6">
                    {activeSupplierLocations.length > 0 && selectedSupplyLocation ? (
                      <RmPoCommercialPreview
                        compact
                        label={selectedSupplyLocation.label}
                        gstin={selectedSupplyLocation.gstin}
                        stateCode={selectedSupplyLocation.stateCode}
                        stateName={selectedSupplyLocation.stateName}
                        gstMode={previewGstMode}
                      />
                    ) : supplierDetail ? (
                      <RmPoCommercialPreview
                        compact
                        label="Registered Office"
                        gstin={supplierDetail.gstin}
                        stateCode={supplierDetail.stateCode}
                        stateName={supplierDetail.stateName}
                        gstMode={derivePreviewGstMode(companyStateCode, {
                          id: 0,
                          label: "Registered Office",
                          stateCode: supplierDetail.stateCode,
                          stateName: supplierDetail.stateName,
                          gstin: supplierDetail.gstin,
                        })}
                      />
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto py-3" data-testid="rm-po-create-lines-scroll">
                <table className="erp-table erp-table-dense w-full table-fixed text-[12px] [&_td]:py-1.5 [&_th]:py-1.5">
                  <colgroup>
                    <col className="w-8" />
                    <col className="w-[18%]" />
                    <col className="w-[11%]" />
                    <col className="w-[12%]" />
                    <col className="w-[10%]" />
                    <col className="w-[10%]" />
                    <col className="w-[9%]" />
                    <col className="w-[9%]" />
                    <col className="w-[12%]" />
                    <col className="w-[11%]" />
                  </colgroup>
                  <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-1 text-left">Sel</th>
                      <th className="px-2 text-left">RM item</th>
                      <th className="px-2 text-left">Source</th>
                      <th className="px-2 text-left">Ref</th>
                      <th className="px-2 text-left">PR</th>
                      <th className="px-2 text-right">Required</th>
                      <th className="px-2 text-right">Ordered</th>
                      <th className="px-2 text-right">Still</th>
                      <th className="px-2 text-right">Order qty</th>
                      <th className="px-2 text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalLines.map((ln) => {
                      const included = modalIncludedIds.has(ln.id);
                      const orderQty = included ? Number(poQty[ln.id]) : 0;
                      const excess = purchaseRequestPoExcessToStock(ln, orderQty);
                      const badge = requirementSourceBadgeLabel(ln);
                      const siblingIds = modalLines.filter((x) => x.rmItemId === ln.rmItemId).map((x) => x.id);
                      return (
                        <tr
                          key={ln.id}
                          className={`border-t border-slate-100 align-middle ${included ? "" : "opacity-50"}`}
                        >
                          <td className="px-1">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300"
                              checked={included}
                              disabled={creating}
                              onChange={(e) => {
                                setModalIncludedIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(ln.id);
                                  else next.delete(ln.id);
                                  return next;
                                });
                                if (!e.target.checked) {
                                  setPoQty((p) => ({ ...p, [ln.id]: "0" }));
                                } else if (!(Number(poQty[ln.id]) > 0)) {
                                  setPoQty((p) => ({ ...p, [ln.id]: String(ln.pendingQty) }));
                                }
                              }}
                              aria-label={`Include ${ln.itemName} from ${ln.requestDocNo}`}
                            />
                          </td>
                          <td className="truncate px-2 font-medium text-slate-900" title={ln.itemName}>
                            {ln.itemName}
                          </td>
                          <td className="px-2">
                            <span
                              className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${sourceBadgeClass(badge)}`}
                            >
                              {badge}
                            </span>
                          </td>
                          <td className="truncate px-2 text-[11px] text-slate-600" title={ln.referenceLabel ?? ""}>
                            {ln.referenceLabel || "—"}
                          </td>
                          <td className="truncate px-2 text-slate-700">{ln.requestDocNo}</td>
                          <td className="px-2 text-right tabular-nums text-slate-800">
                            {fmtQty(ln.netRequiredQty, ln.unit)}
                          </td>
                          <td className="px-2 text-right tabular-nums text-slate-600">{fmtQty(ln.orderedQty, ln.unit)}</td>
                          <td className="px-2 text-right tabular-nums font-medium text-amber-950">
                            {ln.pendingQty > 1e-9 ? fmtQty(ln.pendingQty, ln.unit) : "—"}
                          </td>
                          <td className="px-2 align-top text-right" data-testid={`rm-po-order-qty-cell-${ln.id}`}>
                            <div className={RM_PO_MODAL_LINE_INPUT_ROW_CLASS}>
                              <DecimalInput
                                data-testid={`rm-po-order-qty-${ln.id}`}
                                className={RM_PO_MODAL_QTY_INPUT_CLASS}
                                wrapperClassName="w-full max-w-[7.5rem]"
                                unit={ln.unit}
                                disabled={creating || !included}
                                value={poQty[ln.id] ?? ""}
                                onValueChange={(next) => setPoQty((p) => ({ ...p, [ln.id]: next }))}
                                aria-label={`Order qty for ${ln.itemName}`}
                              />
                            </div>
                            <span
                              className={`${RM_PO_MODAL_LINE_INPUT_HINT_CLASS} ${
                                excess > 1e-9 ? "text-emerald-800" : "invisible"
                              }`}
                              data-testid={`rm-po-excess-${ln.id}`}
                            >
                              {excess > 1e-9 ? `+${fmtQty(excess, ln.unit)} stock` : "\u00a0"}
                            </span>
                          </td>
                          <td className="px-2 align-top text-right" data-testid={`rm-po-rate-cell-${ln.id}`}>
                            <div className={RM_PO_MODAL_LINE_INPUT_ROW_CLASS}>
                              <DecimalInput
                                data-testid={`rm-po-rate-${ln.id}`}
                                className={RM_PO_MODAL_RATE_INPUT_CLASS}
                                wrapperClassName="w-full max-w-[7.5rem]"
                                disabled={creating || !included}
                                value={rates[ln.id] ?? ""}
                                onValueChange={(next) => syncRateForItem(ln.rmItemId, next, siblingIds)}
                                aria-label={`Rate for ${ln.itemName}`}
                              />
                            </div>
                            <span className={`${RM_PO_MODAL_LINE_INPUT_HINT_CLASS} invisible`} aria-hidden>
                              {"\u00a0"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="sticky bottom-0 z-10 flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white px-5 py-3">
              {consolidationPreview.consolidated.length > 0 ? (
                <div className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2" data-testid="rm-po-consolidation-preview">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Consolidated PO preview</p>
                  <ul className="mt-1.5 space-y-1.5">
                    {consolidationPreview.consolidated.map((c) => {
                      const key = `${c.rmItemId}:${c.rate}`;
                      const open = expandedConsolidatedKeys.has(key);
                      return (
                        <li key={key} className="text-[12px] text-slate-800">
                          <button
                            type="button"
                            className="flex w-full items-start justify-between gap-2 text-left"
                            onClick={() =>
                              setExpandedConsolidatedKeys((prev) => {
                                const next = new Set(prev);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              })
                            }
                            data-testid={`rm-po-consolidated-toggle-${c.rmItemId}`}
                          >
                            <span className="font-medium">
                              {c.itemName}: {fmtQty(c.orderQty, c.unit)}
                              {c.allocationCount > 1 ? ` · ${c.allocationCount} SO/PR sources` : ""}
                              {c.excessToStockQty > 1e-9
                                ? ` · Extra stock ${fmtQty(c.excessToStockQty, c.unit)}`
                                : ""}
                            </span>
                            <span className="shrink-0 text-[10px] font-semibold text-slate-500">
                              {open ? "Hide" : "SO breakdown"}
                            </span>
                          </button>
                          {open ? (
                            <ul className="mt-1 space-y-0.5 border-l border-slate-200 pl-3 text-[11px] text-slate-600">
                              {c.soBreakdown.map((row, idx) => (
                                <li key={`${row.prDocNo}-${idx}`}>
                                  {(row.salesOrderDocNo || row.referenceLabel || row.prDocNo) +
                                    `: ${fmtQty(row.demandQty, c.unit)}`}
                                </li>
                              ))}
                              {c.excessToStockQty > 1e-9 ? (
                                <li className="font-medium text-emerald-800">
                                  Extra to RM Stock: {fmtQty(c.excessToStockQty, c.unit)}
                                </li>
                              ) : null}
                            </ul>
                          ) : null}
                          <p className="mt-0.5 text-[10px] text-slate-500" data-testid={`rm-po-confirm-line-${c.rmItemId}`}>
                            {formatRmPoExcessConfirmationLine(c)}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500">
                  Same RM from multiple Regular SO PRs consolidates to one PO line; SO allocations stay separate.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={requestClosePoModal}
                    disabled={creating}
                    data-testid="rm-po-create-modal-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={!canSubmitPo}
                    onClick={() => void submitPo()}
                    data-testid="rm-po-create-modal-submit"
                  >
                    {creating ? "Creating…" : "Create RM PO"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </ErpModal>
      ) : null}

      {confirmExcessOpen ? (
        <ErpModal
          onClose={() => setConfirmExcessOpen(false)}
          escapeDisabled={() => creating}
          backdropClassName="bg-black/40"
          aria-labelledby="rm-po-excess-confirm-title"
        >
          <div className="mx-auto w-full max-w-lg rounded-lg bg-white p-5 shadow-xl ring-1 ring-slate-200" data-testid="rm-po-excess-confirm">
            <h2 id="rm-po-excess-confirm-title" className="text-[16px] font-bold text-slate-900">
              Confirm extra quantity to RM stock
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
              PO quantity is above selected Regular SO demand. Extra received stock will be unrestricted RM stock — not
              additional SO demand.
            </p>
            <pre className="mt-3 whitespace-pre-wrap rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[12px] font-medium text-emerald-950">
              {excessConfirmationText}
            </pre>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmExcessOpen(false)}>
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid="rm-po-excess-confirm-submit"
                onClick={() => {
                  setConfirmExcessOpen(false);
                  void submitPo({ confirmExcess: true });
                }}
              >
                Confirm and create PO
              </Button>
            </div>
          </div>
        </ErpModal>
      ) : null}
    </>
  );
}
