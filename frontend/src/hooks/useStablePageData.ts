import * as React from "react";
import type { ErpRefreshScope } from "../lib/erpRefresh";
import { useErpRefreshTick } from "./useErpRefreshTick";
import {
  createInFlightFetchDeduper,
  isPageRefreshing,
  shouldCommitAsyncFetchResult,
  shouldShowInitialPageSkeleton,
} from "../lib/pageLoadState";

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
 * Failed refresh keeps previous data; obsolete generations are ignored.
 */
export function useStablePageData<T>(options: UseStablePageDataOptions<T>) {
  const { fetcher, deps = [], scopes = [], enabled = true, pollIntervalMs } = options;
  const tick = useErpRefreshTick(scopes, { enabled: scopes.length > 0 && enabled, pollIntervalMs });

  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [firstLoadDone, setFirstLoadDone] = React.useState(false);
  const [busy, setBusy] = React.useState(() => enabled);
  const deduperRef = React.useRef(createInFlightFetchDeduper());
  const genRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = React.useCallback(async () => {
    if (!enabled) return;
    const gen = ++genRef.current;
    setBusy(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const result = await fetcherRef.current(ac.signal);
      if (!shouldCommitAsyncFetchResult(gen, genRef.current)) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (!shouldCommitAsyncFetchResult(gen, genRef.current)) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "Load failed";
      setError(msg);
    } finally {
      if (shouldCommitAsyncFetchResult(gen, genRef.current)) {
        setBusy(false);
        setFirstLoadDone(true);
      }
    }
  }, [enabled]);

  React.useEffect(() => {
    if (!enabled) {
      setBusy(false);
      return;
    }
    let cancelled = false;
    void deduperRef.current.run(async () => {
      if (cancelled) return;
      await reload();
    });
    return () => {
      cancelled = true;
      genRef.current += 1;
      abortRef.current?.abort();
      deduperRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- explicit deps + refresh tick
  }, [...deps, tick, enabled, reload]);

  const hasDisplayData = data != null;
  const snapshot = { firstLoadDone, loading: busy, hasDisplayData };

  return {
    data,
    error,
    firstLoadDone,
    initialLoading: shouldShowInitialPageSkeleton(snapshot),
    refreshing: isPageRefreshing(snapshot),
    loading: busy,
    hasDisplayData,
    reload,
  };
}
