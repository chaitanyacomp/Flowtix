import { useAuth } from "./useAuth";

/** Spec: Add/Edit/Delete visible only for Admin (except where role-specific actions apply). */
export function useIsAdmin() {
  return useAuth().user?.role === "ADMIN";
}

/** Stock adjustment POST/list: ADMIN and STORE only (matches API). */
export function useCanPostStockAdjustment() {
  const role = useAuth().user?.role;
  return role === "ADMIN" || role === "STORE";
}
