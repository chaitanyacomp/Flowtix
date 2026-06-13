import * as React from "react";
import { apiFetch } from "../services/api";
import type { NoQtyFlowState } from "../lib/noQtyFlowState";
import {
  isNoQtyAgreementClosed,
  resolvePlanningInboxRsStatus,
  sortPlanningInboxRows,
  type PlanningInboxSheetRow,
  type PlanningInboxSoSummary,
} from "../lib/planningInboxPresentation";

export type NoQtyPlannerInboxRow = {
  so: PlanningInboxSoSummary;
  rsStatus: string;
  flowState: NoQtyFlowState | null;
  guidedCycleId: number | null;
  cycleNo: number | null;
};

type SoListRow = PlanningInboxSoSummary & {
  orderType?: string;
};

async function loadInboxRow(so: SoListRow): Promise<NoQtyPlannerInboxRow> {
  const guidedCycleId =
    so.noQtyGuidedCycleId != null && Number(so.noQtyGuidedCycleId) > 0
      ? Number(so.noQtyGuidedCycleId)
      : so.currentCycle?.id != null && Number(so.currentCycle.id) > 0
        ? Number(so.currentCycle.id)
        : null;
  const cycleNo =
    so.noQtyActualActiveCycleNo ??
    so.currentCycle?.cycleNo ??
    null;

  let sheets: PlanningInboxSheetRow[] = [];
  let flowState: NoQtyFlowState | null = null;

  const flowQs =
    guidedCycleId != null ? `?cycleId=${encodeURIComponent(String(guidedCycleId))}` : "";

  const [sheetsResult, flowResult] = await Promise.allSettled([
    apiFetch<PlanningInboxSheetRow[]>(`/api/sales-orders/${so.id}/requirement-sheets`),
    apiFetch<NoQtyFlowState>(`/api/sales-orders/${so.id}/no-qty-flow-state${flowQs}`),
  ]);

  if (sheetsResult.status === "fulfilled" && Array.isArray(sheetsResult.value)) {
    sheets = sheetsResult.value;
  }
  if (flowResult.status === "fulfilled") {
    flowState = flowResult.value ?? null;
  }

  return {
    so,
    rsStatus: resolvePlanningInboxRsStatus(sheets, guidedCycleId),
    flowState,
    guidedCycleId,
    cycleNo: cycleNo != null && Number.isFinite(Number(cycleNo)) ? Number(cycleNo) : null,
  };
}

export function useNoQtyPlannerInbox(refreshKey = 0): {
  rows: NoQtyPlannerInboxRow[];
  loading: boolean;
  error: string | null;
} {
  const [rows, setRows] = React.useState<NoQtyPlannerInboxRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const list = await apiFetch<SoListRow[]>("/api/sales-orders");
        const activeNoQty = (Array.isArray(list) ? list : []).filter(
          (so) => so.orderType === "NO_QTY" && !isNoQtyAgreementClosed(so),
        );
        const enriched = await Promise.all(activeNoQty.map((so) => loadInboxRow(so)));
        if (cancelled) return;
        setRows(sortPlanningInboxRows(enriched));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load planner inbox");
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { rows, loading, error };
}
