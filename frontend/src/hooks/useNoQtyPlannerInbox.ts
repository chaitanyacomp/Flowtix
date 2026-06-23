import * as React from "react";

import { apiFetch } from "../services/api";

import type { NoQtyFlowState } from "../lib/noQtyFlowState";

import {

  sortPlanningInboxRows,

  type PlanningInboxSoSummary,

} from "../lib/planningInboxPresentation";



export type NoQtyPlannerInboxRow = {

  so: PlanningInboxSoSummary;

  rsStatus: string;

  lockedPeriodKey: string | null;

  flowState: NoQtyFlowState | null;

  guidedCycleId: number | null;

  cycleNo: number | null;

  openExecutionBalanceQty?: number | null;

  requirementSheetHref?: string | null;

  pendingPlanningAction?: string | null;

  latestRsId?: number | null;

  latestRsNo?: string | null;

};



type NoQtyPlanningInboxApiRow = {

  salesOrderId: number;

  soNumber?: string | null;

  customerName?: string | null;

  currentCycleNo?: number | null;

  activeCycleId?: number | null;

  latestRsId?: number | null;

  latestRsNo?: string | null;

  latestRsStatus?: string | null;

  rsStatus: string;

  lockedPeriodKey: string | null;

  pendingPlanningAction?: string | null;

  openExecutionBalanceQty?: number | null;

  requirementSheetHref?: string | null;

  so: PlanningInboxSoSummary;

  flowState: NoQtyFlowState | null;

  guidedCycleId: number | null;

  cycleNo: number | null;

};



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

        const payload = await apiFetch<{ rows: NoQtyPlanningInboxApiRow[] }>(

          "/api/planning-dashboard/no-qty-inbox",

        );

        const mapped = (Array.isArray(payload.rows) ? payload.rows : []).map((row) => ({

          so: row.so,

          rsStatus: row.rsStatus,

          lockedPeriodKey: row.lockedPeriodKey,

          flowState: row.flowState ?? null,

          guidedCycleId: row.guidedCycleId,

          cycleNo: row.cycleNo,

          openExecutionBalanceQty: row.openExecutionBalanceQty ?? null,

          requirementSheetHref: row.requirementSheetHref ?? null,

          pendingPlanningAction: row.pendingPlanningAction ?? null,

          latestRsId: row.latestRsId ?? null,

          latestRsNo: row.latestRsNo ?? null,

        }));

        if (cancelled) return;

        setRows(sortPlanningInboxRows(mapped));

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

