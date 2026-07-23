/**
 * Client-side master list query helpers (filter / sort / page) with stale-request protection.
 * Prefer server-side pagination when APIs grow; these helpers keep large imported masters usable today.
 */

export type MasterSortDir = "asc" | "desc";

export type MasterListQueryState = {
  search: string;
  /** Debounced search used for filtering */
  debouncedSearch: string;
  statusFilter: "all" | "active" | "inactive";
  sortKey: string;
  sortDir: MasterSortDir;
  page: number;
  pageSize: number;
  /** Extra filter bag (type, stateId, …) */
  filters: Record<string, string>;
};

export const MASTER_PAGE_SIZES = [25, 50, 100] as const;

export function createInitialMasterListQuery(overrides?: Partial<MasterListQueryState>): MasterListQueryState {
  return {
    search: "",
    debouncedSearch: "",
    statusFilter: "all",
    sortKey: "name",
    sortDir: "asc",
    page: 1,
    pageSize: 50,
    filters: {},
    ...overrides,
  };
}

export function normalizeSearchText(raw: string): string {
  return String(raw || "").trim().toLowerCase();
}

export function matchesNameSearch(haystack: string, query: string): boolean {
  const q = normalizeSearchText(query);
  if (!q) return true;
  return normalizeSearchText(haystack).includes(q);
}

/** Stable compare with secondary id for deterministic paging. */
export function compareByKey<T extends { id: number }>(
  a: T,
  b: T,
  getSortValue: (row: T) => string | number | boolean | null | undefined,
  dir: MasterSortDir,
): number {
  const av = getSortValue(a);
  const bv = getSortValue(b);
  let cmp = 0;
  if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else {
    const as = String(av ?? "").toLowerCase();
    const bs = String(bv ?? "").toLowerCase();
    cmp = as < bs ? -1 : as > bs ? 1 : 0;
  }
  if (cmp === 0) cmp = a.id - b.id;
  return dir === "asc" ? cmp : -cmp;
}

export function paginateRows<T>(rows: T[], page: number, pageSize: number): { pageRows: T[]; totalPages: number; from: number; to: number } {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const from = total === 0 ? 0 : start + 1;
  const to = start + pageRows.length;
  return { pageRows, totalPages, from, to };
}

/**
 * Stale-response guard: bump generation on each query change; ignore async results with older gen.
 */
export function createQueryGeneration() {
  let gen = 0;
  return {
    next(): number {
      gen += 1;
      return gen;
    },
    isCurrent(token: number): boolean {
      return token === gen;
    },
    current(): number {
      return gen;
    },
  };
}

export function resultCountLabel(opts: { filtered: number; total: number; searching: boolean }): string {
  const { filtered, total, searching } = opts;
  if (searching || filtered !== total) return `${filtered.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} records`;
  return `${total.toLocaleString("en-IN")} records`;
}

export const MASTERS_LANDING_PATH = "/masters";
