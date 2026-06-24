import * as React from "react";
import { useLocation } from "react-router-dom";
import {
  resolveStoreExecutionNavContext,
  type ErpNavContext,
  type StoreExecutionNavPageKey,
} from "../lib/erpNavContext";

export function useStoreExecutionNavContext(pageKey: StoreExecutionNavPageKey): ErpNavContext {
  const location = useLocation();
  return React.useMemo(
    () => resolveStoreExecutionNavContext(location, pageKey),
    [location.pathname, location.search, location.state, pageKey],
  );
}
