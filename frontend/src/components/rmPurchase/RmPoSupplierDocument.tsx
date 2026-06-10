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
      className="rounded border border-slate-200 bg-white px-3 py-2.5 print:px-2 print:py-1.5"
      data-testid={testId}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-1.5 space-y-1">{children}</div>
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
    <div className="flex gap-2 text-[12px] leading-snug print:text-[10pt]" data-testid={testId}>
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
        className="rounded border border-amber-200 bg-amber-50/90 px-2 py-1.5 text-[11px] leading-snug text-amber-900 print:border-amber-300 print:bg-amber-50 print:text-[9pt]"
        data-testid={testId ?? "rm-po-address-missing-warning"}
      >
        {missingWarning}
      </div>
    );
  }
  return (
    <div className="space-y-0.5 text-[12px] leading-snug text-slate-700 print:text-[10pt]" data-testid={testId}>
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
  const signatoryName = (companyProfile?.companySignatoryName ?? "").trim();
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
      className={cn("rm-po-supplier-doc bg-white text-slate-900", className)}
    >
      <header
        className="border-b border-slate-300 px-4 py-3 md:px-6 print:px-0 print:py-1.5"
        data-testid="rm-po-document-header"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 print:gap-2">
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
              <div className="text-base font-bold text-slate-950 print:text-[11pt]" data-testid="rm-po-company-name">
                {companyName || "—"}
              </div>
              <div className="mt-0.5 space-y-0.5 text-[12px] leading-snug text-slate-700 print:text-[9pt]">
                {buyerLines.length ? (
                  buyerLines.map((line, i) => <div key={i}>{line}</div>)
                ) : (
                  <div className="italic text-slate-500">Company address not configured</div>
                )}
              </div>
              {(companyProfile?.companyGstin ?? "").trim() ? (
                <div className="mt-1 text-[12px] text-slate-600 print:text-[9pt]">
                  <span className="font-medium text-slate-700">GSTIN:</span>{" "}
                  <span className="font-mono">{(companyProfile?.companyGstin ?? "").trim()}</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold uppercase tracking-wider text-slate-800 print:text-[10pt]">
              Purchase Order
            </div>
            <div className="mt-1" data-testid="rm-po-number-block">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 print:text-[8pt]">
                Purchase Order No.
              </div>
              <div className="text-xl font-bold text-slate-950 print:text-[12pt]">{poNo}</div>
            </div>
            <div className="mt-0.5 text-sm text-slate-600 print:text-[9pt]">
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
        className="grid gap-3 border-b border-slate-200 px-4 py-3 sm:grid-cols-2 md:px-6 print:gap-2 print:px-0 print:py-1.5"
        data-testid="rm-po-supplier-details"
      >
        <VendorParty vendor={vendor} />
        <DeliverToParty deliverTo={deliverTo} />
      </section>

      <section
        className="hidden border-b border-slate-200 md:block print:block"
        data-testid="rm-po-supplier-lines-table"
      >
        <table className="w-full border-collapse text-sm print:text-[8.5pt]">
          <thead>
            <tr className="border-b border-slate-300 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600 print:bg-transparent print:text-[7.5pt]">
              <th className="w-9 px-2 py-1.5 print:px-1 print:py-0.5">Sr</th>
              <th className="px-2 py-1.5 print:px-1 print:py-0.5">Item</th>
              <th className="px-2 py-1.5 print:px-1 print:py-0.5">HSN</th>
              <th className="px-2 py-1.5 text-right print:px-1 print:py-0.5">Qty</th>
              <th className="px-2 py-1.5 print:px-1 print:py-0.5">Unit</th>
              <th className="px-2 py-1.5 text-right print:px-1 print:py-0.5">Rate</th>
              <th className="px-2 py-1.5 text-right print:px-1 print:py-0.5">GST %</th>
              <th className="px-2 py-1.5 text-right print:px-1 print:py-0.5">Amount</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((ln, idx) => {
              const ordered = Number(ln.qty);
              const amt = lineAmount(ln);
              return (
                <tr key={ln.id} className="border-b border-slate-100">
                  <td className="px-2 py-1.5 tabular-nums text-slate-600 print:px-1 print:py-0.5">{idx + 1}</td>
                  <td className="px-2 py-1.5 font-medium text-slate-900 print:px-1 print:py-0.5">
                    {ln.item?.itemName ?? `Item #${ln.itemId}`}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs text-slate-700 print:px-1 print:py-0.5">{ln.hsn || "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900 print:px-1 print:py-0.5">
                    {ordered.toFixed(3)}
                  </td>
                  <td className="px-2 py-1.5 text-slate-700 print:px-1 print:py-0.5">{ln.unit || "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums print:px-1 print:py-0.5">{ln.rate ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums print:px-1 print:py-0.5">{ln.gstRate ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900 print:px-1 print:py-0.5">
                    {formatPoMoney(amt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section
        className="space-y-2 border-b border-slate-200 p-4 md:hidden print:hidden"
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
        className="flex flex-wrap justify-end border-b border-slate-200 px-4 py-3 md:px-6 print:px-0 print:py-1"
        data-testid="rm-po-supplier-footer"
      >
        <dl className="w-full max-w-xs space-y-1 text-sm print:max-w-[210px] print:space-y-0.5 print:text-[9pt]">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Subtotal</dt>
            <dd className="tabular-nums font-semibold text-slate-900">₹ {formatPoMoney(totals.subtotal)}</dd>
          </div>
          <TaxTotalRows taxDisplay={taxDisplay} />
          <div className="flex justify-between gap-4 border-t border-slate-300 pt-1 text-base font-bold text-slate-950 print:pt-0.5 print:text-[10pt]">
            <dt>Grand Total</dt>
            <dd className="tabular-nums">₹ {formatPoMoney(totals.grandTotal)}</dd>
          </div>
        </dl>
      </footer>

      {po.remarks?.trim() ? (
        <section
          className="border-b border-slate-200 px-4 py-3 md:px-6 print:px-0 print:py-1"
          data-testid="rm-po-supplier-remarks"
        >
          <div className="rounded border border-slate-200 bg-slate-50/80 px-3 py-2.5 print:border-slate-300 print:bg-transparent print:px-2 print:py-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Remarks</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800 print:text-[9pt]">{po.remarks.trim()}</p>
          </div>
        </section>
      ) : null}

      <section
        className="px-4 py-4 md:px-6 print:px-0 print:py-2"
        data-testid="rm-po-supplier-signatory"
      >
        <div className="flex justify-end">
          <div className="w-full max-w-xs text-right print:max-w-[180px]">
            <div className="mb-8 border-b border-slate-400 print:mb-6" aria-hidden />
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 print:text-[8pt]">
              Authorised Signatory
            </div>
            {signatoryName ? (
              <div className="mt-1 text-sm font-semibold text-slate-900 print:text-[9pt]">{signatoryName}</div>
            ) : (
              <div className="mt-1 text-sm text-slate-500 print:text-[9pt]">—</div>
            )}
            {companyName ? (
              <div className="mt-0.5 text-[12px] text-slate-600 print:text-[8pt]">{companyName}</div>
            ) : null}
          </div>
        </div>
      </section>

      <footer
        className="rm-po-print-only hidden border-t border-slate-200 px-4 py-2 text-center text-[10px] italic text-slate-500 print:block print:px-0 print:py-1 print:text-[8pt]"
        data-testid="rm-po-supplier-print-footer"
      >
        This is a system generated purchase order.
      </footer>
    </div>
  );
}
