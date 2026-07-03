import * as React from "react";
import { bindErpCacheRole, installErpCacheLifecycle } from "../lib/erpDataCache";
import { useAuth } from "./useAuth";

/** Mount once in AppLayout — clears cache on logout / role change; hooks mutation invalidation. */
export function useErpCacheLifecycle(): void {
  const auth = useAuth();

  React.useEffect(() => {
    installErpCacheLifecycle();
  }, []);

  React.useEffect(() => {
    bindErpCacheRole(auth.user?.role ?? null);
  }, [auth.user?.role]);
}
