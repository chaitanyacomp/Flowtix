/**

 * P6B-4A / P10-A5 — Cycle-oriented NO_QTY labels (business language, Store-owned flow).

 */

import { noQtyAgreementListHref } from "./noQtyStoreNavigation";



export type NoQtyCycleRsContext = {

  currentCycleNo?: number | null;

  nextCycleNo?: number | null;

  rsStatus?: string | null;

  hasRs?: boolean | null;

  isDraft?: boolean | null;

};



export const NO_QTY_PLACE_WO_LABEL = "Place WO";

export const NO_QTY_OPEN_MONTHLY_PLANNING_LABEL = "Open Monthly Planning";



/** Human workflow stage from backend processStage.key / label. */

export function noQtyBusinessWorkflowStage(input: {

  processStageKey?: string | null;

  processStageLabel?: string | null;

  rsStatus?: string | null;

  hasRs?: boolean | null;

  readyToPlaceWo?: boolean | null;

}): string {

  const key = String(input.processStageKey ?? "").toUpperCase();

  const label = String(input.processStageLabel ?? "").trim();



  if (key === "NO_QTY_PREPARE_NEXT_RS") return "Cycle review · Next RS";

  if (key === "NO_QTY_DRAFT" || (!input.hasRs && key !== "COMPLETED")) return "Requirement Sheet pending";

  if (key === "NO_QTY_READY_TO_PLACE_WO" || input.readyToPlaceWo) {

    return "Procurement complete · Ready for WO placement";

  }

  if (key === "NO_QTY_PROCUREMENT_IN_PROGRESS") return "Procurement in progress";

  if (key === "NO_QTY_REQUIREMENT_READY") return "RS locked · Monthly planning pending";

  if (key === "NO_QTY_WORK_ORDER") return "Work Order placed · execution pending";

  if (key === "NO_QTY_IN_PRODUCTION") return "Production / QA in progress";

  if (key === "NO_QTY_DISPATCH_BILLING") return "Dispatch / Billing";

  if (key === "NO_QTY_BILLING_COMPLETE") return "Billing complete";

  if (key === "COMPLETED") return "Agreement closed";



  if (label) return label;

  const rs = String(input.rsStatus ?? "").trim();

  if (rs === "Draft") return "Requirement Sheet draft";

  if (rs === "Locked") return "RS locked";

  if (rs === "No RS") return "Requirement Sheet pending";

  return "In progress";

}



/** Requirement Sheet Execution Workspace — Store WO placement entry point. */

export function noQtyRsExecutionWorkspaceHref(input: {

  salesOrderId: number;

  cycleId?: number | null;

  requirementSheetId?: number | null;

  source?: string;

  from?: string;

}): string {

  const params = new URLSearchParams();

  params.set("source", input.source ?? "no_qty_so");

  params.set("salesOrderId", String(input.salesOrderId));

  if (input.cycleId != null && Number(input.cycleId) > 0) {

    params.set("cycleId", String(input.cycleId));

  }

  if (input.requirementSheetId != null && Number(input.requirementSheetId) > 0) {

    params.set("sheetId", String(input.requirementSheetId));

  }

  params.set("focus", "execution");

  if (input.from) params.set("from", input.from);

  return `/sales-orders/${input.salesOrderId}/requirement-sheets?${params.toString()}`;

}



/** Business-friendly Next RS block reason — never lead with PMR/WO doc numbers. */

export function noQtyBusinessNextRsBlockReason(reason?: string | null): string {

  const r = String(reason ?? "").trim();

  if (!r || r === "OK") return "";



  if (r === "NO_LOCKED_RS" || r === "DRAFT_RS_ON_CYCLE") {

    return "Current cycle Requirement Sheet is not locked yet.";

  }

  if (r === "DRAFT_RS_EXISTS") return "A draft Requirement Sheet already exists on the next cycle.";

  if (r === "NEXT_RS_EXISTS") return "A Requirement Sheet already exists on the next cycle.";

  if (r === "NOT_NO_QTY") return "This action applies only to NO_QTY agreements.";

  if (r === "SO_CLOSED") return "This NO_QTY agreement is closed.";

  if (r === "NO_CYCLE" || r === "INVALID_CYCLE" || r === "CYCLE_NOT_FOUND") {

    return "No active cycle is available for the next Requirement Sheet.";

  }

  if (r === "INVALID_SO") return "Invalid sales order.";



  return r.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) + ".";

}



export function noQtyCurrentCycleLabel(cycleNo?: number | null): string {

  if (cycleNo != null && Number.isFinite(Number(cycleNo)) && Number(cycleNo) > 0) {

    return `Cycle ${Number(cycleNo)}`;

  }

  return "—";

}



export function noQtyNextCycleLabel(nextCycleNo?: number | null): string {

  if (nextCycleNo != null && Number.isFinite(Number(nextCycleNo)) && Number(nextCycleNo) > 0) {

    return `Cycle ${Number(nextCycleNo)}`;

  }

  return "—";

}



export function openCurrentRsButtonLabel(): string {

  return "Open Current RS";

}



export function openDraftRsButtonLabel(cycleNo?: number | null): string {

  const c = noQtyCurrentCycleLabel(cycleNo);

  return c !== "—" ? `Open Draft RS (${c})` : "Open Draft RS";

}



/** Create RS for a specific cycle number. */

export function createCycleRsButtonLabel(cycleNo: number): string {

  return `Create Cycle ${cycleNo} RS`;

}



/** P8F-A14 — Store-owned cycle continuation CTA (full business label). */

export function createCycleRequirementSheetButtonLabel(cycleNo: number): string {

  return `Create Cycle ${cycleNo} Requirement Sheet`;

}



/** When next cycle number unknown, use generic label. */

export function createNextRsButtonLabel(nextCycleNo?: number | null): string {

  if (nextCycleNo != null && Number(nextCycleNo) > 0) {

    return createCycleRequirementSheetButtonLabel(Number(nextCycleNo));

  }

  return "Create Next Requirement Sheet";

}



/** Admin NO_QTY list — Store owns RS creation; Admin sees handoff instead of primary create CTA. */
export const NO_QTY_RS_STORE_HANDOFF_LABEL = "Requirement Sheet pending — Owner: Store" as const;

export const NO_QTY_RS_ADMIN_OVERRIDE_LINK_LABEL = "Open RS workspace as Admin override" as const;

export function isNoQtyStoreOwnedRsCreateLabel(label: string): boolean {
  const token = String(label ?? "").trim();
  if (!token) return false;
  if (token === "Create Next Requirement Sheet") return true;
  if (/^Create Cycle \d+ RS$/.test(token)) return true;
  if (/^Create Cycle \d+ Requirement Sheet$/.test(token)) return true;
  return false;
}

export function isNoQtyStoreOwnedRsCreatePrimaryAction(input: {
  primaryActionLabel: string;
  noQtyNextAction?: string | null;
  rsStatusLabel: string;
  hasDraftRequirementSheet: boolean;
}): boolean {
  if (input.hasDraftRequirementSheet) return false;
  const next = String(input.noQtyNextAction ?? "REQUIREMENT");
  if (next === "CREATE_NEXT_RS") return true;
  if ((next === "REQUIREMENT" || next === "") && input.rsStatusLabel === "No RS") return true;
  return isNoQtyStoreOwnedRsCreateLabel(input.primaryActionLabel);
}



export function noQtyCreateNextCycleContinuationLabel(opts: {

  nextCycleNo?: number | null;

  currentCycleNo?: number | null;

}): string {

  const next =

    opts.nextCycleNo != null && Number(opts.nextCycleNo) > 0

      ? Number(opts.nextCycleNo)

      : opts.currentCycleNo != null && Number(opts.currentCycleNo) > 0

        ? Number(opts.currentCycleNo) + 1

        : null;

  if (next != null && next > 0) {

    return createCycleRequirementSheetButtonLabel(next);

  }

  return "Create Next Requirement Sheet";

}



export function resolveCreateRsButtonLabel(ctx: {

  hasRs?: boolean | null;

  rsStatus?: string | null;

  currentCycleNo?: number | null;

  nextCycleNo?: number | null;

  createNextRsEligible?: boolean;

}): string {

  const hasRs = ctx.hasRs === true || (ctx.rsStatus && ctx.rsStatus !== "No RS");

  if (!hasRs) {

    const n = ctx.currentCycleNo ?? ctx.nextCycleNo ?? 1;

    return createCycleRsButtonLabel(Math.max(1, Number(n) || 1));

  }

  if (ctx.createNextRsEligible && ctx.nextCycleNo != null && ctx.nextCycleNo > 0) {

    return createCycleRequirementSheetButtonLabel(ctx.nextCycleNo);

  }

  return createNextRsButtonLabel(ctx.nextCycleNo);

}



export function noQtyAgreementWorkspaceHref(
  salesOrderId: number,
  opts?: { intent?: "add"; from?: string; cycleId?: number | null },
): string {
  const params = new URLSearchParams();
  params.set("source", "no_qty_so");
  params.set("salesOrderId", String(salesOrderId));
  if (opts?.intent === "add") params.set("intent", "add");
  if (opts?.from) params.set("from", opts.from);
  if (opts?.cycleId != null && Number(opts.cycleId) > 0) params.set("cycleId", String(opts.cycleId));
  return `/sales-orders/${salesOrderId}/requirement-sheets?${params.toString()}`;
}

/** Requirement Sheet Creation Workspace — first RS or next-cycle draft (not Place WO / execution). */
export function noQtyRsCreationWorkspaceHref(input: {
  salesOrderId: number;
  cycleId?: number | null;
  from?: string;
}): string {
  return noQtyAgreementWorkspaceHref(input.salesOrderId, {
    intent: "add",
    from: input.from ?? "pending-actions",
    cycleId: input.cycleId,
  });
}



export function noQtyPlanningHubHref(salesOrderId?: number): string {

  if (salesOrderId != null && salesOrderId > 0) {

    return `/planning-dashboard?salesOrderId=${encodeURIComponent(String(salesOrderId))}&source=no_qty_planning`;

  }

  return "/planning-dashboard";

}



/** NO_QTY Monthly Planning workspace — includes RS period when known. */

export function noQtyMonthlyPlanningHref(opts: {

  salesOrderId?: number;

  period?: string | null;

  source?: string;

}): string {

  const params = new URLSearchParams();

  if (opts.source) params.set("source", opts.source);

  if (opts.salesOrderId != null && opts.salesOrderId > 0) {

    params.set("salesOrderId", String(opts.salesOrderId));

  }

  const period = String(opts.period ?? "").trim();

  if (period) params.set("period", period);

  const q = params.toString();

  return q ? `/monthly-planning?${q}` : "/monthly-planning";

}



/** Planner inbox / locked RS CTA — stage-aware (Monthly Planning vs Place WO). */

export function resolveNoQtyInboxPlanningCta(input: {

  processStageKey?: string | null;

  salesOrderId: number;

  lockedPeriodKey?: string | null;

  cycleId?: number | null;

  requirementSheetId?: number | null;

  readyToPlaceWo?: boolean | null;

}): { label: string; href: string } {

  const key = String(input.processStageKey ?? "").toUpperCase();

  if (key === "NO_QTY_READY_TO_PLACE_WO" || input.readyToPlaceWo) {

    return {

      label: NO_QTY_PLACE_WO_LABEL,

      href: noQtyRsExecutionWorkspaceHref({

        salesOrderId: input.salesOrderId,

        cycleId: input.cycleId,

        requirementSheetId: input.requirementSheetId,

        source: "no_qty_planning",

        from: "inbox",

      }),

    };

  }

  if (key === "NO_QTY_REQUIREMENT_READY" || key === "NO_QTY_PROCUREMENT_IN_PROGRESS") {
    return {
      label: NO_QTY_OPEN_MONTHLY_PLANNING_LABEL,
      href: noQtyMonthlyPlanningHref({
        salesOrderId: input.salesOrderId,
        period: input.lockedPeriodKey,
        source: "no_qty_planning",
      }),
    };
  }
  if (key === "NO_QTY_DRAFT" || key === "NO_QTY_PREPARE_NEXT_RS") {
    return {
      label: "Create Requirement Sheet",
      href: noQtyRsCreationWorkspaceHref({
        salesOrderId: input.salesOrderId,
        cycleId: input.cycleId,
        from: "inbox",
      }),
    };
  }
  return {
    label: "Open Requirement Sheet",
    href: noQtyRsCreationWorkspaceHref({
      salesOrderId: input.salesOrderId,
      cycleId: input.cycleId,
      from: "inbox",
    }),
  };
}



/** Locked RS on Requirement Sheet page — Monthly Planning until ready, then execution workspace. */

export function resolveNoQtyLockedRsPlanningCta(input: {

  salesOrderId: number;

  periodKey?: string | null;

  cycleId?: number | null;

  requirementSheetId?: number | null;

  processStageKey?: string | null;

  readyToPlaceWo?: boolean | null;

}): { label: string; href: string } | null {

  const key = String(input.processStageKey ?? "").toUpperCase();

  if (key === "NO_QTY_READY_TO_PLACE_WO" || input.readyToPlaceWo) {

    return {

      label: NO_QTY_PLACE_WO_LABEL,

      href: noQtyRsExecutionWorkspaceHref({

        salesOrderId: input.salesOrderId,

        cycleId: input.cycleId,

        requirementSheetId: input.requirementSheetId,

        source: "no_qty_rs",

        from: "rs-page",

      }),

    };

  }

  if (key === "NO_QTY_PROCUREMENT_IN_PROGRESS") {

    return {

      label: NO_QTY_OPEN_MONTHLY_PLANNING_LABEL,

      href: noQtyMonthlyPlanningHref({

        salesOrderId: input.salesOrderId,

        period: input.periodKey,

        source: "no_qty_rs",

      }),

    };

  }

  if (key === "NO_QTY_REQUIREMENT_READY" || !input.periodKey) {

    return {

      label: NO_QTY_OPEN_MONTHLY_PLANNING_LABEL,

      href: noQtyMonthlyPlanningHref({

        salesOrderId: input.salesOrderId,

        period: input.periodKey,

        source: "no_qty_rs",

      }),

    };

  }

  return null;

}



export function noQtyNextRsStatusHeadline(eligible: boolean, nextRsAlreadyExists?: boolean): string {

  if (nextRsAlreadyExists) return "Next RS: Already on next cycle";

  if (eligible) return "Next RS Ready";

  return "Next RS Blocked";

}



export function noQtySoListHref(salesOrderId?: number, role?: string | null): string {
  return noQtyAgreementListHref(role, salesOrderId);
}

/** P10-A4 — Execution register primary CTA label. */
export const NO_QTY_OPEN_EXECUTION_WORKSPACE_LABEL = "Open Execution Workspace";

export type NoQtyExecutionActionNeededKey =
  | "PLACE_WO"
  | "ISSUE_RM"
  | "AWAIT_PROCUREMENT"
  | "BLOCKED"
  | "MONITOR_WO"
  | "COMPLETE"
  | string;

/** Resolve execution workspace href from inbox row fields (API href preferred). */
export function resolveNoQtyExecutionWorkspaceHref(input: {
  salesOrderId: number;
  executionWorkspaceHref?: string | null;
  placementRequirementSheetId?: number | null;
  guidedCycleId?: number | null;
}): string | null {
  const href = String(input.executionWorkspaceHref ?? "").trim();
  if (href) return href;
  const sheetId = input.placementRequirementSheetId;
  if (sheetId == null || !Number.isFinite(Number(sheetId)) || Number(sheetId) <= 0) return null;
  return noQtyRsExecutionWorkspaceHref({
    salesOrderId: input.salesOrderId,
    cycleId: input.guidedCycleId,
    requirementSheetId: Number(sheetId),
    source: "no_qty_execution",
    from: "execution-register",
  });
}

/** Prefer execution workspace when sheet id is known; otherwise NO_QTY Execution register. */
export function noQtyExecutionEntryHref(input: {
  salesOrderId: number;
  placementRequirementSheetId?: number | null;
  guidedCycleId?: number | null;
  executionWorkspaceHref?: string | null;
  role?: string | null;
  source?: string;
}): string {
  const workspace = resolveNoQtyExecutionWorkspaceHref({
    salesOrderId: input.salesOrderId,
    executionWorkspaceHref: input.executionWorkspaceHref,
    placementRequirementSheetId: input.placementRequirementSheetId,
    guidedCycleId: input.guidedCycleId,
  });
  if (workspace) return workspace;
  const base = noQtyAgreementListHref(input.role, input.salesOrderId);
  if (!input.source) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}source=${encodeURIComponent(input.source)}`;
}

/** Compact tone classes for execution register Action Needed column. */
export function noQtyExecutionActionNeededClassName(actionNeededKey?: string | null): string {
  const key = String(actionNeededKey ?? "").toUpperCase();
  switch (key) {
    case "PLACE_WO":
      return "font-semibold text-slate-900";
    case "ISSUE_RM":
      return "font-medium text-amber-800";
    case "AWAIT_PROCUREMENT":
      return "text-slate-500";
    case "BLOCKED":
      return "font-medium text-red-700";
    case "MONITOR_WO":
      return "text-slate-700";
    case "COMPLETE":
      return "text-emerald-700";
    default:
      return "text-slate-600";
  }
}

export function formatNoQtyExecutionRegisterQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(3).replace(/\.000$/, "");
}

