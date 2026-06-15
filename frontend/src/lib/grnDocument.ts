import type { RmPoTraceDemandSource } from "./rmPoDocumentTrace";
import { demandSourceDisplay } from "./rmPoDocumentTrace";
import { formatProcurementSignatoryForLine } from "./rmPoSupplierDocument";

export type GrnDocumentLine = {
  id: number;
  grnId: number;
  rmPoLineId: number;
  item: { id: number; itemName: string; unit?: string | null; hsn?: string | null } | null;
  poQty: number;
  previouslyReceivedQty: number;
  thisGrnQty: number;
  totalReceivedQty: number;
  pendingQty: number;
  rate: number;
  amount: number;
  location: { id: number; name: string; code?: string | null } | null;
  stockPosting: {
    qtyPosted: number;
    status: string;
  } | null;
  purchaseBillLines: Array<{
    purchaseBillId?: number;
    billNo: string | null;
    status: string | null;
    qty: number;
  }>;
  billStatus: string;
};

export type GrnDocumentPayload = {
  grn: {
    id: number;
    displayNo: string;
    date: string;
    supplierInvoiceNo: string;
    /** Optional — shown only when API provides it (no schema change required). */
    supplierInvoiceDate?: string | null;
    /** Optional — shown only when API provides it. */
    receivedBy?: string | null;
    /** Optional — shown only when API provides it. */
    remarks?: string | null;
    billingStatus: string;
    isReversed: boolean;
    reversedAt?: string | null;
    reversalReason?: string | null;
  };
  po: {
    id: number;
    displayNo: string;
    status: string;
  };
  supplier: {
    id: number;
    name: string;
    address?: string | null;
    gstin?: string | null;
    stateName?: string | null;
    stateCode?: string | null;
  } | null;
  supplyLocation: {
    label?: string | null;
    address?: string | null;
    gstin?: string | null;
    stateName?: string | null;
    stateCode?: string | null;
  } | null;
  lines: GrnDocumentLine[];
  stockPostingSummary: Array<{
    grnLineId: number;
    itemName: string | null;
    location: GrnDocumentLine["location"];
    qtyPosted: number;
    status: string;
  }>;
  purchaseBillSummary: {
    headerBillingStatus: string;
    documentBillStatus: string;
    bills: Array<{ id: number; billNo: string | null; status: string }>;
  };
  trace: {
    lines: Array<{
      id: number;
      item: { itemName?: string } | null;
      demandSources: RmPoTraceDemandSource[];
      traceChain: string[];
    }>;
  };
};

export type GrnCompanyProfile = {
  companyName: string | null;
  companyAddressLine1: string | null;
  companyAddressLine2: string | null;
  companyCity: string | null;
  companyStateName: string | null;
  companyStateCode?: string | null;
  companyPincode?: string | null;
  companyGstin: string | null;
  companySignatoryName: string | null;
  hasLogo: boolean;
};

export type GrnCompanyHeader = {
  companyName: string;
  addressLines: string[];
  gstin: string | null;
  signatoryName: string | null;
  isConfigured: boolean;
};

export type GrnBillPresentation = {
  statusLabel: string;
  billNo: string | null;
  showLineBreakdown: boolean;
  lineBreakdown: Array<{ itemName: string; statusLabel: string; billNo: string | null }>;
};

export type GrnTraceGroupedRow = {
  key: string;
  traceChain: string[];
  demandLabel: string;
  mrDocNo: string | null;
  prDocNo: string | null;
  woDocNo: string | null;
  soDocNo: string | null;
  itemNames: string[];
};

type GrnTraceLine = GrnDocumentPayload["trace"]["lines"][number];

export function formatGrnDocumentDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function formatGrnQty(n: number, unit?: string | null): string {
  const q = Number.isFinite(n) ? n.toFixed(3) : "—";
  const u = (unit ?? "").trim();
  return u ? `${q} ${u}` : q;
}

export function grnBillStatusDisplay(status: string): string {
  switch (status) {
    case "BILLED":
      return "Billed";
    case "PARTIALLY_BILLED":
      return "Partially billed";
    case "NOT_BILLED":
      return "Not billed";
    case "PENDING":
      return "Pending";
    default:
      return status;
  }
}

/** Professional document summary labels (P5C). */
export function grnBillStatusSummaryLabel(status: string): string {
  switch (status) {
    case "BILLED":
      return "Fully Billed";
    case "PARTIALLY_BILLED":
      return "Partially Billed";
    case "NOT_BILLED":
      return "Not Billed";
    case "PENDING":
      return "Pending";
    default:
      return grnBillStatusDisplay(status);
  }
}

export function formatGrnBillingStatusRow(statusLabel: string): string {
  return `Billing Status : ${statusLabel}`;
}

export function formatGrnSignatoryForLine(companyName: string): string {
  return formatProcurementSignatoryForLine(companyName);
}

export function resolveGrnCompanyHeader(profile: GrnCompanyProfile | null | undefined): GrnCompanyHeader {
  const companyName = (profile?.companyName ?? "").trim();
  const addressLines: string[] = [];
  const b1 = (profile?.companyAddressLine1 ?? "").trim();
  const b2 = (profile?.companyAddressLine2 ?? "").trim();
  if (b1) addressLines.push(b1);
  if (b2) addressLines.push(b2);
  const cityPin = [(profile?.companyCity ?? "").trim(), (profile?.companyPincode ?? "").trim()]
    .filter(Boolean)
    .join(" - ");
  if (cityPin) addressLines.push(cityPin);
  const stateLine = stateDisplay(profile?.companyStateCode, profile?.companyStateName);
  if (stateLine) addressLines.push(stateLine);

  return {
    companyName: companyName || "—",
    addressLines,
    gstin: (profile?.companyGstin ?? "").trim() || null,
    signatoryName: (profile?.companySignatoryName ?? "").trim() || null,
    isConfigured: Boolean(companyName),
  };
}

export function resolveGrnVendorAddressLines(
  supplier: GrnDocumentPayload["supplier"],
  supplyLocation: GrnDocumentPayload["supplyLocation"],
): string[] {
  const supplyLines = addressTextToLines(supplyLocation?.address);
  if (supplyLines.length > 0) return supplyLines;
  return addressTextToLines(supplier?.address);
}

export function resolveGrnBillPresentation(
  summary: GrnDocumentPayload["purchaseBillSummary"],
  lines: GrnDocumentLine[],
): GrnBillPresentation {
  const statusLabel = grnBillStatusSummaryLabel(summary.documentBillStatus);
  const finalized = summary.bills.find((b) => b.status === "FINALIZED" && b.billNo);
  const anyBill = summary.bills.find((b) => b.billNo);
  const billNo = finalized?.billNo ?? anyBill?.billNo ?? null;

  const statuses = new Set(lines.map((l) => l.billStatus));
  const showLineBreakdown = statuses.size > 1;
  const lineBreakdown = showLineBreakdown
    ? lines.map((ln) => ({
        itemName: ln.item?.itemName ?? "—",
        statusLabel: grnBillStatusSummaryLabel(ln.billStatus),
        billNo: ln.purchaseBillLines.find((b) => b.billNo)?.billNo ?? null,
      }))
    : [];

  return { statusLabel, billNo, showLineBreakdown, lineBreakdown };
}

/** Procurement header chain only — excludes per-line GRN, stock, and bill suffixes. */
export function procurementCaseTraceChain(chain: string[]): string[] {
  const out: string[] = [];
  for (const label of chain) {
    if (/^GRN-/i.test(label)) break;
    if (label === "StockTransaction IN") break;
    if (/^Purchase Bill/i.test(label)) break;
    out.push(label);
  }
  return out;
}

function traceGroupKey(line: GrnTraceLine): string {
  const ds = line.demandSources?.[0];
  if (!ds) return `line-${line.id}`;
  const planIdentity =
    (ds.monthlyPlan?.periodKey ?? "").trim() ||
    (ds.monthlyPlan?.label ?? "").trim() ||
    (ds.monthlyPlanRevision != null ? `rev-${ds.monthlyPlanRevision}` : "");
  return [
    ds.demandSourceType ?? "",
    planIdentity,
    String(ds.salesOrder?.id ?? ds.mr?.salesOrder?.id ?? ""),
    ds.salesOrder?.docNo ?? ds.mr?.salesOrder?.docNo ?? "",
    String(ds.mr?.materialRequirementId ?? ""),
    ds.mr?.docNo ?? "",
    String(ds.pr?.purchaseRequestId ?? ""),
    ds.pr?.docNo ?? "",
    String(ds.workOrder?.id ?? ds.mr?.workOrder?.id ?? ""),
    ds.workOrder?.docNo ?? ds.mr?.workOrder?.docNo ?? "",
  ].join("|");
}

/** Group trace lines that share the same procurement chain (display only). */
export function groupGrnTraceLines(lines: GrnTraceLine[]): GrnTraceGroupedRow[] {
  const map = new Map<string, GrnTraceGroupedRow>();
  for (const tl of lines) {
    const key = traceGroupKey(tl);
    const itemName = tl.item?.itemName ?? `Line #${tl.id}`;
    const ds = tl.demandSources?.[0];
    const existing = map.get(key);
    if (existing) {
      if (!existing.itemNames.includes(itemName)) existing.itemNames.push(itemName);
      continue;
    }
    map.set(key, {
      key,
      traceChain: procurementCaseTraceChain(tl.traceChain ?? []),
      demandLabel: ds ? demandSourceDisplay(ds) : "Demand source",
      mrDocNo: ds?.mr?.docNo ?? null,
      prDocNo: ds?.pr?.docNo ?? null,
      woDocNo: ds?.workOrder?.docNo ?? null,
      soDocNo: ds?.salesOrder?.docNo ?? null,
      itemNames: [itemName],
    });
  }
  return [...map.values()];
}

export function grnReceiptStatusDisplay(isReversed: boolean): string {
  return isReversed ? "Reversed" : "Active";
}

export function stockPostingStatusLabel(status: string): string {
  if (status === "POSTED") return "Posted";
  if (status === "REVERSED") return "Reversed";
  return "Not posted";
}

export function addressTextToLines(address?: string | null): string[] {
  return String(address ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function stateDisplay(code?: string | null, name?: string | null): string {
  const c = (code ?? "").trim();
  const n = (name ?? "").trim();
  if (c && n) return `${c} · ${n}`;
  return c || n || "";
}
