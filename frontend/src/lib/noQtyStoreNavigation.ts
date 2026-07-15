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

export type NoQtyAgreementHrefOpts = {
  action?: string | null;
  highlight?: string | null;
};

/** Agreement list landing — Admin uses commercial SO list; Store uses execution hub. */
export function noQtyAgreementListHref(
  role?: string | null,
  salesOrderId?: number,
  opts?: NoQtyAgreementHrefOpts,
): string {
  const base = isStoreLikePlanningRole(role) ? NO_QTY_AGREEMENTS_HREF : "/sales-orders?soType=NO_QTY";
  const params = new URLSearchParams();
  if (salesOrderId != null && salesOrderId > 0) {
    params.set("salesOrderId", String(salesOrderId));
  }
  if (opts?.action) params.set("action", String(opts.action));
  if (opts?.highlight) params.set("highlight", String(opts.highlight));
  const qs = params.toString();
  if (!qs) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${qs}`;
}

/** Admin FG disposition / Recovery close workspace for a NO_QTY Agreement. */
export function noQtyFgDispositionWorkspaceHref(salesOrderId: number): string {
  return noQtyAgreementListHref("ADMIN", salesOrderId, { action: "no-qty-fg-disposition" });
}

/** Admin waiver/close workspace for a NO_QTY Agreement. */
export function noQtyWaiverCloseHref(salesOrderId: number): string {
  return noQtyAgreementListHref("ADMIN", salesOrderId, { action: "no-qty-close" });
}

/** Focused agreement with downstream blockers highlighted. */
export function noQtyDownstreamBlockerHref(role: string | null | undefined, salesOrderId: number): string {
  return noQtyAgreementListHref(role, salesOrderId, { highlight: "downstream" });
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
