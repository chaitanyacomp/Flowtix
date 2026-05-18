import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../services/api";

export type AuthUser = { id: number; email: string; role: string; name: string };

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem("user");
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  });

  const token = localStorage.getItem("token");

  const isAuthed = Boolean(token && user);

  useEffect(() => {
    function syncFromStorage() {
      const raw = localStorage.getItem("user");
      setUser(raw ? (JSON.parse(raw) as AuthUser) : null);
    }

    function onStorage(e: StorageEvent) {
      if (e.key === "token" || e.key === "user") {
        syncFromStorage();
      }
    }

    function onAuthLogout() {
      syncFromStorage();
    }

    /** Same-tab login: `storage` does not fire for the tab that called `setItem` — sync all `useAuth()` instances. */
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
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[auth] login request start", { email: email.trim() });
    }
    const data = await apiFetch<{ token: string; user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[auth] login success → token stored, user set (this hook instance); broadcasting auth:login");
    }
    try {
      window.dispatchEvent(new Event("auth:login"));
    } catch {
      /* ignore */
    }
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }, []);

  return useMemo(
    () => ({
      user,
      token,
      isAuthed,
      login,
      logout,
    }),
    [user, token, isAuthed, login, logout],
  );
}

