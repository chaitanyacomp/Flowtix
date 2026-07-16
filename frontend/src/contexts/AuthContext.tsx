/**
 * Shared AuthProvider — single source of truth for token/user/authStatus.
 * Prevents per-hook token freeze and premature protected/login flashes.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, resetAuthFailureGate } from "../services/api";
import { clearErpDataCache } from "../lib/erpDataCache";
import { endPerfMark, startPerfMark } from "../lib/performanceTiming";
import {
  clearUserScopedSessionArtifacts,
  forceUnauthenticatedState,
  isAccessTokenUsable,
  performIntentionalLogout,
  readStoredAuthUser,
  readStoredToken,
  type StoredAuthUser,
} from "../lib/authSession";

export type AuthUser = StoredAuthUser;

export type AuthStatus = "loading" | "authenticated" | "anonymous";

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  /** True when credentials are present and usable. */
  isAuthed: boolean;
  /**
   * `loading` — auth still resolving (do not render protected or login form).
   * `authenticated` / `anonymous` — stable for routing gates.
   */
  authStatus: AuthStatus;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function resolveInitialAuth(): { user: AuthUser | null; token: string | null; authStatus: AuthStatus } {
  const token = readStoredToken();
  const user = readStoredAuthUser();
  if (!isAccessTokenUsable(token) || !user) {
    if (token || user) {
      // Stale / malformed credentials — wipe before first paint of protected shell.
      forceUnauthenticatedState({ dispatchEvent: false, clearCache: true });
    }
    return { user: null, token: null, authStatus: "anonymous" };
  }
  return { user, token, authStatus: "authenticated" };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initial = resolveInitialAuth();
  const [user, setUser] = useState<AuthUser | null>(initial.user);
  const [token, setToken] = useState<string | null>(initial.token);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(initial.authStatus);

  const syncFromStorage = useCallback(() => {
    const nextToken = readStoredToken();
    const nextUser = readStoredAuthUser();
    if (!isAccessTokenUsable(nextToken) || !nextUser) {
      setToken(null);
      setUser(null);
      setAuthStatus("anonymous");
      return;
    }
    setToken(nextToken);
    setUser(nextUser);
    setAuthStatus("authenticated");
  }, []);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "token" || e.key === "user") syncFromStorage();
    }
    function onAuthLogout() {
      syncFromStorage();
    }
    function onAuthLogin() {
      syncFromStorage();
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("auth:logout", onAuthLogout as EventListener);
    window.addEventListener("auth:login", onAuthLogin as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("auth:logout", onAuthLogout as EventListener);
      window.removeEventListener("auth:login", onAuthLogin as EventListener);
    };
  }, [syncFromStorage]);

  const login = useCallback(async (email: string, password: string) => {
    startPerfMark("login-submit");
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[auth] login request start", { email: email.trim() });
    }
    const data = await apiFetch<{ token: string; user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    clearErpDataCache("login");
    clearUserScopedSessionArtifacts();
    resetAuthFailureGate();
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    setAuthStatus("authenticated");
    endPerfMark("login-submit", "login-submit", { role: data.user.role });
    try {
      sessionStorage.setItem("erp:loginDashboardMark", "1");
      startPerfMark("login-dashboard-ready");
    } catch {
      // ignore
    }
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[auth] login success → token stored, broadcasting auth:login");
    }
    try {
      window.dispatchEvent(new Event("auth:login"));
    } catch {
      /* ignore */
    }
    return data.user;
  }, []);

  const logout = useCallback(() => {
    setAuthStatus("loading");
    performIntentionalLogout();
  }, []);

  const isAuthed = authStatus === "authenticated" && Boolean(token && user);

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthed,
      authStatus,
      login,
      logout,
    }),
    [user, token, isAuthed, authStatus, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
