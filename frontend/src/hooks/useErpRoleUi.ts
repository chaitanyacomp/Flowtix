import { useMemo } from "react";
import { useAuth } from "./useAuth";

/**
 * Role-based UI visibility — presentation only.
 */
export function useErpRoleUi() {
  const role = useAuth().user?.role ?? "";
  const isAdmin = role === "ADMIN";
  const isProduction = role === "PRODUCTION";
  const isQa = role === "QA";
  const isStore = role === "STORE";
  const isPurchase = role === "PURCHASE";
  const isOperator = !isAdmin;

  return useMemo(
    () => ({
      role,
      isAdmin,
      isProduction,
      isQc: isQa,
      isQa,
      isStore,
      isPurchase,
      /** @deprecated use isPurchase */
      isAccounts: isPurchase,
      /** @deprecated use isAdmin for commercial */
      isSales: isAdmin,
      isOperator,
      isPureProductionOperator: isProduction && isOperator,
      isPureQcOperator: isQa && isOperator,
      isPureDispatchOperator: isStore && isOperator,
      isPurePlanningOperator: isAdmin && isOperator,
      isPureAccountsOperator: isPurchase && isOperator,
      isPurePurchaseOperator: isPurchase && isOperator,

      showPlanningWorkflowActions: isAdmin || isStore,
      showProductionPlanningBreadcrumb: isAdmin || isStore,
      showProductionDispatchHandoff: isAdmin || isStore,
      showDispatchCrossDeptNav: isAdmin,
      /** Sales bill creation / BILL workflow step — ADMIN only (STORE views status read-only). */
      showDispatchBillingNav: isAdmin,
      canCreateSalesBill: isAdmin,
      showQcDispatchHandoff: isAdmin || isStore || isQa,
      quietNoQtyExplanations: isOperator && !isAdmin,
      showWoNoQtyQcHandoffStrip: isAdmin || isQa || isProduction,
      showWoNoQtyProductionHandoffStrip: isAdmin || isProduction,
      showQcSecondaryQueueChips: isAdmin || isQa,
      showProductionWorkflowTrail: isAdmin || isStore,
    }),
    [role, isAdmin, isProduction, isQa, isStore, isPurchase, isOperator],
  );
}
