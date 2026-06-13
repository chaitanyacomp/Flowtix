/**
 * RM Control Center guided workflow — presentation orchestration only.
 * Reuses backend storeAction keys and escalation states; does not change calculations.
 */

import {
  buildProcurementWorkspaceHref,
  buildRmControlCenterHref,
  WO_PROCUREMENT_WORKFLOW_STAGES,
} from "./woProcurementContinuity";
import { PROCUREMENT_TERMS } from "./procurementTerminology";
import { isStockCommittedElsewhere, stockCommittedElsewhereSummary } from "./stockCommitmentVisibility";
import { buildRmPoDetailHref } from "./rmPurchaseWoContinuity";
import { productionWorkspaceHref } from "./materialWorkflowLinks";

const EPS = 1e-6;

export type GuidedWorkflowPhase =
  | "A_BLOCKED"
  | "B_MR_ESCALATED"
  | "C_PR_CREATED"
  | "D_PO_GRN_PENDING"
  | "E_READY_TO_ISSUE"
  | "F_ISSUED_OPEN_PRODUCTION"
  | "IDLE";

export type GuidedPrimaryActionKind =
  | "START_PROCUREMENT"
  | "CREATE_PR"
  | "CREATE_PO"
  | "RECORD_GRN"
  | "ISSUE_RM"
  | "OPEN_PRODUCTION"
  | "NONE";

export type GuidedWorkflowInput = {
  storeActionKey: string;
  escalation: {
    state: string;
    procurementInitiated: boolean;
    headline?: string;
    description?: string;
    materialRequirementDocNo?: string | null;
  } | null;
  caseSupply: {
    summary: {
      prLineCount?: number;
      poLineCount?: number;
      pendingGrnQty?: number;
      receivedGrnQty?: number;
      openMrCount?: number;
    };
    prLines?: Array<{ pendingPoQty?: number; orderedQty?: number }>;
    poLines?: Array<{ pendingGrnQty?: number; purchaseOrderId?: number }>;
  } | null;
  rmLines: Array<{
    physicalUsableStockQty?: number;
    freeStockQty?: number;
    shortageAfterReservationQty?: number;
    netShortageAfterIncomingQty?: number;
    coveredByIncomingQty?: number;
    blockerReason?: string;
  }>;
  anyIssueable: boolean;
  hasWaitingPmr: boolean;
  workOrderId: number;
  salesOrderId?: number | null;
  orderType?: string | null;
  cycleId?: number | null;
  materialRequirementId?: number | null;
  rmItemId?: number | null;
  mrStatus?: string | null;
  requiresReopenConfirm?: boolean;
  blockerExplanation?: string | null;
  primaryPoId?: number | null;
};

export type GuidedWorkflowResolution = {
  phase: GuidedWorkflowPhase;
  phaseTitle: string;
  phaseDetail: string;
  ownerLabel: string;
  /** Single headline — never contradicts escalation (e.g. not "not started" when MR exists). */
  statusHeadline: string;
  primaryAction: {
    kind: GuidedPrimaryActionKind;
    label: string;
    href?: string;
  };
  showMaterialIssueSection: boolean;
  showProductionLink: boolean;
  timelineStepIndex: number;
  hideProcurementExecutionNav: boolean;
};

export const GUIDED_WORKFLOW_CTA = {
  DASHBOARD_CONTINUE: "Continue RM Resolution",
} as const;

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function sumPendingPo(prLines: Array<{ pendingPoQty?: number }> | undefined): number {
  return (prLines ?? []).reduce((s: number, pr) => s + Math.max(0, n(pr.pendingPoQty)), 0);
}

export function resolveGuidedWorkflow(input: GuidedWorkflowInput): GuidedWorkflowResolution {
  const esc = input.escalation;
  const summary = input.caseSupply?.summary ?? {};
  const prCount = n(summary.prLineCount);
  const poCount = n(summary.poLineCount);
  const pendingGrn = n(summary.pendingGrnQty);
  const pendingPo = sumPendingPo(input.caseSupply?.prLines);
  const procurementInitiated = Boolean(esc?.procurementInitiated);
  const mrDoc = esc?.materialRequirementDocNo ?? null;

  const rmHref = buildRmControlCenterHref({
    workOrderId: input.workOrderId,
    salesOrderId: input.salesOrderId,
    rmItemId: input.rmItemId,
  });
  const procHref = buildProcurementWorkspaceHref({
    workOrderId: input.workOrderId,
    salesOrderId: input.salesOrderId,
    rmItemId: input.rmItemId,
    materialRequirementId: input.materialRequirementId,
    returnTo: "rm-control-center",
  });
  const requisitionHref =
    input.salesOrderId && input.salesOrderId > 0
      ? `/material-planning?salesOrderId=${input.salesOrderId}`
      : procHref;
  const grnHref =
    input.primaryPoId && input.primaryPoId > 0
      ? buildRmPoDetailHref(input.primaryPoId, {
          salesOrderId: input.salesOrderId,
          from: "rm-purchase",
        })
      : "/rm-po-grn?focus=pending-requests";
  const issueHref = input.materialRequirementId
    ? `/material-issue?workOrderId=${input.workOrderId}&returnTo=rm-control-center`
    : `/material-issue?workOrderId=${input.workOrderId}&returnTo=rm-control-center`;
  const productionHref = productionWorkspaceHref(input.workOrderId, undefined, {
    salesOrderId: input.salesOrderId ?? undefined,
    orderType: input.orderType,
    cycleId: input.cycleId ?? undefined,
  });

  let phase: GuidedWorkflowPhase = "IDLE";
  let timelineStepIndex = 0;

  if (input.anyIssueable) {
    phase = "E_READY_TO_ISSUE";
    timelineStepIndex = 4;
  } else if (
    esc?.state === "PROCUREMENT_COMPLETED" ||
    input.storeActionKey === "ISSUE" ||
    input.rmLines.some((l) => l.blockerReason === "Ready for material issue")
  ) {
    phase = "E_READY_TO_ISSUE";
    timelineStepIndex = 4;
  } else if (pendingGrn > EPS || input.storeActionKey === "WAIT_GRN" || esc?.state === "WAITING_GRN") {
    phase = "D_PO_GRN_PENDING";
    timelineStepIndex = 3;
  } else if (poCount > 0 && pendingGrn <= EPS && esc?.state === "PROCUREMENT_COMPLETED") {
    phase = input.hasWaitingPmr ? "E_READY_TO_ISSUE" : "F_ISSUED_OPEN_PRODUCTION";
    timelineStepIndex = 4;
  } else if (prCount > 0 && pendingPo > EPS) {
    phase = "C_PR_CREATED";
    timelineStepIndex = 2;
  } else if (
    input.mrStatus === "SENT_TO_PURCHASE" ||
    (procurementInitiated && input.mrStatus && !["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(input.mrStatus))
  ) {
    phase = "B_MR_ESCALATED";
    timelineStepIndex = 1;
  } else if (procurementInitiated || input.storeActionKey === "CONTINUE_PROCUREMENT" || input.storeActionKey === "VIEW_PROCUREMENT") {
    phase = "B_MR_ESCALATED";
    timelineStepIndex = 1;
  } else if (
    input.storeActionKey === "ESCALATE" ||
    input.storeActionKey === "REOPEN_REQUISITION" ||
    input.requiresReopenConfirm ||
    esc?.state === "NOT_ESCALATED" ||
    input.rmLines.some((l) => n(l.netShortageAfterIncomingQty) > EPS || n(l.shortageAfterReservationQty) > EPS)
  ) {
    phase = "A_BLOCKED";
    timelineStepIndex = 0;
  }

  const shortageLine = input.rmLines.find((l) => n(l.shortageAfterReservationQty) > EPS) ?? input.rmLines[0];
  const committedElsewhereLine = input.rmLines.find((l) =>
    isStockCommittedElsewhere(n(l.physicalUsableStockQty), n(l.freeStockQty)),
  );
  const blockerText = committedElsewhereLine
    ? stockCommittedElsewhereSummary()
    : input.blockerExplanation?.trim() ||
      shortageLine?.blockerReason?.trim() ||
      "RM is blocked until store completes procurement and issue.";

  const base = {
    ownerLabel: "Store",
    showMaterialIssueSection: phase === "E_READY_TO_ISSUE",
    showProductionLink: phase === "F_ISSUED_OPEN_PRODUCTION",
    timelineStepIndex,
    hideProcurementExecutionNav: phase === "A_BLOCKED" || phase === "E_READY_TO_ISSUE" || phase === "F_ISSUED_OPEN_PRODUCTION",
  };

  switch (phase) {
    case "A_BLOCKED":
      return {
        ...base,
        phase,
        phaseTitle: input.requiresReopenConfirm
          ? "Previous requisition closed"
          : committedElsewhereLine
            ? "Stock on hand — committed elsewhere"
            : "RM blocked — no available stock",
        phaseDetail: input.requiresReopenConfirm
          ? "Previous requisition was closed. Creating a new requisition will restart procurement for the same shortage."
          : blockerText,
        statusHeadline: input.requiresReopenConfirm
          ? "Previous RM Requisition closed — raise a new requisition to restart procurement."
          : committedElsewhereLine
            ? "Review commitments below, then raise a Store RM Requisition or wait for stock to free up."
            : "Raise a Store RM Requisition to cover the shortage on this work order.",
        primaryAction: {
          kind: "START_PROCUREMENT",
          label: input.requiresReopenConfirm ? "Reopen / Raise New Requisition" : "Raise Store Requisition",
        },
        showMaterialIssueSection: false,
        showProductionLink: false,
        timelineStepIndex: 0,
        hideProcurementExecutionNav: true,
      };
    case "B_MR_ESCALATED":
      return {
        ...base,
        phase,
        phaseTitle: input.mrStatus === "SENT_TO_PURCHASE" ? "Awaiting PR" : "Approved MR",
        phaseDetail:
          input.mrStatus === "SENT_TO_PURCHASE"
            ? mrDoc
              ? `${mrDoc} is approved — create the Purchase Request in Procurement Workspace. Purchase will execute the PO.`
              : "Approved MR — create the Purchase Request in Procurement Workspace. Purchase will execute the PO."
            : mrDoc
              ? `Store requisition ${mrDoc} is active. Approve it, then create the Purchase Request in Procurement Workspace.`
              : "Store requisition is active. Approve it, then create the Purchase Request in Procurement Workspace.",
        statusHeadline:
          input.mrStatus === "SENT_TO_PURCHASE"
            ? "Awaiting PR — Store creates Purchase Request"
            : esc?.headline?.includes("not escalated")
              ? "RM Requisition raised — next: Store approval"
              : esc?.headline ?? "RM Requisition raised",
        primaryAction:
          input.mrStatus === "SENT_TO_PURCHASE"
            ? { kind: "CREATE_PR", label: PROCUREMENT_TERMS.CREATE_PURCHASE_REQUEST, href: procHref }
            : { kind: "CREATE_PR", label: "Open RM Requisition", href: requisitionHref },
        ownerLabel: input.mrStatus === "SENT_TO_PURCHASE" ? "Store" : base.ownerLabel,
        showMaterialIssueSection: false,
        showProductionLink: false,
        timelineStepIndex: 1,
        hideProcurementExecutionNav: false,
      };
    case "C_PR_CREATED":
      return {
        ...base,
        phase,
        phaseTitle: "Purchase request created",
        phaseDetail: `PR is on this case${pendingPo > EPS ? ` · ${pendingPo.toLocaleString()} qty still needs a PO` : ""}.`,
        statusHeadline: "Procurement in progress — create the purchase order.",
        primaryAction: { kind: "CREATE_PO", label: "Create Purchase Order", href: "/rm-po-grn?focus=pending-requests" },
        showMaterialIssueSection: false,
        showProductionLink: false,
        timelineStepIndex: 2,
        hideProcurementExecutionNav: false,
      };
    case "D_PO_GRN_PENDING":
      return {
        ...base,
        phase,
        phaseTitle: "Material incoming — waiting GRN",
        phaseDetail:
          pendingGrn > EPS
            ? `${pendingGrn.toLocaleString()} qty pending goods receipt before issue.`
            : esc?.description ?? "Record GRN when material arrives at store.",
        statusHeadline: "PO created — record GRN to make stock available.",
        primaryAction: { kind: "RECORD_GRN", label: "Record GRN", href: grnHref },
        showMaterialIssueSection: false,
        showProductionLink: false,
        timelineStepIndex: 3,
        hideProcurementExecutionNav: false,
      };
    case "E_READY_TO_ISSUE":
      return {
        ...base,
        phase,
        phaseTitle: "Stock available — ready to issue",
        phaseDetail: "Free store stock is available for the open material request on this WO.",
        statusHeadline: "GRN complete (or stock free) — issue RM to production.",
        primaryAction: { kind: "ISSUE_RM", label: "Issue RM to Production", href: issueHref },
        showMaterialIssueSection: true,
        showProductionLink: false,
        timelineStepIndex: 4,
        hideProcurementExecutionNav: true,
      };
    case "F_ISSUED_OPEN_PRODUCTION":
      return {
        ...base,
        phase,
        phaseTitle: "RM issued — production can continue",
        phaseDetail: "Store issue is complete for this step. Production owns the next action.",
        statusHeadline: "Material issued — open production when ready.",
        primaryAction: { kind: "OPEN_PRODUCTION", label: "Open Production", href: productionHref },
        showMaterialIssueSection: false,
        showProductionLink: true,
        timelineStepIndex: 4,
        hideProcurementExecutionNav: true,
      };
    default:
      return {
        ...base,
        phase: "IDLE",
        phaseTitle: "Review work order material status",
        phaseDetail: blockerText,
        statusHeadline: "Select a queue row or review RM lines below.",
        primaryAction: { kind: "NONE", label: "Review case", href: rmHref },
        showMaterialIssueSection: false,
        showProductionLink: false,
        timelineStepIndex: 0,
        hideProcurementExecutionNav: true,
      };
  }
}

export function timelineStepsForPhase(activeIndex: number): Array<{ label: string; done: boolean; active: boolean }> {
  return WO_PROCUREMENT_WORKFLOW_STAGES.map((label, i) => ({
    label,
    done: i < activeIndex,
    active: i === activeIndex,
  }));
}
