import * as React from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Eye } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import { buildProcurementWorkspaceHref } from "../../lib/woProcurementContinuity";
import { buildGrnDetailHref } from "../../lib/grnDocumentActions";
import { buildPurchaseBillDetailHref, resolvePrimaryPurchaseBill } from "../../lib/procurementNavigation";
import { PROCUREMENT_TERMS } from "../../lib/procurementTerminology";
import { demandPoolLabelForSourceType } from "../../lib/procurementTraceTerminology";
import type { RmPoCompanyProfile } from "../../lib/rmPoSupplierDocument";
import {
  demandPoolKeyForSourceType,
  demandSourceDisplay,
  formatPoDocumentDate,
  formatTraceQty,
  lineBillStatusLabel,
  lineReceiptStatusLabel,
  poTraceChainSummary,
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

export type RmPoInternalTraceabilityViewProps = {
  po: RmPoRow;
  companyProfile: RmPoCompanyProfile | null;
  trace: RmPoTracePayload | null;
  traceError: string | null;
  receiveInfo: { ordered: number; received: number; pending: number } | null;
  billingTotals: { billed: number; pendingBilling: number; rebillable: number };
  poPrimaryUnit: string;
  stockStatusLabel: string;
  billingStatusLabel: string;
  isAdmin: boolean;
  reversingGrnId: number;
  onReverseGrn?: (grnId: number) => void;
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-bold uppercase tracking-wide text-slate-800">{children}</h2>;
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

function grnNumbersForTraceLine(traceLine: ReturnType<typeof traceLineByPoLineId>): string {
  if (!traceLine?.grnLines?.length) return "—";
  const labels = [
    ...new Set(
      traceLine.grnLines
        .filter((g) => !g.isReversed)
        .map((g) => g.grnNo?.trim() || `GRN-${g.grnId}`),
    ),
  ];
  return labels.length ? labels.join(", ") : "—";
}

function stockStatusForTraceLine(traceLine: ReturnType<typeof traceLineByPoLineId>): string {
  if (traceLine?.grnLines?.some((g) => !g.isReversed && g.stockTransactions.length)) return "Posted";
  return "Not posted";
}

function mrNumbersForSources(traceLine: ReturnType<typeof traceLineByPoLineId>): string {
  const docs = (traceLine?.demandSources ?? []).map((ds) => ds.mr?.docNo?.trim()).filter(Boolean) as string[];
  return docs.length ? [...new Set(docs)].join(", ") : "—";
}

function prNumbersForSources(traceLine: ReturnType<typeof traceLineByPoLineId>): string {
  const docs = (traceLine?.demandSources ?? []).map((ds) => ds.pr?.docNo?.trim()).filter(Boolean) as string[];
  return docs.length ? [...new Set(docs)].join(", ") : "—";
}

function demandSourcesLabel(traceLine: ReturnType<typeof traceLineByPoLineId>): string {
  const sources = traceLine?.demandSources ?? [];
  if (!sources.length) return "—";
  return [...new Set(sources.map((ds) => demandSourceDisplay(ds)))].join("; ");
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
        const poolKey = demandPoolKeyForSourceType(ds.demandSourceType);
        const procHref =
          mrId && mrId > 0
            ? buildProcurementWorkspaceHref({
                materialRequirementId: mrId,
                workOrderId: ds.workOrder?.id ?? ds.mr?.workOrder?.id,
                salesOrderId: ds.salesOrder?.id ?? ds.mr?.salesOrder?.id,
                demandPool: poolKey ?? undefined,
                returnTo,
              })
            : null;
        const poolLabel = demandPoolLabelForSourceType(ds.demandSourceType);
        const traceSummary = poTraceChainSummary(ds.demandSourceType);
        return (
          <div key={idx} className="rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {poolLabel ? (
                <span className="inline-flex rounded-md bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-950 ring-1 ring-violet-200">
                  {poolLabel}
                </span>
              ) : null}
              <span className="text-[11px] font-medium text-slate-600">{traceSummary}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-800">
              <span>
                <span className="font-semibold text-slate-600">{PROCUREMENT_TERMS.PROCUREMENT_SOURCE_LABEL}:</span>{" "}
                {demandSourceDisplay(ds)}
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
            </div>
          </div>
        );
      })}
      {traceLine?.traceChain?.length ? <TraceChainInline chain={traceLine.traceChain} /> : null}
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
  onReverse?: (id: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const traceGrn = trace?.grns?.find((g) => g.id === grn.id);
  const lineDetails = (trace?.lines ?? []).flatMap((tl) =>
    (tl.grnLines ?? [])
      .filter((gl) => gl.grnId === grn.id)
      .map((gl) => {
        const primaryBill = resolvePrimaryPurchaseBill(gl.purchaseBillLines);
        return {
          itemName: tl.item?.itemName ?? `Line #${tl.id}`,
          receivedQty: gl.receivedQty,
          location: gl.location?.name ?? gl.location?.code ?? null,
          stockPosted: gl.stockTransactions.length > 0,
          billId: primaryBill?.id ?? null,
          billNo: primaryBill?.billNo ?? null,
        };
      }),
  );

  if (!lineDetails.length) {
    for (const gl of grn.lines) {
      const poLine = po.lines.find((l) => l.id === gl.rmPoLineId);
      lineDetails.push({
        itemName: poLine?.item?.itemName ?? `Line #${gl.rmPoLineId}`,
        receivedQty: Number(gl.receivedQty),
        location: gl.location?.locationName ?? gl.location?.locationCode ?? null,
        stockPosted: false,
        billId: null,
        billNo: null,
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
          <span className="text-sm text-slate-600">
            {lineDetails.length} line{lineDetails.length === 1 ? "" : "s"} · {receivedTotal.toFixed(3)} received
          </span>
        </div>
        <div className="rm-po-no-print flex shrink-0 flex-wrap items-center gap-2">
          <Link
            to={buildGrnDetailHref(grn.id)}
            data-testid={`grn-open-${grn.id}`}
            onClick={(e) => e.stopPropagation()}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 px-3 text-sm no-underline")}
          >
            <Eye className="h-3.5 w-3.5" />
            Open GRN
          </Link>
          {isAdmin && !grn.reversedAt && onReverse ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-3 text-sm"
              disabled={reversingGrnId === grn.id}
              onClick={(e) => {
                e.stopPropagation();
                onReverse(grn.id);
              }}
            >
              {reversingGrnId === grn.id ? "Reversing…" : "Reverse"}
            </Button>
          ) : null}
        </div>
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
                  <td className="py-2 text-slate-700">
                    {ln.billId ? (
                      <Link to={buildPurchaseBillDetailHref(ln.billId)} className="text-primary underline">
                        {ln.billNo ?? `PB-${ln.billId}`}
                      </Link>
                    ) : (
                      "Not billed"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function RmPoInternalTraceabilityView({
  po,
  companyProfile,
  trace,
  traceError,
  receiveInfo,
  billingTotals,
  poPrimaryUnit,
  stockStatusLabel,
  billingStatusLabel,
  isAdmin,
  reversingGrnId,
  onReverseGrn,
}: RmPoInternalTraceabilityViewProps) {
  const returnTo = `/rm-po-grn/${po.id}/traceability`;
  const poNo = formatRmPoNo(po.id);
  const supplierName = trace?.supplier?.name ?? po.supplier?.name ?? "—";
  const poDate = formatPoDocumentDate(trace?.rmPo?.createdAt);
  const primaryDemand = po.lines
    .map((ln) => demandSourcesLabel(traceLineByPoLineId(trace, ln.id)))
    .find((v) => v !== "—");

  return (
    <article
      id="rm-po-traceability-printable"
      className="rm-po-traceability-doc mx-auto max-w-6xl overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md"
      data-testid="rm-po-internal-trace-section"
    >
      <header className="rm-po-traceability-print-header hidden border-b border-slate-200 px-6 py-4 print:block">
        <p className="text-lg font-bold text-slate-900">{companyProfile?.companyName ?? "Company"}</p>
        {companyProfile?.companyAddressLine1 ? (
          <p className="text-sm text-slate-700">{companyProfile.companyAddressLine1}</p>
        ) : null}
        <h1 className="mt-3 text-xl font-bold uppercase tracking-wide text-slate-900">Internal Procurement Traceability</h1>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-800">
          <div>
            <dt className="inline font-semibold">RM PO: </dt>
            <dd className="inline">{poNo}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Supplier: </dt>
            <dd className="inline">{supplierName}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Date: </dt>
            <dd className="inline">{poDate}</dd>
          </div>
          {primaryDemand ? (
            <div>
              <dt className="inline font-semibold">Demand source: </dt>
              <dd className="inline">{primaryDemand}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      <div className="border-b border-violet-100 bg-violet-50/60 px-4 py-3 md:px-6 rm-po-no-print">
        <SectionHeading>Internal Procurement Traceability</SectionHeading>
        <p className="mt-1 text-sm text-slate-700">
          Store / Purchase audit view — Monthly Plan → MR → PR → RMPO → GRN → Stock IN → Billing
        </p>
      </div>

      {traceError ? (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:px-6">
          Trace data unavailable: {traceError}. Showing receipt data from PO only.
        </p>
      ) : null}

      <section className="border-b border-violet-100 px-2 py-3 md:px-4" data-testid="rm-po-audit-table">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-left text-[11px] md:text-xs">
            <thead>
              <tr className="border-b border-violet-200 bg-violet-50/80 text-[10px] font-bold uppercase tracking-wide text-slate-700">
                <th className="px-2 py-2">RM item</th>
                <th className="px-2 py-2 text-right">Ordered</th>
                <th className="px-2 py-2 text-right">Received</th>
                <th className="px-2 py-2 text-right">Pending</th>
                <th className="px-2 py-2">Receipt</th>
                <th className="px-2 py-2">Demand source</th>
                <th className="px-2 py-2">MR</th>
                <th className="px-2 py-2">PR</th>
                <th className="px-2 py-2">RMPO</th>
                <th className="px-2 py-2">GRN</th>
                <th className="px-2 py-2">Stock</th>
                <th className="px-2 py-2">Billing</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((ln) => {
                const traceLine = traceLineByPoLineId(trace, ln.id);
                const received = traceLine?.receivedQty ?? receivedForLine(po, ln.id);
                const ordered = Number(ln.qty);
                const pending = Math.max(0, ordered - received);
                return (
                  <tr key={ln.id} className="border-b border-violet-50 align-top">
                    <td className="px-2 py-2 font-semibold text-slate-950">{ln.item?.itemName ?? `Item #${ln.itemId}`}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{ordered.toFixed(3)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-emerald-800">{received.toFixed(3)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-amber-800">{pending.toFixed(3)}</td>
                    <td className="px-2 py-2">{lineReceiptStatusLabel(ordered, received, pending)}</td>
                    <td className="px-2 py-2">
                      <div>{demandSourcesLabel(traceLine)}</div>
                      {(traceLine?.soAllocationBreakdown?.length ?? 0) > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600">
                          {traceLine!.soAllocationBreakdown!.map((row, idx) => (
                            <li key={`${row.salesOrderId ?? row.salesOrderDocNo}-${idx}`}>
                              {(row.salesOrderDocNo || `SO #${row.salesOrderId}`) +
                                `: ${Number(row.allocatedQty).toFixed(3)}`}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {Number(traceLine?.excessToStockQty ?? 0) > 1e-9 ? (
                        <p className="mt-1 text-[11px] font-medium text-emerald-800">
                          Extra to RM Stock: {Number(traceLine!.excessToStockQty).toFixed(3)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">{mrNumbersForSources(traceLine)}</td>
                    <td className="px-2 py-2">{prNumbersForSources(traceLine)}</td>
                    <td className="px-2 py-2">{poNo}</td>
                    <td className="px-2 py-2">{grnNumbersForTraceLine(traceLine)}</td>
                    <td className="px-2 py-2">{stockStatusForTraceLine(traceLine)}</td>
                    <td className="px-2 py-2">{lineBillStatusLabel(traceLine?.purchaseBillLines ?? [])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="hidden border-b border-violet-100 md:block" data-testid="rm-po-internal-lines-table">
        <table className="w-full border-collapse text-base">
          <tbody>
            {po.lines.map((ln) => {
              return (
                <React.Fragment key={ln.id}>
                  <tr className="border-b border-violet-50 bg-white">
                    <td colSpan={5} className="px-4 py-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-violet-800">Source trace — {ln.item?.itemName}</p>
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

      <section className="border-b border-violet-100 px-4 py-5 md:px-6" data-testid="rm-po-grn-history" id="grn-history">
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
    </article>
  );
}
