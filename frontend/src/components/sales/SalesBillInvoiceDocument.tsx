import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import { buildSalesBillTaxSummary, lineTaxRates } from "../../lib/salesBillTaxDisplay";

export type SalesBillInvoiceLine = {
  id: number;
  itemNameSnapshot: string;
  hsnCodeSnapshot: string;
  unitSnapshot: string;
  qty: string;
  rate: string;
  basicAmount: string;
  goodsTaxableAmount?: string;
  gstRate: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
  transportationAllocation?: string;
};

export type SalesBillInvoiceDocumentBill = {
  billNo: string | null;
  billDate: string;
  remarks?: string | null;
  docNo?: string | null;
  totalBasic: string;
  totalCgst: string;
  totalSgst: string;
  totalIgst: string;
  totalTax?: string;
  netAmount: string;
  goodsTaxableValue?: string;
  transportationAmount?: string;
  transportationTaxableValue?: string;
  transportationChargedBy?: "OUR_COMPANY" | "TRANSPORTER_DIRECTLY" | string;
  transporterName?: string | null;
  transportationReferenceNo?: string | null;
  vehicleNumber?: string | null;
  roundOffAmount?: string;
  dispatchAllocations?: Array<{ dispatch?: { docNo?: string | null }; dispatchId: number; allocatedQty: string }>;
  taxIntraState?: boolean;
  gstMode?: "LOCAL" | "INTERSTATE" | string | null;
  posStateCode?: string | null;
  posStateName?: string | null;
  posStateNameSnapshot?: string | null;
  posStateCodeSnapshot?: string | null;
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
  customer: { name: string };
  dispatch?: {
    docNo?: string | null;
    soId?: number;
    salesOrder?: { docNo?: string | null; orderType?: string };
  } | null;
  lines: SalesBillInvoiceLine[];
};

function trim(v?: string | null): string {
  return (v ?? "").trim();
}

function formatMoney(n0: string | number): string {
  const x = typeof n0 === "number" ? n0 : Number(n0);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatBillDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function gstModeLabel(bill: SalesBillInvoiceDocumentBill): { label: string; variant: "local" | "interstate" | "pending" } {
  if (bill.gstMode === "INTERSTATE" || (bill.gstMode == null && bill.taxIntraState === false)) {
    return { label: "Interstate", variant: "interstate" };
  }
  if (bill.gstMode === "LOCAL" || (bill.gstMode == null && bill.taxIntraState === true)) {
    return { label: "Local", variant: "local" };
  }
  return { label: "POS Pending", variant: "pending" };
}

function addressLines(address?: string | null): string[] {
  return String(address ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function stateDisplay(code?: string | null, name?: string | null): string {
  const c = trim(code);
  const n = trim(name);
  if (c && n) return `${c} · ${n}`;
  return c || n || "—";
}

type Props = {
  bill: SalesBillInvoiceDocumentBill;
  className?: string;
};

/**
 * Customer-facing tax invoice layout for screen view and print.
 */
export function SalesBillInvoiceDocument({ bill, className }: Props) {
  const billToName = trim(bill.customerNameSnapshot) || bill.customer.name;
  const shipLabel = trim(bill.shipToLabelSnapshot);
  const shipBlank =
    !shipLabel &&
    !trim(bill.shipToAddressSnapshot) &&
    !trim(bill.shipToGstinSnapshot) &&
    !trim(bill.shipToStateCodeSnapshot) &&
    !trim(bill.shipToStateNameSnapshot);
  const shipToLabel = shipBlank ? "Same as Bill To" : shipLabel || billToName;
  const shipToAddress = shipBlank ? bill.billToAddressSnapshot : bill.shipToAddressSnapshot;
  const shipToGstin = shipBlank ? bill.billToGstinSnapshot : bill.shipToGstinSnapshot;
  const shipToStateCode = shipBlank ? bill.customerStateCodeSnapshot : bill.shipToStateCodeSnapshot;
  const shipToStateName = shipBlank ? bill.customerStateNameSnapshot : bill.shipToStateNameSnapshot;

  const posName = trim(bill.posStateName) || trim(bill.posStateNameSnapshot);
  const posCode = trim(bill.posStateCode) || trim(bill.posStateCodeSnapshot);
  const gstChip = gstModeLabel(bill);
  const intraState = gstChip.variant !== "interstate";
  const taxSummary = buildSalesBillTaxSummary(bill.lines, intraState);

  return (
    <div
      id="sales-bill-invoice-printable"
      className={cn("rounded-md border border-slate-200 bg-white p-4 text-slate-900 print:border-0 print:p-0", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tax Invoice</div>
          <div className="mt-0.5 text-lg font-semibold text-slate-900">{bill.billNo?.trim() || bill.docNo?.trim() || "Draft invoice"}</div>
          <div className="mt-1 text-sm text-slate-600">Date: {formatBillDate(bill.billDate)}</div>
        </div>
        <div className="text-right text-sm text-slate-600">
          {bill.dispatch?.salesOrder?.docNo ? (
            <div>
              SO: <span className="font-medium text-slate-800">{bill.dispatch.salesOrder.docNo}</span>
            </div>
          ) : bill.dispatch?.soId ? (
            <div>
              SO: <span className="font-medium text-slate-800">#{bill.dispatch.soId}</span>
            </div>
          ) : null}
          {bill.dispatchAllocations?.length ? (
            <div className="mt-0.5 max-w-xs text-xs">
              Dispatch: <span className="font-medium text-slate-800">{bill.dispatchAllocations.length === 1 ? (bill.dispatchAllocations[0].dispatch?.docNo || `D-${bill.dispatchAllocations[0].dispatchId}`) : `${bill.dispatchAllocations.length} Dispatches`}</span>
              {bill.dispatchAllocations.length > 1 ? <div className="mt-0.5 text-[11px] text-slate-600">{bill.dispatchAllocations.map((a) => `${a.dispatch?.docNo || `D-${a.dispatchId}`} (${Number(a.allocatedQty)} allocated)`).join(" · ")}</div> : null}
            </div>
          ) : bill.dispatch?.docNo ? (
            <div className="mt-0.5">
              Dispatch: <span className="font-medium text-slate-800">{bill.dispatch.docNo}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded border border-slate-200 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Bill To</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{billToName}</div>
          <div className="mt-1 space-y-0.5 text-[12px] leading-snug text-slate-700">
            {addressLines(bill.billToAddressSnapshot).length ? (
              addressLines(bill.billToAddressSnapshot).map((line, i) => <div key={`bt-${i}`}>{line}</div>)
            ) : (
              <div className="text-slate-500">Address not recorded</div>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
            <span>{stateDisplay(bill.customerStateCodeSnapshot, bill.customerStateNameSnapshot)}</span>
            {trim(bill.billToGstinSnapshot) ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{trim(bill.billToGstinSnapshot)}</span>
            ) : null}
          </div>
        </div>

        <div className="rounded border border-slate-200 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ship To</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{shipToLabel}</div>
          <div className="mt-1 space-y-0.5 text-[12px] leading-snug text-slate-700">
            {shipBlank ? (
              <div className="italic text-slate-500">Same as Bill To</div>
            ) : addressLines(shipToAddress).length ? (
              addressLines(shipToAddress).map((line, i) => <div key={`st-${i}`}>{line}</div>)
            ) : (
              <div className="text-slate-500">Address not recorded</div>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
            <span>{stateDisplay(shipToStateCode, shipToStateName)}</span>
            {trim(shipToGstin) ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{trim(shipToGstin)}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="font-medium text-slate-600">Place of Supply:</span>
        <span className="text-slate-800">{stateDisplay(posCode, posName)}</span>
        <Badge
          variant={gstChip.variant === "interstate" ? "info" : gstChip.variant === "local" ? "success" : "default"}
          density="compact"
          className={cn(
            gstChip.variant === "interstate"
              ? "border-purple-200 bg-purple-50 text-purple-900"
              : gstChip.variant === "local"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-slate-200 bg-slate-50 text-slate-700",
          )}
        >
          {gstChip.label}
        </Badge>
      </div>

      <div className="mt-3 overflow-x-auto rounded border border-slate-200">
        <table className="w-full min-w-[640px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
              <th className="px-2 py-1.5 font-medium">Item</th>
              <th className="px-2 py-1.5 font-medium">HSN</th>
              <th className="px-2 py-1.5 text-right font-medium">Qty</th>
              <th className="px-2 py-1.5 text-right font-medium">Rate</th>
              <th className="px-2 py-1.5 text-right font-medium">Taxable</th>
              <th className="px-2 py-1.5 text-right font-medium">GST %</th>
              <th className="px-2 py-1.5 text-right font-medium">Tax</th>
              <th className="px-2 py-1.5 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((ln) => {
              const tax = Number(ln.cgstAmount) + Number(ln.sgstAmount) + Number(ln.igstAmount);
              const rates = lineTaxRates(ln, intraState);
              return (
                <tr key={ln.id} className="border-b border-slate-100">
                  <td className="px-2 py-1.5 font-medium text-slate-900">{ln.itemNameSnapshot}<div className="mt-0.5 text-[10px] font-normal text-slate-500">Goods {formatMoney(ln.goodsTaxableAmount ?? (Number(ln.basicAmount) - Number(ln.transportationAllocation || 0)))} + transport {formatMoney(ln.transportationAllocation || 0)}</div><div className="text-[10px] font-normal text-slate-600">CGST {rates.cgst ?? "—"}: {rates.cgst ? formatMoney(ln.cgstAmount) : "—"} · SGST {rates.sgst ?? "—"}: {rates.sgst ? formatMoney(ln.sgstAmount) : "—"} · IGST {rates.igst ?? "—"}: {rates.igst ? formatMoney(ln.igstAmount) : "—"}</div></td>
                  <td className="px-2 py-1.5 text-slate-600">{ln.hsnCodeSnapshot || "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {Number(ln.qty)} {ln.unitSnapshot}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(ln.rate)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(ln.basicAmount)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{rates.gst}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(tax)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{formatMoney(ln.lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex justify-end">
        <div className="w-full max-w-xs space-y-1 text-[12px]">
          <div className="flex justify-between gap-4">
            <span className="text-slate-600">Goods taxable value</span>
            <span className="tabular-nums">{formatMoney(bill.goodsTaxableValue ?? bill.totalBasic)}</span>
          </div>
          {Number(bill.transportationAmount || 0) > 0 ? <div className="flex justify-between gap-4"><span className="text-slate-600">Transportation Charges{bill.transportationChargedBy === "TRANSPORTER_DIRECTLY" ? " (transporter direct)" : ""}</span><span className="tabular-nums">{formatMoney(bill.transportationAmount || 0)}</span></div> : null}
          <div className="flex justify-between gap-4"><span className="text-slate-600">Total Taxable Value</span><span className="tabular-nums">{formatMoney(bill.totalBasic)}</span></div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-600">CGST</span>
            <span className="tabular-nums">{formatMoney(bill.totalCgst)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-600">SGST</span>
            <span className="tabular-nums">{formatMoney(bill.totalSgst)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-600">IGST</span>
            <span className="tabular-nums">{formatMoney(bill.totalIgst)}</span>
          </div>
          <div className="flex justify-between gap-4"><span className="text-slate-600">Total tax</span><span className="tabular-nums">{formatMoney(bill.totalTax ?? (Number(bill.totalCgst) + Number(bill.totalSgst) + Number(bill.totalIgst)))}</span></div>
          <div className="flex justify-between gap-4 text-slate-600"><span>Round-off</span><span className="tabular-nums">{formatMoney(bill.roundOffAmount || 0)}</span></div>
          <div className="flex justify-between gap-4 border-t border-slate-200 pt-1 font-semibold">
            <span className="text-slate-900">Grand total</span>
            <span className="tabular-nums text-slate-900">{formatMoney(bill.netAmount)}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 rounded border border-slate-200">
        <div className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">GST rate-wise summary</div>
        <table className="w-full border-collapse text-[11px]"><thead><tr className="border-b border-slate-200 text-slate-600"><th className="px-2 py-1 text-right">GST Rate</th><th className="px-2 py-1 text-right">Taxable Value</th><th className="px-2 py-1 text-right">CGST % / Amt</th><th className="px-2 py-1 text-right">SGST % / Amt</th><th className="px-2 py-1 text-right">IGST % / Amt</th></tr></thead><tbody>{taxSummary.map((row) => <tr key={row.gstRate} className="border-b border-slate-100 last:border-0"><td className="px-2 py-1 text-right font-medium">{row.gstRateLabel}</td><td className="px-2 py-1 text-right tabular-nums">{formatMoney(row.taxableValue)}</td><td className="px-2 py-1 text-right tabular-nums">{row.cgstRateLabel ? `${row.cgstRateLabel} / ${formatMoney(row.cgstAmount)}` : "—"}</td><td className="px-2 py-1 text-right tabular-nums">{row.sgstRateLabel ? `${row.sgstRateLabel} / ${formatMoney(row.sgstAmount)}` : "—"}</td><td className="px-2 py-1 text-right tabular-nums">{row.igstRateLabel ? `${row.igstRateLabel} / ${formatMoney(row.igstAmount)}` : "—"}</td></tr>)}</tbody></table>
      </div>
      {bill.lines.some((line) => Number(line.transportationAllocation || 0) > 0) ? <p className="mt-1 text-[10px] text-slate-500">Taxable value includes proportionately allocated transportation.</p> : null}

      {Number(bill.transportationAmount || 0) > 0 ? (
        <p className="mt-2 text-[11px] text-slate-600">
          {bill.transportationChargedBy === "OUR_COMPANY"
            ? "Transportation GST is allocated proportionately across invoice items."
            : `Transporter bills customer separately${bill.transporterName ? ` · ${bill.transporterName}` : ""}.`}
          {bill.vehicleNumber ? ` · Vehicle ${bill.vehicleNumber}` : ""}
          {bill.transportationReferenceNo
            ? ` · ${bill.vehicleNumber ? "LR" : "Ref"} ${bill.transportationReferenceNo}`
            : ""}
        </p>
      ) : null}

      {bill.remarks?.trim() ? (
        <p className="mt-3 rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-[12px] text-slate-700">
          <span className="font-medium text-slate-800">Remarks:</span> {bill.remarks.trim()}
        </p>
      ) : null}
    </div>
  );
}
