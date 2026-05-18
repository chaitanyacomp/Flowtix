import * as React from "react";
import type { ErpRefreshScope } from "../lib/erpRefresh";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "./useErpRefreshTick";

/**
 * Re-runs `load` on mount, ERP mutation signals, tab focus, and optional polling.
 */
export function useErpReportLiveLoad(
  load: () => void | Promise<void>,
  scopes: ErpRefreshScope[],
  deps: React.DependencyList,
  options?: { pollIntervalMs?: number; enabled?: boolean },
): void {
  const tick = useErpRefreshTick(scopes, {
    pollIntervalMs: options?.pollIntervalMs ?? ERP_REPORT_POLL_MS,
    enabled: options?.enabled ?? true,
  });

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- explicit deps + live tick
  }, [...deps, tick]);
}
