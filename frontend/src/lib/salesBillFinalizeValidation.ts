/** Client-side finalize readiness — mirrors backend guards; UI only. */

export type SalesBillFinalizeCheck = {
  id: string;
  label: string;
  passed: boolean;
};

export type SalesBillFinalizeBill = {
  id: number;
  docNo?: string | null;
  billDate?: string | null;
  dispatchId?: number;
  customerId?: number;
  customer?: { id: number; name?: string | null } | null;
  customerStateCodeSnapshot?: string | null;
  gstMode?: string | null;
  taxIntraState?: boolean | null;
  totalBasic?: string | number | null;
  netAmount?: string | number | null;
  lines?: Array<{
    id: number;
    qty?: string | number;
    rate?: string | number;
    hsnCodeSnapshot?: string | null;
    basicAmount?: string | number | null;
    lineTotal?: string | number | null;
  }>;
};

function n(v: string | number | null | undefined): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function hasGstResolution(bill: SalesBillFinalizeBill): boolean {
  if (bill.gstMode === "LOCAL" || bill.gstMode === "INTERSTATE") return true;
  return bill.taxIntraState === true || bill.taxIntraState === false;
}

export function buildSalesBillFinalizeChecks(
  bill: SalesBillFinalizeBill,
  billDateInput: string,
): SalesBillFinalizeCheck[] {
  const systemNo = bill.docNo?.trim();
  const lines = bill.lines ?? [];
  const ratesOk = lines.length > 0 && lines.every((ln) => n(ln.rate) > 0);
  const hsnOk = lines.length > 0 && lines.every((ln) => String(ln.hsnCodeSnapshot ?? "").trim().length > 0);
  const amountsOk =
    lines.length > 0 &&
    lines.every((ln) => n(ln.qty) > 0 && n(ln.basicAmount) >= 0 && n(ln.lineTotal) >= 0) &&
    n(bill.netAmount) > 0;

  return [
    {
      id: "system-bill-no",
      label: "Sales bill number assigned",
      passed: Boolean(systemNo),
    },
    {
      id: "bill-date",
      label: "Bill date entered",
      passed: Boolean(String(billDateInput ?? "").trim()),
    },
    {
      id: "dispatch",
      label: "Dispatch linked",
      passed: n(bill.dispatchId) > 0,
    },
    {
      id: "customer",
      label: "Customer linked",
      passed: n(bill.customerId) > 0 && Boolean(bill.customer?.name?.trim()),
    },
    {
      id: "lines",
      label: "At least one line item",
      passed: lines.length > 0,
    },
    {
      id: "gst",
      label: "GST / place of supply resolved",
      passed: hasGstResolution(bill) && Boolean(String(bill.customerStateCodeSnapshot ?? "").trim()),
    },
    {
      id: "rates",
      label: "Line rates complete",
      passed: ratesOk,
    },
    {
      id: "hsn",
      label: "HSN codes present",
      passed: hsnOk,
    },
    {
      id: "amounts",
      label: "Amount calculation complete",
      passed: amountsOk,
    },
  ];
}

export function canFinalizeSalesBill(checks: SalesBillFinalizeCheck[]): boolean {
  return checks.length > 0 && checks.every((c) => c.passed);
}

export function firstFinalizeBlocker(checks: SalesBillFinalizeCheck[]): string | null {
  const fail = checks.find((c) => !c.passed);
  return fail ? `${fail.label} is required before finalize.` : null;
}
