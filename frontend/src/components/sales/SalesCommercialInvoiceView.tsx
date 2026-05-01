import * as React from "react";
import { Link } from "react-router-dom";
import { Badge } from "../ui/badge";

type Customer = { id: number; name: string };

export type SalesInvoiceSoLine = {
  id: number;
  itemId: number;
  qty: string;
  isFree?: boolean;
  quotationLineId?: number | null;
  quotationLine?: {
    qty: string;
    rate: string;
    isFree: boolean;
    lineTotal: string;
    discountPct?: string;
    gstPct?: string;
  } | null;
  item: { itemName: string };
};

/** Detail payload from GET /api/sales-orders/:id — used for commercial invoice display. */
export type SalesInvoiceSoDetail = {
  id: number;
  customerId: number | null;
  customer: Customer | null;
  quotationId: number | null;
  quotation: { id: number; quotationNo: string | null } | null;
  customerPoReference: string | null;
  remarks: string | null;
  internalStatus: string;
  createdAt: string;
  po?: { id: number; customer?: Customer | null } | null;
  lines: SalesInvoiceSoLine[];
};

function customerName(so: SalesInvoiceSoDetail): string {
  return so.customer?.name?.trim() || so.po?.customer?.name?.trim() || "Customer";
}

function lineIsFree(ln: SalesInvoiceSoLine): boolean {
  return Boolean(ln.quotationLine?.isFree ?? ln.isFree);
}

function commercialLineDisplay(ln: SalesInvoiceSoLine): { rate: number; amount: number; isFree: boolean } {
  const free = lineIsFree(ln);
  if (free) return { rate: 0, amount: 0, isFree: true };
  const ql = ln.quotationLine;
  if (!ql) return { rate: 0, amount: 0, isFree: false };
  const qQty = Number(ql.qty);
  const soQty = Number(ln.qty);
  const baseTotal = Number(ql.lineTotal);
  const rate = Number(ql.rate);
  if (qQty <= 0 || !Number.isFinite(qQty)) return { rate, amount: baseTotal, isFree: false };
  const amount = Math.round(((baseTotal * soQty) / qQty) * 100) / 100;
  return { rate, amount, isFree: false };
}

type Props = { so: SalesInvoiceSoDetail };

/**
 * Read-only commercial tax-invoice body (quotation-linked pricing, PO path lines, replacement SOs — all from API).
 */
export function SalesCommercialInvoiceView({ so }: Props) {
  const totals = React.useMemo(() => {
    let subtotal = 0;
    let freeLines = 0;
    for (const ln of so.lines) {
      const c = commercialLineDisplay(ln);
      if (c.isFree) freeLines += 1;
      subtotal += c.amount;
    }
    return { subtotal, freeLines };
  }, [so]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-600">
        Read-only commercial view from quotation-linked pricing. Free lines are priced at zero; operational quantities are
        unchanged.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs font-medium uppercase text-slate-500">Bill to</div>
          <div className="text-base font-semibold text-slate-900">{customerName(so)}</div>
        </div>
        <div className="text-sm sm:text-right">
          <div className="text-slate-600">
            <span className="font-medium text-slate-800">SO #{so.id}</span>
            <span className="mx-2 text-slate-400">·</span>
            <span>{new Date(so.createdAt).toLocaleDateString()}</span>
          </div>
          {so.quotation ? (
            <div className="mt-1 text-slate-600">
              Quotation:{" "}
              <Link to="/quotations" className="text-primary underline">
                {so.quotation.quotationNo || `#${so.quotation.id}`}
              </Link>
            </div>
          ) : null}
          {so.customerPoReference ? (
            <div className="mt-1 text-slate-600">Customer PO ref: {so.customerPoReference}</div>
          ) : null}
          <div className="mt-1">
            <Badge variant="default">{so.internalStatus.replace(/_/g, " ")}</Badge>
          </div>
        </div>
      </div>

      <div className="erp-table-wrap overflow-x-auto rounded-md border border-slate-200">
        <table className="erp-table text-sm">
          <thead>
            <tr className="text-left text-slate-600">
              <th className="py-2 pr-3">Item</th>
              <th className="py-2 pr-3">Qty</th>
              <th className="py-2 pr-3">Rate</th>
              <th className="py-2 pr-3">Line amount</th>
              <th className="py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {so.lines.map((ln) => {
              const c = commercialLineDisplay(ln);
              const noQuotePricing = !ln.quotationLine && !c.isFree;
              return (
                <tr
                  key={ln.id}
                  className={c.isFree ? "bg-emerald-50/60" : noQuotePricing ? "bg-amber-50/40" : undefined}
                >
                  <td className="py-2 pr-3 font-medium text-slate-900">
                    {ln.item.itemName}
                    {c.isFree ? (
                      <Badge variant="success" className="ml-2 align-middle">
                        Free
                      </Badge>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{Number(ln.qty)}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {c.isFree ? "0.00" : noQuotePricing ? "—" : c.rate.toFixed(2)}
                  </td>
                  <td className="py-2 pr-3 tabular-nums font-medium">
                    {c.isFree ? "0.00" : noQuotePricing ? "—" : c.amount.toFixed(2)}
                  </td>
                  <td className="py-2 text-xs text-slate-600">
                    {c.isFree ? "Commercial free line (quotation)" : noQuotePricing ? "No quotation line — PO path" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm">
        <div className="text-slate-600">
          {totals.freeLines > 0 ? (
            <span>
              {totals.freeLines} free line{totals.freeLines === 1 ? "" : "s"} at ₹0.00
            </span>
          ) : (
            <span>No free lines on this order</span>
          )}
        </div>
        <div className="text-right">
          <div className="text-xs uppercase text-slate-500">Invoice total (commercial)</div>
          <div className="text-xl font-semibold tabular-nums text-slate-900">{totals.subtotal.toFixed(2)}</div>
        </div>
      </div>

      {so.remarks ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Remarks:</span> {so.remarks}
        </p>
      ) : null}
    </div>
  );
}
