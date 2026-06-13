import type { NavigateFunction } from "react-router-dom";
import { apiFetch } from "../services/api";
import { PRODUCTION_FLOW_NO_QTY } from "./productionFlowContract";

type ToastApi = {
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showInfo: (message: string) => void;
};

function toastForPrepareReason(reason: string, blockingPmrDocNo?: string | null): string {
  if (reason === "NO_LOCKED_RS" || reason === "DRAFT_RS_ON_CYCLE") {
    return "Current cycle needs a locked requirement sheet.";
  }
  if (reason === "DRAFT_RS_EXISTS") return "Finish or cancel the draft Requirement Sheet on the next cycle first.";
  if (reason === "NEXT_RS_EXISTS") return "A locked requirement sheet already exists on a later cycle.";
  if (reason === "NOT_CURRENT_CYCLE") return "Sales order cycle pointer is out of date — try again after refresh.";
  if (reason === "SO_CLOSED") return "This NO_QTY agreement is closed.";
  return `Could not advance cycle (${reason}).`;
}

/**
 * Dashboard → Next RS (post-prepare): explicit query shape only — never `sheetId` / `requirementSheetId` / `fromStep`,
 * so the RS page stays in empty-cycle create mode instead of inheriting a prior locked RS from the current URL.
 */
export function buildNoQtyPrepareNextRsCreateUrl(salesOrderId: number, cycleId: number | null): string {
  const sid = Number(salesOrderId);
  if (!Number.isFinite(sid) || sid <= 0) return `/sales-orders/${salesOrderId}/requirement-sheets`;
  const params = new URLSearchParams();
  params.set("flow", PRODUCTION_FLOW_NO_QTY);
  params.set("source", "no_qty_so");
  params.set("salesOrderId", String(sid));
  const c = cycleId != null ? Number(cycleId) : NaN;
  if (Number.isFinite(c) && c > 0) params.set("cycleId", String(Math.trunc(c)));
  params.set("intent", "add");
  params.set("fromDashboard", "1");
  return `/sales-orders/${sid}/requirement-sheets?${params.toString()}`;
}

/**
 * POST prepare-next-requirement-sheet then navigate to the add-intent requirement sheet URL.
 * Matches dashboard NO_QTY continuation behavior (including skipping duplicate prepare when `fromDashboard=1`).
 */
export async function prepareNoQtyNextRequirementSheetAndNavigate(opts: {
  salesOrderId: number;
  navigate: NavigateFunction;
  toast: ToastApi;
  /** Passed to react-router `navigate` state */
  navigateState?: Record<string, unknown>;
}): Promise<void> {
  const { salesOrderId, navigate, toast, navigateState } = opts;
  let cycleIdFromPrepare: number | null = null;
  try {
    const out = await apiFetch<{
      advanced?: boolean;
      reason?: string;
      currentCycleId?: number | null;
      blockingPmrDocNo?: string | null;
    }>(`/api/sales-orders/${salesOrderId}/no-qty-cycle/prepare-next-requirement-sheet`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    const cid = out?.currentCycleId != null ? Number(out.currentCycleId) : NaN;
    if (Number.isFinite(cid) && cid > 0) {
      cycleIdFromPrepare = cid;
    }
    if (out?.advanced) {
      toast.showSuccess("Next cycle opened. Continuing to requirement sheet…");
    } else if (out?.reason && out.reason !== "OK") {
      toast.showInfo(toastForPrepareReason(String(out.reason), out.blockingPmrDocNo));
    }
  } catch (err) {
    toast.showError(err instanceof Error ? err.message : "Could not prepare the next cycle.");
  }
  const to = buildNoQtyPrepareNextRsCreateUrl(salesOrderId, cycleIdFromPrepare);
  navigate(to, { replace: true, state: navigateState ?? { from: "dashboard" } });
}
