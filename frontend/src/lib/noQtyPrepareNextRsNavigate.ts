import type { NavigateFunction } from "react-router-dom";
import { apiFetch } from "../services/api";
import { buildNoQtyGuidedHref } from "./noQtyFlowState";

type ToastApi = {
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showInfo: (message: string) => void;
};

function toastForPrepareReason(reason: string): string {
  if (reason === "NO_LOCKED_RS") return "Current cycle needs a locked requirement sheet.";
  if (reason === "NO_QC") return "Record QC for the current cycle first.";
  if (reason === "QC_PENDING") return "Complete pending QC for the current cycle first.";
  if (reason === "NEXT_RS_EXISTS") return "A locked requirement sheet already exists on a later cycle.";
  if (reason === "NOT_CURRENT_CYCLE") return "Sales order cycle pointer is out of date — try again after refresh.";
  return `Could not advance cycle (${reason}).`;
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
  try {
    const out = await apiFetch<{ advanced?: boolean; reason?: string }>(
      `/api/sales-orders/${salesOrderId}/no-qty-cycle/prepare-next-requirement-sheet`,
      { method: "POST", body: JSON.stringify({}) },
    );
    if (out?.advanced) {
      toast.showSuccess("Next cycle opened. Continuing to requirement sheet…");
    } else if (out?.reason && out.reason !== "OK") {
      toast.showInfo(toastForPrepareReason(String(out.reason)));
    }
  } catch (err) {
    toast.showError(err instanceof Error ? err.message : "Could not prepare the next cycle.");
  }
  const base = buildNoQtyGuidedHref({
    to: `/sales-orders/${salesOrderId}/requirement-sheets?intent=add`,
    salesOrderId,
    cycleId: null,
    fromStep: "dispatch",
  });
  const sep = base.includes("?") ? "&" : "?";
  navigate(`${base}${sep}fromDashboard=1`, { state: navigateState ?? { from: "dashboard" } });
}
