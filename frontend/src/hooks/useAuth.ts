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

    window.addEventListener("storage", onStorage);
    window.addEventListener("auth:logout", onAuthLogout as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("auth:logout", onAuthLogout as EventListener);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiFetch<{ token: string; user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);
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

