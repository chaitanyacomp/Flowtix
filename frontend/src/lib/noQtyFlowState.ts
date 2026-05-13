import * as React from "react";
import { apiFetch } from "../services/api";
import type { FlowStep } from "../components/erp/FlowStepBar";

export type NoQtyFromStep = "requirement" | "rs" | "work_order" | "production" | "qc" | "dispatch";

export type NoQtyNextAction = "REQUIREMENT" | "WORK_ORDER" | "PRODUCTION" | "QC" | "DISPATCH" | "SALES_BILL";

export type NoQtyFlowState = {
  salesOrderId: number;
  cycleId: number | null;
  isCompleted: boolean;
  requirementExists: boolean;
  requirementLocked: boolean;
  workOrderExists: boolean;
  workOrderId: number | null;
  productionExists: boolean;
  qcExists: boolean;
  /** True when at least one approved batch in this cycle still has QC pending qty. */
  qcPendingForCycle?: boolean;
  /** True when cycle QC accepted qty exceeds operational net dispatch for some FG line. */
  hasQcDispatchPending?: boolean;
  dispatchExists: boolean;
  salesBillExists: boolean;
  nextAction: NoQtyNextAction;
  /** 1..6 per Requirement→Sales Bill */
  activeStep: 1 | 2 | 3 | 4 | 5 | 6;
  /** True when current-cycle RS is locked, QC is complete for the cycle, and no RS exists on a later cycle. */
  createNextRsEligible?: boolean;
  /** When a later-cycle RS already exists, its document number (Create Next RS hidden). */
  nextRsAlreadyCreatedDocNo?: string | null;
};

export type UseNoQtyFlowStateOpts = {
  /** When set, GET flow state for this cycle (matches RS / deep-link context). Omit to use SO current cycle. */
  cycleId?: number | null;
};

export function useNoQtyFlowState(
  soId: number | null,
  enabled: boolean,
  opts?: UseNoQtyFlowStateOpts,
): {
  state: NoQtyFlowState | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [state, setState] = React.useState<NoQtyFlowState | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const cycleKey =
    opts?.cycleId != null && Number.isFinite(Number(opts.cycleId)) && Number(opts.cycleId) > 0
      ? Number(opts.cycleId)
      : null;

  const refresh = React.useCallback(async () => {
    if (!enabled || !soId) return;
    setLoading(true);
    setError(null);
    try {
      const qs =
        cycleKey != null ? `?cycleId=${encodeURIComponent(String(cycleKey))}` : "";
      const r = await apiFetch<NoQtyFlowState>(`/api/sales-orders/${soId}/no-qty-flow-state${qs}`);
      setState(r ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load flow state");
      // Keep the last known good state (if any) so the UI can still guide users.
    } finally {
      setLoading(false);
    }
  }, [enabled, soId, cycleKey]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, loading, error, refresh };
}

/**
 * When showing next-step UI on a LOCKED NO_QTY RS, clamp impossible skips (e.g. Sales Bill before WO)
 * using only flags already returned by the flow-state API — no new business calculations.
 */
export function clampNoQtyNextActionForLockedRs(flow: NoQtyFlowState): NoQtyNextAction {
  const a = flow.nextAction;
  if (!flow.workOrderExists) {
    if (a === "DISPATCH") return "DISPATCH";
    if (a === "PRODUCTION" || a === "QC" || a === "SALES_BILL") return "WORK_ORDER";
    return "WORK_ORDER";
  }
  if (!flow.productionExists) {
    return "PRODUCTION";
  }
  if (flow.qcPendingForCycle && (a === "DISPATCH" || a === "SALES_BILL")) return "QC";
  return a;
}

/** Primary next step on locked NO_QTY RS: Create Next RS takes precedence when backend says eligible. */
export function lockedNoQtyPrimaryStep(
  flow: NoQtyFlowState | null,
): { mode: "create_next_rs" } | { mode: "action"; action: NoQtyNextAction } | null {
  if (!flow) return null;
  if (flow.createNextRsEligible && !flow.nextRsAlreadyCreatedDocNo) {
    return { mode: "create_next_rs" };
  }
  return { mode: "action", action: clampNoQtyNextActionForLockedRs(flow) };
}

export function buildNoQtyGuidedHref(args: {
  to: string;
  salesOrderId: number;
  cycleId?: number | null;
  /** NO_QTY: RS row id — keeps Work Orders page aligned with the locked sheet when SO cycle pointer differs. */
  requirementSheetId?: number | null;
  fromStep?: NoQtyFromStep;
}): string {
  const { to, salesOrderId, cycleId, requirementSheetId, fromStep } = args;
  const hasQuery = to.includes("?");
  const q: string[] = [`source=no_qty_so`, `salesOrderId=${salesOrderId}`];
  if (cycleId != null && Number.isFinite(cycleId) && cycleId > 0) q.push(`cycleId=${cycleId}`);
  const rsId =
    requirementSheetId != null && Number.isFinite(Number(requirementSheetId)) && Number(requirementSheetId) > 0
      ? Number(requirementSheetId)
      : null;
  if (rsId != null) q.push(`requirementSheetId=${encodeURIComponent(String(rsId))}`);
  if (fromStep) q.push(`fromStep=${encodeURIComponent(fromStep)}`);
  return `${to}${hasQuery ? "&" : "?"}${q.join("&")}`;
}

/** QC deep-link: adds `source=no_qty_so` (+ optional cycle) when the SO is NO_QTY so QcEntryPage enables guided next steps. */
export function buildQcEntryHref(args: {
  salesOrderId: number;
  productionId?: number | null;
  cycleId?: number | null;
  orderType?: string | null;
  fromStep?: NoQtyFromStep;
}): string {
  const pid = args.productionId != null ? Number(args.productionId) : 0;
  const prodQs = Number.isFinite(pid) && pid > 0 ? `&productionId=${encodeURIComponent(String(pid))}` : "";
  if (String(args.orderType ?? "").trim() === "NO_QTY") {
    return `${buildNoQtyGuidedHref({
      to: "/qc-entry",
      salesOrderId: args.salesOrderId,
      cycleId: args.cycleId ?? null,
      fromStep: args.fromStep ?? "production",
    })}${prodQs}`;
  }
  return `/qc-entry?salesOrderId=${encodeURIComponent(String(args.salesOrderId))}${prodQs}`;
}

export function buildNoQtyFlowSteps(args: {
  salesOrderId: number;
  state: NoQtyFlowState | null;
}): FlowStep[] {
  const { salesOrderId, state } = args;
  const active = state?.activeStep ?? 1;

  const st = (n: 1 | 2 | 3 | 4 | 5 | 6): "done" | "active" | "next" | "todo" => {
    if (n < active) return "done";
    if (n === active) return "active";
    if (n === (active + 1) as any) return "next";
    return "todo";
  };

  return [
    {
      label: "Requirement",
      to: buildNoQtyGuidedHref({ to: `/sales-orders/${salesOrderId}/requirement-sheets`, salesOrderId, cycleId: state?.cycleId ?? null }),
      status: st(1),
    },
    { label: "Work Order", to: buildNoQtyGuidedHref({ to: `/work-orders?soMode=NO_QTY`, salesOrderId, cycleId: state?.cycleId ?? null }), status: st(2) },
    { label: "Production", to: buildNoQtyGuidedHref({ to: `/production`, salesOrderId, cycleId: state?.cycleId ?? null }), status: st(3) },
    { label: "QC", to: buildNoQtyGuidedHref({ to: `/qc-entry`, salesOrderId, cycleId: state?.cycleId ?? null }), status: st(4) },
    { label: "Dispatch", to: buildNoQtyGuidedHref({ to: `/dispatch`, salesOrderId, cycleId: state?.cycleId ?? null }), status: st(5) },
    { label: "Sales Bill", to: buildNoQtyGuidedHref({ to: `/sales-bills`, salesOrderId, cycleId: state?.cycleId ?? null }), status: st(6) },
  ];
}

