/**
 * Regular SO Create Purchase Request from RM Control Center (presentation + request helpers).
 */

export function isRegularSoOrderType(orderType: string | null | undefined): boolean {
  const t = String(orderType ?? "").trim().toUpperCase();
  return !t || t === "NORMAL";
}

export function regularSoPurchaseRequestSuccessMessage(salesOrderDocNo: string | null | undefined, salesOrderId?: number | null): string {
  const label = String(salesOrderDocNo ?? "").trim() || (salesOrderId != null && salesOrderId > 0 ? `SO #${salesOrderId}` : "sales order");
  return `Purchase Request created for ${label}.`;
}

export function regularSoPurchaseRequestAlreadyExistsMessage(
  salesOrderDocNo: string | null | undefined,
  salesOrderId?: number | null,
): string {
  const label = String(salesOrderDocNo ?? "").trim() || (salesOrderId != null && salesOrderId > 0 ? `SO #${salesOrderId}` : "sales order");
  return `Purchase Request already exists for ${label}.`;
}

/** Prefer the dedicated Regular SO ensure-MR + create-PR path (Store → Purchase handoff). */
export function shouldCreatePurchaseRequestViaRegularSoEndpoint(input: {
  materialRequirementId?: number | null;
  salesOrderId?: number | null;
  orderType?: string | null;
  prefersProcurementWorkspace?: boolean;
}): boolean {
  if (input.prefersProcurementWorkspace) return false;
  const soId = Number(input.salesOrderId ?? 0);
  if (!Number.isFinite(soId) || soId <= 0) return false;
  if (!isRegularSoOrderType(input.orderType)) return false;
  return true;
}
