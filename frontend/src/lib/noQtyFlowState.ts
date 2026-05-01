import * as React from "react";
import { apiFetch } from "../services/api";
import type { FlowStep } from "../components/erp/FlowStepBar";

export type NoQtyFromStep = "requirement" | "work_order" | "production" | "qc" | "dispatch";

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
  dispatchExists: boolean;
  salesBillExists: boolean;
  nextAction: NoQtyNextAction;
  /** 1..6 per Requirement→Sales Bill */
  activeStep: 1 | 2 | 3 | 4 | 5 | 6;
};

export function useNoQtyFlowState(soId: number | null, enabled: boolean): {
  state: NoQtyFlowState | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [state, setState] = React.useState<NoQtyFlowState | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (!enabled || !soId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch<NoQtyFlowState>(`/api/sales-orders/${soId}/no-qty-flow-state`);
      setState(r ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load flow state");
      // Keep the last known good state (if any) so the UI can still guide users.
    } finally {
      setLoading(false);
    }
  }, [enabled, soId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, loading, error, refresh };
}

export function buildNoQtyGuidedHref(args: {
  to: string;
  salesOrderId: number;
  cycleId?: number | null;
  fromStep?: NoQtyFromStep;
}): string {
  const { to, salesOrderId, cycleId, fromStep } = args;
  const hasQuery = to.includes("?");
  const q: string[] = [`source=no_qty_so`, `salesOrderId=${salesOrderId}`];
  if (cycleId != null && Number.isFinite(cycleId) && cycleId > 0) q.push(`cycleId=${cycleId}`);
  if (fromStep) q.push(`fromStep=${encodeURIComponent(fromStep)}`);
  return `${to}${hasQuery ? "&" : "?"}${q.join("&")}`;
}

function withNoQtyCtx(to: string, salesOrderId: number): string {
  return buildNoQtyGuidedHref({ to, salesOrderId });
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

