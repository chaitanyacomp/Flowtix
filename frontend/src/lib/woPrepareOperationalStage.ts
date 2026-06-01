/**
 * REGULAR SO → WO prepare operational substage (list + dashboard).
 * Mirrors backend `woPrepareOperational` on sales order payloads.
 */

import { REGULAR_TERMS } from "./flowTerminology";
import { rmControlCenterHref } from "./materialWorkflowLinks";
import { formatProcessStageDisplayLabel } from "./operationalErrorPresentation";

export type WoPrepareOperationalKey =
  | "RM_SHORTAGE"
  | "PURCHASE_GRN_PENDING"
  | "READY_FOR_WO"
  | "WO_PREPARE";

export type WoPrepareNextActionKey =
  | "RAISE_MR"
  | "OPEN_PURCHASE_PLAN"
  | "CREATE_WO"
  | "PREPARE_WO";

export type WoPrepareOperational = {
  key: WoPrepareOperationalKey;
  label: string;
  nextActionKey: WoPrepareNextActionKey;
  canCreateWorkOrder?: boolean;
  shortageRmCount?: number;
  pendingMaterialRequirements?: { id: number; docNo: string | null }[];
  pendingMrRefs?: string;
  primaryFgName?: string | null;
  pendingPoStatus?: string;
  pendingGrnStatus?: string;
};

export function woPreparePrepareHref(salesOrderId: number): string {
  return `/work-orders/prepare?salesOrderId=${encodeURIComponent(String(salesOrderId))}`;
}

/** RM Planning — review requirements, stock, and shortages (not PO/GRN execution). */
export function materialPlanningReviewHref(opts: {
  salesOrderId?: number;
  quotationId?: number;
  source?: string;
}): string {
  const p = new URLSearchParams();
  if (opts.source) p.set("source", opts.source);
  if (opts.salesOrderId != null && opts.salesOrderId > 0) {
    p.set("salesOrderId", String(opts.salesOrderId));
  }
  if (opts.quotationId != null && opts.quotationId > 0) {
    p.set("quotationId", String(opts.quotationId));
  }
  const q = p.toString();
  return q ? `/material-planning?${q}` : "/material-planning";
}

/** True when PO exists and GRN/receipt is the next procurement step (read-only heuristic). */
export function isPurchaseGrnReceiptStage(pendingGrnStatus?: string, pendingPoStatus?: string): boolean {
  const g = (pendingGrnStatus ?? "").toLowerCase();
  const p = (pendingPoStatus ?? "").toLowerCase();
  if (g.includes("awaiting grn") || g.includes("receipt pending")) return true;
  if (p.includes("po open") && !g.includes("no grn")) return true;
  return false;
}

/** Purchase & GRN — pending PR lines / Prepare RM PO. */
export function purchasePlanExecutionHref(opts: {
  salesOrderId?: number;
  materialRequirementId?: number;
  source?: string;
}): string {
  const p = new URLSearchParams();
  p.set("focus", "pending-requests");
  if (opts.source) p.set("source", opts.source);
  if (opts.salesOrderId != null && opts.salesOrderId > 0) {
    p.set("salesOrderId", String(opts.salesOrderId));
  }
  if (opts.materialRequirementId != null && opts.materialRequirementId > 0) {
    p.set("materialRequirementId", String(opts.materialRequirementId));
  }
  return `/rm-po-grn?${p.toString()}`;
}

/** Purchase & GRN — open PO list filtered for GRN / receipt work. */
export function purchaseGrnExecutionHref(opts: { salesOrderId?: number; source?: string }): string {
  const p = new URLSearchParams();
  p.set("focus", "open-pos");
  p.set("poStatus", "OPEN");
  if (opts.source) p.set("source", opts.source);
  if (opts.salesOrderId != null && opts.salesOrderId > 0) {
    p.set("salesOrderId", String(opts.salesOrderId));
  }
  return `/rm-po-grn?${p.toString()}`;
}

/** Dashboard / queue CTA: PR preparation vs GRN receipt from procurement status chips. */
export function resolvePurchaseExecutionCta(opts: {
  salesOrderId?: number;
  materialRequirementId?: number;
  pendingPoStatus?: string;
  pendingGrnStatus?: string;
  source?: string;
}): { label: string; href: string } {
  if (isPurchaseGrnReceiptStage(opts.pendingGrnStatus, opts.pendingPoStatus)) {
    return {
      label: REGULAR_TERMS.OPEN_PURCHASE_AND_GRN,
      href: purchaseGrnExecutionHref({
        salesOrderId: opts.salesOrderId,
        source: opts.source,
      }),
    };
  }
  return {
    label: REGULAR_TERMS.OPEN_PURCHASE_PLAN,
    href: purchasePlanExecutionHref({
      salesOrderId: opts.salesOrderId,
      materialRequirementId: opts.materialRequirementId,
      source: opts.source,
    }),
  };
}

export function woPreparePrimaryCta(
  soId: number,
  op: WoPrepareOperational | null | undefined,
): { label: string; to: string } {
  const prepare = woPreparePrepareHref(soId);
  if (!op) return { label: "Create Work Order", to: prepare };
  switch (op.nextActionKey) {
    case "OPEN_PURCHASE_PLAN": {
      const cta = resolvePurchaseExecutionCta({
        salesOrderId: soId,
        source: "dashboard",
        pendingPoStatus: op.pendingPoStatus,
        pendingGrnStatus: op.pendingGrnStatus,
      });
      return { label: cta.label, to: cta.href };
    }
    case "RAISE_MR":
      return {
        label: REGULAR_TERMS.OPEN_RM_CONTROL_CENTER,
        to: rmControlCenterHref({ salesOrderId: soId, onlyBlocked: true, returnTo: "sales-orders" }),
      };
    case "CREATE_WO":
      return { label: "Create Work Order", to: prepare };
    case "PREPARE_WO":
    default:
      return { label: "Review RM Readiness", to: prepare };
  }
}

export function woPreparePositionLabel(op: WoPrepareOperational | null | undefined, fallback: string): string {
  const raw = op?.label ?? fallback;
  return formatProcessStageDisplayLabel(raw);
}

/** Informational next-step text for list tables — never duplicates row CTA button labels. */
export function woPrepareNextActionStatusLabel(op: WoPrepareOperational | null | undefined): string {
  if (!op) return "WO preparation pending";
  switch (op.nextActionKey) {
    case "CREATE_WO":
      return "WO preparation pending";
    case "PREPARE_WO":
      return "Ready for WO planning";
    case "RAISE_MR":
      return "RM shortage — resolve in RM Control Center";
    case "OPEN_PURCHASE_PLAN":
      return isPurchaseGrnReceiptStage(op.pendingGrnStatus, op.pendingPoStatus)
        ? "GRN receipt pending"
        : "Procurement planning pending";
    default:
      return op.label || "WO preparation pending";
  }
}

export function regularProcessStageNextActionStatus(
  processStageKey: string | undefined,
  op?: WoPrepareOperational | null,
): string {
  switch (processStageKey) {
    case "WO_PENDING":
      return woPrepareNextActionStatusLabel(op);
    case "PRODUCTION_PENDING":
      return "Production start pending";
    case "QC_PENDING":
      return "QA completion pending";
    case "DISPATCH_PENDING":
      return "Dispatch pending";
    case "SALES_BILL_PENDING":
      return "Sales billing pending";
    default:
      return "—";
  }
}
