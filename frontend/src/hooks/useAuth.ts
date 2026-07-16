/**
 * Auth hook — re-exports the shared AuthProvider context.
 * Prefer importing `useAuth` from here for existing call sites.
 */
export { useAuth, AuthProvider, type AuthUser, type AuthStatus } from "../contexts/AuthContext";
