import { buildNoQtyGuidedHref, buildQcEntryHref, type NoQtyFlowState } from "./noQtyFlowState";

export type ResolvedNoQtyContinuation =
  | { kind: "navigate"; label: string; to: string }
  | { kind: "prepare_next_rs"; label: string };

/**
 * Maps NO_QTY flow state + dashboard row hints to the primary continuation action
 * for the **Sales / Admin planning launcher** (not Store dispatch ownership).
 *
 * **Dashboard → Next RS (rolling / continue planning):** always `prepare_next_rs` so the client runs
 * `prepareNoQtyNextRequirementSheetAndNavigate` — never a direct `navigate` with stale `sheetId` /
 * `fromStep=requirement` (those URLs loaded the prior cycle’s locked RS and hid the create workspace).
 *
 * **Exception:** when the row is clearly a **draft** RS, we still deep-link so operators open that draft.
 *
 * This resolver never targets `/work-orders` — WO creation remains from the RS workspace.
 */
export function resolveNoQtyDashboardContinuation(args: {
  salesOrderId: number;
  cycleId: number | null | undefined;
  latestRequirementSheetId: number | null | undefined;
  lastRsStatus: string | null | undefined;
  flow: NoQtyFlowState | null;
  /** Dashboard viewer — blocking QC step applies only for roles that own the QC floor. */
  viewerRole?: string | null;
}): ResolvedNoQtyContinuation {
  const { salesOrderId, cycleId, latestRequirementSheetId, lastRsStatus, flow, viewerRole } = args;
  const effCycleId = flow?.cycleId ?? cycleId ?? null;
  const viewer = String(viewerRole ?? "").trim().toUpperCase();

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

  /** Flow not loaded yet but row shows locked RS — POST prepare (same as eligible path); never deep-link stale sheetId. */
  if (!flow) {
    const lockedNoFlow = String(lastRsStatus ?? "").toUpperCase() === "LOCKED";
    if (lockedNoFlow) {
      return { kind: "prepare_next_rs", label: "Next RS" };
    }
    return {
      kind: "navigate",
      label: "Next RS",
      to: buildNoQtyGuidedHref({
        to: `/sales-orders/${salesOrderId}/requirement-sheets`,
        salesOrderId,
        cycleId: effCycleId,
        fromStep: "requirement",
      }),
    };
  }

  const na = flow.nextAction;
  const hasQcDispatchTail = Boolean(flow.hasQcDispatchPending);

  const userCanCreateNextRs =
    flow.primaryActionForCurrentUser != null
      ? flow.primaryActionForCurrentUser === "CREATE_NEXT_RS" ||
        flow.roleAllowedSecondaryActions?.includes("CREATE_NEXT_RS") ||
        flow.roleAllowedSecondaryActions?.includes("NEXT_RS")
      : flow.primaryAction === "NEXT_RS" || Boolean(flow.createNextRsEligible);

  const openQc = () =>
    ({
      kind: "navigate" as const,
      label: "Open QC",
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

  /** Planning (SALES/ADMIN) is independent of shop-floor production balance. */
  if (userCanCreateNextRs && (viewer === "SALES" || viewer === "ADMIN")) {
    return { kind: "prepare_next_rs", label: "Next RS" };
  }

  /** QC → Dispatch → Production for shop-floor roles. */
  if (flow.qcPendingForCycle && (viewer === "ADMIN" || viewer === "QC" || viewer === "PRODUCTION")) {
    return openQc();
  }
  if (
    (na === "DISPATCH" || flow.hasQcDispatchPending) &&
    (viewer === "ADMIN" || viewer === "STORE" || viewer === "DISPATCH")
  ) {
    return openDispatch();
  }
  if (na === "PRODUCTION" && (viewer === "ADMIN" || viewer === "PRODUCTION")) {
    return openProduction();
  }

  if (rollingSheetId != null && Number.isFinite(Number(rollingSheetId)) && Number(rollingSheetId) > 0) {
    return { kind: "prepare_next_rs", label: "Next RS" };
  }

  if (na === "WORK_ORDER" && !hasQcDispatchTail) {
    return { kind: "prepare_next_rs", label: "Next RS" };
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
