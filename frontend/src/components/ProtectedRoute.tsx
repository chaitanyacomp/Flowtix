import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { ALL_APP_ROLES } from "../config/erpRoles";

export { ALL_APP_ROLES };

type ProtectedRouteProps = {  /** User must have one of these roles (from JWT / localStorage user). */
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
