import { useMemo } from "react";
import { useAuth } from "./useAuth";

/**
 * Role-based UI visibility — presentation only.
 * Does not grant permissions; pair action buttons with existing role gates / API checks.
 */
export function useErpRoleUi() {
  const role = useAuth().user?.role ?? "";
  const isAdmin = role === "ADMIN";
  const isProduction = role === "PRODUCTION";
  const isQc = role === "QC";
  const isStore = role === "STORE";
  const isSales = role === "SALES";
  const isAccounts = role === "ACCOUNTS";
  const isOperator = !isAdmin;

  return useMemo(
    () => ({
      role,
      isAdmin,
      isProduction,
      isQc,
      isStore,
      isSales,
      isAccounts,
      isPureProductionOperator: isProduction && isOperator,
      isPureQcOperator: isQc && isOperator,
      isPureDispatchOperator: isStore && isOperator,
      isPurePlanningOperator: isSales && isOperator,
      isPureAccountsOperator: isAccounts && isOperator,

      /** Planning-owned Next RS / requirement-sheet workflow surfaces. */
      showPlanningWorkflowActions: isAdmin || isSales,

      /** Production NO_QTY shell: requirement-sheet breadcrumb trail. */
      showProductionPlanningBreadcrumb: isAdmin || isSales || isStore,

      /** Production: optional dispatch handoff strip. */
      showProductionDispatchHandoff: isAdmin || isStore,

      /** Dispatch page: RS · Prepare WO · Production · QC jump links. */
      showDispatchCrossDeptNav: isAdmin,

      /** Dispatch page: Sales bill jump link. */
      showDispatchBillingNav: isAdmin || isStore || isAccounts,

      /** QC: dispatch handoff CTA after QC-complete. */
      showQcDispatchHandoff: isAdmin || isStore || isQc,

      /** Long NO_QTY carry-forward / planning helper paragraphs. */
      quietNoQtyExplanations: isOperator && !isSales,

      /** Work Orders: NO_QTY top strip aimed at QC department. */
      showWoNoQtyQcHandoffStrip: isAdmin || isQc,

      /** Work Orders: NO_QTY top strip aimed at Production department. */
      showWoNoQtyProductionHandoffStrip: isAdmin || isProduction,

      /** QC sticky header: rework / hold / scrap summary chips. */
      showQcSecondaryQueueChips: isAdmin || isQc,

      /** Production page: full workflow trail chip row (NO_QTY / Regular). */
      showProductionWorkflowTrail: isAdmin || isSales || isStore,
    }),
    [role, isAdmin, isProduction, isQc, isStore, isSales, isAccounts, isOperator],
  );
}
