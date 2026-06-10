import * as React from "react";
import { getApiUrl } from "../../services/api";
import { cn } from "../../lib/utils";
import { formatPoDocumentDate } from "../../lib/rmPoDocumentTrace";
import { formatRmPoNo, poStatusDotClass, poStatusLabel, type RmPoRow } from "../../pages/rmPurchase/rmPurchaseShared";
import {
  computeRmPoCommercialTotals,
  formatPoMoney,
  hasStateValue,
  lineAmount,
  resolveRmPoDeliverToBlock,
  resolveRmPoTaxDisplay,
  formatProcurementSignatoryForLine,
  resolveRmPoVendorBlock,
  stateDisplay,
  VENDOR_ADDRESS_MISSING_WARNING,
  type RmPoCompanyProfile,
  type RmPoDeliverToBlock,
  type RmPoTaxDisplay,
  type RmPoVendorBlock,
} from "../../lib/rmPoSupplierDocument";

type Props = {
  po: RmPoRow;
  poDate?: string | null;
  companyProfile: RmPoCompanyProfile | null;
  className?: string;
};

function PartyBlock({
  title,
  testId,
  children,
}: {
  title: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rm-po-party-panel min-w-0 rounded border border-slate-300 bg-white px-3 py-2 print:px-2.5 print:py-1.5"
      data-testid={testId}
    >
      <div className="procurement-doc-section-heading font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-1 space-y-0.5">{children}</div>
    </div>
  );
}

function PartyField({
  label,
  value,
  mono = false,
  testId,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  testId?: string;
}) {
  const text = (value ?? "").trim();
  if (!text) return null;
  return (
    <div className="procurement-doc-body-text flex gap-2 leading-snug" data-testid={testId}>
      <span className="w-[4.25rem] shrink-0 font-medium text-slate-500">{label}</span>
      <span className={cn("min-w-0 text-slate-800", mono && "font-mono text-[11px]")}>{text}</span>
    </div>
  );
}

function AddressBlock({
  lines,
  missingWarning,
  testId,
}: {
  lines: string[];
  missingWarning?: string;
  testId?: string;
}) {
  if (!lines.length) {
    return (
      <div
        className="rm-po-screen-only rounded border border-amber-200 bg-amber-50/90 px-2 py-1.5 text-[11px] leading-snug text-amber-900"
        data-testid={testId ?? "rm-po-address-missing-warning"}
      >
        {missingWarning}
      </div>
    );
  }
  return (
    <div className="procurement-doc-body-text space-y-0.5 leading-snug text-slate-700" data-testid={testId}>
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}

function VendorParty({ vendor }: { vendor: RmPoVendorBlock }) {
  const stateText = stateDisplay(vendor.stateCode, vendor.stateName);
  return (
    <PartyBlock title="Vendor" testId="rm-po-vendor-block">
      <PartyField label="Name" value={vendor.name} testId="rm-po-vendor-name" />
      {vendor.supplyLabel ? (
        <PartyField label="Supply" value={vendor.supplyLabel} testId="rm-po-vendor-supply" />
      ) : null}
      <div className="pt-0.5">
        <AddressBlock
          lines={vendor.addressLines}
          missingWarning={VENDOR_ADDRESS_MISSING_WARNING}
          testId="rm-po-vendor-address"
        />
      </div>
      <PartyField label="GSTIN" value={vendor.gstin} mono testId="rm-po-vendor-gstin" />
      {hasStateValue(vendor.stateCode, vendor.stateName) ? (
        <PartyField label="State" value={stateText} testId="rm-po-vendor-state" />
      ) : null}
      <PartyField label="Contact" value={vendor.contact} testId="rm-po-vendor-contact" />
      <PartyField label="Phone" value={vendor.phone} testId="rm-po-vendor-phone" />
      <PartyField label="Email" value={vendor.email} testId="rm-po-vendor-email" />
    </PartyBlock>
  );
}

function DeliverToParty({ deliverTo }: { deliverTo: RmPoDeliverToBlock }) {
  const stateText = stateDisplay(deliverTo.stateCode, deliverTo.stateName);
  return (
    <PartyBlock title="Deliver To" testId="rm-po-deliver-to-block">
      <PartyField label="Name" value={deliverTo.name} testId="rm-po-deliver-to-name" />
      <div className="pt-0.5">
        <AddressBlock lines={deliverTo.addressLines} testId="rm-po-deliver-to-address" />
      </div>
      <PartyField label="GSTIN" value={deliverTo.gstin} mono testId="rm-po-deliver-to-gstin" />
      {hasStateValue(deliverTo.stateCode, deliverTo.stateName) ? (
        <PartyField label="State" value={stateText} testId="rm-po-deliver-to-state" />
      ) : null}
    </PartyBlock>
  );
}

function TaxTotalRows({ taxDisplay }: { taxDisplay: RmPoTaxDisplay }) {
  if (taxDisplay.mode === "split") {
    return (
      <>
        <div className="flex justify-between gap-4" data-testid="rm-po-total-cgst">
          <dt className="text-slate-600">CGST</dt>
          <dd className="tabular-nums font-semibold text-slate-900">₹ {formatPoMoney(taxDisplay.cgst)}</dd>
        </div>
        <div className="flex justify-between gap-4" data-testid="rm-po-total-sgst">
          <dt className="text-slate-600">SGST</dt>
          <dd className="tabular-nums font-semibold text-slate-900">₹ {formatPoMoney(taxDisplay.sgst)}</dd>
        </div>
      </>
    );
  }
  if (taxDisplay.mode === "igst") {
    return (
      <div className="flex justify-between gap-4" data-testid="rm-po-total-igst">
        <dt className="text-slate-600">IGST</dt>
        <dd className="tabular-nums font-semibold text-slate-900">₹ {formatPoMoney(taxDisplay.igst)}</dd>
      </div>
    );
  }
  return (
    <div className="flex justify-between gap-4" data-testid="rm-po-total-tax">
      <dt className="text-slate-600">Tax</dt>
      <dd className="tabular-nums font-semibold text-slate-900">₹ {formatPoMoney(taxDisplay.tax)}</dd>
    </div>
  );
}

export function RmPoSupplierDocument({ po, poDate, companyProfile, className }: Props) {
  const vendor = resolveRmPoVendorBlock(po);
  const deliverTo = resolveRmPoDeliverToBlock(companyProfile);
  const totals = computeRmPoCommercialTotals(po.lines);
  const taxDisplay = resolveRmPoTaxDisplay(po, totals);
  const poNo = formatRmPoNo(po.id);
  const companyName = (companyProfile?.companyName ?? "").trim();

  const buyerLines: string[] = [];
  const b1 = (companyProfile?.companyAddressLine1 ?? "").trim();
  const b2 = (companyProfile?.companyAddressLine2 ?? "").trim();
  if (b1) buyerLines.push(b1);
  if (b2) buyerLines.push(b2);
  const cityPin = [(companyProfile?.companyCity ?? "").trim(), (companyProfile?.companyPincode ?? "").trim()]
    .filter(Boolean)
    .join(" - ");
  if (cityPin) buyerLines.push(cityPin);

  const logoUrl =
    companyProfile?.hasLogo ? `${getApiUrl("/api/company-profile/logo/file")}?v=po` : null;

  return (
    <div
      id="rm-po-supplier-section-printable"
      data-testid="rm-po-supplier-section"
      className={cn("rm-po-supplier-doc procurement-commercial-doc bg-white text-slate-900", className)}
    >
      <div
        className="procurement-doc-grid procurement-doc-print-inner"
        data-testid="procurement-doc-grid"
      >
      <header
        className="procurement-doc-section border-b border-slate-300 py-2.5 md:py-3 print:py-1"
        data-testid="rm-po-document-header"
      >
        <div className="flex flex-wrap items-start justify-between gap-5 md:gap-6 print:gap-4">
          <div className="flex min-w-0 items-start gap-3 print:gap-2">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt=""
                className="rm-po-supplier-logo h-12 w-auto max-w-[110px] shrink-0 object-contain print:h-10"
                data-testid="rm-po-company-logo"
              />
            ) : null}
            <div className="min-w-0">
              <div className="procurement-doc-section-heading text-[13px] font-bold text-slate-950" data-testid="rm-po-company-name">
                {companyName || "—"}
              </div>
              <div className="procurement-doc-body-text mt-0.5 space-y-0.5 leading-snug text-slate-700">
                {buyerLines.length ? (
                  buyerLines.map((line, i) => <div key={i}>{line}</div>)
                ) : (
                  <div className="italic text-slate-500">Company address not configured</div>
                )}
              </div>
              {(companyProfile?.companyGstin ?? "").trim() ? (
                <div className="procurement-doc-body-text mt-1 text-slate-600">
                  <span className="font-medium text-slate-700">GSTIN:</span>{" "}
                  <span className="font-mono">{(companyProfile?.companyGstin ?? "").trim()}</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <div className="procurement-doc-title font-bold uppercase tracking-wider text-slate-800">
              Purchase Order
            </div>
            <div className="mt-1" data-testid="rm-po-number-block">
              <div className="procurement-doc-section-heading font-medium uppercase tracking-wide text-slate-500">
                Purchase Order No.
              </div>
              <div className="procurement-doc-title text-lg font-bold text-slate-950">{poNo}</div>
            </div>
            <div className="procurement-doc-body-text mt-0.5 text-slate-600">
              Date: {formatPoDocumentDate(poDate)}
            </div>
            <span
              className={cn(
                "rm-po-screen-only mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide",
                po.status === "COMPLETED"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : po.status === "CANCELLED"
                    ? "border-slate-300 bg-slate-100 text-slate-700"
                    : "border-amber-300 bg-amber-50 text-amber-950",
              )}
              data-testid="rm-po-status-badge"
            >
              <span className={`h-2 w-2 rounded-full ${poStatusDotClass(po.status)}`} />
              {poStatusLabel(po.status)}
            </span>
          </div>
        </div>
      </header>

      <section
        className="procurement-doc-section procurement-doc-party-grid border-b border-slate-300 py-2 print:gap-2 print:py-1.5"
        data-testid="rm-po-supplier-details"
      >
        <VendorParty vendor={vendor} />
        <DeliverToParty deliverTo={deliverTo} />
      </section>

      <section
        className="procurement-doc-section procurement-doc-table-section hidden border-b border-slate-200 md:block print:block"
        data-testid="rm-po-supplier-lines-table"
      >
        <table className="rm-po-doc-table w-full border-collapse">
          <thead>
            <tr className="rm-po-doc-table-head border-b border-slate-300 bg-slate-50 text-left procurement-doc-section-heading font-semibold uppercase tracking-wide text-slate-600">
              <th className="w-9 px-2 py-1.5">Sr</th>
              <th className="px-2 py-1.5">Item</th>
              <th className="px-2 py-1.5">HSN</th>
              <th className="procurement-doc-nowrap px-2 py-1.5 text-right">Qty</th>
              <th className="px-2 py-1.5">Unit</th>
              <th className="procurement-doc-nowrap px-2 py-1.5 text-right">Rate</th>
              <th className="procurement-doc-nowrap px-2 py-1.5 text-right">GST %</th>
              <th className="procurement-doc-nowrap px-2 py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((ln, idx) => {
              const ordered = Number(ln.qty);
              const amt = lineAmount(ln);
              return (
                <tr key={ln.id} className="border-b border-slate-200">
                  <td className="px-2 py-1.5 tabular-nums text-slate-600">{idx + 1}</td>
                  <td className="px-2 py-1.5 font-medium text-slate-900">
                    {ln.item?.itemName ?? `Item #${ln.itemId}`}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-slate-700">{ln.hsn || "—"}</td>
                  <td className="procurement-doc-nowrap px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900">
                    {ordered.toFixed(3)}
                  </td>
                  <td className="px-2 py-1.5 text-slate-700">{ln.unit || "—"}</td>
                  <td className="procurement-doc-nowrap px-2 py-1.5 text-right tabular-nums">{ln.rate ?? "—"}</td>
                  <td className="procurement-doc-nowrap px-2 py-1.5 text-right tabular-nums">{ln.gstRate ?? "—"}</td>
                  <td className="procurement-doc-nowrap px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900">
                    {formatPoMoney(amt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section
        className="procurement-doc-section space-y-2 border-b border-slate-200 py-4 md:hidden print:hidden"
        data-testid="rm-po-supplier-line-cards"
      >
        {po.lines.map((ln, idx) => {
          const ordered = Number(ln.qty);
          const amt = lineAmount(ln);
          return (
            <div key={ln.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-sm font-semibold text-slate-950">
                {idx + 1}. {ln.item?.itemName}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-700">
                <div>Qty: <span className="font-semibold tabular-nums">{ordered.toFixed(3)}</span></div>
                <div>Amount: <span className="font-semibold tabular-nums">₹ {formatPoMoney(amt)}</span></div>
                <div>HSN: {ln.hsn || "—"}</div>
                <div>GST %: {ln.gstRate ?? "—"}</div>
              </div>
            </div>
          );
        })}
      </section>

      <footer
        className="procurement-doc-section procurement-doc-trailing-section border-b border-slate-200 py-1.5 print:py-0.5"
        data-testid="rm-po-supplier-footer"
      >
        <dl className="procurement-doc-trailing-block procurement-doc-totals space-y-0.5">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Subtotal</dt>
            <dd className="tabular-nums font-semibold text-slate-900">₹ {formatPoMoney(totals.subtotal)}</dd>
          </div>
          <TaxTotalRows taxDisplay={taxDisplay} />
          <div className="procurement-doc-grand-total flex justify-between gap-4 border-t border-slate-300 pt-0.5 font-bold text-slate-950">
            <dt>Grand Total</dt>
            <dd className="tabular-nums">₹ {formatPoMoney(totals.grandTotal)}</dd>
          </div>
        </dl>
      </footer>

      {po.remarks?.trim() ? (
        <section
          className="procurement-doc-section border-b border-slate-200 py-3 print:py-1"
          data-testid="rm-po-supplier-remarks"
        >
          <div className="rounded border border-slate-200 bg-slate-50/80 px-3 py-2.5 print:border-slate-300 print:bg-transparent print:px-2 print:py-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Remarks</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800 print:text-[9pt]">{po.remarks.trim()}</p>
          </div>
        </section>
      ) : null}

      <section
        className="procurement-doc-section procurement-doc-trailing-section py-1.5 print:py-0.5"
        data-testid="rm-po-supplier-signatory"
      >
          <div className="procurement-doc-trailing-block rm-po-signatory-block text-right">
            <p className="rm-po-signatory-company procurement-doc-body-text font-medium leading-snug text-slate-800" data-testid="rm-po-signatory-for-line">
              {formatProcurementSignatoryForLine(companyName || "—")}
            </p>
            <div className="rm-po-signatory-line mb-3 mt-4 border-b border-slate-400" aria-hidden />
            <p className="rm-po-signatory-label procurement-doc-section-heading font-semibold uppercase tracking-wide text-slate-600">
              Authorized Signatory
            </p>
          </div>
      </section>

      <footer
        className="procurement-doc-section rm-po-print-only hidden border-t border-slate-200 py-2 text-center text-[10px] italic text-slate-500 print:block print:py-1 print:text-[8pt]"
        data-testid="rm-po-supplier-print-footer"
      >
        This is a system generated purchase order.
      </footer>
      </div>
    </div>
  );
}
