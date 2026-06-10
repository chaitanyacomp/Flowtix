import * as React from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "../ui/button";
import { RmPoCommercialSummary } from "../purchase/RmPoCommercialSummary";
import { cn } from "../../lib/utils";
import { buildProcurementWorkspaceHref } from "../../lib/woProcurementContinuity";
import {
  demandSourceDisplay,
  formatPoDocumentDate,
  formatTraceQty,
  lineBillStatusLabel,
  lineReceiptStatusLabel,
  traceLineByPoLineId,
  type RmPoTracePayload,
} from "../../lib/rmPoDocumentTrace";
import {
  computeLineAmount,
  formatRmPoNo,
  grnStatusDotClass,
  grnStatusLabel,
  poStatusDotClass,
  poStatusLabel,
  receivedForLine,
  type GrnRow,
  type RmPoRow,
} from "../../pages/rmPurchase/rmPurchaseShared";

type GrnExtended = GrnRow & {
  date?: string;
  supplierInvoiceNo?: string;
  billingStatus?: string;
};

export type RmPoDocumentViewProps = {
  po: RmPoRow;
  trace: RmPoTracePayload | null;
  traceError: string | null;
  receiveInfo: { ordered: number; received: number; pending: number } | null;
  billingTotals: { billed: number; pendingBilling: number; rebillable: number };
  poPrimaryUnit: string;
  stockStatusLabel: string;
  billingStatusLabel: string;
  canEditPo: boolean;
  showCancel: boolean;
  grnAllowed: boolean;
  isAdmin: boolean;
  reversingGrnId: number;
  onEdit: () => void;
  onCancel: () => void;
  onCreateGrn: () => void;
  onReverseGrn: (grnId: number) => void;
};

function TraceChainInline({ chain }: { chain: string[] }) {
  if (!chain.length) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
      {chain.map((step, i) => (
        <React.Fragment key={`${step}-${i}`}>
          {i > 0 ? <span className="text-slate-400">→</span> : null}
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">{step}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

function LineSourceTrace({
  poLineId,
  trace,
  returnTo,
}: {
  poLineId: number;
  trace: RmPoTracePayload | null;
  returnTo: string;
}) {
  const traceLine = traceLineByPoLineId(trace, poLineId);
  const sources = traceLine?.demandSources ?? [];

  if (!sources.length) {
    return <p className="text-[11px] italic text-slate-500">No source trace found</p>;
  }

  return (
    <div className="space-y-2" data-testid={`po-line-trace-${poLineId}`}>
      {sources.map((ds, idx) => {
        const mrId = ds.mr?.materialRequirementId;
        const procHref =
          mrId && mrId > 0
            ? buildProcurementWorkspaceHref({
                materialRequirementId: mrId,
                workOrderId: ds.workOrder?.id ?? ds.mr?.workOrder?.id,
                salesOrderId: ds.salesOrder?.id ?? ds.mr?.salesOrder?.id,
                returnTo,
              })
            : null;
        return (
          <div key={idx} className="rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-700">
              <span>
                <span className="font-semibold text-slate-500">Demand:</span> {demandSourceDisplay(ds)}
              </span>
              {ds.mr?.docNo ? (
                <span>
                  <span className="font-semibold text-slate-500">MR:</span>{" "}
                  {procHref ? (
                    <Link to={procHref} className="text-primary underline">
                      {ds.mr.docNo}
                    </Link>
                  ) : (
                    ds.mr.docNo
                  )}
                </span>
              ) : null}
              {ds.pr?.docNo ? (
                <span>
                  <span className="font-semibold text-slate-500">PR:</span> {ds.pr.docNo}
                </span>
              ) : null}
              {ds.workOrder?.docNo ? (
                <span>
                  <span className="font-semibold text-slate-500">WO:</span> {ds.workOrder.docNo}
                </span>
              ) : null}
              {ds.salesOrder?.docNo ? (
                <span>
                  <span className="font-semibold text-slate-500">SO:</span> {ds.salesOrder.docNo}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
      {traceLine?.traceChain?.length ? <TraceChainInline chain={traceLine.traceChain} /> : null}
      <div className="flex flex-wrap gap-3 text-[11px] text-slate-600">
        <span>
          <span className="font-semibold">Stock:</span>{" "}
          {traceLine?.grnLines?.some((g) => !g.isReversed && g.stockTransactions.length)
            ? "Posted"
            : "Not posted"}
        </span>
        <span>
          <span className="font-semibold">Bill:</span> {lineBillStatusLabel(traceLine?.purchaseBillLines ?? [])}
        </span>
      </div>
    </div>
  );
}

function GrnHistoryCard({
  grn,
  po,
  trace,
  isAdmin,
  reversingGrnId,
  onReverse,
}: {
  grn: GrnExtended;
  po: RmPoRow;
  trace: RmPoTracePayload | null;
  isAdmin: boolean;
  reversingGrnId: number;
  onReverse: (id: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const traceGrn = trace?.grns?.find((g) => g.id === grn.id);
  const lineDetails = (trace?.lines ?? []).flatMap((tl) =>
    (tl.grnLines ?? [])
      .filter((gl) => gl.grnId === grn.id)
      .map((gl) => ({
        itemName: tl.item?.itemName ?? `Line #${tl.id}`,
        receivedQty: gl.receivedQty,
        location: gl.location?.name ?? gl.location?.code ?? null,
        stockPosted: gl.stockTransactions.length > 0,
        bill: gl.purchaseBillLines[0]?.purchaseBill?.billNo ?? null,
      })),
  );

  if (!lineDetails.length) {
    for (const gl of grn.lines) {
      const poLine = po.lines.find((l) => l.id === gl.rmPoLineId);
      lineDetails.push({
        itemName: poLine?.item?.itemName ?? `Line #${gl.rmPoLineId}`,
        receivedQty: Number(gl.receivedQty),
        location: gl.location?.locationName ?? gl.location?.locationCode ?? null,
        stockPosted: false,
        bill: null,
      });
    }
  }

  const receivedTotal = lineDetails.reduce((s, l) => s + l.receivedQty, 0);

  return (
    <div className="rounded-md border border-slate-200 bg-white" data-testid={`grn-card-${grn.id}`}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />}
          <span className="font-semibold text-slate-900">GRN-{grn.id}</span>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-700">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${grnStatusDotClass(grn)}`} aria-hidden />
            {grnStatusLabel(grn)}
          </span>
          {traceGrn?.date || grn.date ? (
            <span className="text-[12px] text-slate-500">{formatPoDocumentDate(traceGrn?.date ?? grn.date)}</span>
          ) : null}
          {traceGrn?.supplierInvoiceNo || grn.supplierInvoiceNo ? (
            <span className="text-[12px] text-slate-600">
              Inv: {traceGrn?.supplierInvoiceNo ?? grn.supplierInvoiceNo}
            </span>
          ) : null}
          <span className="text-[12px] text-slate-500">
            {lineDetails.length} line{lineDetails.length === 1 ? "" : "s"} · {receivedTotal.toFixed(3)} received
          </span>
        </div>
        {isAdmin && !grn.reversedAt ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 px-2 text-[11px]"
            disabled={reversingGrnId === grn.id}
            onClick={(e) => {
              e.stopPropagation();
              onReverse(grn.id);
            }}
          >
            {reversingGrnId === grn.id ? "Reversing…" : "Reverse"}
          </Button>
        ) : null}
      </button>
      {open ? (
        <div className="border-t border-slate-100 px-3 py-2 text-[12px]">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <th className="pb-1">Item</th>
                <th className="pb-1 text-right">Received</th>
                <th className="pb-1">Location</th>
                <th className="pb-1">Stock</th>
                <th className="pb-1">Bill</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {lineDetails.map((ln, i) => (
                <tr key={i}>
                  <td className="py-1 font-medium text-slate-800">{ln.itemName}</td>
                  <td className="py-1 text-right tabular-nums">{ln.receivedQty.toFixed(3)}</td>
                  <td className="py-1 text-slate-600">{ln.location ?? "—"}</td>
                  <td className="py-1">{ln.stockPosted ? "Posted" : "Not posted"}</td>
                  <td className="py-1">{ln.bill ? ln.bill : "Not billed"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function RmPoDocumentView({
  po,
  trace,
  traceError,
  receiveInfo,
  billingTotals,
  poPrimaryUnit,
  stockStatusLabel,
  billingStatusLabel,
  canEditPo,
  showCancel,
  grnAllowed,
  isAdmin,
  reversingGrnId,
  onEdit,
  onCancel,
  onCreateGrn,
  onReverseGrn,
}: RmPoDocumentViewProps) {
  const returnTo = `/rm-po-grn/${po.id}`;
  const commercial = po.resolvedSupplierCommercial;
  const supplierGst =
    commercial?.registeredSupplier?.gstin ?? po.supplier.gstin ?? po.supplier.gst ?? "—";
  const supplierState =
    commercial?.registeredSupplier?.stateName ??
    po.supplier.stateName ??
    po.supplier.state ??
    "—";
  const supplyLabel = commercial?.supplyLocation?.label ?? trace?.supplierLocation?.label ?? "—";

  let subtotal = 0;
  let totalGst = 0;
  for (const ln of po.lines) {
    const amt =
      ln.amount != null && String(ln.amount).trim() !== ""
        ? Number(ln.amount)
        : computeLineAmount(Number(ln.qty), Number(ln.rate ?? 0));
    if (Number.isFinite(amt)) subtotal += amt;
    const gst = ln.gstRate != null ? Number(ln.gstRate) : 0;
    if (Number.isFinite(gst) && Number.isFinite(amt)) totalGst += (amt * gst) / 100;
  }
  const grandTotal = subtotal + totalGst;

  return (
    <article
      className="mx-auto max-w-5xl overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md"
      data-testid="rm-po-document"
    >
      {/* Sticky document actions */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur-sm">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">RM Purchase Order</p>
        <div className="flex flex-wrap gap-1.5">
          {grnAllowed ? (
            <Button type="button" size="sm" data-testid="rm-po-create-grn-btn" onClick={onCreateGrn}>
              Create GRN
            </Button>
          ) : null}
          {canEditPo ? (
            <Button type="button" variant="outline" size="sm" data-testid="rm-po-edit-btn" onClick={onEdit}>
              Edit order
            </Button>
          ) : null}
          {showCancel ? (
            <Button type="button" variant="outline" size="sm" data-testid="rm-po-cancel-btn" onClick={onCancel}>
              Cancel order
            </Button>
          ) : null}
        </div>
      </div>

      {/* Document header */}
      <header className="border-b border-slate-200 px-4 py-4 md:px-6" data-testid="rm-po-document-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-950 md:text-2xl">{formatRmPoNo(po.id)}</h1>
            <p className="mt-0.5 text-sm text-slate-600">
              PO date: {formatPoDocumentDate(trace?.rmPo?.createdAt)}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide",
              po.status === "COMPLETED"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : po.status === "CANCELLED"
                  ? "border-slate-200 bg-slate-100 text-slate-600"
                  : "border-amber-200 bg-amber-50 text-amber-900",
            )}
          >
            <span className={`h-2 w-2 rounded-full ${poStatusDotClass(po.status)}`} />
            {poStatusLabel(po.status)}
          </span>
        </div>
      </header>

      {/* Supplier section */}
      <section className="grid gap-4 border-b border-slate-200 px-4 py-4 md:grid-cols-2 md:px-6" data-testid="rm-po-supplier-section">
        <div>
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Supplier</h2>
          <p className="mt-1 text-base font-semibold text-slate-900">{po.supplier.name}</p>
          <dl className="mt-2 space-y-1 text-sm text-slate-700">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 font-medium text-slate-500">GSTIN</dt>
              <dd className="font-mono text-[13px]">{supplierGst}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 font-medium text-slate-500">State</dt>
              <dd>{supplierState}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Supply / receiving</h2>
          <dl className="mt-2 space-y-1 text-sm text-slate-700">
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 font-medium text-slate-500">Supply location</dt>
              <dd>{supplyLabel}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 font-medium text-slate-500">Stock status</dt>
              <dd>{stockStatusLabel}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 font-medium text-slate-500">Billing</dt>
              <dd>{billingStatusLabel}</dd>
            </div>
          </dl>
          {po.remarks ? (
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-semibold text-slate-500">Remarks:</span> {po.remarks}
            </p>
          ) : null}
        </div>
        {commercial ? (
          <div className="md:col-span-2">
            <RmPoCommercialSummary commercial={commercial} />
          </div>
        ) : null}
      </section>

      {traceError ? (
        <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800 md:px-6">
          Trace data unavailable: {traceError}. Showing PO lines from order data.
        </p>
      ) : null}

      {/* Line table — desktop */}
      <section className="hidden border-b border-slate-200 md:block" data-testid="rm-po-lines-table">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wider text-slate-600">
              <th className="px-4 py-2">RM item</th>
              <th className="px-2 py-2">HSN</th>
              <th className="px-2 py-2 text-right">Ordered</th>
              <th className="px-2 py-2 text-right">Received</th>
              <th className="px-2 py-2 text-right">Pending</th>
              <th className="px-2 py-2">Unit</th>
              <th className="px-2 py-2 text-right">Rate</th>
              <th className="px-2 py-2 text-right">GST %</th>
              <th className="px-2 py-2 text-right">Amount</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((ln) => {
              const received = traceLineByPoLineId(trace, ln.id)?.receivedQty ?? receivedForLine(po, ln.id);
              const ordered = Number(ln.qty);
              const pending = Math.max(0, ordered - received);
              const amt =
                ln.amount != null && String(ln.amount).trim() !== ""
                  ? Number(ln.amount)
                  : computeLineAmount(ordered, Number(ln.rate ?? 0));
              const status = lineReceiptStatusLabel(ordered, received, pending);
              return (
                <React.Fragment key={ln.id}>
                  <tr className="border-b border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-900">{ln.item?.itemName ?? `Item #${ln.itemId}`}</td>
                    <td className="px-2 py-2 font-mono text-xs">{ln.hsn || "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{ordered.toFixed(3)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{received.toFixed(3)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{pending.toFixed(3)}</td>
                    <td className="px-2 py-2">{ln.unit || "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{ln.rate ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{ln.gstRate ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{Number.isFinite(amt) ? amt.toFixed(2) : "—"}</td>
                    <td className="px-4 py-2 text-xs font-semibold text-slate-700">{status}</td>
                  </tr>
                  <tr className="border-b border-slate-200 bg-slate-50/50">
                    <td colSpan={10} className="px-4 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Source trace</p>
                      <LineSourceTrace poLineId={ln.id} trace={trace} returnTo={returnTo} />
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Line cards — mobile/tablet */}
      <section className="space-y-3 border-b border-slate-200 p-4 md:hidden" data-testid="rm-po-line-cards">
        {po.lines.map((ln) => {
          const received = traceLineByPoLineId(trace, ln.id)?.receivedQty ?? receivedForLine(po, ln.id);
          const ordered = Number(ln.qty);
          const pending = Math.max(0, ordered - received);
          const amt =
            ln.amount != null && String(ln.amount).trim() !== ""
              ? Number(ln.amount)
              : computeLineAmount(ordered, Number(ln.rate ?? 0));
          return (
            <div key={ln.id} className="rounded-md border border-slate-200 bg-slate-50/30 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-slate-900">{ln.item?.itemName}</p>
                <span className="text-xs font-semibold text-slate-600">
                  {lineReceiptStatusLabel(ordered, received, pending)}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-700">
                <div>
                  <span className="block text-[10px] uppercase text-slate-400">Ordered</span>
                  {formatTraceQty(ordered, ln.unit)}
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-slate-400">Received</span>
                  {formatTraceQty(received, ln.unit)}
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-slate-400">Pending</span>
                  {formatTraceQty(pending, ln.unit)}
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                Rate {ln.rate ?? "—"} · GST {ln.gstRate ?? "—"}% · Amount{" "}
                {Number.isFinite(amt) ? amt.toFixed(2) : "—"}
              </p>
              <div className="mt-2 border-t border-slate-200 pt-2">
                <LineSourceTrace poLineId={ln.id} trace={trace} returnTo={returnTo} />
              </div>
            </div>
          );
        })}
      </section>

      {/* GRN history */}
      <section className="border-b border-slate-200 px-4 py-4 md:px-6" data-testid="rm-po-grn-history">
        <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">GRN history</h2>
        {!po.grns.length ? (
          <p className="mt-2 text-sm text-slate-600" data-testid="rm-po-no-grn">
            No GRN posted yet. Use Create GRN when stock arrives.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {po.grns.map((g) => (
              <GrnHistoryCard
                key={g.id}
                grn={g as GrnExtended}
                po={po}
                trace={trace}
                isAdmin={isAdmin}
                reversingGrnId={reversingGrnId}
                onReverse={onReverseGrn}
              />
            ))}
          </div>
        )}
      </section>

      {/* Summary footer */}
      <footer className="bg-slate-50 px-4 py-4 md:px-6" data-testid="rm-po-document-footer">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Receipt summary</h2>
            <dl className="mt-2 space-y-1 text-sm text-slate-800">
              <div className="flex justify-between gap-4">
                <dt>Total ordered</dt>
                <dd className="tabular-nums font-semibold">
                  {receiveInfo ? `${receiveInfo.ordered.toFixed(3)}${poPrimaryUnit ? ` ${poPrimaryUnit}` : ""}` : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Total received</dt>
                <dd className="tabular-nums font-semibold">
                  {receiveInfo ? `${receiveInfo.received.toFixed(3)}${poPrimaryUnit ? ` ${poPrimaryUnit}` : ""}` : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Total pending</dt>
                <dd className="tabular-nums font-semibold">
                  {receiveInfo ? `${receiveInfo.pending.toFixed(3)}${poPrimaryUnit ? ` ${poPrimaryUnit}` : ""}` : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4 text-slate-600">
                <dt>Billing pending qty</dt>
                <dd className="tabular-nums">{billingTotals.pendingBilling.toFixed(3)}</dd>
              </div>
            </dl>
          </div>
          <div>
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Commercial total</h2>
            <dl className="mt-2 space-y-1 text-sm text-slate-800">
              <div className="flex justify-between gap-4">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">₹ {subtotal.toFixed(2)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Tax (est.)</dt>
                <dd className="tabular-nums">₹ {totalGst.toFixed(2)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-slate-200 pt-1 font-bold">
                <dt>Grand total (est.)</dt>
                <dd className="tabular-nums">₹ {grandTotal.toFixed(2)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </footer>
    </article>
  );
}
