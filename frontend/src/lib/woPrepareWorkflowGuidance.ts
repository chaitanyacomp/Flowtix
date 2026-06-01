/**
 * Prepare Work Order — guided operational workflow (UX only).
 * Derives display state from existing rm-check / dashboard payloads — no stock or WO logic changes.
 */

import { REGULAR_TERMS } from "./flowTerminology";
import { rmControlCenterHref } from "./materialWorkflowLinks";
import { isPurchaseGrnReceiptStage } from "./woPrepareOperationalStage";

export const WO_PREPARE_WORKFLOW_STEPS = [
  "RM Shortage",
  "Waiting for RM Procurement",
  "RM Received in Store",
  "Ready for WO",
] as const;

export type WoPrepareWorkflowStepLabel = (typeof WO_PREPARE_WORKFLOW_STEPS)[number];

export type WoPrepareBlockedCardModel = {
  title: string;
  reason: string;
  currentStatus: WoPrepareWorkflowStepLabel;
  owner: WorkflowOwnerRole;
  nextAction: string;
  rmWorkspaceHref: string;
  showRefresh: boolean;
};

export type WoPrepareReadinessItem = {
  key: string;
  label: string;
  met: boolean;
};

export type WoPrepareWorkflowState =
  | "NO_MR"
  | "PROCUREMENT_PENDING"
  | "WAITING_GRN"
  | "READY_FOR_WO"
  | "WO_CREATED"
  | "FG_STOCK_COVERS"
  | "REVIEW";

export type WorkflowOwnerRole = "Store" | "Store Department" | "Purchase" | "Production" | "Store / GRN" | "Store / Purchase";

export function deriveWoPrepareWorkflowStepLabel(args: {
  workflowState: WoPrepareWorkflowState;
  canCreateWorkOrder: boolean;
  hasRmShortage: boolean;
  hasPendingMr: boolean;
  hasExistingWorkOrder: boolean;
  allRmAvailable: boolean;
}): WoPrepareWorkflowStepLabel {
  if (args.hasExistingWorkOrder) return "Ready for WO";
  if (args.canCreateWorkOrder) {
    if (!args.hasPendingMr && args.allRmAvailable && !args.hasRmShortage) {
      return "RM Received in Store";
    }
    return "Ready for WO";
  }
  if (args.workflowState === "PROCUREMENT_PENDING" || args.workflowState === "WAITING_GRN" || args.hasPendingMr) {
    return "Waiting for RM Procurement";
  }
  if (args.hasRmShortage || args.workflowState === "NO_MR") return "RM Shortage";
  return "RM Shortage";
}

export function workflowStepIndex(label: WoPrepareWorkflowStepLabel): number {
  return WO_PREPARE_WORKFLOW_STEPS.indexOf(label);
}

export function buildWoPrepareReadinessChecklist(args: {
  salesOrderApproved: boolean;
  rmAvailableInStore: boolean;
  workOrderCreationAllowed: boolean;
  productionReady: boolean;
}): WoPrepareReadinessItem[] {
  return [
    { key: "so-approved", label: "Sales Order Approved", met: args.salesOrderApproved },
    { key: "rm-available", label: "RM Available in Store", met: args.rmAvailableInStore },
    { key: "wo-allowed", label: "Work Order Creation Allowed", met: args.workOrderCreationAllowed },
    { key: "production-ready", label: "Production Ready", met: args.productionReady },
  ];
}

export function buildWoPrepareBlockedCardModel(args: {
  workflowState: WoPrepareWorkflowState;
  stepLabel: WoPrepareWorkflowStepLabel;
  salesOrderId: number;
  firstMrId?: number;
  onRefresh: () => void;
}): WoPrepareBlockedCardModel {
  const rmWorkspaceHref = rmControlCenterHref({
    salesOrderId: args.salesOrderId,
    materialRequirementId: args.firstMrId,
    onlyBlocked: true,
    returnTo: "prepare-wo",
  });

  if (args.workflowState === "PROCUREMENT_PENDING" || args.workflowState === "WAITING_GRN") {
    return {
      title: "Work Order Creation Blocked",
      reason: "Required raw materials are still in procurement — GRN or store receipt is pending.",
      currentStatus: args.stepLabel,
      owner: "Store Department",
      nextAction:
        "Track requisition, PO, and GRN in Store RM Workspace. Work Order creation will become available after RM is received and validated by Store.",
      rmWorkspaceHref,
      showRefresh: true,
    };
  }

  return {
    title: "Work Order Creation Blocked",
    reason: "Required raw materials are not available in Store.",
    currentStatus: args.stepLabel,
    owner: "Store Department",
    nextAction:
      "Review RM shortage and raise procurement requirement from Store RM Workspace. Work Order creation will become available automatically after RM is received and validated by Store.",
    rmWorkspaceHref,
    showRefresh: true,
  };
}


export type WoPrepareGuidedStripModel = {
  state: WoPrepareWorkflowState;
  tone: "danger" | "warning" | "caution" | "success" | "neutral";
  headline: string;
  owner: WorkflowOwnerRole;
  nextActionText: string;
  primaryLabel: string;
  primaryKind: "button" | "link";
  primaryHref?: string;
  onPrimaryClick?: () => void;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  secondaryLabel?: string;
  secondaryHref?: string;
  tertiaryLabel?: string;
  onTertiaryClick?: () => void;
  showRefreshAvailability?: boolean;
};

export function deriveWoPrepareWorkflowState(args: {
  canCreateWorkOrder: boolean;
  hasRmShortage: boolean;
  hasPendingMr: boolean;
  hasExistingWorkOrder: boolean;
  allFgEnough: boolean;
  pendingPoStatus?: string;
  pendingGrnStatus?: string;
}): WoPrepareWorkflowState {
  if (args.hasExistingWorkOrder) return "WO_CREATED";
  if (args.canCreateWorkOrder) {
    return args.allFgEnough ? "FG_STOCK_COVERS" : "READY_FOR_WO";
  }
  if (args.hasPendingMr) {
    return isPurchaseGrnReceiptStage(args.pendingGrnStatus, args.pendingPoStatus)
      ? "WAITING_GRN"
      : "PROCUREMENT_PENDING";
  }
  if (args.hasRmShortage) return "NO_MR";
  return "REVIEW";
}

export type RmLineDisplayStatus = "Ready" | "Partial" | "Waiting Procurement" | "Blocked";

export function rmLineDisplayStatus(args: {
  shortage: number;
  available: number;
  hasPendingMr: boolean;
  canCreateWorkOrder: boolean;
}): RmLineDisplayStatus {
  if (args.shortage <= 0 || args.canCreateWorkOrder) return "Ready";
  if (args.hasPendingMr) return "Waiting Procurement";
  if (args.available > 0) return "Partial";
  return "Blocked";
}

export function rmLineStatusChipClass(status: RmLineDisplayStatus): string {
  if (status === "Ready") return "bg-emerald-600 text-white";
  if (status === "Partial") return "bg-amber-600 text-white";
  if (status === "Waiting Procurement") return "bg-amber-500 text-white";
  return "bg-red-600 text-white";
}

export function workflowOperationalStatusPresentation(state: WoPrepareWorkflowState): {
  label: string;
  icon: string;
  stripClass: string;
} {
  switch (state) {
    case "NO_MR":
      return {
        label: "RM Shortage",
        icon: "🔴",
        stripClass: "border-red-300 bg-red-50",
      };
    case "PROCUREMENT_PENDING":
      return {
        label: "Waiting for RM Procurement",
        icon: "🟠",
        stripClass: "border-amber-400 bg-amber-50",
      };
    case "WAITING_GRN":
      return {
        label: "Waiting for RM Procurement",
        icon: "🟡",
        stripClass: "border-yellow-400 bg-yellow-50",
      };
    case "READY_FOR_WO":
      return {
        label: "Ready for WO",
        icon: "🟢",
        stripClass: "border-emerald-400 bg-emerald-50",
      };
    case "WO_CREATED":
      return {
        label: "WO Created",
        icon: "🟢",
        stripClass: "border-emerald-400 bg-emerald-50",
      };
    case "FG_STOCK_COVERS":
      return {
        label: "FG Stock OK",
        icon: "🟢",
        stripClass: "border-emerald-400 bg-emerald-50",
      };
    default:
      return {
        label: "Review Required",
        icon: "ℹ️",
        stripClass: "border-slate-300 bg-slate-50",
      };
  }
}

export function buildWoPrepareGuidedStripModel(args: {
  state: WoPrepareWorkflowState;
  salesOrderId: number;
  pendingMrLabel: string;
  firstMrId?: number;
  canRaiseMr: boolean;
  raisingMr: boolean;
  canStartWo: boolean;
  woCreateDisabled: boolean;
  loading: boolean;
  resumeWorkOrder?: boolean;
  onRaiseMr: () => void;
  onCreateWo: () => void;
  onResumeWo: () => void;
  onRefreshAvailability: () => void;
}): WoPrepareGuidedStripModel | null {
  const so = args.salesOrderId;

  switch (args.state) {
    case "NO_MR":
      return {
        state: "NO_MR",
        tone: "danger",
        headline: "Work Order Creation Blocked",
        owner: "Store Department",
        nextActionText:
          "Review RM shortage and raise procurement requirement from Store RM Workspace. Work Order creation will become available automatically after RM is received and validated by Store.",
        primaryLabel: "Open Store RM Workspace",
        primaryKind: "link",
        primaryHref: rmControlCenterHref({
          salesOrderId: so,
          onlyBlocked: true,
          returnTo: "prepare-wo",
        }),
        showRefreshAvailability: true,
        tertiaryLabel: "Refresh Status",
        onTertiaryClick: args.onRefreshAvailability,
      };
    case "PROCUREMENT_PENDING":
      return {
        state: "PROCUREMENT_PENDING",
        tone: "warning",
        headline: "Work Order Creation Blocked",
        owner: "Store Department",
        nextActionText:
          "Track requisition, PO, and GRN in Store RM Workspace. Work Order creation will become available after RM is received and validated by Store.",
        primaryLabel: "Open Store RM Workspace",
        primaryKind: "link",
        primaryHref: rmControlCenterHref({
          salesOrderId: so,
          materialRequirementId: args.firstMrId,
          returnTo: "prepare-wo",
        }),
        showRefreshAvailability: true,
        tertiaryLabel: "Refresh Status",
        onTertiaryClick: args.onRefreshAvailability,
      };
    case "WAITING_GRN":
      return {
        state: "WAITING_GRN",
        tone: "warning",
        headline: "Work Order Creation Blocked",
        owner: "Store Department",
        nextActionText:
          "Track requisition, PO, and GRN in Store RM Workspace. Work Order creation will become available after RM is received and validated by Store.",
        primaryLabel: "Open Store RM Workspace",
        primaryKind: "link",
        primaryHref: rmControlCenterHref({
          salesOrderId: so,
          returnTo: "prepare-wo",
        }),
        showRefreshAvailability: true,
        tertiaryLabel: "Refresh Status",
        onTertiaryClick: args.onRefreshAvailability,
      };
    case "READY_FOR_WO":
      return {
        state: "READY_FOR_WO",
        tone: "success",
        headline: "RM ready for production",
        owner: "Production",
        nextActionText: args.resumeWorkOrder
          ? REGULAR_TERMS.RESUME_WO_SUBTITLE
          : "Create the work order to start manufacturing.",
        primaryLabel: args.resumeWorkOrder ? "Continue Work Order" : "Create Work Order",
        primaryKind: "button",
        onPrimaryClick: args.resumeWorkOrder ? args.onResumeWo : args.onCreateWo,
        primaryDisabled: args.resumeWorkOrder ? !args.canStartWo || args.loading : args.woCreateDisabled,
      };
    case "WO_CREATED":
      return {
        state: "WO_CREATED",
        tone: "success",
        headline: "Work order created",
        owner: "Production",
        nextActionText: "Issue RM to production, then record batches on the production screen.",
        primaryLabel: "Open Work Orders",
        primaryKind: "link",
        primaryHref: `/work-orders?salesOrderId=${encodeURIComponent(String(so))}`,
        showRefreshAvailability: false,
      };
    case "FG_STOCK_COVERS":
      return {
        state: "FG_STOCK_COVERS",
        tone: "neutral",
        headline: "FG stock covers the order",
        owner: "Production",
        nextActionText: "No manufacturing gap on this plan — a work order is not required.",
        primaryLabel: REGULAR_TERMS.BACK_TO_WORK_ORDERS,
        primaryKind: "link",
        primaryHref: `/work-orders?salesOrderId=${encodeURIComponent(String(so))}`,
        showRefreshAvailability: false,
      };
    case "REVIEW":
    default:
      return {
        state: "REVIEW",
        tone: "neutral",
        headline: "Review production requirements",
        owner: "Store",
        nextActionText: REGULAR_TERMS.NEXT_REVIEW_REQUIREMENTS,
        primaryLabel: REGULAR_TERMS.LOAD_RM_FG_BUTTON,
        primaryKind: "button",
        onPrimaryClick: args.onRefreshAvailability,
        primaryDisabled: args.loading,
        showRefreshAvailability: true,
        tertiaryLabel: REGULAR_TERMS.REFRESH_STOCK,
        onTertiaryClick: args.onRefreshAvailability,
      };
  }
}
