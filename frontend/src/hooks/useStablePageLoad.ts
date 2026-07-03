import * as React from "react";
import { createInFlightFetchDeduper } from "../lib/pageLoadState";

/**
 * Standard ERP page load flags for manual fetch effects.
 * - Initial open: `initialLoading` → skeleton (no false empty state).
 * - Refresh: `refreshing` → keep stale content + small indicator.
 */
export function useStablePageLoad() {
  const [firstLoadDone, setFirstLoadDone] = React.useState(false);
  const [busy, setBusy] = React.useState(true);
  const deduperRef = React.useRef(createInFlightFetchDeduper());

  const startLoad = React.useCallback(() => {
    setBusy(true);
  }, []);

  const finishLoad = React.useCallback(() => {
    setBusy(false);
    setFirstLoadDone(true);
  }, []);

  const runDeduped = React.useCallback(<T,>(task: () => Promise<T>) => {
    return deduperRef.current.run(task);
  }, []);

  return {
    firstLoadDone,
    /** True only before the first fetch completes (show skeleton). */
    initialLoading: !firstLoadDone && busy,
    /** True on subsequent fetches while prior data may still render. */
    refreshing: firstLoadDone && busy,
    busy,
    startLoad,
    finishLoad,
    runDeduped,
  };
}

export type StablePageLoadFlags = ReturnType<typeof useStablePageLoad>;
