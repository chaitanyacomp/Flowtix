/**
 * QA workspace presentation — queue rows, completion copy, navigation labels.
 * Business rules unchanged; labels and operator flow only.
 */

import { PRODUCTION_QA_TERMS } from "./productionQaTerminology";

export type QualityQueueRowKind =
  | "PENDING_QC"
  | "REWORK_PENDING"
  | "REWORK_SUPERVISOR"
  | "HOLD_DECISION"
  | "CUSTOMER_RETURN";

export type QualityQueueRow = {
  id: string;
  kind: QualityQueueRowKind;
  label: string;
  subtitle: string;
  qtyLabel: string;
  anchor: string;
  productionId?: number;
  dispositionId?: number;
  customerReturnId?: number;
};

export type QcCompletionOutcome = "ACCEPTED" | "REJECTED" | "REWORK" | "HOLD";

const EPS = 1e-6;

export type QcCompletionSplit = {
  acceptedQty: number;
  rejectedQty: number;
  reworkQty: number;
  holdQty: number;
  scrapQty: number;
};

export function resolveQcCompletionOutcome(split: QcCompletionSplit): QcCompletionOutcome {
  const { acceptedQty, rejectedQty, reworkQty, holdQty, scrapQty } = split;
  if (rejectedQty <= EPS) return "ACCEPTED";
  if (reworkQty > EPS && holdQty <= EPS && scrapQty <= EPS) return "REWORK";
  if (holdQty > EPS && reworkQty <= EPS && scrapQty <= EPS) return "HOLD";
  if (scrapQty > EPS && reworkQty <= EPS && holdQty <= EPS) return "REJECTED";
  if (reworkQty >= holdQty && reworkQty >= scrapQty && reworkQty > EPS) return "REWORK";
  if (holdQty >= scrapQty && holdQty > EPS) return "HOLD";
  if (rejectedQty > EPS || scrapQty > EPS) return "REJECTED";
  if (acceptedQty > EPS) return "ACCEPTED";
  return "ACCEPTED";
}

export function formatQcCompletionMessage(outcome: QcCompletionOutcome): string {
  switch (outcome) {
    case "ACCEPTED":
      return "Quality Inspection completed. Material released for Dispatch.";
    case "REJECTED":
      return "Inspection completed. Rejected quantity recorded.";
    case "REWORK":
      return "Inspection completed. Material moved to Rework.";
    case "HOLD":
      return "Inspection completed. Material placed on Hold.";
    default:
      return "Quality Inspection completed.";
  }
}

export function qcCompletionPostActionHash(outcome: QcCompletionOutcome): string | null {
  if (outcome === "REWORK") return "qc-rework-pending";
  if (outcome === "HOLD") return "qc-hold-decisions";
  return null;
}

export type QualityQueuePendingQcInput = {
  productionId: number;
  itemName: string;
  workOrderLabel: string;
  pendingQty: number;
};

export type QualityQueueDispositionInput = {
  id: number;
  kind: "REWORK_PENDING" | "REWORK_SUPERVISOR" | "HOLD_DECISION";
  itemName: string;
  qty: number;
  workOrderLabel: string;
  qcDocNo?: string | null;
};

export type QualityQueueCustomerReturnInput = {
  id: number;
  returnNo: string;
  itemName?: string | null;
  qty: number;
};

function queueKindLabel(kind: QualityQueueRowKind): string {
  switch (kind) {
    case "PENDING_QC":
      return PRODUCTION_QA_TERMS.PENDING_QC;
    case "REWORK_PENDING":
      return PRODUCTION_QA_TERMS.REWORK_PENDING_QA;
    case "REWORK_SUPERVISOR":
      return PRODUCTION_QA_TERMS.REWORK_SUPERVISOR;
    case "HOLD_DECISION":
      return PRODUCTION_QA_TERMS.HOLD_DECISION;
    case "CUSTOMER_RETURN":
      return PRODUCTION_QA_TERMS.CUSTOMER_RETURN_INSPECTION;
    default:
      return "QA";
  }
}

function queueKindPriority(kind: QualityQueueRowKind): number {
  switch (kind) {
    case "PENDING_QC":
      return 0;
    case "REWORK_SUPERVISOR":
      return 1;
    case "REWORK_PENDING":
      return 2;
    case "HOLD_DECISION":
      return 3;
    case "CUSTOMER_RETURN":
      return 4;
    default:
      return 9;
  }
}

export function buildQualityQueueRows(input: {
  pendingQc: QualityQueuePendingQcInput[];
  dispositions: QualityQueueDispositionInput[];
  customerReturns: QualityQueueCustomerReturnInput[];
  fmtQty?: (n: number) => string;
}): QualityQueueRow[] {
  const fmt = input.fmtQty ?? ((n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3)));
  const rows: QualityQueueRow[] = [];

  for (const p of input.pendingQc) {
    if (p.pendingQty <= EPS) continue;
    rows.push({
      id: `pending-qc-${p.productionId}`,
      kind: "PENDING_QC",
      label: queueKindLabel("PENDING_QC"),
      subtitle: `${p.itemName} · ${p.workOrderLabel}`,
      qtyLabel: fmt(p.pendingQty),
      anchor: "#qc-production-pending",
      productionId: p.productionId,
    });
  }

  for (const d of input.dispositions) {
    if (d.qty <= EPS) continue;
    const kind = d.kind;
    const anchor =
      kind === "REWORK_SUPERVISOR"
        ? "#qc-rework-supervisor"
        : kind === "REWORK_PENDING"
          ? "#qc-rework-pending"
          : "#qc-hold-decisions";
    rows.push({
      id: `${kind.toLowerCase()}-${d.id}`,
      kind,
      label: queueKindLabel(kind),
      subtitle: [d.itemName, d.workOrderLabel, d.qcDocNo ? `QC ${d.qcDocNo}` : null].filter(Boolean).join(" · "),
      qtyLabel: fmt(d.qty),
      anchor,
      dispositionId: d.id,
    });
  }

  for (const c of input.customerReturns) {
    if (c.qty <= EPS) continue;
    rows.push({
      id: `customer-return-${c.id}`,
      kind: "CUSTOMER_RETURN",
      label: queueKindLabel("CUSTOMER_RETURN"),
      subtitle: [c.returnNo, c.itemName].filter(Boolean).join(" · "),
      qtyLabel: fmt(c.qty),
      anchor: "#qc-customer-returns",
      customerReturnId: c.id,
    });
  }

  return rows.sort((a, b) => {
    const p = queueKindPriority(a.kind) - queueKindPriority(b.kind);
    if (p !== 0) return p;
    return a.subtitle.localeCompare(b.subtitle);
  });
}

export function buildQcBackLink(params: {
  fromNoQtySo: boolean;
  source: string;
  from: string;
  role: string;
}): { to: string; label: string } | null {
  if (params.fromNoQtySo) return null;
  const { source, from, role } = params;
  const fromPending = source === "pending-actions" || from === "pending-actions";
  const fromProduction = from === "production" || from === "production_screen";
  const fromDashboard = source === "dashboard" || from === "dashboard";
  const isQaRole = role === "QA";

  if (fromProduction || (role === "PRODUCTION" && !fromDashboard && !fromPending)) {
    return { to: "/production", label: "Back to Production Workspace" };
  }
  if (fromPending || fromDashboard) {
    return {
      to: "/dashboard",
      label: isQaRole ? "Back to Quality Inspection Dashboard" : "Back to Production Dashboard",
    };
  }
  if (isQaRole) {
    return { to: "/dashboard", label: "Back to Quality Inspection Dashboard" };
  }
  if (role === "PRODUCTION") {
    return { to: "/production", label: "Back to Production Workspace" };
  }
  return { to: "/dashboard", label: "Back to Production Dashboard" };
}

export type QcEmbeddedStageStep = {
  label: string;
  active: boolean;
  done: boolean;
  href?: string;
};

export function buildQcEmbeddedStageSteps(showEmbedded: boolean): QcEmbeddedStageStep[] {
  if (!showEmbedded) return [];
  return [
    { label: "Production", active: false, done: true, href: "/production" },
    { label: "Quality Inspection", active: true, done: false },
    { label: "Dispatch", active: false, done: false, href: "/dispatch" },
  ];
}

export function buildQcWorkspaceBreadcrumb(params: {
  showEmbedded: boolean;
  fromDashboard: boolean;
  role: string;
}): Array<{ label: string; href?: string }> {
  const crumbs: Array<{ label: string; href?: string }> = [];
  if (params.showEmbedded) {
    crumbs.push(
      { label: PRODUCTION_QA_TERMS.PRODUCTION_DASHBOARD_TITLE, href: "/dashboard" },
      { label: PRODUCTION_QA_TERMS.PRODUCTION_WORKSPACE_TITLE, href: "/production" },
      { label: "Quality Inspection" },
    );
    return crumbs;
  }
  if (params.fromDashboard || params.role === "QA") {
    crumbs.push(
      { label: PRODUCTION_QA_TERMS.DASHBOARD_TITLE, href: "/dashboard" },
      { label: PRODUCTION_QA_TERMS.WORKSPACE_TITLE },
    );
    return crumbs;
  }
  crumbs.push(
    { label: PRODUCTION_QA_TERMS.PRODUCTION_DASHBOARD_TITLE, href: "/dashboard" },
    { label: PRODUCTION_QA_TERMS.WORKSPACE_TITLE },
  );
  return crumbs;
}
