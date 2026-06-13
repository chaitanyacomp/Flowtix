import { buildGrnDetailHref } from "./grnDocumentActions";
import { buildRmPoDetailHref } from "./rmPurchaseWoContinuity";

export type PurchaseBillTraceLine = {
  purchaseBillId: number;
  purchaseBill?: { billNo: string | null; status: string } | null;
};

/** Parse display numbers such as GRN-101 into numeric ids. */
export function parseGrnDisplayNo(displayNo: string | null | undefined): number | null {
  const m = /^GRN-(\d+)$/i.exec(String(displayNo ?? "").trim());
  const id = m ? Number(m[1]) : NaN;
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function buildPurchaseBillDetailHref(billId: number, options?: { tab?: "tally" }): string {
  const base = `/purchase-bills/${billId}`;
  if (options?.tab === "tally") return `${base}?tab=tally`;
  return base;
}

export function buildPurchaseBillNewHref(options: {
  supplierId?: number | null;
  returnTo?: string | null;
}): string {
  const qs = new URLSearchParams();
  if (options.supplierId != null && options.supplierId > 0) {
    qs.set("supplierId", String(options.supplierId));
  }
  if (options.returnTo?.startsWith("/")) {
    qs.set("returnTo", options.returnTo);
  }
  const query = qs.toString();
  return query ? `/purchase-bills/new?${query}` : "/purchase-bills/new";
}

export function buildRmPoGrnDetailHref(poId: number): string {
  return buildRmPoDetailHref(poId, { from: "procurement-nav" });
}

export function buildGrnDocumentHref(grnId: number, returnTo?: string): string {
  return buildGrnDetailHref(grnId, returnTo);
}

/** Prefer finalized bill; otherwise first linked bill from trace lines. */
export function resolvePrimaryPurchaseBill(
  billLines: PurchaseBillTraceLine[] | null | undefined,
): { id: number; billNo: string | null; status: string | null } | null {
  if (!billLines?.length) return null;
  const finalized = billLines.find((b) => b.purchaseBill?.status === "FINALIZED");
  const pick = finalized ?? billLines[0];
  if (!pick?.purchaseBillId) return null;
  return {
    id: pick.purchaseBillId,
    billNo: pick.purchaseBill?.billNo ?? null,
    status: pick.purchaseBill?.status ?? null,
  };
}

export function tallyExportLabel(isExported: boolean | null | undefined): "Exported" | "Not exported" {
  return isExported ? "Exported" : "Not exported";
}

export function resolvePrimaryPurchaseBillFromSummary(
  bills: Array<{ id: number; billNo: string | null; status: string }> | null | undefined,
): { id: number; billNo: string | null; status: string } | null {
  if (!bills?.length) return null;
  return bills.find((b) => b.status === "FINALIZED") ?? bills[0] ?? null;
}

type GrnLineBillRef = {
  purchaseBillId?: number;
  billNo?: string | null;
  status?: string | null;
};

export function resolvePrimaryPurchaseBillForGrn(
  summaryBills: Array<{ id: number; billNo: string | null; status: string }> | null | undefined,
  lineBillRefs: GrnLineBillRef[] | null | undefined,
): { id: number; billNo: string | null; status: string | null } | null {
  const fromSummary = resolvePrimaryPurchaseBillFromSummary(summaryBills);
  if (fromSummary) return fromSummary;

  const traceLines = (lineBillRefs ?? [])
    .filter((row) => row.purchaseBillId && row.purchaseBillId > 0)
    .map((row) => ({
      purchaseBillId: row.purchaseBillId as number,
      purchaseBill: {
        billNo: row.billNo ?? null,
        status: row.status ?? "DRAFT",
      },
    }));
  return resolvePrimaryPurchaseBill(traceLines);
}

export function purchaseBillIdByBillNo(
  bills: Array<{ id: number; billNo: string | null }> | null | undefined,
  billNo: string | null | undefined,
): number | null {
  const needle = (billNo ?? "").trim();
  if (!needle || !bills?.length) return null;
  return bills.find((b) => (b.billNo ?? "").trim() === needle)?.id ?? null;
}
