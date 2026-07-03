import * as React from "react";
import {
  buildErpApiCacheKey,
  buildErpPageCacheKey,
  readErpCachedData,
  runErpDedupedFetch,
  writeErpCache,
  type ErpCacheEntry,
} from "../lib/erpDataCache";
import { isPageRefreshing, shouldShowInitialPageSkeleton } from "../lib/pageLoadState";

export type UseErpCachedQueryOptions<T> = {
  role: string;
  route: string;
  queryKey: string;
  apiPath: string;
  enabled?: boolean;
  fetcher: () => Promise<T>;
  /** Bump to background-revalidate (poll, mutation signal, tab focus). */
  refreshTick?: number;
};

export type UseErpCachedQueryResult<T> = {
  data: T | null;
  error: string | null;
  firstLoadDone: boolean;
  initialLoading: boolean;
  refreshing: boolean;
  busy: boolean;
  hasDisplayData: boolean;
};

function seedFromCache<T>(pageKey: string, apiKey: string): {
  data: T | null;
  error: string | null;
  firstLoadDone: boolean;
  busy: boolean;
} {
  const cached = readErpCachedData<T>(pageKey, apiKey);
  if (cached) {
    return {
      data: cached.data,
      error: cached.error,
      firstLoadDone: true,
      busy: false,
    };
  }
  return { data: null, error: null, firstLoadDone: false, busy: true };
}

/**
 * Stale-while-revalidate query: hydrate from module cache on mount, dedupe in-flight GETs, silent refresh.
 */
export function useErpCachedQuery<T>(options: UseErpCachedQueryOptions<T>): UseErpCachedQueryResult<T> {
  const { role, route, queryKey, apiPath, enabled = true, fetcher, refreshTick = 0 } = options;

  const pageKey = React.useMemo(
    () => buildErpPageCacheKey({ role, route, queryKey }),
    [role, route, queryKey],
  );
  const apiKey = React.useMemo(() => buildErpApiCacheKey(role, apiPath), [role, apiPath]);

  const [data, setData] = React.useState<T | null>(() => seedFromCache<T>(pageKey, apiKey).data);
  const [error, setError] = React.useState<string | null>(() => seedFromCache<T>(pageKey, apiKey).error);
  const [firstLoadDone, setFirstLoadDone] = React.useState(() => seedFromCache<T>(pageKey, apiKey).firstLoadDone);
  const [busy, setBusy] = React.useState(() => seedFromCache<T>(pageKey, apiKey).busy);
  const genRef = React.useRef(0);

  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;

  React.useEffect(() => {
    const seeded = seedFromCache<T>(pageKey, apiKey);
    setData(seeded.data);
    setError(seeded.error);
    setFirstLoadDone(seeded.firstLoadDone);
    setBusy(seeded.busy);
  }, [pageKey, apiKey]);

  React.useEffect(() => {
    if (!enabled) {
      setBusy(false);
      return;
    }

    let mounted = true;
    const gen = ++genRef.current;
    setBusy(true);

    void runErpDedupedFetch(apiKey, () => fetcherRef.current())
      .then((result) => {
        if (!mounted || gen !== genRef.current) return;
        const entry: ErpCacheEntry<T> = { data: result, error: null, updatedAt: Date.now() };
        writeErpCache(pageKey, apiKey, entry);
        setData(result);
        setError(null);
      })
      .catch((e) => {
        if (!mounted || gen !== genRef.current) return;
        const msg = e instanceof Error ? e.message : "Load failed";
        setError(msg);
        setData((prev) => {
          if (prev != null) return prev;
          const cached = readErpCachedData<T>(pageKey, apiKey);
          return cached?.data ?? null;
        });
      })
      .finally(() => {
        if (!mounted || gen !== genRef.current) return;
        setBusy(false);
        setFirstLoadDone(true);
      });

    return () => {
      mounted = false;
      genRef.current += 1;
    };
  }, [enabled, pageKey, apiKey, refreshTick]);

  const hasDisplayData = data != null;
  const snapshot = { firstLoadDone, loading: busy, hasDisplayData };

  return {
    data,
    error,
    firstLoadDone,
    initialLoading: shouldShowInitialPageSkeleton(snapshot),
    refreshing: isPageRefreshing(snapshot),
    busy,
    hasDisplayData,
  };
}
