/**

 * Purchase dept — pending consolidated RM requirements from Store.

 */

import * as React from "react";

import { useNavigate } from "react-router-dom";

import { ClipboardList } from "lucide-react";

import { apiFetch, ApiRequestError } from "../../services/api";

import { Button } from "../ui/button";
import { ErpModal } from "../erp/ErpModal";

import { Input } from "../ui/input";

import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

import { useToast } from "../../contexts/ToastContext";

import { PROCUREMENT_TERMS } from "../../lib/procurementTerminology";
import { resolvePendingPrPoPrepUi } from "../../lib/pendingMaterialRequestsPanelUx";

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

  const [poRemarks, setPoRemarks] = React.useState("");

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

      setSupplierId(sup[0]?.id ?? 0);

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
          remarks: poRemarks.trim() || null,
          lines,
        }),

      });

      if (po.taxWarnings?.length) showInfo(po.taxWarnings.join(" "));

      showSuccess(`RM PO RMPO-${po.id} created`);

      setPoOpen(false);

      bulk.clear();

      setModalLines([]);

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
          onClose={() => {
            if (creating) return;
            setPoOpen(false);
            setModalLines([]);
          }}
          backdropClassName="bg-black/40"
          aria-label="Create RM purchase order"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl">

            <h2 className="text-lg font-semibold text-slate-900">Create RM Purchase Order</h2>

            <p className="mt-1 text-sm text-slate-600">{modalLines.length} request line(s)</p>



            <label className="mt-4 block text-sm font-medium text-slate-700">

              Supplier

              <select

                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"

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



            {activeSupplierLocations.length > 0 ? (
              <label className="mt-3 block text-sm font-medium text-slate-700">
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



            <label className="mt-3 block text-sm text-slate-700">

              PO remarks (optional)

              <Input

                className="mt-1"

                value={poRemarks}

                disabled={creating}

                onChange={(e) => setPoRemarks(e.target.value)}

              />

            </label>



            <div className="mt-4 space-y-3">

              {modalLines.map((ln) => (

                <div key={ln.id} className="rounded-lg border border-slate-200 p-3">

                  <div className="text-sm font-medium">{ln.itemName}</div>

                  <div className="text-xs text-slate-500">{ln.requestDocNo}</div>

                  {(() => {
                    const orderQty = Number(poQty[ln.id]);
                    const excess = purchaseRequestPoExcessToStock(ln, orderQty);
                    return (
                      <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-600">
                        <div>
                          <dt className="font-medium text-slate-500">Required qty</dt>
                          <dd className="tabular-nums text-slate-800">{fmtQty(ln.netRequiredQty, ln.unit)}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-500">Order qty</dt>
                          <dd className="tabular-nums text-slate-800">
                            {Number.isFinite(orderQty) && orderQty > 0
                              ? fmtQty(orderQty, ln.unit)
                              : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-500">Excess to stock</dt>
                          <dd className="tabular-nums text-emerald-900">
                            {excess > 1e-9 ? fmtQty(excess, ln.unit) : "—"}
                          </dd>
                        </div>
                      </dl>
                    );
                  })()}

                  <div className="mt-2 grid grid-cols-2 gap-2">

                    <label className="text-xs text-slate-600">

                      Order qty

                      <Input

                        type="number"

                        min={0}

                        step="any"

                        className="mt-1"

                        disabled={creating}

                        value={poQty[ln.id] ?? ""}

                        onChange={(e) => setPoQty((p) => ({ ...p, [ln.id]: e.target.value }))}

                      />

                    </label>

                    <label className="text-xs text-slate-600">

                      Rate

                      <Input

                        type="number"

                        min={0}

                        step="any"

                        className="mt-1"

                        disabled={creating}

                        value={rates[ln.id] ?? ""}

                        onChange={(e) => setRates((p) => ({ ...p, [ln.id]: e.target.value }))}

                      />

                    </label>

                  </div>

                </div>

              ))}

            </div>



            <div className="mt-5 flex justify-end gap-2">

              <Button

                type="button"

                variant="outline"

                onClick={() => {

                  if (creating) return;

                  setPoOpen(false);

                  setModalLines([]);

                }}

                disabled={creating}

              >

                Cancel

              </Button>

              <Button type="button" disabled={creating} onClick={() => void submitPo()}>

                {creating ? "Creating…" : "Create RM PO"}

              </Button>

            </div>

          </div>
        </ErpModal>
      ) : null}

    </>

  );

}


