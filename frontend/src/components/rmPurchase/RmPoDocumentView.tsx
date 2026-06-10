import * as React from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Download, Eye, Printer } from "lucide-react";
import { Button } from "../ui/button";
import { RmPoSupplierDocument } from "./RmPoSupplierDocument";
import { buildProcurementWorkspaceHref } from "../../lib/woProcurementContinuity";
import type { RmPoCompanyProfile } from "../../lib/rmPoSupplierDocument";
import {
  exportRmPoPdfPlaceholder,
  printRmPoSupplierSection,
} from "../../lib/rmPoDocumentActions";
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
  formatRmPoNo,
  grnStatusDotClass,
  grnStatusLabel,
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
  companyProfile: RmPoCompanyProfile | null;
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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-bold uppercase tracking-wide text-slate-800">{children}</h2>
  );
}

function TraceBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm font-medium text-slate-800 shadow-sm">
      {children}
    </span>
  );
}

function TraceChainInline({ chain }: { chain: string[] }) {
  if (!chain.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {chain.map((step, i) => (
        <React.Fragment key={`${step}-${i}`}>
          {i > 0 ? <span className="text-base text-slate-400">→</span> : null}
          <TraceBadge>{step}</TraceBadge>
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
    return <p className="text-sm italic text-slate-600">No source trace found</p>;
  }

  return (
    <div className="space-y-3" data-testid={`po-line-trace-${poLineId}`}>
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
          <div key={idx} className="rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2.5">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-800">
              <span>
                <span className="font-semibold text-slate-600">Demand:</span> {demandSourceDisplay(ds)}
              </span>
              {ds.mr?.docNo ? (
                <span>
                  <span className="font-semibold text-slate-600">MR:</span>{" "}
                  {procHref ? (
                    <Link to={procHref} className="font-medium text-primary underline">
                      {ds.mr.docNo}
                    </Link>
                  ) : (
                    ds.mr.docNo
                  )}
                </span>
              ) : null}
              {ds.pr?.docNo ? (
                <span>
                  <span className="font-semibold text-slate-600">PR:</span> {ds.pr.docNo}
                </span>
              ) : null}
              {ds.workOrder?.docNo ? (
                <span>
                  <span className="font-semibold text-slate-600">WO:</span> {ds.workOrder.docNo}
                </span>
              ) : null}
              {ds.salesOrder?.docNo ? (
                <span>
                  <span className="font-semibold text-slate-600">SO:</span> {ds.salesOrder.docNo}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
      {traceLine?.traceChain?.length ? <TraceChainInline chain={traceLine.traceChain} /> : null}
      <div className="flex flex-wrap gap-4 text-sm text-slate-700">
        <span>
          <span className="font-semibold text-slate-600">Stock:</span>{" "}
          {traceLine?.grnLines?.some((g) => !g.isReversed && g.stockTransactions.length)
            ? "Posted"
            : "Not posted"}
        </span>
        <span>
          <span className="font-semibold text-slate-600">Bill:</span>{" "}
          {lineBillStatusLabel(traceLine?.purchaseBillLines ?? [])}
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
    <div className="rounded-lg border border-slate-200 bg-white" data-testid={`grn-card-${grn.id}`}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />}
          <span className="text-base font-semibold text-slate-900">GRN-{grn.id}</span>
          <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            <span className={`inline-block h-2 w-2 rounded-full ${grnStatusDotClass(grn)}`} aria-hidden />
            {grnStatusLabel(grn)}
          </span>
          {traceGrn?.date || grn.date ? (
            <span className="text-sm text-slate-600">{formatPoDocumentDate(traceGrn?.date ?? grn.date)}</span>
          ) : null}
          {traceGrn?.supplierInvoiceNo || grn.supplierInvoiceNo ? (
            <span className="text-sm text-slate-700">
              Inv: {traceGrn?.supplierInvoiceNo ?? grn.supplierInvoiceNo}
            </span>
          ) : null}
          <span className="text-sm text-slate-600">
            {lineDetails.length} line{lineDetails.length === 1 ? "" : "s"} · {receivedTotal.toFixed(3)} received
          </span>
        </div>
        {isAdmin && !grn.reversedAt ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 shrink-0 px-3 text-sm"
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
        <div className="border-t border-slate-100 px-4 py-3 text-sm">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs font-bold uppercase tracking-wide text-slate-600">
                <th className="pb-2">Item</th>
                <th className="pb-2 text-right">Received</th>
                <th className="pb-2">Location</th>
                <th className="pb-2">Stock</th>
                <th className="pb-2">Bill</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lineDetails.map((ln, i) => (
                <tr key={i}>
                  <td className="py-2 font-medium text-slate-900">{ln.itemName}</td>
                  <td className="py-2 text-right tabular-nums font-semibold text-slate-900">{ln.receivedQty.toFixed(3)}</td>
                  <td className="py-2 text-slate-700">{ln.location ?? "—"}</td>
                  <td className="py-2 text-slate-700">{ln.stockPosted ? "Posted" : "Not posted"}</td>
                  <td className="py-2 text-slate-700">{ln.bill ? ln.bill : "Not billed"}</td>
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
  companyProfile,
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
  const [supplierCopyMode, setSupplierCopyMode] = React.useState(false);
  const poNo = formatRmPoNo(po.id);

  return (
    <article
      className="mx-auto max-w-5xl overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md"
      data-testid="rm-po-document"
    >
      {/* Document action bar */}
      <div className="rm-po-no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm">
        <p className="text-sm font-bold uppercase tracking-wide text-slate-700">RM Purchase Order</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-sm"
            data-testid="rm-po-print-btn"
            onClick={() => printRmPoSupplierSection()}
          >
            <Printer className="h-4 w-4" />
            Print
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-sm"
            data-testid="rm-po-export-pdf-btn"
            onClick={() => exportRmPoPdfPlaceholder(poNo)}
          >
            <Download className="h-4 w-4" />
            Export PDF
          </Button>
          <Button
            type="button"
            variant={supplierCopyMode ? "default" : "outline"}
            size="sm"
            className="gap-1.5 text-sm"
            data-testid="rm-po-supplier-copy-btn"
            onClick={() => setSupplierCopyMode((v) => !v)}
          >
            <Eye className="h-4 w-4" />
            {supplierCopyMode ? "Show full view" : "Supplier copy"}
          </Button>
          {grnAllowed ? (
            <Button type="button" size="sm" className="text-sm" data-testid="rm-po-create-grn-btn" onClick={onCreateGrn}>
              Create GRN
            </Button>
          ) : null}
          {canEditPo ? (
            <Button type="button" variant="outline" size="sm" className="text-sm" data-testid="rm-po-edit-btn" onClick={onEdit}>
              Edit order
            </Button>
          ) : null}
          {showCancel ? (
            <Button type="button" variant="outline" size="sm" className="text-sm" data-testid="rm-po-cancel-btn" onClick={onCancel}>
              Cancel order
            </Button>
          ) : null}
        </div>
      </div>

      {supplierCopyMode ? (
        <div className="rm-po-no-print border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900 md:px-6">
          Supplier copy view — internal traceability is hidden. Use Print for a supplier-facing document.
        </div>
      ) : null}

      {/* ─── Section A: Supplier Purchase Order Document ─── */}
      <RmPoSupplierDocument
        po={po}
        poDate={trace?.rmPo?.createdAt}
        companyProfile={companyProfile}
      />

      {/* ─── Section B: Internal procurement traceability ─── */}
      {!supplierCopyMode ? (
        <div
          className="rm-po-internal-section border-t-4 border-violet-200 bg-violet-50/20"
          data-testid="rm-po-internal-trace-section"
        >
          <div className="border-b border-violet-100 bg-violet-50/60 px-4 py-3 md:px-6">
            <SectionHeading>Internal procurement traceability</SectionHeading>
            <p className="mt-1 text-sm text-slate-700">
              Store / Purchase audit view — demand source, receipt status, GRN, stock, and bill linkage.
            </p>
          </div>

          {traceError ? (
            <p className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:px-6">
              Trace data unavailable: {traceError}. Showing receipt data from PO only.
            </p>
          ) : null}

          <section className="hidden border-b border-violet-100 md:block" data-testid="rm-po-internal-lines-table">
            <table className="w-full border-collapse text-base">
              <thead>
                <tr className="border-b border-violet-100 bg-violet-50/80 text-left text-xs font-bold uppercase tracking-wide text-slate-700">
                  <th className="px-4 py-3">RM item</th>
                  <th className="px-3 py-3 text-right">Ordered</th>
                  <th className="px-3 py-3 text-right">Received</th>
                  <th className="px-3 py-3 text-right">Pending</th>
                  <th className="px-4 py-3">Receipt status</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((ln) => {
                  const received = traceLineByPoLineId(trace, ln.id)?.receivedQty ?? receivedForLine(po, ln.id);
                  const ordered = Number(ln.qty);
                  const pending = Math.max(0, ordered - received);
                  return (
                    <React.Fragment key={ln.id}>
                      <tr className="border-b border-violet-50 bg-white">
                        <td className="px-4 py-3 font-semibold text-slate-950">{ln.item?.itemName ?? `Item #${ln.itemId}`}</td>
                        <td className="px-3 py-3 text-right font-bold tabular-nums text-slate-900">{ordered.toFixed(3)}</td>
                        <td className="px-3 py-3 text-right font-bold tabular-nums text-emerald-800">{received.toFixed(3)}</td>
                        <td className="px-3 py-3 text-right font-bold tabular-nums text-amber-800">{pending.toFixed(3)}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                          {lineReceiptStatusLabel(ordered, received, pending)}
                        </td>
                      </tr>
                      <tr className="border-b border-violet-100 bg-violet-50/30">
                        <td colSpan={5} className="px-4 py-4">
                          <p className="text-xs font-bold uppercase tracking-wide text-violet-800">Source trace</p>
                          <LineSourceTrace poLineId={ln.id} trace={trace} returnTo={returnTo} />
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="space-y-4 border-b border-violet-100 p-4 md:hidden" data-testid="rm-po-line-cards">
            {po.lines.map((ln) => {
              const received = traceLineByPoLineId(trace, ln.id)?.receivedQty ?? receivedForLine(po, ln.id);
              const ordered = Number(ln.qty);
              const pending = Math.max(0, ordered - received);
              return (
                <div key={ln.id} className="rounded-lg border border-violet-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-base font-semibold text-slate-950">{ln.item?.itemName}</p>
                    <span className="text-sm font-semibold text-slate-700">
                      {lineReceiptStatusLabel(ordered, received, pending)}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="block text-xs font-semibold uppercase text-slate-500">Ordered</span>
                      <span className="text-base font-bold tabular-nums">{formatTraceQty(ordered, ln.unit)}</span>
                    </div>
                    <div>
                      <span className="block text-xs font-semibold uppercase text-slate-500">Received</span>
                      <span className="text-base font-bold tabular-nums text-emerald-800">{formatTraceQty(received, ln.unit)}</span>
                    </div>
                    <div>
                      <span className="block text-xs font-semibold uppercase text-slate-500">Pending</span>
                      <span className="text-base font-bold tabular-nums text-amber-800">{formatTraceQty(pending, ln.unit)}</span>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-violet-100 pt-3">
                    <LineSourceTrace poLineId={ln.id} trace={trace} returnTo={returnTo} />
                  </div>
                </div>
              );
            })}
          </section>

          <section className="border-b border-violet-100 px-4 py-5 md:px-6" data-testid="rm-po-grn-history">
            <SectionHeading>GRN history</SectionHeading>
            <p className="mt-1 text-sm text-slate-600">
              Stock: {stockStatusLabel} · Purchase billing: {billingStatusLabel}
            </p>
            {!po.grns.length ? (
              <p className="mt-3 text-base text-slate-700" data-testid="rm-po-no-grn">
                No GRN posted yet.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
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

          <footer className="px-4 py-5 md:px-6" data-testid="rm-po-internal-footer">
            <SectionHeading>Receipt summary (internal)</SectionHeading>
            <dl className="mt-3 max-w-md space-y-2 text-base text-slate-900">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-700">Total ordered</dt>
                <dd className="tabular-nums font-bold">
                  {receiveInfo ? `${receiveInfo.ordered.toFixed(3)}${poPrimaryUnit ? ` ${poPrimaryUnit}` : ""}` : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-700">Total received</dt>
                <dd className="tabular-nums font-bold text-emerald-800">
                  {receiveInfo ? `${receiveInfo.received.toFixed(3)}${poPrimaryUnit ? ` ${poPrimaryUnit}` : ""}` : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-700">Total pending</dt>
                <dd className="tabular-nums font-bold text-amber-800">
                  {receiveInfo ? `${receiveInfo.pending.toFixed(3)}${poPrimaryUnit ? ` ${poPrimaryUnit}` : ""}` : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4 text-slate-700">
                <dt>Billing pending qty</dt>
                <dd className="tabular-nums font-semibold">{billingTotals.pendingBilling.toFixed(3)}</dd>
              </div>
            </dl>
          </footer>
        </div>
      ) : null}
    </article>
  );
}
