import { buildNoQtyGuidedHref } from "./noQtyFlowState";
import type { NoQtyPlannerInboxRow } from "../hooks/useNoQtyPlannerInbox";
import {
  formatPlanningInboxNextRsLine,
  planningInboxCycleLabel,
} from "./planningInboxPresentation";
import {
  NO_QTY_OPEN_MONTHLY_PLANNING_LABEL,
  NO_QTY_PLACE_WO_LABEL,
  NO_QTY_RS_STORE_HANDOFF_LABEL,
  createCycleRequirementSheetButtonLabel,
  noQtyRsCreationWorkspaceHref,
  openDraftRsButtonLabel,
  resolveNoQtyInboxPlanningCta,
} from "./noQtyRsActionLabels";

export type CycleManagementPrimaryAction = {
  key: string;
  label: string;
  href?: string;
  disabled?: boolean;
  blockedReason?: string | null;
  /** Non-navigating handoff when operator lacks RS access */
  handoff?: boolean;
};

export type CycleManagementCurrentCycleStatus = {
  cycle: string;
  rsStatus: string;
  monthlyPlanning: string;
  procurement: string;
  production: string;
};

function createNextRsHref(row: NoQtyPlannerInboxRow): string {
  const nextCycleId = row.flowState?.nextRollingRequirementSheetCycleId ?? row.guidedCycleId ?? null;
  return noQtyRsCreationWorkspaceHref({
    salesOrderId: row.so.id,
    cycleId: nextCycleId,
    from: "inbox",
  });
}

function openNextCycleRsHref(row: NoQtyPlannerInboxRow): string {
  const cycleId = row.flowState?.nextRollingRequirementSheetCycleId ?? null;
  if (cycleId != null && Number(cycleId) > 0) {
    return buildNoQtyGuidedHref({
      to: `/sales-orders/${row.so.id}/requirement-sheets`,
      salesOrderId: row.so.id,
      cycleId,
      fromStep: "requirement",
    });
  }
  return createNextRsHref(row);
}

/** Single contextual primary action — never duplicates Open RS / Open Current RS. */
export function resolveNoQtyCycleManagementPrimaryAction(
  row: NoQtyPlannerInboxRow,
  opts: { canOpenRs: boolean; canCreateNextRs: boolean },
): CycleManagementPrimaryAction {
  const { so, rsStatus, lockedPeriodKey, guidedCycleId, cycleNo, flowState } = row;
  const nextCycleNo =
    so.noQtyNextPossibleCycleNo ?? (cycleNo != null && cycleNo > 0 ? cycleNo + 1 : null);
  const nextRsLine = formatPlanningInboxNextRsLine(so);
  const rsHref =
    row.requirementSheetHref ??
    buildNoQtyGuidedHref({
      to: `/sales-orders/${so.id}/requirement-sheets`,
      salesOrderId: so.id,
      cycleId: guidedCycleId,
      fromStep: "requirement",
    });

  if (rsStatus === "Draft") {
    if (!opts.canOpenRs) {
      return {
        key: "draft-handoff",
        label: "Draft Requirement Sheet · With Planning",
        disabled: true,
        handoff: true,
      };
    }
    return {
      key: "open-draft",
      label: openDraftRsButtonLabel(cycleNo),
      href: rsHref,
    };
  }

  if (rsStatus === "No RS") {
    const cycleForCreate = cycleNo != null && cycleNo > 0 ? cycleNo : 1;
    if (!opts.canCreateNextRs && !opts.canOpenRs) {
      return {
        key: "create-handoff",
        label: NO_QTY_RS_STORE_HANDOFF_LABEL,
        disabled: true,
        handoff: true,
      };
    }
    return {
      key: "create-current-rs",
      label: createCycleRequirementSheetButtonLabel(cycleForCreate),
      href: createNextRsHref(row),
    };
  }

  if (String(so.noQtyNextRsAlreadyCreatedDocNo ?? flowState?.nextRsAlreadyCreatedDocNo ?? "").trim()) {
    const label =
      nextCycleNo != null && nextCycleNo > 0
        ? `Open Cycle ${nextCycleNo} Requirement Sheet`
        : "Open Next Requirement Sheet";
    if (!opts.canOpenRs) {
      return { key: "open-next-handoff", label: `${label} · With Planning`, disabled: true, handoff: true };
    }
    return {
      key: "open-next-rs",
      label,
      href: openNextCycleRsHref(row),
    };
  }

  if (so.noQtyCreateNextRsEligible && opts.canCreateNextRs) {
    return {
      key: "create-next-rs",
      label: createCycleRequirementSheetButtonLabel(nextCycleNo ?? (cycleNo != null ? cycleNo + 1 : 2)),
      href: createNextRsHref(row),
    };
  }

  if (rsStatus === "Locked" && nextRsLine.tone === "blocked") {
    return {
      key: "next-rs-blocked",
      label: "Next RS Blocked",
      disabled: true,
      blockedReason: nextRsLine.reason,
    };
  }

  const planningCta = resolveNoQtyInboxPlanningCta({
    processStageKey: so.processStage?.key,
    salesOrderId: so.id,
    lockedPeriodKey,
    cycleId: guidedCycleId,
    requirementSheetId:
      (so as { noQtyPlacementRequirementSheetId?: number | null }).noQtyPlacementRequirementSheetId ??
      flowState?.placementRequirementSheetId ??
      row.placementRequirementSheetId ??
      null,
    readyToPlaceWo: (so as { noQtyReadyToPlaceWo?: boolean | null }).noQtyReadyToPlaceWo ?? flowState?.readyToPlaceWo ?? false,
  });

  if (planningCta.label === NO_QTY_PLACE_WO_LABEL || planningCta.label === NO_QTY_OPEN_MONTHLY_PLANNING_LABEL) {
    if (!opts.canOpenRs) {
      return {
        key: "workflow-handoff",
        label: `${planningCta.label} · With Planning`,
        disabled: true,
        handoff: true,
      };
    }
    return { key: "workflow-cta", label: planningCta.label, href: planningCta.href };
  }

  if (planningCta.label === "Create Requirement Sheet") {
    if (!opts.canCreateNextRs && !opts.canOpenRs) {
      return { key: "create-handoff", label: NO_QTY_RS_STORE_HANDOFF_LABEL, disabled: true, handoff: true };
    }
    return { key: "create-rs", label: planningCta.label, href: planningCta.href };
  }

  if (!opts.canOpenRs) {
    return {
      key: "rs-handoff",
      label: "Requirement Sheet · With Planning",
      disabled: true,
      handoff: true,
    };
  }

  const cycleLabel =
    cycleNo != null && cycleNo > 0 ? `Open Cycle ${cycleNo} Requirement Sheet` : "Open Requirement Sheet";
  return {
    key: "open-current-rs",
    label: cycleLabel,
    href: rsHref,
  };
}

export function resolveCycleManagementCurrentCycleStatus(row: NoQtyPlannerInboxRow): CycleManagementCurrentCycleStatus {
  const stageKey = String(row.so.processStage?.key ?? row.flowState?.placementProcessStageKey ?? "").toUpperCase();
  const flow = row.flowState;

  let monthlyPlanning = "—";
  if (stageKey === "NO_QTY_REQUIREMENT_READY") monthlyPlanning = "Pending";
  else if (stageKey === "NO_QTY_PROCUREMENT_IN_PROGRESS") monthlyPlanning = "In progress";
  else if (stageKey === "NO_QTY_READY_TO_PLACE_WO") monthlyPlanning = "Complete";
  else if (row.rsStatus === "Locked") monthlyPlanning = "Awaiting release";
  else if (row.rsStatus === "Draft") monthlyPlanning = "Draft RS";
  else if (row.rsStatus === "No RS") monthlyPlanning = "Not started";

  const procurement = row.rmCoverageLabel?.trim() || "—";

  let production = "—";
  if (flow?.overallWorkflowState === "DONE") production = "Complete";
  else if (flow?.productionExists) production = "In progress";
  else if (flow?.workOrderExists) production = "WO placed";
  else if (flow?.readyToPlaceWo) production = "Ready for WO";
  else if (row.rsStatus === "Locked") production = "Awaiting WO";

  return {
    cycle: planningInboxCycleLabel(row.so),
    rsStatus: row.rsStatus,
    monthlyPlanning,
    procurement,
    production,
  };
}
