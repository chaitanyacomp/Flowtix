import * as React from "react";
import {
  ERP_DASHBOARD_POLL_MS,
  ERP_REFRESH_EVENT,
  ERP_REPORT_POLL_MS,
  type ErpRefreshEventDetail,
  type ErpRefreshScope,
  erpRefreshEventMatches,
} from "../lib/erpRefresh";

export { ERP_DASHBOARD_POLL_MS, ERP_REPORT_POLL_MS };

export type UseErpRefreshTickOptions = {
  /** Poll while tab is visible (0 = disabled). */
  pollIntervalMs?: number;
  /** Refetch when tab becomes visible or window gains focus. */
  refreshOnVisible?: boolean;
  enabled?: boolean;
};

/**
 * Returns a monotonic tick included in useEffect deps to reload live ERP data.
 */
export function useErpRefreshTick(
  scopes: ErpRefreshScope[],
  options: UseErpRefreshTickOptions = {},
): number {
  const { pollIntervalMs = 0, refreshOnVisible = true, enabled = true } = options;
  const scopeKey = scopes.join(",");
  const [tick, setTick] = React.useState(0);

  const bump = React.useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  React.useEffect(() => {
    if (!enabled) return;

    const onEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<ErpRefreshEventDetail>).detail;
      if (erpRefreshEventMatches(detail, scopes)) bump();
    };

    window.addEventListener(ERP_REFRESH_EVENT, onEvent);
    return () => window.removeEventListener(ERP_REFRESH_EVENT, onEvent);
  }, [enabled, scopeKey, bump, scopes]);

  React.useEffect(() => {
    if (!enabled || !refreshOnVisible) return;

    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    const onFocus = () => bump();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refreshOnVisible, bump]);

  React.useEffect(() => {
    if (!enabled || !pollIntervalMs || pollIntervalMs <= 0) return;

    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") bump();
    }, pollIntervalMs);

    return () => window.clearInterval(id);
  }, [enabled, pollIntervalMs, bump]);

  return tick;
}
