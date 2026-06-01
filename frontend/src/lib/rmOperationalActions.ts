/**
 * RM Control Center — Store operational actions (presentation only).
 * Reuses MR lifecycle statuses and workspace supply signals; no stock/PO/GRN math changes.
 */

const EPS = 1e-6;

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

export type TraceStepKey = "wo" | "mr" | "pr" | "po" | "grn" | "issue";

export type TraceStepState = "done" | "active" | "waiting" | "pending" | "na";

export type TraceStep = {
  key: TraceStepKey;
  label: string;
  statusLabel: string;
  state: TraceStepState;
};

export type OperationalActionButton = {
  id: string;
  label: string;
  kind: "primary" | "secondary" | "outline" | "info";
  disabled?: boolean;
  href?: string;
  action?: "approve" | "send-to-purchase" | "reopen" | "close" | "raise-mr";
  description?: string;
};

export type RmOperationalContextInput = {
  workOrderLabel?: string | null;
  mrStatus: string | null;
  mrDocNo: string | null;
  mrId: number | null;
  prLineCount: number;
  poLineCount: number;
  pendingGrnQty: number;
  receivedGrnQty: number;
  anyIssueable: boolean;
  readyToRelease: boolean;
  hasWaitingPmr: boolean;
  notEscalated: boolean;
  requiresReopenConfirm?: boolean;
  workOrderId?: number | null;
  salesOrderId?: number | null;
  rmItemId?: number | null;
  issueHref: string;
  productionHref: string;
  prepareWoHref?: string | null;
  grnHref?: string | null;
  procurementWorkspaceHref?: string | null;
  stockReadyForIssue?: boolean;
  procurementCompletedForCase?: boolean;
  queueType?: string | null;
  requisitionStatus?: string | null;
  procurementStatus?: string | null;
  nextOwner?: string | null;
  nextAction?: string | null;
};

export type RmOperationalContext = {
  traceSteps: TraceStep[];
  buttons: OperationalActionButton[];
  owner: string;
  nextAction: string;
  requisitionStatus: string;
  procurementStatus: string;
};

export function mrStatusDisplayLabel(status: string | null | undefined): string {
  switch (String(status ?? "").trim()) {
    case "DRAFT":
      return "Draft";
    case "PENDING_APPROVAL":
      return "Pending Store Approval";
    case "APPROVED":
      return "Approved by Store";
    case "SENT_TO_PURCHASE":
      return "Sent to Purchase";
    case "PROCUREMENT_IN_PROGRESS":
      return "Procurement in Progress";
    case "PARTIALLY_PROCURED":
      return "Partially Procured";
    case "FULLY_PROCURED":
      return "Fully Procured";
    case "CLOSED":
      return "Closed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status ? String(status).replaceAll("_", " ") : "Not raised";
  }
}

function partialGrn(input: RmOperationalContextInput): boolean {
  return n(input.pendingGrnQty) > EPS && n(input.receivedGrnQty) > EPS;
}

function mrTraceState(status: string | null, hasMr: boolean): TraceStepState {
  if (!hasMr) return "pending";
  if (["DRAFT", "PENDING_APPROVAL"].includes(String(status ?? ""))) return "active";
  if (["CLOSED", "CANCELLED"].includes(String(status ?? ""))) return "na";
  return "done";
}

export function resolveRmTraceSteps(input: RmOperationalContextInput): TraceStep[] {
  const hasMr = Boolean(input.mrId);
  const mrLabel = mrStatusDisplayLabel(input.mrStatus);
  const prDone = input.prLineCount > 0;
  const poDone = input.poLineCount > 0;
  const grnWaiting = poDone && n(input.pendingGrnQty) > EPS;
  const grnDone = poDone && n(input.pendingGrnQty) <= EPS && n(input.receivedGrnQty) > EPS;
  const issueActive = input.anyIssueable;
  const issueDone = input.readyToRelease;

  return [
    {
      key: "wo",
      label: "Work Order",
      statusLabel: input.workOrderId ? input.workOrderLabel?.trim() || `WO #${input.workOrderId}` : "WO not created",
      state: input.workOrderId ? "done" : "pending",
    },
    {
      key: "mr",
      label: "RM Requisition",
      statusLabel: hasMr
        ? [input.mrDocNo, mrLabel].filter(Boolean).join(" · ")
        : "Not raised",
      state: mrTraceState(input.mrStatus, hasMr),
    },
    {
      key: "pr",
      label: "Purchase Request",
      statusLabel: prDone ? `${input.prLineCount} line(s)` : hasMr ? "Pending" : "—",
      state: prDone ? "done" : hasMr && ["SENT_TO_PURCHASE", "APPROVED"].includes(String(input.mrStatus)) ? "waiting" : "pending",
    },
    {
      key: "po",
      label: "Purchase Order",
      statusLabel: poDone ? `${input.poLineCount} PO line(s)` : prDone ? "Pending" : "—",
      state: poDone ? "done" : prDone ? "waiting" : "pending",
    },
    {
      key: "grn",
      label: "GRN",
      statusLabel: grnDone
        ? `Received ${n(input.receivedGrnQty).toLocaleString()}`
        : grnWaiting
          ? `Pending ${n(input.pendingGrnQty).toLocaleString()}`
          : poDone
            ? "Awaiting receipt"
            : "—",
      state: grnDone ? "done" : grnWaiting || partialGrn(input) ? "active" : poDone ? "waiting" : "pending",
    },
    {
      key: "issue",
      label: "Material Issue",
      statusLabel: issueDone
        ? "Issued to production"
        : issueActive
          ? "Ready to issue"
          : input.hasWaitingPmr
            ? "Waiting stock"
            : "—",
      state: issueDone ? "done" : issueActive ? "active" : input.hasWaitingPmr ? "waiting" : "pending",
    },
  ];
}

export function resolveRmOperationalContext(input: RmOperationalContextInput): RmOperationalContext {
  const traceSteps = resolveRmTraceSteps(input);
  const buttons: OperationalActionButton[] = [];
  const mrStatus = String(input.mrStatus ?? "").trim();
  const hasMr = Boolean(input.mrId);
  const partial = partialGrn(input);

  if (input.readyToRelease) {
    buttons.push({
      id: "release-wo",
      label: "Release WO for Production",
      kind: "primary",
      href: input.productionHref,
      description: "Material issued — production can continue on this work order.",
    });
  } else if (
    mrStatus === "FULLY_PROCURED" &&
    !input.workOrderId &&
    input.prepareWoHref
  ) {
    buttons.push({
      id: "create-wo-post-grn",
      label: "Create Work Order",
      kind: "primary",
      href: input.prepareWoHref,
      description: "RM received in Store after GRN. Create the work order to open PMR and material issue.",
    });
  } else if (input.anyIssueable && !input.workOrderId) {
    buttons.push({
      id: "create-wo",
      label: "Create Work Order",
      kind: "primary",
      href: input.prepareWoHref ?? undefined,
      description: "WO not created yet. Complete RM procurement and create the work order before material issue.",
    });
  } else if (input.anyIssueable) {
    buttons.push({
      id: "open-issue",
      label: "Issue RM to Production",
      kind: "primary",
      href: input.issueHref,
      description: "Free store stock is available — issue RM against the open material request.",
    });
  } else if (
    (input.stockReadyForIssue || input.procurementCompletedForCase) &&
    input.workOrderId &&
    input.issueHref
  ) {
    buttons.push({
      id: "issue-to-production",
      label: "Issue RM to Production",
      kind: "primary",
      href: input.issueHref,
      description: "RM is in Store after procurement — issue to Production before starting the work order.",
    });
  } else if (partial) {
    buttons.push({
      id: "partial-grn",
      label: "Partial RM Received",
      kind: "info",
      disabled: true,
      description: "Some quantity is received; balance GRN or issue partial RM when store is ready.",
      href: input.grnHref ?? undefined,
    });
  } else if (input.poLineCount > 0 && n(input.pendingGrnQty) > EPS) {
    buttons.push({
      id: "wait-grn",
      label: "Waiting for GRN",
      kind: "info",
      disabled: true,
      description: "Purchase order exists — record goods receipt when material arrives.",
      href: input.grnHref ?? undefined,
    });
  } else if (
    hasMr &&
    mrStatus === "SENT_TO_PURCHASE" &&
    input.procurementWorkspaceHref
  ) {
    buttons.push({
      id: "open-procurement",
      label: "Open Procurement Workspace",
      kind: "primary",
      href: input.procurementWorkspaceHref,
      description: "Requisition sent to Purchase — create the Purchase Request from Procurement Workspace.",
    });
  } else if (
    input.prLineCount > 0 ||
    input.queueType === "WAITING_PURCHASE_ACTION" ||
    (hasMr &&
      ["PROCUREMENT_IN_PROGRESS", "PARTIALLY_PROCURED"].includes(mrStatus) &&
      input.poLineCount === 0)
  ) {
    if (input.poLineCount === 0 && !["APPROVED", "DRAFT", "PENDING_APPROVAL", "SENT_TO_PURCHASE"].includes(mrStatus)) {
      buttons.push({
        id: "wait-purchase",
        label: "Waiting for Purchase Action",
        kind: "info",
        disabled: true,
        description: "RM Requisition is with Purchase — PR/PO will be created from the requisition.",
        href: input.procurementWorkspaceHref ?? undefined,
      });
    }
  }

  if (!buttons.length) {
    if (["DRAFT", "PENDING_APPROVAL"].includes(mrStatus) && hasMr) {
      buttons.push({
        id: "approve",
        label: "Approve Requisition",
        kind: "primary",
        action: "approve",
        description: "Store approval required before Purchase can act.",
      });
    } else if (mrStatus === "APPROVED" && hasMr) {
      buttons.push({
        id: "send-purchase",
        label: "Send to Purchase",
        kind: "primary",
        action: "send-to-purchase",
        description: "Release the requisition to Purchase for PR/PO creation.",
      });
    } else if (input.requiresReopenConfirm && !hasMr) {
      buttons.push({
        id: "raise-mr-reopen",
        label: "Reopen / Raise New Requisition",
        kind: "primary",
        action: "raise-mr",
        description:
          "Previous requisition was closed. Creating a new requisition will restart procurement for the same shortage.",
      });
    } else if (input.notEscalated || !hasMr) {
      buttons.push({
        id: "raise-mr",
        label: "Raise Store Requisition",
        kind: "primary",
        action: "raise-mr",
        description: input.workOrderId
          ? "Create or refresh the WO RM requisition for shortage lines on this case."
          : "Create the SO-level RM requisition before the work order is created.",
      });
    }
  }

  if (
    hasMr &&
    ["APPROVED", "SENT_TO_PURCHASE"].includes(mrStatus) &&
    !buttons.some((b) => b.action === "reopen")
  ) {
    buttons.push({
      id: "reopen",
      label: "Reopen Requisition",
      kind: "outline",
      action: "reopen",
      description: "Return to Store for review before procurement progresses further.",
    });
  }

  if (hasMr && !["CLOSED", "CANCELLED"].includes(mrStatus)) {
    buttons.push({
      id: "close",
      label: "Close Requisition",
      kind: "outline",
      action: "close",
      description: "Close this WO RM requisition when shortage is resolved or no longer needed.",
    });
  }

  const owner =
    input.nextOwner?.trim() ||
    (mrStatus === "SENT_TO_PURCHASE" || input.queueType === "WAITING_PURCHASE_ACTION"
      ? "Purchase Department"
      : "Store Department");

  const nextAction =
    input.nextAction?.trim() ||
    buttons.find((b) => b.kind === "primary" && !b.disabled)?.label ||
    buttons[0]?.label ||
    "Review case";

  return {
    traceSteps,
    buttons,
    owner,
    nextAction,
    requisitionStatus:
      mrStatus === "SENT_TO_PURCHASE"
        ? "Sent to Purchase"
        : input.requisitionStatus?.trim() || mrStatusDisplayLabel(input.mrStatus),
    procurementStatus:
      input.procurementStatus?.trim() ||
      (input.readyToRelease
        ? "Material issued / release ready"
        : input.anyIssueable
          ? "Stock available for issue"
          : partial
            ? "Partially received"
            : input.poLineCount > 0
              ? "PO created / GRN pending"
              : input.prLineCount > 0
                ? "Purchase request created"
                : input.stockReadyForIssue || input.procurementCompletedForCase
                  ? "RM ready in Store"
                  : hasMr
                    ? "RM Requisition active"
                    : "Not escalated"),
  };
}
