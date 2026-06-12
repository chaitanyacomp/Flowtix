/** WO shortage procurement visibility — presentation only (Phase A). */

import {
  PROCUREMENT_STATUS_VOCABULARY,
  PROCUREMENT_TERMS,
  PROCUREMENT_WORKFLOW_STAGES,
} from "./procurementTerminology";

export const WO_PROCUREMENT_CONTINUITY = {
  PROCUREMENT_INITIATED: PROCUREMENT_STATUS_VOCABULARY.AWAITING_PR,
  PO_CREATED: PROCUREMENT_STATUS_VOCABULARY.PO_RELEASED,
  MATERIAL_INCOMING: PROCUREMENT_STATUS_VOCABULARY.GRN_PENDING,
  WAITING_GRN: PROCUREMENT_STATUS_VOCABULARY.GRN_PENDING,
  READY_FOR_ISSUE: PROCUREMENT_STATUS_VOCABULARY.RM_READY,
  COVERED_BY_INCOMING: (qty: string) => `${qty} covered by incoming PO`,
  WAITING_GRN_QTY: (qty: string) => `GRN pending: ${qty}`,
  PARTIAL_COVERAGE: "Procurement partially covering this WO",
  PENDING_GRN_CASE: "GRN pending for this WO",
  PROCUREMENT_ACTIVE: "Approved MR",
  TRACK_IN_RM_CONTROL: PROCUREMENT_TERMS.TRACK_PROCUREMENT,
  OPEN_RM_CONTROL_CENTER: PROCUREMENT_TERMS.OPEN_RM_CONTROL_CENTER,
} as const;

export function buildRmControlCenterHref(opts: {
  workOrderId?: number;
  rmItemId?: number | null;
  salesOrderId?: number | null;
  materialRequirementId?: number | null;
  returnTo?: string | null;
  onlyBlocked?: boolean;
}): string {
  const q = new URLSearchParams();
  if (opts.workOrderId != null && opts.workOrderId > 0) q.set("workOrderId", String(opts.workOrderId));
  if (opts.rmItemId != null && opts.rmItemId > 0) q.set("rmItemId", String(opts.rmItemId));
  if (opts.salesOrderId != null && opts.salesOrderId > 0) q.set("salesOrderId", String(opts.salesOrderId));
  if (opts.materialRequirementId != null && opts.materialRequirementId > 0) {
    q.set("materialRequirementId", String(opts.materialRequirementId));
  }
  if (opts.returnTo) q.set("returnTo", opts.returnTo);
  if (opts.onlyBlocked) q.set("onlyBlocked", "true");
  const s = q.toString();
  return s ? `/reports/rm-shortage?${s}` : "/reports/rm-shortage";
}

export function formatProcurementQty(n: number, unit?: string): string {
  const u = unit?.trim() ? ` ${unit}` : "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;
}

/** Maps dashboard / MR operational keys to continuous workflow labels. */
export function procurementStageLabelForKey(operationalKey: string | null | undefined): string {
  switch (String(operationalKey ?? "").trim()) {
    case "PR_PENDING_PO":
      return PROCUREMENT_STATUS_VOCABULARY.AWAITING_PO;
    case "SUPPLIER_PENDING":
      return PROCUREMENT_STATUS_VOCABULARY.PO_RELEASED;
    case "GRN_PENDING":
      return PROCUREMENT_STATUS_VOCABULARY.GRN_PENDING;
    case "PARTIAL_RECEIVED":
      return PROCUREMENT_STATUS_VOCABULARY.PARTIALLY_RECEIVED;
    case "RM_READY":
    case "PROCUREMENT_COMPLETE":
      return PROCUREMENT_STATUS_VOCABULARY.RM_READY;
    case "PROCUREMENT_PENDING":
      return PROCUREMENT_STATUS_VOCABULARY.AWAITING_PR;
    default:
      return PROCUREMENT_STATUS_VOCABULARY.AWAITING_PR;
  }
}

export function storeActionButtonLabel(key: string | null | undefined): string {
  switch (key) {
    case "REOPEN_REQUISITION":
      return "Reopen / Raise New Requisition";
    case "ESCALATE":
      return "Raise Store Requisition";
    case "CONTINUE_PROCUREMENT":
      return "Continue RM Requisition";
    case "WAIT_GRN":
      return WO_PROCUREMENT_CONTINUITY.TRACK_IN_RM_CONTROL;
    case "VIEW_PROCUREMENT":
      return PROCUREMENT_TERMS.TRACK_PROCUREMENT;
    case "ISSUE":
      return WO_PROCUREMENT_CONTINUITY.READY_FOR_ISSUE;
    case "CREATE_WO":
      return "Create Work Order";
    default:
      return "Review WO case";
  }
}

/** WO procurement lifecycle strip (display only). */
export const WO_PROCUREMENT_WORKFLOW_STAGES = PROCUREMENT_WORKFLOW_STAGES;

/** Maps backend `operationalKey` to strip index (0–4). */
export function woProcurementStageIndex(operationalKey: string | null | undefined): number {
  switch (String(operationalKey ?? "").trim()) {
    case "PR_PENDING_PO":
      return 1;
    case "SUPPLIER_PENDING":
      return 2;
    case "GRN_PENDING":
    case "PARTIAL_RECEIVED":
      return 3;
    case "RM_READY":
    case "PROCUREMENT_COMPLETE":
      return 4;
    case "PROCUREMENT_PENDING":
    default:
      return 0;
  }
}

/** Lifecycle-aware copy when PR list is empty on RM Control Center. */
export function prSectionEmptyMessage(opts: {
  escalationState?: string | null;
  prLineCount: number;
  procurementInitiated?: boolean;
}): string {
  if (opts.prLineCount > 0) return "";
  if (!opts.procurementInitiated) {
    return "No procurement handoff yet — add shortage lines to the WO case first.";
  }
  switch (opts.escalationState) {
    case "ESCALATION_PENDING":
    case "PARTIALLY_ESCALATED":
      return "Approved MR — create the Purchase Request in Procurement Workspace.";
    case "PROCUREMENT_IN_PROGRESS":
      return "Awaiting PR — Purchase Request pending from Store.";
    case "WAITING_GRN":
      return "GRN pending — material incoming from released PO.";
    case "PROCUREMENT_COMPLETED":
      return "RM Ready — procurement completed for this WO case.";
    default:
      return "Awaiting PR — create Purchase Request in Procurement Workspace.";
  }
}

export function buildProcurementWorkspaceHref(opts: {
  salesOrderId?: number | null;
  workOrderId?: number | null;
  rmItemId?: number | null;
  materialRequirementId?: number | null;
  returnTo?: string | null;
  demandPool?: "REGULAR_SO" | "MPRS" | "STOCK_REPLENISHMENT" | null;
  sourceType?: string | null;
}): string {
  const q = new URLSearchParams();
  const demandPool =
    opts.demandPool ??
    (opts.sourceType === "MONTHLY_PLAN"
      ? "MPRS"
      : opts.sourceType === "STOCK_REPLENISHMENT"
        ? "STOCK_REPLENISHMENT"
        : (opts.salesOrderId != null && opts.salesOrderId > 0) ||
            (opts.workOrderId != null && opts.workOrderId > 0) ||
            opts.sourceType === "SALES_ORDER"
          ? "REGULAR_SO"
          : null);
  if (demandPool) q.set("demandPool", demandPool);
  if (opts.salesOrderId != null && opts.salesOrderId > 0) q.set("salesOrderId", String(opts.salesOrderId));
  if (opts.workOrderId != null && opts.workOrderId > 0) q.set("workOrderId", String(opts.workOrderId));
  if (opts.rmItemId != null && opts.rmItemId > 0) q.set("rmItemId", String(opts.rmItemId));
  if (opts.materialRequirementId != null && opts.materialRequirementId > 0) {
    q.set("materialRequirementId", String(opts.materialRequirementId));
  }
  if (opts.returnTo) q.set("returnTo", opts.returnTo);
  const s = q.toString();
  return s ? `/procurement-planning?${s}` : "/procurement-planning?demandPool=REGULAR_SO";
}

export function prStatusLabel(status: string | null | undefined): string {
  const s = String(status ?? "").trim();
  if (!s) return "Purchase Request";
  if (s === "PENDING_PURCHASE") return PROCUREMENT_STATUS_VOCABULARY.AWAITING_PO;
  if (s === "PARTIALLY_ORDERED") return "PO partially created";
  if (s === "ORDERED") return "Fully ordered";
  return s.replaceAll("_", " ");
}
