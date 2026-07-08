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
import { resolvePendingPrPoPrepUi, hasRmPoModalUnsavedEntry, RM_PO_MODAL_DISCARD_CONFIRM, type RmPoModalEntryBaseline } from "../../lib/pendingMaterialRequestsPanelUx";

import { useBulkSelection } from "../../hooks/useBulkSelection";

import {

  flattenOrderablePurchaseRequestLines,

  formatPurchaseRequestPoError,

  purchaseRequestPoExcessToStock,

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
  const source =
    (loc?.stateCode ?? "").trim() || gstStateFromGstin(loc?.gstin ?? null) || "";
  if (!companyStateCode || !source) return "UNKNOWN";
  return companyStateCode === source ? "LOCAL" : "INTERSTATE";
}



function fmtQty(n: number, unit?: string) {

  const u = unit?.trim() ? ` ${unit}` : "";

  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;

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



  const resolveLinesForIds = React.useCallback(

    (rows: PendingPurchaseRequest[], ids: Set<number>) => {

      const orderable = flattenOrderablePurchaseRequestLines(rows);

      return orderable.filter((ln) => ids.has(ln.id));

    },

    [],

  );



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

      setModalLines(valid);

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



  const submitPo = async () => {

    if (!canPrepareRmPo || creating) return;

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
    setSupplierPoNumberError(null);



    setCreating(true);

    try {

      const fresh = await apiFetch<PendingPurchaseRequest[]>("/api/purchase/purchase-requests/pending");

      setRequests(fresh);

      const valid = resolveLinesForIds(

        fresh,

        new Set(modalLines.map((ln) => ln.id)),

      );

      if (!valid.length) {

        setPoOpen(false);

        bulk.clear();

        setModalLines([]);
        setPoModalBaseline(null);

        showError("These purchase request lines are no longer open for RM PO. Refresh the list — PO may already exist.");

        return;

      }



      const lines = valid.map((ln) => {

        const qty = Number(poQty[ln.id]);

        const rate = Number(rates[ln.id]);

        if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Enter qty for ${ln.itemName}`);

        if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Enter rate for ${ln.itemName}`);

        return { purchaseRequestLineId: ln.id, qty, rate };

      });



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

      <table className="erp-table erp-table-dense w-full min-w-[40rem] text-[12px] [&_td]:py-1.5 [&_th]:py-1.5">

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

            <th className="text-left">Procurement source</th>

            <th className="text-left">Request No.</th>

            <th className="text-left">RM item</th>

            <th className="text-right">Net required</th>

            <th className="text-right">Ordered</th>

            <th className="text-right">Still to order</th>

            <th className="text-right">Excess ordered</th>

          </tr>

        </thead>

        <tbody>

          {orderableLines.map((ln) => (

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

              <td className="text-[11px] font-semibold text-violet-900">{ln.demandPoolLabel ?? "—"}</td>

              <td className="font-medium text-slate-800">

                {ln.requestDocNo}

                {ln.requestStatus === "PARTIALLY_ORDERED" ? (

                  <span className="ml-1 text-[10px] font-semibold text-violet-800">Partial PO</span>

                ) : null}

              </td>

              <td>{ln.itemName}</td>

              <td className="text-right tabular-nums">{fmtQty(ln.netRequiredQty, ln.unit)}</td>

              <td className="text-right tabular-nums text-slate-600">{fmtQty(ln.orderedQty, ln.unit)}</td>

              <td className="text-right tabular-nums font-semibold text-amber-950">
                {ln.pendingQty > 1e-9 ? fmtQty(ln.pendingQty, ln.unit) : "—"}
              </td>

              <td className="text-right tabular-nums text-emerald-900">
                {ln.excessOrderedQty > 1e-9 ? fmtQty(ln.excessOrderedQty, ln.unit) : "—"}
              </td>

            </tr>

          ))}

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
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 py-2">
      <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading || creating}>
        Refresh
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={!selectedLines.length || creating}
        onClick={() => void openPoModal()}
      >
        {PROCUREMENT_TERMS.PREPARE_RM_PO}
      </Button>
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
                ? "Select PR lines from Store, then create RM PO with supplier and rate."
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
            <div className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
              <div className="min-w-0">
                <h2 id="rm-po-create-modal-title" className="text-lg font-semibold text-slate-900">
                  Create RM Purchase Order
                </h2>
                <p className="mt-1 text-sm text-slate-600">{modalLines.length} request line(s)</p>
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
              <div className="shrink-0 space-y-3 border-b border-slate-100 py-4">
                <div className="grid gap-3 md:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  Supplier
                  <select
                    className="mt-1 w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={supplierId}
                    disabled={creating}
                    onChange={(e) => setSupplierId(Number(e.target.value))}
                  >
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  Supplier PO Number <span className="text-red-600">*</span>
                  <Input
                    ref={supplierPoNumberRef}
                    className={`mt-1 max-w-md ${supplierPoNumberError ? "border-red-500 focus-visible:ring-red-400" : ""}`}
                    value={supplierPoNumber}
                    disabled={creating}
                    maxLength={100}
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
                  <label className="block text-sm font-medium text-slate-700">
                    Supply location
                    <select
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
                    <RmPoCommercialPreview
                      label={selectedSupplyLocation?.label}
                      gstin={selectedSupplyLocation?.gstin}
                      stateCode={selectedSupplyLocation?.stateCode}
                      stateName={selectedSupplyLocation?.stateName}
                      gstMode={previewGstMode}
                    />
                  </label>
                ) : supplierDetail ? (
                  <RmPoCommercialPreview
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

                <label className="block max-w-xl text-sm text-slate-700">
                  PO remarks (optional)
                  <Input
                    className="mt-1 max-w-xl"
                    value={poRemarks}
                    disabled={creating}
                    onChange={(e) => setPoRemarks(e.target.value)}
                  />
                </label>
              </div>

              <div
                className="min-h-0 flex-1 overflow-auto py-4"
                data-testid="rm-po-create-lines-scroll"
              >
                <table className="erp-table erp-table-dense w-full min-w-[64rem] text-[12px] [&_td]:py-1.5 [&_th]:py-1.5">
                  <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-2 text-left">RM item</th>
                      <th className="px-2 text-left">PR No.</th>
                      <th className="px-2 text-right">Required qty</th>
                      <th className="px-2 text-right">Already ordered</th>
                      <th className="px-2 text-right">Still to order</th>
                      <th className="px-2 text-right">Order qty</th>
                      <th className="px-2 text-right">Rate</th>
                      <th className="px-2 text-right">Excess to stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalLines.map((ln) => {
                      const orderQty = Number(poQty[ln.id]);
                      const excess = purchaseRequestPoExcessToStock(ln, orderQty);
                      return (
                        <tr key={ln.id} className="border-t border-slate-100 align-middle">
                          <td className="max-w-[12rem] truncate px-2 font-medium text-slate-900" title={ln.itemName}>
                            {ln.itemName}
                          </td>
                          <td className="whitespace-nowrap px-2 text-slate-700">{ln.requestDocNo}</td>
                          <td className="px-2 text-right tabular-nums text-slate-800">
                            {fmtQty(ln.netRequiredQty, ln.unit)}
                          </td>
                          <td className="px-2 text-right tabular-nums text-slate-600">
                            {fmtQty(ln.orderedQty, ln.unit)}
                          </td>
                          <td className="px-2 text-right tabular-nums font-medium text-amber-950">
                            {ln.pendingQty > 1e-9 ? fmtQty(ln.pendingQty, ln.unit) : "—"}
                          </td>
                          <td className="px-2 text-right">
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              className="ml-auto h-8 w-[7.5rem] text-right tabular-nums"
                              disabled={creating}
                              value={poQty[ln.id] ?? ""}
                              onChange={(e) => setPoQty((p) => ({ ...p, [ln.id]: e.target.value }))}
                              aria-label={`Order qty for ${ln.itemName}`}
                            />
                          </td>
                          <td className="px-2 text-right">
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              className="ml-auto h-8 w-[6.5rem] text-right tabular-nums"
                              disabled={creating}
                              value={rates[ln.id] ?? ""}
                              onChange={(e) => setRates((p) => ({ ...p, [ln.id]: e.target.value }))}
                              aria-label={`Rate for ${ln.itemName}`}
                            />
                          </td>
                          <td className="px-2 text-right tabular-nums text-emerald-900">
                            {excess > 1e-9 ? fmtQty(excess, ln.unit) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="sticky bottom-0 z-10 flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
              <Button
                type="button"
                variant="outline"
                onClick={requestClosePoModal}
                disabled={creating}
                data-testid="rm-po-create-modal-cancel"
              >
                Cancel
              </Button>
              <Button type="button" disabled={creating} onClick={() => void submitPo()} data-testid="rm-po-create-modal-submit">
                {creating ? "Creating…" : "Create RM PO"}
              </Button>
            </div>
          </div>
        </ErpModal>
      ) : null}

    </>

  );

}
