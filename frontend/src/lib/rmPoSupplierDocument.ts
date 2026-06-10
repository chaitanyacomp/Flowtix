import type { RmPoLine, RmPoRow } from "../pages/rmPurchase/rmPurchaseShared";
import { computeLineAmount } from "../pages/rmPurchase/rmPurchaseShared";

/** Company profile fields used on supplier-facing RM PO documents. */
export type RmPoCompanyProfile = {
  companyName: string | null;
  companyAddressLine1: string | null;
  companyAddressLine2: string | null;
  companyCity: string | null;
  companyStateName: string | null;
  companyStateCode: string | null;
  companyPincode: string | null;
  companyGstin: string | null;
  companyMobile: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companySignatoryName: string | null;
  hasLogo: boolean;
};

export type RmPoVendorBlock = {
  name: string;
  supplyLabel: string | null;
  addressLines: string[];
  gstin: string | null;
  stateCode: string | null;
  stateName: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
};

export type RmPoTaxDisplay =
  | { mode: "split"; cgst: number; sgst: number; tax: number }
  | { mode: "igst"; igst: number; tax: number }
  | { mode: "aggregate"; tax: number };

export type RmPoDeliverToBlock = {
  name: string;
  addressLines: string[];
  gstin: string | null;
  stateCode: string | null;
  stateName: string | null;
};

export type RmPoCommercialTotals = {
  subtotal: number;
  tax: number;
  grandTotal: number;
};

function trim(v?: string | null): string {
  return (v ?? "").trim();
}

export function addressTextToLines(address?: string | null): string[] {
  return String(address ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function stateDisplay(code?: string | null, name?: string | null): string {
  const c = trim(code);
  const n = trim(name);
  if (c && n) return `${c} · ${n}`;
  return c || n || "";
}

export function hasStateValue(code?: string | null, name?: string | null): boolean {
  return Boolean(trim(code) || trim(name));
}

export function formatPoMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function lineAmount(ln: RmPoLine): number {
  const amt =
    ln.amount != null && String(ln.amount).trim() !== ""
      ? Number(ln.amount)
      : computeLineAmount(Number(ln.qty), Number(ln.rate ?? 0));
  return Number.isFinite(amt) ? amt : 0;
}

export function computeRmPoCommercialTotals(lines: RmPoLine[]): RmPoCommercialTotals {
  let subtotal = 0;
  let tax = 0;
  for (const ln of lines) {
    const amt = lineAmount(ln);
    subtotal += amt;
    const gst = ln.gstRate != null ? Number(ln.gstRate) : 0;
    if (Number.isFinite(gst)) tax += (amt * gst) / 100;
  }
  return { subtotal, tax, grandTotal: subtotal + tax };
}

function appendCityLine(lines: string[], city?: string | null): string[] {
  const c = trim(city);
  if (!c) return lines;
  if (lines.some((l) => l.toLowerCase().includes(c.toLowerCase()))) return lines;
  return [...lines, c];
}

/**
 * Vendor block: registered supplier identity with supply-branch address when distinct.
 * Uses frozen commercial snapshots first; live supplier/location only as fallback.
 */
export function resolveRmPoVendorBlock(po: RmPoRow): RmPoVendorBlock {
  const commercial = po.resolvedSupplierCommercial;
  const reg = commercial?.registeredSupplier;
  const supply = commercial?.supplyLocation;
  const liveLoc = po.supplierLocation;

  const name = trim(reg?.name) || trim(po.supplier.name) || "—";
  const supplyLabel = trim(supply?.label) || trim(liveLoc?.label) || null;
  const registeredOffice = !supplyLabel || supplyLabel.toLowerCase() === "registered office";

  const supplyAddress = trim(supply?.address) || trim(liveLoc?.address);
  const regAddress = trim(reg?.address) || trim(po.supplier.address);
  const useSupplyAddress = Boolean(supplyAddress && (!registeredOffice || !regAddress));

  let addressLines = addressTextToLines(useSupplyAddress ? supplyAddress : regAddress || supplyAddress);
  if (useSupplyAddress) {
    addressLines = appendCityLine(addressLines, liveLoc?.city);
  }

  const gstin = trim(useSupplyAddress ? supply?.gstin : reg?.gstin) || trim(reg?.gstin) || trim(supply?.gstin) || trim(po.supplier.gstin) || trim(po.supplier.gst) || null;
  const stateCode = useSupplyAddress ? supply?.stateCode ?? liveLoc?.stateCode : reg?.stateCode ?? po.supplier.stateCode;
  const stateName = useSupplyAddress ? supply?.stateName : reg?.stateName ?? po.supplier.stateName ?? po.supplier.state;

  const locContact = trim(liveLoc?.contactPerson);
  const locPhone = trim(liveLoc?.phone);
  const supContact = trim(po.supplier.contact);
  const supEmail = trim(po.supplier.email);
  const contact = locContact || supContact || null;
  const phone = locPhone || null;
  const email = supEmail || null;

  return {
    name,
    supplyLabel: registeredOffice ? null : supplyLabel,
    addressLines,
    gstin,
    stateCode: trim(stateCode) || null,
    stateName: trim(stateName) || null,
    contact,
    phone,
    email,
  };
}

/** Display-only tax split from frozen GST mode; does not recalculate line tax. */
export function resolveRmPoTaxDisplay(
  po: RmPoRow,
  totals: RmPoCommercialTotals,
): RmPoTaxDisplay {
  const tax = totals.tax;
  if (!Number.isFinite(tax) || tax <= 0) {
    return { mode: "aggregate", tax: 0 };
  }
  const gstMode = po.resolvedSupplierCommercial?.gstMode;
  if (gstMode === "LOCAL") {
    const half = tax / 2;
    return { mode: "split", cgst: half, sgst: half, tax };
  }
  if (gstMode === "INTERSTATE") {
    return { mode: "igst", igst: tax, tax };
  }
  return { mode: "aggregate", tax };
}

export function resolveRmPoDeliverToBlock(profile: RmPoCompanyProfile | null | undefined): RmPoDeliverToBlock {
  const name = trim(profile?.companyName) || "—";
  const lines: string[] = [];
  const l1 = trim(profile?.companyAddressLine1);
  const l2 = trim(profile?.companyAddressLine2);
  if (l1) lines.push(l1);
  if (l2) lines.push(l2);
  const city = trim(profile?.companyCity);
  const pin = trim(profile?.companyPincode);
  if (city || pin) {
    lines.push([city, pin].filter(Boolean).join(" - "));
  }
  return {
    name,
    addressLines: lines,
    gstin: trim(profile?.companyGstin) || null,
    stateCode: trim(profile?.companyStateCode) || null,
    stateName: trim(profile?.companyStateName) || null,
  };
}

export const VENDOR_ADDRESS_MISSING_WARNING =
  "Supplier address not maintained in supplier master";

export function supplierDocumentHasErpOnlyContent(source: string): boolean {
  const erpMarkers = [
    "RmPoCommercialSummary",
    "FROZEN",
    "LIVE",
    "Purchase source",
    "LOCAL",
    "INTERSTATE",
    "Internal procurement traceability",
    "po-line-trace-",
    "TraceChainInline",
  ];
  return erpMarkers.some((m) => source.includes(m));
}
