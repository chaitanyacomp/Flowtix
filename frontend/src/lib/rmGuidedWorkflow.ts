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
import { buildMaterialIssueDeepLink } from "./manufacturingNavigationContinuity";
import {
  guidedTimelineIndexForStoreAction,
  mapStoreActionToGuidedPhase,
  normalizeStoreActionKey,
} from "./rmControlCenterReadinessUx";

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
  /** Authoritative store action labels from workspace API (when present). */
  storeActionLabel?: string | null;
  storeActionDescription?: string | null;
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
  /** @deprecated Use `storeActionKey === 'ISSUE'` from backend — kept for legacy callers only. */
  anyIssueable?: boolean;
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
  const pendingGrn = n(summary.pendingGrnQty);
  const pendingPo = sumPendingPo(input.caseSupply?.prLines);
  const mrDoc = esc?.materialRequirementDocNo ?? null;
  const storeKey = normalizeStoreActionKey(input.storeActionKey);
  const storeLabel = input.storeActionLabel?.trim() || null;
  const storeDescription = input.storeActionDescription?.trim() || null;

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
  const isNoQtyOrder = String(input.orderType ?? "").trim() === "NO_QTY";
  const requisitionHref = isNoQtyOrder
    ? rmHref
    : input.salesOrderId && input.salesOrderId > 0
      ? `/material-planning?salesOrderId=${input.salesOrderId}`
      : procHref;
  const grnHref =
    input.primaryPoId && input.primaryPoId > 0
      ? buildRmPoDetailHref(input.primaryPoId, {
          salesOrderId: input.salesOrderId,
          from: "rm-purchase",
        })
      : "/rm-po-grn?focus=pending-requests";
  const issueHref = buildMaterialIssueDeepLink({
    workOrderId: input.workOrderId,
    returnTo: "rm-control-center",
    salesOrderId: input.salesOrderId ?? null,
  });

  const phase = mapStoreActionToGuidedPhase(storeKey);
  const timelineStepIndex = guidedTimelineIndexForStoreAction(storeKey);

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
    showProductionLink: false,
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
            : storeLabel || "RM blocked — no available stock",
        phaseDetail: input.requiresReopenConfirm
          ? storeDescription ||
            "Previous requisition was closed. Creating a new requisition will restart procurement for the same shortage."
          : storeDescription || blockerText,
        statusHeadline:
          storeLabel ||
          (input.requiresReopenConfirm
            ? "Previous RM Requisition closed — raise a new requisition to restart procurement."
            : committedElsewhereLine
              ? "Review commitments below, then raise a Store RM Requisition or wait for stock to free up."
              : "Raise a Store RM Requisition to cover the shortage on this work order."),
        primaryAction: {
          kind: "START_PROCUREMENT",
          label: storeLabel || (input.requiresReopenConfirm ? "Reopen / Raise New Requisition" : "Raise Store Requisition"),
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
          storeLabel ||
          (input.mrStatus === "SENT_TO_PURCHASE"
            ? "Awaiting PR — Store creates Purchase Request"
            : esc?.headline?.includes("not escalated")
              ? "RM Requisition raised — next: Store approval"
              : esc?.headline ?? "RM Requisition raised"),
        primaryAction:
          input.mrStatus === "SENT_TO_PURCHASE"
            ? {
                kind: "CREATE_PR",
                label: storeLabel || PROCUREMENT_TERMS.CREATE_PURCHASE_REQUEST,
                href: procHref,
              }
            : {
                kind: "CREATE_PR",
                label: storeLabel || "Open RM Requisition",
                href: requisitionHref,
              },
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
        phaseTitle: storeLabel || "Awaiting PO",
        phaseDetail:
          storeDescription ||
          `PR is on this case${pendingPo > EPS ? ` · ${pendingPo.toLocaleString()} qty still needs a PO` : ""}. Purchase will create the RM PO.`,
        statusHeadline: storeLabel || PROCUREMENT_TERMS.WAITING_FOR_PURCHASE_RM_PO,
        primaryAction: {
          kind: "NONE",
          label: storeLabel || PROCUREMENT_TERMS.WAITING_FOR_PURCHASE_RM_PO,
          href: procHref,
        },
        showMaterialIssueSection: false,
        showProductionLink: false,
        timelineStepIndex: 2,
        hideProcurementExecutionNav: false,
      };
    case "D_PO_GRN_PENDING":
      return {
        ...base,
        phase,
        phaseTitle: storeLabel || "Material incoming — waiting GRN",
        phaseDetail:
          storeDescription ||
          (pendingGrn > EPS
            ? `${pendingGrn.toLocaleString()} qty pending goods receipt before issue.`
            : esc?.description ?? "Record GRN when material arrives at store."),
        statusHeadline: storeLabel || "PO created — record GRN to make stock available.",
        primaryAction: { kind: "RECORD_GRN", label: storeLabel || "Record GRN", href: grnHref },
        showMaterialIssueSection: false,
        showProductionLink: false,
        timelineStepIndex: 3,
        hideProcurementExecutionNav: false,
      };
    case "E_READY_TO_ISSUE":
      return {
        ...base,
        phase,
        phaseTitle: storeLabel || "Stock available — ready to issue",
        phaseDetail: storeDescription || "Free store stock is available for the open material request on this WO.",
        statusHeadline: storeLabel || "GRN complete (or stock free) — issue RM to production.",
        primaryAction: {
          kind: "ISSUE_RM",
          label: storeLabel || "Issue RM to Production",
          href: issueHref,
        },
        showMaterialIssueSection: true,
        showProductionLink: false,
        timelineStepIndex: 4,
        hideProcurementExecutionNav: true,
      };
    case "F_ISSUED_OPEN_PRODUCTION":
      return {
        ...base,
        phase,
        phaseTitle: storeLabel || "RM issued — waiting for Production",
        phaseDetail: storeDescription || "Store issue is complete for this work order. Production owns the next action.",
        statusHeadline: storeLabel || "RM issued — waiting for Production",
        primaryAction: { kind: "NONE", label: storeLabel || "Waiting for Production" },
        showMaterialIssueSection: false,
        showProductionLink: false,
        timelineStepIndex: 4,
        hideProcurementExecutionNav: true,
      };
    default:
      return {
        ...base,
        phase: "IDLE",
        phaseTitle: storeLabel || "Review work order material status",
        phaseDetail: storeDescription || blockerText,
        statusHeadline: storeLabel || "Select a queue row or review RM lines below.",
        primaryAction: { kind: "NONE", label: storeLabel || "Review case", href: rmHref },
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
