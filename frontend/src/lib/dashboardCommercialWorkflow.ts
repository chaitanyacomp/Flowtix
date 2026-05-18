import { NO_QTY_TERMS } from "./flowTerminology";

export type QuotationPendingSoRow = {
  key: string;
  quotationId: number;
  quotationNo: string;
  customerName: string;
  flowType: "REGULAR" | "NO_QTY";
  nextStep: string;
  href: string;
};

export const QUOTATION_PENDING_SO_NEXT_STEP = "Create Sales Order";

/** Operator-facing flow label on dashboard commercial continuation rows. */
export function flowLabelForQuotationPendingSo(flowType: QuotationPendingSoRow["flowType"]): string {
  return flowType === "NO_QTY" ? NO_QTY_TERMS.AGREEMENT_LABEL : "REGULAR Order";
}

/** Deep-link into SO creation from quotation (matches Quotations operator panel). */
export function buildQuotationPendingSoHref(
  quotationId: number,
  flowType: QuotationPendingSoRow["flowType"],
  from: "dashboard" | "quotations" = "dashboard",
): string {
  const q = encodeURIComponent(String(quotationId));
  const src = encodeURIComponent(from);
  if (flowType === "NO_QTY") {
    return `/sales-orders/no-qty/from-quotation?quotationId=${q}&from=${src}`;
  }
  return `/sales-orders?quotationId=${q}&from=${src}`;
}

export function normalizeQuotationPendingSoRow(raw: unknown): QuotationPendingSoRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const quotationId = Number(r.quotationId);
  if (!Number.isFinite(quotationId) || quotationId <= 0) return null;
  const flowRaw = String(r.flowType ?? "REGULAR").toUpperCase();
  const flowType: QuotationPendingSoRow["flowType"] = flowRaw === "NO_QTY" ? "NO_QTY" : "REGULAR";
  const quotationNo =
    typeof r.quotationNo === "string" && r.quotationNo.trim()
      ? r.quotationNo.trim()
      : `Q-${quotationId}`;
  const customerName =
    typeof r.customerName === "string" && r.customerName.trim() ? r.customerName.trim() : "—";
  const key =
    typeof r.key === "string" && r.key.trim() ? r.key.trim() : `quotation-pending-so-${quotationId}`;
  return {
    key,
    quotationId,
    quotationNo,
    customerName,
    flowType,
    nextStep: QUOTATION_PENDING_SO_NEXT_STEP,
    href:
      typeof r.href === "string" && r.href.trim()
        ? r.href.trim()
        : buildQuotationPendingSoHref(quotationId, flowType),
  };
}
