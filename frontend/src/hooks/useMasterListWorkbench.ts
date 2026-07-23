import * as React from "react";
import {
  MASTER_PAGE_SIZES,
  createInitialMasterListQuery,
  createQueryGeneration,
  type MasterListQueryState,
  type MasterSortDir,
} from "../lib/masterListQuery";
import { useBulkSelection } from "./useBulkSelection";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Shared master-list query + selection behaviour.
 * Clears selection whenever the filtered query context changes (search/filter/sort/page/pageSize).
 */
export function useMasterListWorkbench(opts?: { initial?: Partial<MasterListQueryState> }) {
  const [query, setQuery] = React.useState(() => createInitialMasterListQuery(opts?.initial));
  const genRef = React.useRef(createQueryGeneration());

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setQuery((q) => {
        const next = String(q.search || "").trim();
        if (next === q.debouncedSearch) return q;
        return { ...q, debouncedSearch: next, page: 1 };
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query.search]);

  const setSearch = React.useCallback((search: string) => {
    genRef.current.next();
    setQuery((q) => ({ ...q, search }));
  }, []);

  const clearSearch = React.useCallback(() => {
    genRef.current.next();
    setQuery((q) => ({ ...q, search: "", debouncedSearch: "", page: 1 }));
  }, []);

  const setStatusFilter = React.useCallback((statusFilter: MasterListQueryState["statusFilter"]) => {
    genRef.current.next();
    setQuery((q) => ({ ...q, statusFilter, page: 1 }));
  }, []);

  const setFilter = React.useCallback((key: string, value: string) => {
    genRef.current.next();
    setQuery((q) => ({
      ...q,
      filters: { ...q.filters, [key]: value },
      page: 1,
    }));
  }, []);

  const clearFilters = React.useCallback(() => {
    genRef.current.next();
    setQuery((q) => ({
      ...q,
      search: "",
      debouncedSearch: "",
      statusFilter: "all",
      filters: {},
      page: 1,
    }));
  }, []);

  const toggleSort = React.useCallback((sortKey: string) => {
    genRef.current.next();
    setQuery((q) => {
      if (q.sortKey === sortKey) {
        const sortDir: MasterSortDir = q.sortDir === "asc" ? "desc" : "asc";
        return { ...q, sortDir, page: 1 };
      }
      return { ...q, sortKey, sortDir: "asc", page: 1 };
    });
  }, []);

  const setPage = React.useCallback((page: number) => {
    genRef.current.next();
    setQuery((q) => ({ ...q, page }));
  }, []);

  const setPageSize = React.useCallback((pageSize: number) => {
    genRef.current.next();
    const size = (MASTER_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : 50;
    setQuery((q) => ({ ...q, pageSize: size, page: 1 }));
  }, []);

  const queryContextKey = React.useMemo(
    () =>
      JSON.stringify({
        s: query.debouncedSearch,
        st: query.statusFilter,
        f: query.filters,
        sk: query.sortKey,
        sd: query.sortDir,
        p: query.page,
        ps: query.pageSize,
      }),
    [query],
  );

  return {
    query,
    setSearch,
    clearSearch,
    setStatusFilter,
    setFilter,
    clearFilters,
    toggleSort,
    setPage,
    setPageSize,
    queryContextKey,
    isCurrentGeneration: (token: number) => genRef.current.isCurrent(token),
    nextGeneration: () => genRef.current.next(),
  };
}

/** Selection that clears when `queryContextKey` changes. */
export function useMasterListSelection(pageRowIds: readonly number[], queryContextKey: string) {
  const bulk = useBulkSelection(pageRowIds);
  const prevKey = React.useRef(queryContextKey);
  React.useEffect(() => {
    if (prevKey.current !== queryContextKey) {
      prevKey.current = queryContextKey;
      bulk.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear only on context change
  }, [queryContextKey]);
  return bulk;
}
