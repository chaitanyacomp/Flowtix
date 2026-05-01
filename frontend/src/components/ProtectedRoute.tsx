import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

/** Roles that may use the app; used for dashboard and global reports. */
export const ALL_APP_ROLES = ["ADMIN", "SALES", "STORE", "PRODUCTION", "QC", "SUPERVISOR"] as const;

type ProtectedRouteProps = {
  /** User must have one of these roles (from JWT / localStorage user). */
  allowedRoles: readonly string[];
  children: React.ReactNode;
};

/**
 * Enforces authentication and role allowlist for a page.
 * Unauthenticated users are sent to login; wrong role → dashboard.
 */
export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const auth = useAuth();
  if (!auth.isAuthed || !auth.user) {
    return <Navigate to="/login" replace />;
  }
  if (!allowedRoles.includes(auth.user.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
