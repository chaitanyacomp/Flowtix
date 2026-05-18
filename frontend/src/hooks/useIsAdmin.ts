import { useAuth } from "./useAuth";
import { NEXT_RS_WRITE_ROLES, RS_WRITE_ROLES } from "../config/erpRoles";

/** Spec: Add/Edit/Delete visible only for Admin (except where role-specific actions apply). */
export function useIsAdmin() {
  return useAuth().user?.role === "ADMIN";
}

/** Stock adjustment POST/list: ADMIN and STORE only (matches API). */
export function useCanPostStockAdjustment() {
  const role = useAuth().user?.role;
  return role === "ADMIN" || role === "STORE";
}

/**
 * NO_QTY Next RS creation visibility — matches backend NEXT_RS_WRITE_ROLES (ADMIN + SALES).
 * Use this to gate "Create Next RS" CTAs across Dashboard / NO_QTY SO detail / Requirement Sheet pages.
 */
export function useCanCreateNextRs() {
  const role = useAuth().user?.role ?? "";
  return (NEXT_RS_WRITE_ROLES as readonly string[]).includes(role);
}

/**
 * Role-based UI gate for the "Open Requirement Sheet" / planning workspace CTAs.
 *
 * Requirement sheet authoring is owned by ADMIN + SALES (mirrors backend RS_WRITE_ROLES).
 * Other roles see a read-only "Planning Status" chip instead of a deep-link that would 403.
 */
export function useCanOpenRequirementSheet() {
  const role = useAuth().user?.role ?? "";
  return (RS_WRITE_ROLES as readonly string[]).includes(role);
}
