import { buildNoQtyGuidedHref, buildQcEntryHref, type NoQtyFlowState } from "./noQtyFlowState";

export type ResolvedNoQtyContinuation =
  | { kind: "navigate"; label: string; to: string }
  | { kind: "prepare_next_rs"; label: string };

/**
 * Maps NO_QTY flow state + dashboard row hints to the primary continuation action.
 * Routing/UX only — same signals as {@link NoQtyFlowState} from the API.
 */
export function resolveNoQtyDashboardContinuation(args: {
  salesOrderId: number;
  cycleId: number | null | undefined;
  latestRequirementSheetId: number | null | undefined;
  lastRsStatus: string | null | undefined;
  flow: NoQtyFlowState | null;
}): ResolvedNoQtyContinuation {
  const { salesOrderId, cycleId, latestRequirementSheetId, lastRsStatus, flow } = args;
  const effCycleId = flow?.cycleId ?? cycleId ?? null;

  const rsDraft =
    String(lastRsStatus ?? "").toUpperCase() === "DRAFT" ||
    Boolean(flow && flow.requirementExists && !flow.requirementLocked);

  if (rsDraft) {
    const base = buildNoQtyGuidedHref({
      to: `/sales-orders/${salesOrderId}/requirement-sheets`,
      salesOrderId,
      cycleId: effCycleId,
      fromStep: "requirement",
    });
    const sid = latestRequirementSheetId != null ? Number(latestRequirementSheetId) : 0;
    const sep = base.includes("?") ? "&" : "?";
    const withSheet =
      Number.isFinite(sid) && sid > 0 ? `${base}${sep}sheetId=${encodeURIComponent(String(sid))}` : base;
    return { kind: "navigate", label: "Open RS", to: withSheet };
  }

  if (!flow) {
    const lockedNoFlow = String(lastRsStatus ?? "").toUpperCase() === "LOCKED";
    const sidEarly = latestRequirementSheetId != null ? Number(latestRequirementSheetId) : 0;
    if (lockedNoFlow && Number.isFinite(sidEarly) && sidEarly > 0) {
      return {
        kind: "navigate",
        label: "Go to Work Order",
        to: buildNoQtyGuidedHref({
          to: `/work-orders?soMode=NO_QTY`,
          salesOrderId,
          cycleId: cycleId ?? effCycleId,
          requirementSheetId: sidEarly,
          fromStep: "rs",
        }),
      };
    }
    return {
      kind: "navigate",
      label: "Open requirement sheets",
      to: buildNoQtyGuidedHref({
        to: `/sales-orders/${salesOrderId}/requirement-sheets`,
        salesOrderId,
        cycleId: effCycleId,
        fromStep: "requirement",
      }),
    };
  }

  const na = flow.nextAction;

  if (flow.createNextRsEligible) {
    return { kind: "prepare_next_rs", label: "Create Next RS" };
  }

  /** Locked RS with no WO yet: API often returns REQUIREMENT; ops next step is Work Order (not re-open RS). */
  const latestLocked = String(lastRsStatus ?? "").toUpperCase() === "LOCKED";
  const stockDispatchWithoutWo = !flow.workOrderExists && na === "DISPATCH";
  const sid = latestRequirementSheetId != null ? Number(latestRequirementSheetId) : 0;
  const hasRsId = Number.isFinite(sid) && sid > 0;
  if (latestLocked && !stockDispatchWithoutWo && !flow.workOrderExists && hasRsId) {
    return {
      kind: "navigate",
      label: "Create Work Order",
      to: buildNoQtyGuidedHref({
        to: `/work-orders?soMode=NO_QTY`,
        salesOrderId,
        cycleId: effCycleId,
        requirementSheetId: sid,
        fromStep: "rs",
      }),
    };
  }

  if (na === "WORK_ORDER") {
    return {
      kind: "navigate",
      label: flow.workOrderExists ? "Go to Work Order" : "Create Work Order",
      to: buildNoQtyGuidedHref({
        to: `/work-orders?soMode=NO_QTY`,
        salesOrderId,
        cycleId: effCycleId,
        requirementSheetId: latestRequirementSheetId ?? null,
        fromStep: "rs",
      }),
    };
  }
  if (na === "PRODUCTION") {
    return {
      kind: "navigate",
      label: "Open Production",
      to: buildNoQtyGuidedHref({
        to: `/production`,
        salesOrderId,
        cycleId: effCycleId,
        fromStep: "work_order",
      }),
    };
  }
  if (na === "QC") {
    return {
      kind: "navigate",
      label: "Open QC",
      to: buildQcEntryHref({
        salesOrderId,
        cycleId: effCycleId,
        orderType: "NO_QTY",
        fromStep: "production",
      }),
    };
  }
  if (na === "DISPATCH") {
    return {
      kind: "navigate",
      label: "Open Dispatch",
      to: buildNoQtyGuidedHref({
        to: `/dispatch`,
        salesOrderId,
        cycleId: effCycleId,
        fromStep: "qc",
      }),
    };
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

  return {
    kind: "navigate",
    label: "Open RS",
    to: buildNoQtyGuidedHref({
      to: `/sales-orders/${salesOrderId}/requirement-sheets`,
      salesOrderId,
      cycleId: effCycleId,
      fromStep: "requirement",
    }),
  };
}
