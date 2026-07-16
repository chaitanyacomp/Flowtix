import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { ALL_APP_ROLES } from "../config/erpRoles";
import { loginPathWithReturn, ROLE_LANDING_PATH } from "../lib/authReturnPath";
import { BrandSplash } from "./branding/Branding";

export { ALL_APP_ROLES };

type ProtectedRouteProps = {
  /** User must have one of these roles (from JWT / localStorage user). */
  allowedRoles: readonly string[];
  children: React.ReactNode;
};

/**
 * Enforces authentication and role allowlist for a page.
 * Unauthenticated users are sent to login with returnTo; wrong role → role landing.
 * While auth is resolving, show a stable splash (no protected content flash).
 */
export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.authStatus === "loading") {
    return <BrandSplash hint="Checking session…" className="min-h-[50vh]" />;
  }

  if (import.meta.env.DEV && (!auth.isAuthed || !auth.user)) {
    // eslint-disable-next-line no-console
    console.debug("[auth] ProtectedRoute → unauthenticated, redirect /login", {
      isAuthed: auth.isAuthed,
      hasUser: Boolean(auth.user),
    });
  }
  if (!auth.isAuthed || !auth.user) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={loginPathWithReturn(returnTo)} replace />;
  }
  if (!allowedRoles.includes(auth.user.role)) {
    return <Navigate to={ROLE_LANDING_PATH} replace />;
  }
  return <>{children}</>;
}
