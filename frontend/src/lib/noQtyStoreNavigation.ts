/**
 * Store-safe NO_QTY navigation targets (P11-A16).
 * Admin keeps commercial Sales Orders list; Store/Production use planning hubs.
 */
export const NO_QTY_AGREEMENTS_HREF = "/no-qty-agreements";
export const NO_QTY_PLANNING_HUB_HREF = "/planning-dashboard";

export function isStoreLikePlanningRole(role: string | undefined | null): boolean {
  const r = String(role ?? "").trim().toUpperCase();
  return r === "STORE" || r === "PRODUCTION";
}

/** Agreement list landing — Admin uses commercial SO list; Store uses execution hub. */
export function noQtyAgreementListHref(role?: string | null, salesOrderId?: number): string {
  const base = isStoreLikePlanningRole(role) ? NO_QTY_AGREEMENTS_HREF : "/sales-orders?soType=NO_QTY";
  if (salesOrderId != null && salesOrderId > 0) {
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}salesOrderId=${encodeURIComponent(String(salesOrderId))}`;
  }
  return base;
}

export function noQtyPlanningHubOrAgreementsHref(role?: string | null): string {
  return isStoreLikePlanningRole(role) ? NO_QTY_AGREEMENTS_HREF : NO_QTY_PLANNING_HUB_HREF;
}

/** Store execution entry when sheet id is unknown — lands on NO_QTY Execution register for the SO. */
export function noQtyExecutionRegisterHref(salesOrderId: number, source?: string): string {
  const base = noQtyAgreementListHref("STORE", salesOrderId);
  if (!source) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}source=${encodeURIComponent(source)}`;
}
