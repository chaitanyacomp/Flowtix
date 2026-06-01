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
 *
 * ### Commercial continuation mode (`commercialContinuation: true`)
 *
 * The Planning Dashboard renders a **commercial continuation** list for OPEN
 * NO_QTY sales orders — this list is intentionally separate from the
 * operational queues (Production / QC / Dispatch). For ADMIN / SALES it must
 * **always** surface a planning action (Open Draft RS or Prepare Next RS),
 * never an operational step like "Open QC" / "Open Production" / "Open
 * Dispatch". Operational steps still live in their own cards on the same
 * dashboard column.
 *
 * Concretely, when `commercialContinuation: true` and viewer is SALES/ADMIN:
 *   - a `DRAFT` RS still wins (operators need to open and finalize it),
 *   - otherwise we always return `prepare_next_rs` regardless of
 *     `createNextRsEligible` / `primaryAction` / pending QC / pending
 *     dispatch / cycle pointer state. The actual eligibility check
 *     happens **at click time** in `prepareNoQtyNextRsAndNavigate` so the
 *     dashboard can show planning continuation as long as the SO is OPEN.
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
   * When `true`, force a planning-oriented resolution for SALES/ADMIN even
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
  const isPlanningViewer = viewer === "ADMIN";

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
    /**
     * Commercial continuation: SALES/ADMIN must see a planning action even
     * before flow state has resolved — fall back to prepare_next_rs so the
     * row never disappears between fetches.
     */
    if (commercialContinuation && isPlanningViewer) {
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

  /**
   * Commercial continuation (SALES/ADMIN): always plan. We never surface
   * shop-floor steps in this lane — those have their own dashboard cards.
   * Eligibility is re-checked at click time, so the row stays visible for
   * the entire lifetime of an OPEN NO_QTY sales order.
   */
  if (commercialContinuation && isPlanningViewer) {
    return { kind: "prepare_next_rs", label: "Next RS" };
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

  /** Planning (SALES/ADMIN) is independent of shop-floor production balance. */
  if (userCanCreateNextRs && viewer === "ADMIN") {
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
