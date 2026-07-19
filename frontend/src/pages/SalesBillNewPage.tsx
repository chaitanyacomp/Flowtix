import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PageContainer, PageSmartBackLink, StickyWorkspaceHead } from "../components/PageHeader";
import { apiFetch } from "../services/api";
import { blockNumericStepperKey, defaultBillNow, isDispatchSelectable, selectAllEligible, selectAllState } from "../lib/salesBillSelection";

type DispatchRow = {
  dispatchId: number; dispatchNo: string; dispatchDate: string; salesOrderId: number;
  salesOrderDocNo?: string | null; customerName?: string | null; itemName?: string | null;
  hsnCode?: string | null; unit?: string | null; dispatchedQty: string;
  previouslyBilledQty?: string; reservedOtherDraftQty?: string; availableQty?: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const qty = (value: unknown) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export function SalesBillNewPage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [seedRows, setSeedRows] = React.useState<DispatchRow[]>([]);
  const [rows, setRows] = React.useState<DispatchRow[]>([]);
  const [soId, setSoId] = React.useState(Number(sp.get("salesOrderId") || 0));
  const [selected, setSelected] = React.useState<Record<number, boolean>>({});
  const [billNow, setBillNow] = React.useState<Record<number, string>>({});
  const [billDate, setBillDate] = React.useState(today);
  const [transportAmount, setTransportAmount] = React.useState("0");
  const [chargedBy, setChargedBy] = React.useState<"OUR_COMPANY" | "TRANSPORTER_DIRECTLY">("OUR_COMPANY");
  const [transporterName, setTransporterName] = React.useState("");
  const [referenceNo, setReferenceNo] = React.useState("");
  const [remarks, setRemarks] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const selectAllRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    void apiFetch<DispatchRow[]>("/api/sales-bills/eligible-dispatches").then((data) => {
      setSeedRows(data);
      if (!soId && data[0]?.salesOrderId) setSoId(data[0].salesOrderId);
    }).catch((e) => setError(e instanceof Error ? e.message : "Unable to load billing eligibility."));
  }, []);

  React.useEffect(() => {
    if (!(soId > 0)) return;
    setError(null);
    void apiFetch<DispatchRow[]>(`/api/sales-bills/sales-orders/${soId}/eligible-dispatches`).then((data) => {
      setRows(data);
      setSelected({}); setBillNow(defaultBillNow(data));
    }).catch((e) => setError(e instanceof Error ? e.message : "Unable to load dispatches."));
  }, [soId]);

  const salesOrders = React.useMemo(() => {
    const map = new Map<number, DispatchRow>();
    for (const row of seedRows) if (!map.has(row.salesOrderId)) map.set(row.salesOrderId, row);
    return [...map.values()];
  }, [seedRows]);
  const chosen = rows.filter((row) => selected[row.dispatchId]);
  const billQty = chosen.reduce((sum, row) => sum + Number(billNow[row.dispatchId] || 0), 0);
  const allState = selectAllState(rows, selected);
  React.useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = allState.indeterminate; }, [allState.indeterminate]);

  function toggleRow(row: DispatchRow, checked: boolean) {
    setSelected((current) => ({ ...current, [row.dispatchId]: checked }));
    if (checked) setBillNow((current) => ({ ...current, [row.dispatchId]: String(row.availableQty || "") }));
  }

  function toggleAll(checked: boolean) {
    setSelected(selectAllEligible(rows, checked));
    if (checked) setBillNow(defaultBillNow(rows));
  }

  async function createDraft() {
    const allocations = chosen.map((row) => ({ dispatchId: row.dispatchId, billNowQty: Number(billNow[row.dispatchId] || 0) }));
    if (!allocations.length || allocations.some((row) => !(row.billNowQty > 0))) return setError("Select dispatches and enter a Bill Now quantity greater than zero.");
    const over = chosen.find((row) => Number(billNow[row.dispatchId]) > Number(row.availableQty || 0));
    if (over) return setError(`Bill Now exceeds available quantity for ${over.dispatchNo}.`);
    setBusy(true); setError(null);
    try {
      const bill = await apiFetch<{ id: number }>("/api/sales-bills/from-sales-order", { method: "POST", body: JSON.stringify({
        salesOrderId: soId, billDate, allocations,
        transportation: { amount: Number(transportAmount || 0), chargedBy, transporterName: transporterName || null, referenceNo: referenceNo || null, remarks: remarks || null },
      }) });
      navigate(`/sales-bills/${bill.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create Sales Bill draft."); }
    finally { setBusy(false); }
  }

  return <PageContainer className="space-y-3">
    <StickyWorkspaceHead lead={<PageSmartBackLink defaultTo="/sales-bills" defaultLabel="Back to Sales Bills" />}>
      <div><h1 className="text-lg font-semibold text-slate-900">Create Sales Bill</h1><p className="text-xs text-slate-600">Combine eligible dispatch quantities from one Sales Order.</p></div>
    </StickyWorkspaceHead>
    {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs font-semibold text-slate-700">Sales Order
          <select className="mt-1 h-9 w-full rounded border border-slate-300 px-2 text-sm" value={soId || ""} onChange={(e) => setSoId(Number(e.target.value))}>
            <option value="">Select Sales Order</option>
            {salesOrders.map((row) => <option key={row.salesOrderId} value={row.salesOrderId}>{row.salesOrderDocNo || `SO-${row.salesOrderId}`} · {row.customerName}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-700">Customer<Input className="mt-1" value={rows[0]?.customerName || ""} readOnly /></label>
        <label className="text-xs font-semibold text-slate-700">Bill date<Input className="mt-1" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></label>
      </div>
    </section>
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">Dispatch selection</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-xs"><thead className="bg-slate-50 text-slate-600"><tr>
        <th className="px-2 py-2 text-left"><label className="inline-flex items-center gap-1.5 whitespace-nowrap"><input ref={selectAllRef} type="checkbox" aria-label="Select all eligible dispatches" checked={allState.checked} disabled={!rows.some(isDispatchSelectable)} onChange={(e) => toggleAll(e.target.checked)} /><span>Select All</span></label></th>
        {['Dispatch / Date','Item','Dispatched','Already billed','Reserved elsewhere','Available','Bill now','Unit'].map((h) => <th key={h} className="px-2 py-2 text-left">{h}</th>)}
      </tr></thead><tbody>{rows.map((row) => <tr key={row.dispatchId} className="border-t border-slate-100">
        <td className="px-2 py-1.5"><input type="checkbox" checked={Boolean(selected[row.dispatchId])} disabled={!isDispatchSelectable(row)} onChange={(e) => toggleRow(row, e.target.checked)} /></td>
        <td className="px-2 py-1.5 font-medium">{row.dispatchNo}<div className="font-normal text-slate-500">{new Date(row.dispatchDate).toLocaleDateString()}</div></td>
        <td className="px-2 py-1.5">{row.itemName}</td><td className="px-2 py-1.5 tabular-nums">{qty(row.dispatchedQty)}</td>
        <td className="px-2 py-1.5 tabular-nums">{qty(row.previouslyBilledQty)}</td><td className="px-2 py-1.5 tabular-nums">{qty(row.reservedOtherDraftQty)}</td>
        <td className="px-2 py-1.5 font-semibold tabular-nums">{qty(row.availableQty)}</td>
        <td className="px-2 py-1.5"><Input className="h-8 w-28 text-right" type="text" inputMode="decimal" disabled={!selected[row.dispatchId]} value={billNow[row.dispatchId] || ""} onWheel={(e) => e.currentTarget.blur()} onKeyDown={(e) => { if (blockNumericStepperKey(e.key)) e.preventDefault(); }} onChange={(e) => setBillNow((s) => ({ ...s, [row.dispatchId]: e.target.value }))} /></td>
        <td className="px-2 py-1.5">{row.unit}</td></tr>)}</tbody></table></div>
    </section>
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 text-sm font-semibold">Additional charges</div><div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs font-semibold">Transportation charges<Input className="mt-1" type="text" inputMode="decimal" value={transportAmount} onWheel={(e) => e.currentTarget.blur()} onKeyDown={(e) => { if (blockNumericStepperKey(e.key)) e.preventDefault(); }} onChange={(e) => setTransportAmount(e.target.value)} /></label>
        <label className="text-xs font-semibold">Charged by<select className="mt-1 h-9 w-full rounded border border-slate-300 px-2" value={chargedBy} onChange={(e) => setChargedBy(e.target.value as typeof chargedBy)}><option value="OUR_COMPANY">Our Company</option><option value="TRANSPORTER_DIRECTLY">Transporter Directly</option></select></label>
        <label className="text-xs font-semibold">Transporter name<Input className="mt-1" value={transporterName} onChange={(e) => setTransporterName(e.target.value)} /></label>
        <label className="text-xs font-semibold">LR / vehicle / reference<Input className="mt-1" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} /></label>
        <label className="text-xs font-semibold md:col-span-2">Remarks<Input className="mt-1" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
      </div>{chargedBy === "OUR_COMPANY" ? <p className="mt-2 text-xs text-slate-600">Transportation GST is allocated proportionately across invoice items.</p> : <p className="mt-2 text-xs text-amber-700">The transporter will bill the customer separately; this amount is excluded from this invoice.</p>}
    </section>
    <div className="sticky bottom-0 flex items-center justify-between rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur"><span className="text-sm font-semibold">{chosen.length} dispatches · {qty(billQty)} total quantity</span><Button disabled={busy || !chosen.length} onClick={() => void createDraft()}>{busy ? "Creating…" : "Create Sales Bill Draft"}</Button></div>
  </PageContainer>;
}
