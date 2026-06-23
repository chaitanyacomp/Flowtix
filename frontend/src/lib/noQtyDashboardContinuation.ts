import { buildNoQtyGuidedHref, buildQcEntryHref, type NoQtyFlowState } from "./noQtyFlowState";
import { noQtyRsCreationWorkspaceHref } from "./noQtyRsActionLabels";
import { noQtyDashboardRowHasRs } from "./noQtyDashboardPresentation";

export type ResolvedNoQtyContinuation =
  | { kind: "navigate"; label: string; to: string }
  | { kind: "prepare_next_rs"; label: string };

function openCurrentRsNavigate(salesOrderId: number, effCycleId: number | null): ResolvedNoQtyContinuation {
  return {
    kind: "navigate",
    label: "Open Requirement Sheet",
    to: buildNoQtyGuidedHref({
      to: `/sales-orders/${salesOrderId}/requirement-sheets`,
      salesOrderId,
      cycleId: effCycleId,
      fromStep: "requirement",
    }),
  };
}

/**
 * Maps NO_QTY flow state + dashboard row hints to the primary continuation action
 * for the **Store / Admin planning launcher** (not shop-floor dispatch ownership).
 *
 * **Dashboard → Next RS (rolling / continue planning):** always `prepare_next_rs` so the client runs
 * `prepareNoQtyNextRequirementSheetAndNavigate` — never a direct `navigate` with stale `sheetId` /
 * `fromStep=requirement` (those URLs loaded the prior cycle’s locked RS and hid the create workspace).
 *
 * **Exception:** when the row is clearly a **draft** RS, we still deep-link so operators open that draft.
 *
 * This resolver never targets `/work-orders` — WO creation remains from the RS workspace.
 *
 * ### Commercial continuation mode (`commercialContinuation: true`)
 *
 * The Planning Dashboard renders a **commercial continuation** list for OPEN
 * NO_QTY sales orders — this list is intentionally separate from the
 * operational queues (Production / QC / Dispatch). For ADMIN / STORE it must
 * **always** surface a planning action (Open Draft RS or Prepare Next RS),
 * never an operational step like "Open QC" / "Open Production" / "Open
 * Dispatch". Operational steps still live in their own cards on the same
 * dashboard column.
 *
 * Concretely, when `commercialContinuation: true` and viewer is ADMIN/STORE:
 *   - a `DRAFT` RS still wins (operators need to open and finalize it),
 *   - no RS on the current cycle → navigate to RS creation workspace (Cycle 1, not cycle+1),
 *   - locked RS with `createNextRsEligible` → `prepare_next_rs` for the next cycle,
 *   - otherwise → open the current RS workspace (never shop-floor QC / dispatch).
 */
export function resolveNoQtyDashboardContinuation(args: {
  salesOrderId: number;
  cycleId: number | null | undefined;
  latestRequirementSheetId: number | null | undefined;
  lastRsStatus: string | null | undefined;
  flow: NoQtyFlowState | null;
  /** Dashboard viewer — blocking QC step applies only for roles that own the QC floor. */
  viewerRole?: string | null;
  /**
   * When `true`, force a planning-oriented resolution for ADMIN/STORE even
   * if operational steps are pending. See doc block above. The Planning
   * Dashboard's NO_QTY continuation list passes this flag; deep-link
   * navigations from operational cards do not.
   */
  commercialContinuation?: boolean;
}): ResolvedNoQtyContinuation {
  const {
    salesOrderId,
    cycleId,
    latestRequirementSheetId,
    lastRsStatus,
    flow,
    viewerRole,
    commercialContinuation,
  } = args;
  const effCycleId = flow?.cycleId ?? cycleId ?? null;
  const viewer = String(viewerRole ?? "").trim().toUpperCase();
  const isPlanningViewer = viewer === "ADMIN" || viewer === "STORE";

  const rollingSheetId =
    flow?.nextRollingRequirementSheetId != null && Number(flow.nextRollingRequirementSheetId) > 0
      ? Number(flow.nextRollingRequirementSheetId)
      : null;

  const rsDraft =
    String(lastRsStatus ?? "").toUpperCase() === "DRAFT" ||
    Boolean(flow && flow.requirementExists && !flow.requirementLocked);

  /** A) Draft / unlocked RS — open that sheet (only navigate-with-sheet case we keep). */
  if (rsDraft) {
    const sid =
      rollingSheetId != null
        ? rollingSheetId
        : latestRequirementSheetId != null
          ? Number(latestRequirementSheetId)
          : 0;
    const rollingCycleId =
      flow?.nextRollingRequirementSheetCycleId != null && Number(flow.nextRollingRequirementSheetCycleId) > 0
        ? Number(flow.nextRollingRequirementSheetCycleId)
        : null;
    const base = buildNoQtyGuidedHref({
      to: `/sales-orders/${salesOrderId}/requirement-sheets`,
      salesOrderId,
      cycleId: rollingCycleId ?? effCycleId,
      fromStep: "requirement",
    });
    const sep = base.includes("?") ? "&" : "?";
    const withSheet =
      Number.isFinite(sid) && sid > 0 ? `${base}${sep}sheetId=${encodeURIComponent(String(sid))}` : base;
    return { kind: "navigate", label: "Next RS", to: withSheet };
  }

  /** Flow not loaded yet — infer from row hints; never prepare-next when no RS exists. */
  if (!flow) {
    const hasRs = noQtyDashboardRowHasRs({ lastRsStatus, latestRequirementSheetId, flow: null });
    if (!hasRs) {
      return {
        kind: "navigate",
        label: "Create RS",
        to: noQtyRsCreationWorkspaceHref({ salesOrderId, cycleId: effCycleId, from: "dashboard" }),
      };
    }
    const lockedNoFlow = String(lastRsStatus ?? "").toUpperCase() === "LOCKED";
    if (lockedNoFlow && commercialContinuation && isPlanningViewer) {
      return openCurrentRsNavigate(salesOrderId, effCycleId);
    }
    if (lockedNoFlow) {
      return { kind: "prepare_next_rs", label: "Next RS" };
    }
    if (commercialContinuation && isPlanningViewer) {
      return openCurrentRsNavigate(salesOrderId, effCycleId);
    }
    return {
      kind: "navigate",
      label: "Create RS",
      to: noQtyRsCreationWorkspaceHref({ salesOrderId, cycleId: effCycleId, from: "dashboard" }),
    };
  }

  /**
   * Commercial continuation (ADMIN/STORE): planning-only lane on the dashboard.
   * Case A — no RS → creation workspace (current cycle, not cycle+1).
   * Case B — draft → handled above via rsDraft navigate.
   * Case C — next RS only when createNextRsEligible is true.
   */
  if (commercialContinuation && isPlanningViewer) {
    const hasRs = noQtyDashboardRowHasRs({ lastRsStatus, latestRequirementSheetId, flow });
    if (!hasRs) {
      return {
        kind: "navigate",
        label: "Create RS",
        to: noQtyRsCreationWorkspaceHref({ salesOrderId, cycleId: effCycleId, from: "dashboard" }),
      };
    }
    if (flow.createNextRsEligible) {
      return { kind: "prepare_next_rs", label: "Next RS" };
    }
    return openCurrentRsNavigate(salesOrderId, effCycleId);
  }

  const na = flow.nextAction;

  const userCanCreateNextRs =
    flow.primaryActionForCurrentUser != null
      ? flow.primaryActionForCurrentUser === "CREATE_NEXT_RS" ||
        flow.roleAllowedSecondaryActions?.includes("CREATE_NEXT_RS") ||
        flow.roleAllowedSecondaryActions?.includes("NEXT_RS")
      : flow.primaryAction === "NEXT_RS" || Boolean(flow.createNextRsEligible);

  const openQc = () =>
    ({
      kind: "navigate" as const,
      label: "Complete QA",
      to: buildQcEntryHref({
        salesOrderId,
        cycleId: effCycleId,
        orderType: "NO_QTY",
        fromStep: "production",
        navOrigin: "dashboard",
      }),
    });

  const openProduction = () =>
    ({
      kind: "navigate" as const,
      label: "Open Production",
      to: buildNoQtyGuidedHref({
        to: `/production`,
        salesOrderId,
        cycleId: effCycleId,
        fromStep: "work_order",
      }),
    });

  const openDispatch = () =>
    ({
      kind: "navigate" as const,
      label: "Open NO_QTY Dispatch",
      to: buildNoQtyGuidedHref({
        to: `/dispatch`,
        salesOrderId,
        cycleId: effCycleId,
        fromStep: "dispatch",
      }),
    });

  /** Planning (Store/Admin) is independent of shop-floor production balance. */
  if (userCanCreateNextRs && (viewer === "ADMIN" || viewer === "STORE")) {
    return { kind: "prepare_next_rs", label: "Next RS" };
  }

  /** QC → Dispatch → Production for shop-floor roles. */
  if (flow.qcPendingForCycle && (viewer === "ADMIN" || viewer === "QA" || viewer === "PRODUCTION")) {
    return openQc();
  }
  if (
    (na === "DISPATCH" || flow.hasQcDispatchPending) &&
    (viewer === "ADMIN" || viewer === "STORE")
  ) {
    return openDispatch();
  }
  if (na === "PRODUCTION" && (viewer === "ADMIN" || viewer === "PRODUCTION")) {
    return openProduction();
  }

  if (rollingSheetId != null && Number.isFinite(Number(rollingSheetId)) && Number(rollingSheetId) > 0) {
    return { kind: "prepare_next_rs", label: "Next RS" };
  }

  if (na === "WORK_ORDER" && (viewer === "ADMIN" || viewer === "STORE")) {
    return {
      kind: "navigate",
      label: "Place WO",
      to: `${buildNoQtyGuidedHref({
        to: `/sales-orders/${salesOrderId}/requirement-sheets`,
        salesOrderId,
        cycleId: effCycleId,
        fromStep: "requirement",
      })}&focus=execution`,
    };
  }
  if (na === "QC") {
    return openQc();
  }
  if (na === "PRODUCTION") {
    return openProduction();
  }
  if (na === "DISPATCH") {
    return openDispatch();
  }
  if (na === "SALES_BILL") {
    return {
      kind: "navigate",
      label: "Open Sales Bill",
      to: buildNoQtyGuidedHref({
        to: `/sales-bills`,
        salesOrderId,
        cycleId: effCycleId,
        fromStep: "dispatch",
      }),
    };
  }

  return { kind: "prepare_next_rs", label: "Next RS" };
}
