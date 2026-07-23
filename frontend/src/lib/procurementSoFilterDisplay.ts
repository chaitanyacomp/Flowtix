import { displaySalesOrderNo } from "./docNoDisplay";

/**
 * Procurement Workspace SO filter banner — business doc number only.
 * Never render "SO #258" (raw database id with hash prefix).
 */
export function formatProcurementSoFilterLabel(
  salesOrderId: number,
  salesOrderDocNo?: string | null,
): string {
  const id = Number(salesOrderId);
  if (!Number.isFinite(id) || id <= 0) return "Sales order";
  return displaySalesOrderNo(id, salesOrderDocNo);
}

/** True when a label exposes the forbidden "SO #<dbId>" pattern. */
export function isRawSoHashIdLabel(label: string, salesOrderId?: number | null): boolean {
  const text = String(label ?? "").trim();
  if (/^SO\s*#\d+$/i.test(text)) return true;
  const id = Number(salesOrderId);
  if (Number.isFinite(id) && id > 0 && text === `SO #${id}`) return true;
  return false;
}
