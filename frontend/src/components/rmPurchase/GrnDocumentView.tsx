import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import { getApiUrl } from "../../services/api";
import { printGrnDocumentSection } from "../../lib/grnDocumentActions";
import {
  formatGrnBillingStatusRow,
  formatGrnDocumentDate,
  formatGrnQty,
  formatGrnSignatoryForLine,
  grnReceiptStatusDisplay,
  groupGrnTraceLines,
  resolveGrnBillPresentation,
  resolveGrnCompanyHeader,
  resolveGrnVendorAddressLines,
  stockPostingStatusLabel,
  stateDisplay,
  type GrnCompanyProfile,
  type GrnDocumentPayload,
} from "../../lib/grnDocument";
import { VENDOR_ADDRESS_MISSING_WARNING } from "../../lib/rmPoSupplierDocument";

export type GrnDocumentViewProps = {
  detail: GrnDocumentPayload;
  companyProfile: GrnCompanyProfile | null;
  poHref: string;
  isAdmin: boolean;
  reversing: boolean;
  onReverse?: () => void;
};

function PartyBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grn-party-panel min-w-0 rounded border border-slate-300 bg-white px-3 py-2 print:rounded-none print:border-slate-300 print:px-2.5 print:py-1.5">
      <div className="grn-section-title procurement-doc-section-heading font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-1 space-y-0.5">{children}</div>
    </div>
  );
}

function PartyField({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  const text = (value ?? "").trim();
  if (!text) return null;
  return (
    <div className="procurement-doc-body-text flex gap-2 leading-snug">
      <span className="w-[5.5rem] shrink-0 font-medium text-slate-500 print:w-[4.5rem]">{label}</span>
      <span className={cn("min-w-0 text-slate-800", mono && "font-mono text-[11px]")}>{text}</span>
    </div>
  );
}

function VendorAddressBlock({ lines }: { lines: string[] }) {
  if (!lines.length) {
    return (
      <div
        className="grn-screen-only rounded border border-amber-200 bg-amber-50/90 px-2 py-1.5 text-[11px] leading-snug text-amber-900"
        data-testid="grn-vendor-address-warning"
      >
        {VENDOR_ADDRESS_MISSING_WARNING}
      </div>
    );
  }
  return (
    <div className="procurement-doc-body-text space-y-0.5 leading-snug text-slate-700" data-testid="grn-vendor-address">
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}

function MetaField({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-[8.5rem]">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 print:text-[8pt]">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-900 print:text-[9pt]">{children ?? value ?? "—"}</div>
    </div>
  );
}

function TraceBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 text-sm font-medium text-slate-800">
      {children}
    </span>
  );
}

export function GrnDocumentView({
  detail,
  companyProfile,
  poHref,
  isAdmin,
  reversing,
  onReverse,
}: GrnDocumentViewProps) {
  const { grn, po, supplier, supplyLocation, lines, stockPostingSummary, purchaseBillSummary, trace } = detail;
  const companyHeader = resolveGrnCompanyHeader(companyProfile);
  const vendorAddress = resolveGrnVendorAddressLines(supplier, supplyLocation);
  const billPresentation = resolveGrnBillPresentation(purchaseBillSummary, lines);
  const traceGroups = groupGrnTraceLines(trace?.lines ?? []);
  const logoUrl = companyProfile?.hasLogo ? `${getApiUrl("/api/company-profile/logo/file")}?v=grn` : null;
  const receiptStatus = grnReceiptStatusDisplay(grn.isReversed);
  const invoiceDate = (grn.supplierInvoiceDate ?? "").trim();
  const receivedBy = (grn.receivedBy ?? "").trim();
  const remarks = (grn.remarks ?? "").trim();

  return (
    <article className="mx-auto max-w-5xl overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md" data-testid="grn-document">
      <div className="grn-no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm">
        <p className="text-sm font-bold uppercase tracking-wide text-slate-700">Goods Receipt Note</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" data-testid="grn-print-btn" onClick={() => printGrnDocumentSection()}>
            <Printer className="h-4 w-4" />
            Print / Save as PDF
          </Button>
          <Link
            to={poHref}
            data-testid="grn-back-po-btn"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5 no-underline")}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to PO
          </Link>
          {isAdmin && !grn.isReversed && onReverse ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="grn-reverse-btn"
              disabled={reversing}
              onClick={onReverse}
            >
              {reversing ? "Reversing…" : "Reverse GRN"}
            </Button>
          ) : null}
        </div>
      </div>

      <div id="grn-document-printable" data-testid="grn-document-section" className="grn-document-doc procurement-commercial-doc bg-white text-slate-900">
        <div
          className="procurement-doc-grid procurement-doc-print-inner"
          data-testid="procurement-doc-grid"
        >
        <header className="procurement-doc-section border-b border-slate-300 py-2.5 print:py-0" data-testid="grn-document-header">
          <div className="border-b border-slate-300 pb-3 print:pb-2" data-testid="grn-document-title-block">
            <h1 className="grn-document-title procurement-doc-title text-center font-bold uppercase tracking-[0.12em] text-slate-950">
              Goods Receipt Note
            </h1>
          </div>

          <div className="mt-4 flex flex-wrap items-start justify-between gap-5 md:gap-6 print:mt-3 print:gap-4">
            <div className="flex min-w-0 items-start gap-3 print:gap-2">
              {logoUrl ? (
                <img src={logoUrl} alt="" className="h-11 w-auto max-w-[100px] object-contain print:h-9" data-testid="grn-company-logo" />
              ) : null}
              <div className="min-w-0" data-testid="grn-company-header">
                <div className="grn-company-name-text procurement-doc-section-heading text-[13px] font-bold text-slate-950" data-testid="grn-company-name">
                  {companyHeader.companyName}
                </div>
                <div className="procurement-doc-body-text mt-0.5 space-y-0.5 leading-snug text-slate-700">
                  {companyHeader.addressLines.length ? (
                    companyHeader.addressLines.map((line, i) => <div key={i}>{line}</div>)
                  ) : null}
                </div>
                {companyHeader.gstin ? (
                  <div className="procurement-doc-body-text mt-1 text-slate-600">
                    <span className="font-medium text-slate-700">GSTIN:</span>{" "}
                    <span className="font-mono">{companyHeader.gstin}</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div
              className="grid grid-cols-2 gap-x-5 gap-y-2 print:gap-x-3 print:gap-y-1"
              data-testid="grn-header-meta"
            >
              <MetaField label="GRN No." value={grn.displayNo} />
              <MetaField label="GRN Date" value={formatGrnDocumentDate(grn.date)} />
              <MetaField label="PO Reference">
                <Link to={poHref} className="grn-no-print text-primary underline">
                  {po.displayNo}
                </Link>
                <span className="hidden print:inline">{po.displayNo}</span>
              </MetaField>
              <MetaField label="Status" value={receiptStatus} />
            </div>
          </div>

          <span
            className={cn(
              "grn-screen-only mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase",
              grn.isReversed ? "border-slate-300 bg-slate-100 text-slate-700" : "border-emerald-300 bg-emerald-50 text-emerald-900",
            )}
            data-testid="grn-status-badge"
          >
            {receiptStatus}
          </span>
        </header>

        <section className="procurement-doc-section procurement-doc-party-grid border-b border-slate-300 py-2 print:gap-2 print:py-1.5" data-testid="grn-party-blocks">
          <PartyBlock title="Vendor">
            <PartyField label="Name" value={supplier?.name} />
            {supplyLocation?.label ? <PartyField label="Supply" value={supplyLocation.label} /> : null}
            <VendorAddressBlock lines={vendorAddress} />
            <PartyField label="GSTIN" value={supplier?.gstin ?? supplyLocation?.gstin} mono />
            <PartyField
              label="State"
              value={stateDisplay(supplier?.stateCode ?? supplyLocation?.stateCode, supplier?.stateName ?? supplyLocation?.stateName)}
            />
          </PartyBlock>
          <PartyBlock title="Receipt Details">
            <PartyField label="Invoice No." value={grn.supplierInvoiceNo} />
            {invoiceDate ? <PartyField label="Invoice Date" value={formatGrnDocumentDate(invoiceDate)} /> : null}
            <PartyField label="GRN Date" value={formatGrnDocumentDate(grn.date)} />
            <PartyField label="PO Ref." value={`${po.displayNo} (${po.status})`} />
            {receivedBy ? <PartyField label="Received By" value={receivedBy} /> : null}
            {remarks ? <PartyField label="Remarks" value={remarks} /> : null}
            <PartyField label="GRN Status" value={receiptStatus} />
          </PartyBlock>
        </section>

        <section className="procurement-doc-section procurement-doc-table-section border-b border-slate-200 print:block" data-testid="grn-lines-table">
          <table className="grn-doc-table w-full border-collapse">
            <thead>
              <tr className="grn-doc-table-head border-b border-slate-300 bg-slate-50 text-left procurement-doc-section-heading font-semibold uppercase tracking-wide text-slate-600">
                <th className="grn-col-screen-only w-9 px-2 py-1.5">Sr</th>
                <th className="px-2 py-1.5">Item</th>
                <th className="px-2 py-1.5">HSN</th>
                <th className="px-2 py-1.5">Unit</th>
                <th className="grn-col-screen-only grn-qty-cell procurement-doc-nowrap px-2 py-1.5 text-right">PO Qty</th>
                <th className="grn-col-screen-only grn-qty-cell procurement-doc-nowrap px-2 py-1.5 text-right">Previously Received</th>
                <th className="grn-col-screen-only grn-qty-cell procurement-doc-nowrap px-2 py-1.5 text-right">Received Now</th>
                <th className="grn-col-screen-only grn-qty-cell procurement-doc-nowrap px-2 py-1.5 text-right">Total Received</th>
                <th className="grn-col-screen-only grn-qty-cell procurement-doc-nowrap px-2 py-1.5 text-right">Balance Qty</th>
                <th className="grn-col-print-only grn-qty-cell procurement-doc-nowrap px-2 py-1.5 text-right">Received Qty</th>
                <th className="procurement-doc-nowrap px-2 py-1.5">Location</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((ln, idx) => (
                <tr key={ln.id} className="border-b border-slate-200">
                  <td className="grn-col-screen-only px-2 py-1.5 tabular-nums text-slate-600">{idx + 1}</td>
                  <td className="px-2 py-1.5 font-medium text-slate-900">{ln.item?.itemName ?? "—"}</td>
                  <td className="px-2 py-1.5 font-mono">{ln.item?.hsn || "—"}</td>
                  <td className="px-2 py-1.5">{ln.item?.unit || "—"}</td>
                  <td className="grn-col-screen-only grn-qty-cell procurement-doc-nowrap px-2 py-1.5 text-right tabular-nums font-semibold">{formatGrnQty(ln.poQty, ln.item?.unit)}</td>
                  <td className="grn-col-screen-only grn-qty-cell procurement-doc-nowrap px-2 py-1.5 text-right tabular-nums">{formatGrnQty(ln.previouslyReceivedQty, ln.item?.unit)}</td>
                  <td className="grn-col-screen-only grn-qty-cell procurement-doc-nowrap px-2 py-1.5 text-right tabular-nums font-bold text-emerald-800">{formatGrnQty(ln.thisGrnQty, ln.item?.unit)}</td>
                  <td className="grn-col-screen-only grn-qty-cell procurement-doc-nowrap px-2 py-1.5 text-right tabular-nums">{formatGrnQty(ln.totalReceivedQty, ln.item?.unit)}</td>
                  <td className="grn-col-screen-only grn-qty-cell procurement-doc-nowrap px-2 py-1.5 text-right tabular-nums text-amber-800">{formatGrnQty(ln.pendingQty, ln.item?.unit)}</td>
                  <td className="grn-col-print-only grn-qty-cell procurement-doc-nowrap px-2 py-1.5 text-right tabular-nums font-semibold">{formatGrnQty(ln.thisGrnQty, ln.item?.unit)}</td>
                  <td className="procurement-doc-nowrap px-2 py-1.5 text-slate-700">{ln.location?.name ?? ln.location?.code ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="procurement-doc-section grn-screen-only border-b border-slate-200 py-2" data-testid="grn-stock-summary">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Stock Posting Summary</div>
          <table className="grn-doc-table mt-1 w-full border-collapse text-xs text-slate-700">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-[10px] font-medium uppercase tracking-wide text-slate-500">
                <th className="px-2 py-1">Item</th>
                <th className="px-2 py-1">Location</th>
                <th className="px-2 py-1 text-right">Posted Qty</th>
                <th className="w-24 px-2 py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {stockPostingSummary.map((row) => (
                <tr key={row.grnLineId} className="border-b border-slate-100">
                  <td className="px-2 py-1 font-medium text-slate-800">{row.itemName ?? "—"}</td>
                  <td className="px-2 py-1 text-slate-600">{row.location?.name ?? row.location?.code ?? "—"}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{row.qtyPosted.toFixed(3)}</td>
                  <td className="px-2 py-1 text-slate-600">{stockPostingStatusLabel(row.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="procurement-doc-section border-b border-slate-200 py-1.5 print:py-0.5" data-testid="grn-bill-status">
          <div className="procurement-doc-trailing-section grn-print-only">
            <p
              className="procurement-doc-trailing-block procurement-doc-totals text-right font-medium text-slate-900"
              data-testid="grn-bill-status-print"
            >
              {formatGrnBillingStatusRow(billPresentation.statusLabel)}
            </p>
          </div>
          <div className="grn-screen-only">
            <div className="grn-section-title text-[11px] font-semibold uppercase tracking-wide text-slate-500">Purchase Bill Status</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="grn-bill-status-summary">
              <PartyField label="Status" value={billPresentation.statusLabel} />
              {billPresentation.billNo ? <PartyField label="Bill No." value={billPresentation.billNo} mono /> : null}
            </div>
            {billPresentation.showLineBreakdown ? (
              <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-sm text-slate-700" data-testid="grn-bill-line-breakdown">
                {billPresentation.lineBreakdown.map((row) => (
                  <li key={row.itemName}>
                    {row.itemName}: {row.statusLabel}
                    {row.billNo ? ` — ${row.billNo}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>

        {grn.isReversed ? (
          <section
            className="grn-screen-only border-b border-amber-200 bg-amber-50 px-4 py-2.5 md:px-6"
            data-testid="grn-reversal-section"
          >
            <div className="grn-section-title text-[11px] font-semibold uppercase tracking-wide text-amber-800">Reversal</div>
            <p className="mt-1 text-sm text-amber-950">Reversed on: {formatGrnDocumentDate(grn.reversedAt)}</p>
            {grn.reversalReason ? (
              <p className="mt-1 text-sm text-amber-950">
                <span className="font-semibold">Reason:</span> {grn.reversalReason}
              </p>
            ) : null}
            <p className="mt-1 text-sm font-medium text-amber-900">Stock reversal completed</p>
          </section>
        ) : null}

        <section className="procurement-doc-section procurement-doc-trailing-section py-1.5 print:py-0.5" data-testid="grn-signatory">
            <div className="procurement-doc-trailing-block grn-signatory-block text-right">
              <p
                className="grn-signatory-company procurement-doc-body-text font-medium leading-snug text-slate-800"
                data-testid="grn-signatory-for-line"
              >
                {formatGrnSignatoryForLine(companyHeader.companyName)}
              </p>
              <div className="grn-signatory-line mb-3 mt-4 border-b border-slate-400" aria-hidden />
              <p className="grn-signatory-label procurement-doc-section-heading font-semibold uppercase tracking-wide text-slate-600">
                Authorized Signatory
              </p>
            </div>
        </section>

        <footer className="procurement-doc-section grn-print-only hidden border-t border-slate-200 py-1 text-center text-[10px] italic text-slate-500 print:block print:py-0.5 print:text-[8pt]" data-testid="grn-print-footer">
          This is a system generated goods receipt note.
        </footer>
        </div>
      </div>

      <div className="grn-internal-section border-t-4 border-violet-200 bg-violet-50/20" data-testid="grn-internal-trace-section">
        <div className="border-b border-violet-100 bg-violet-50/60 px-4 py-3 md:px-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-800">Internal procurement traceability</h2>
          <p className="mt-1 text-sm text-slate-700">Demand source linkage for this GRN (not included in supplier print).</p>
        </div>
        <div className="space-y-4 p-4 md:px-6" data-testid="grn-trace-groups">
          {traceGroups.map((group) => (
            <div key={group.key} className="rounded-lg border border-violet-200 bg-white p-4" data-testid="grn-trace-group">
              <div className="text-sm text-slate-800">
                <span className="font-semibold text-slate-600">Demand:</span> {group.demandLabel}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-800">
                {group.mrDocNo ? (
                  <span>
                    <span className="font-semibold text-slate-600">MR:</span> {group.mrDocNo}
                  </span>
                ) : null}
                {group.prDocNo ? (
                  <span>
                    <span className="font-semibold text-slate-600">PR:</span> {group.prDocNo}
                  </span>
                ) : null}
                {group.woDocNo ? (
                  <span>
                    <span className="font-semibold text-slate-600">WO:</span> {group.woDocNo}
                  </span>
                ) : null}
                {group.soDocNo ? (
                  <span>
                    <span className="font-semibold text-slate-600">SO:</span> {group.soDocNo}
                  </span>
                ) : null}
              </div>
              {group.traceChain.length ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {group.traceChain.map((step, i) => (
                    <React.Fragment key={`${step}-${i}`}>
                      {i > 0 ? <span className="text-slate-400">→</span> : null}
                      <TraceBadge>{step}</TraceBadge>
                    </React.Fragment>
                  ))}
                </div>
              ) : null}
              <p className="mt-2 text-sm text-slate-700">
                <span className="font-semibold text-slate-600">Items:</span> {group.itemNames.join(", ")}
              </p>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
