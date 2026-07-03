import type * as React from "react";
import type { WorkbenchActionSpec } from "../components/erp/workbench/WorkbenchActionBar";
import type { WorkbenchKpiItem } from "../components/erp/workbench/WorkbenchKpiStrip";
import {
  createCycleRequirementSheetButtonLabel,
  resolveNoQtyLockedRsPlanningCta,
} from "./noQtyRsActionLabels";

function fmtQty(n: number): string {
  return n.toFixed(3).replace(/\.000$/, "");
}

export type RequirementSheetSummary = {
  shortfallSum: number;
  pendingDispositionSum: number;
  newWoSum: number;
  totalWoSum: number;
  stockSum: number;
  postCycleApprovalSum: number;
};

export type RequirementSheetWorkbenchActionContext = {
  isNoQty: boolean;
  sheet: {
    id: number;
    salesOrderId: number;
    status: string;
    periodKey?: string | null;
    cycleId?: number | null;
  } | null;
  showNoQtyCreateWorkspace: boolean;
  showNoQtyFinalizeActions: boolean;
  noQtyFinalizeDisabled: boolean;
  draftUi: boolean;
  noQtyDraftCanFinalize: boolean;
  busy: boolean;
  noSheetsUi: boolean;
  canCreateNextRs: boolean;
  createNextRsEligible: boolean;
  nextCycleNoForRs: number | null;
  nextRsPrepareBusy: boolean;
  readyToPlaceWo: boolean;
  processStageKey: string | null;
  showNoQtyLockedRsContextPanel: boolean;
  locked: boolean;
  onFinalize: () => void;
  onCreateSheet: () => void;
  onCreateNewSheetFromEmpty: () => void;
  onPrepareNextRs: () => void;
};

export type RequirementSheetWorkbenchActionsResult = {
  primary: WorkbenchActionSpec | null;
  secondary: WorkbenchActionSpec[];
  tertiary: WorkbenchActionSpec[];
  hint: React.ReactNode;
};

export function buildRequirementSheetKpiItems(input: {
  isNoQty: boolean;
  summary: RequirementSheetSummary;
  rsCycleSummaryLoading: boolean;
  previousCyclesTotal: number;
  allCyclesTotal: number;
  hasSheet: boolean;
}): WorkbenchKpiItem[] {
  if (!input.hasSheet) return [];

  const items: WorkbenchKpiItem[] = [];

  if (input.isNoQty) {
    items.push(
      {
        key: "current-req",
        label: "Current cycle req.",
        value: fmtQty(input.summary.newWoSum),
      },
      {
        key: "prev-cycles",
        label: "Previous cycles",
        value: input.rsCycleSummaryLoading ? "…" : fmtQty(input.previousCyclesTotal),
      },
      {
        key: "all-cycles",
        label: "All cycles",
        value: input.rsCycleSummaryLoading ? "…" : fmtQty(input.allCyclesTotal),
      },
      {
        key: "total-produce",
        label: "Total to Produce",
        value: fmtQty(input.summary.totalWoSum),
      },
      {
        key: "pending-qc",
        label: "Pending QC",
        value: fmtQty(input.summary.pendingDispositionSum),
        tone: input.summary.pendingDispositionSum > 1e-6 ? "warn" : "muted",
      },
      {
        key: "usable-dispatch",
        label: "Usable (dispatch)",
        value: fmtQty(input.summary.stockSum),
        title: "Usable FG stock for optional dispatch — informational only",
      },
    );
  } else {
    items.push(
      {
        key: "new-req",
        label: "New requirement",
        value: fmtQty(input.summary.newWoSum),
      },
      {
        key: "suggested-wo",
        label: "Suggested WO",
        value: fmtQty(input.summary.totalWoSum),
      },
      {
        key: "usable-stock",
        label: "Usable stock",
        value: fmtQty(input.summary.stockSum),
      },
    );
  }

  return items;
}

/** Single contextual primary action — dedupes Open RS / Open Current RS / Finalize / Create CTAs. */
export function resolveRequirementSheetWorkbenchActions(
  ctx: RequirementSheetWorkbenchActionContext,
): RequirementSheetWorkbenchActionsResult {
  const secondary: WorkbenchActionSpec[] = [];
  const tertiary: WorkbenchActionSpec[] = [];
  let primary: WorkbenchActionSpec | null = null;
  let hint: React.ReactNode = null;

  const planningCta =
    ctx.sheet && ctx.isNoQty && ctx.sheet.status === "LOCKED"
      ? resolveNoQtyLockedRsPlanningCta({
          salesOrderId: ctx.sheet.salesOrderId,
          periodKey: ctx.sheet.periodKey,
          cycleId: ctx.sheet.cycleId,
          requirementSheetId: ctx.sheet.id,
          processStageKey: ctx.processStageKey,
          readyToPlaceWo: ctx.readyToPlaceWo,
        })
      : null;

  if (ctx.showNoQtyFinalizeActions) {
    primary = {
      key: "finalize",
      label: ctx.draftUi ? "Finalize RS" : "Finalize Requirement",
      onClick: ctx.onFinalize,
      disabled: ctx.noQtyFinalizeDisabled,
      loading: ctx.busy,
    };
    if (ctx.draftUi && !ctx.noQtyDraftCanFinalize) {
      hint = "Enter requirement qty.";
    }
  } else if (ctx.showNoQtyCreateWorkspace && ctx.noSheetsUi) {
    primary = {
      key: "create-rs",
      label: "Create Requirement Sheet",
      onClick: ctx.onCreateNewSheetFromEmpty,
      disabled: ctx.busy,
      loading: ctx.busy,
    };
  } else if (ctx.canCreateNextRs && ctx.createNextRsEligible && ctx.showNoQtyLockedRsContextPanel) {
    primary = {
      key: "create-next-rs",
      label: createCycleRequirementSheetButtonLabel(ctx.nextCycleNoForRs ?? 2),
      onClick: ctx.onPrepareNextRs,
      disabled: ctx.nextRsPrepareBusy,
      loading: ctx.nextRsPrepareBusy,
    };
  } else if (planningCta) {
    primary = {
      key: "planning-cta",
      label: planningCta.label,
      href: planningCta.href,
    };
  } else if (ctx.sheet && ctx.draftUi && !ctx.isNoQty) {
    primary = {
      key: "finalize-regular",
      label: "Finalize Requirement",
      onClick: ctx.onFinalize,
      disabled: ctx.noQtyFinalizeDisabled,
      loading: ctx.busy,
    };
  }

  return { primary, secondary, tertiary, hint };
}
