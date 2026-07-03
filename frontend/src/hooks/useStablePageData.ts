import * as React from "react";
import type { ErpRefreshScope } from "../lib/erpRefresh";
import { useErpRefreshTick } from "./useErpRefreshTick";
import { createInFlightFetchDeduper } from "../lib/pageLoadState";

export type UseStablePageDataOptions<T> = {
  fetcher: (signal: AbortSignal) => Promise<T>;
  deps?: React.DependencyList;
  scopes?: ErpRefreshScope[];
  enabled?: boolean;
  pollIntervalMs?: number;
};

/**
 * Fetch hook with ERP-standard loading semantics:
 * null initial data, skeleton on first load, stale-while-revalidate on refresh.
 */
export function useStablePageData<T>(options: UseStablePageDataOptions<T>) {
  const { fetcher, deps = [], scopes = [], enabled = true, pollIntervalMs } = options;
  const tick = useErpRefreshTick(scopes, { enabled: scopes.length > 0, pollIntervalMs });

  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [firstLoadDone, setFirstLoadDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const deduperRef = React.useRef(createInFlightFetchDeduper());
  const genRef = React.useRef(0);

  const reload = React.useCallback(async () => {
    if (!enabled) return;
    const gen = ++genRef.current;
    setBusy(true);
    const ac = new AbortController();
    try {
      const result = await fetcher(ac.signal);
      if (gen !== genRef.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (gen !== genRef.current) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "Load failed";
      setError(msg);
    } finally {
      if (gen === genRef.current) {
        setBusy(false);
        setFirstLoadDone(true);
      }
    }
  }, [enabled, fetcher]);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void deduperRef.current.run(async () => {
      if (cancelled) return;
      await reload();
    });
    return () => {
      cancelled = true;
      genRef.current += 1;
      deduperRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- explicit deps + refresh tick
  }, [...deps, tick, enabled, reload]);

  const hasDisplayData = data != null;

  return {
    data,
    error,
    firstLoadDone,
    initialLoading: !firstLoadDone && busy,
    refreshing: firstLoadDone && busy && hasDisplayData,
    loading: busy,
    hasDisplayData,
    reload,
  };
}
