/**
 * RM Purchase list/detail back navigation from URL context (REGULAR RM check / WO flow, NO_QTY planning hub, returnTo, etc.).
 */
import { NO_QTY_TERMS, REGULAR_TERMS } from "../../lib/flowTerminology";
export type RmPurchaseBackNavDefaults = {
  defaultRoute: string;
  defaultLabel: string;
};

export function resolveRmPurchaseBackNav(
  searchParams: URLSearchParams,
  defaults: RmPurchaseBackNavDefaults,
): { backLabel: string; backRoute: string } {
  const sourceUpfront = searchParams.get("source") ?? "";
  const returnToRaw = searchParams.get("returnTo");
  if (returnToRaw && returnToRaw.trim()) {
    try {
      const decoded = decodeURIComponent(returnToRaw.trim());
      if (decoded.startsWith("/")) {
        // Use a specific breadcrumb when the operator came from the RM
        // Shortage Workspace so the back path is unambiguous.
        if (sourceUpfront === "rm-shortage") {
          return { backLabel: "Back to RM Shortage Workspace", backRoute: decoded };
        }
        return { backLabel: "Back", backRoute: decoded };
      }
    } catch {
      /* ignore malformed returnTo */
    }
  }

  const from = searchParams.get("from") ?? "";
  const source = sourceUpfront;
  const salesOrderId = (searchParams.get("salesOrderId") ?? searchParams.get("soId") ?? "").trim();
  const soNum = Number(salesOrderId);
  const hasSo = salesOrderId !== "" && Number.isFinite(soNum) && soNum > 0;

  if (source === "planning_dashboard") {
    if (hasSo) {
      return {
        backLabel: NO_QTY_TERMS.BACK_TO_REQUIREMENT_CYCLE_PLANNING,
        backRoute: `/planning-dashboard?salesOrderId=${encodeURIComponent(salesOrderId)}`,
      };
    }
    return { backLabel: NO_QTY_TERMS.BACK_TO_REQUIREMENT_CYCLE_PLANNING, backRoute: "/planning-dashboard" };
  }

  if (from === "rm-check" || source === "production") {
    if (hasSo) {
      return {
        backLabel: REGULAR_TERMS.BACK_TO_PREPARE_WORK_ORDER,
        backRoute: `/work-orders/prepare?salesOrderId=${encodeURIComponent(salesOrderId)}`,
      };
    }
    return { backLabel: REGULAR_TERMS.BACK_TO_PREPARE_WORK_ORDER, backRoute: "/work-orders/prepare" };
  }

  if (from === "customer-tracking") {
    return { backLabel: "Back to Customer Tracking", backRoute: "/customer-tracking-flow" };
  }

  if (from === "work-order" && hasSo) {
    return {
      backLabel: "Back to Work Orders",
      backRoute: `/work-orders?salesOrderId=${encodeURIComponent(salesOrderId)}`,
    };
  }

  if (from === "rm-purchase" && hasSo) {
    return {
      backLabel: "Back to Work Orders",
      backRoute: `/work-orders?salesOrderId=${encodeURIComponent(salesOrderId)}&from=rm-purchase`,
    };
  }

  return { backLabel: defaults.defaultLabel, backRoute: defaults.defaultRoute };
}
