/** P3 — Purchase Workspace demand pools (REGULAR_SO · MPRS · STOCK_REPLENISHMENT). */

export const PROCUREMENT_DEMAND_POOL_KEYS = ["REGULAR_SO", "MPRS", "STOCK_REPLENISHMENT"] as const;

export type ProcurementDemandPoolKey = (typeof PROCUREMENT_DEMAND_POOL_KEYS)[number];

export const DEFAULT_PROCUREMENT_DEMAND_POOL: ProcurementDemandPoolKey = "REGULAR_SO";

export type ProcurementDemandPoolCounts = Record<ProcurementDemandPoolKey, number>;

export type ProcurementQueueTabDef = {
  id: ProcurementDemandPoolKey;
  label: string;
  countKey: ProcurementDemandPoolKey;
};

export const PROCUREMENT_DEMAND_POOL_TABS: ProcurementQueueTabDef[] = [
  { id: "REGULAR_SO", label: "Sales Orders", countKey: "REGULAR_SO" },
  { id: "MPRS", label: "Monthly Planning", countKey: "MPRS" },
  { id: "STOCK_REPLENISHMENT", label: "Stock Replenishment", countKey: "STOCK_REPLENISHMENT" },
];

/** @deprecated Use PROCUREMENT_DEMAND_POOL_TABS */
export const PROCUREMENT_QUEUE_TABS = PROCUREMENT_DEMAND_POOL_TABS;

/** @deprecated Use ProcurementDemandPoolKey */
export type ProcurementQueueTabId = ProcurementDemandPoolKey;

/** @deprecated Use ProcurementDemandPoolCounts */
export type ProcurementQueueCounts = ProcurementDemandPoolCounts;

const POOL_SOURCE_TYPES: Record<ProcurementDemandPoolKey, readonly string[]> = {
  REGULAR_SO: ["SALES_ORDER"],
  MPRS: ["MONTHLY_PLAN"],
  STOCK_REPLENISHMENT: ["STOCK_REPLENISHMENT"],
};

type PoolOriginLike = { materialRequirementId?: number | null };
type PoolItemLike = { origins?: PoolOriginLike[] | null };
type PoolsMapLike = Partial<Record<ProcurementDemandPoolKey, { items?: PoolItemLike[] | null }>>;

export function emptyProcurementDemandPoolCounts(): ProcurementDemandPoolCounts {
  return { REGULAR_SO: 0, MPRS: 0, STOCK_REPLENISHMENT: 0 };
}

/** @deprecated Use emptyProcurementDemandPoolCounts */
export function emptyProcurementQueueCounts(): ProcurementDemandPoolCounts {
  return emptyProcurementDemandPoolCounts();
}

export function parseDemandPoolParam(value: string | null | undefined): ProcurementDemandPoolKey | null {
  const key = String(value ?? "")
    .trim()
    .toUpperCase();
  return PROCUREMENT_DEMAND_POOL_KEYS.includes(key as ProcurementDemandPoolKey)
    ? (key as ProcurementDemandPoolKey)
    : null;
}

export function resolveMrDemandPool(mr: {
  sourceType?: string | null;
  source?: { type?: string | null } | null;
}): ProcurementDemandPoolKey | null {
  const st = String(mr.source?.type ?? mr.sourceType ?? "").trim();
  for (const pool of PROCUREMENT_DEMAND_POOL_KEYS) {
    if (POOL_SOURCE_TYPES[pool].includes(st)) return pool;
  }
  return null;
}

export function mrMatchesDemandPool(
  mr: { sourceType?: string | null; source?: { type?: string | null } | null },
  demandPool: ProcurementDemandPoolKey,
): boolean {
  return resolveMrDemandPool(mr) === demandPool;
}

export function deriveDemandPoolCountsFromPools(pools: PoolsMapLike | null | undefined): ProcurementDemandPoolCounts {
  const counts = emptyProcurementDemandPoolCounts();
  if (!pools) return counts;

  for (const poolKey of PROCUREMENT_DEMAND_POOL_KEYS) {
    const items = pools[poolKey]?.items ?? [];
    const mrIds = new Set<number>();
    for (const item of items) {
      for (const origin of item.origins ?? []) {
        const id = Number(origin.materialRequirementId ?? 0);
        if (id > 0) mrIds.add(id);
      }
    }
    counts[poolKey] = mrIds.size;
  }
  return counts;
}

export function deriveDemandPoolCountsFromWorkspace(ws: {
  pools?: PoolsMapLike | null;
  summary?: { queueCounts?: { byDemandPool?: Partial<ProcurementDemandPoolCounts> } | null } | null;
} | null): ProcurementDemandPoolCounts {
  if (ws?.pools && PROCUREMENT_DEMAND_POOL_KEYS.every((k) => ws.pools?.[k])) {
    return deriveDemandPoolCountsFromPools(ws.pools);
  }

  const byPool = ws?.summary?.queueCounts?.byDemandPool;
  const counts = emptyProcurementDemandPoolCounts();
  if (byPool) {
    for (const key of PROCUREMENT_DEMAND_POOL_KEYS) {
      counts[key] = Number(byPool[key] ?? 0);
    }
  }
  return counts;
}

/** @deprecated Use deriveDemandPoolCountsFromWorkspace */
export function deriveQueueCountsFromMrs(
  rows: ReadonlyArray<{ sourceType?: string | null }>,
): ProcurementDemandPoolCounts {
  const counts = emptyProcurementDemandPoolCounts();
  for (const row of rows) {
    const pool = resolveMrDemandPool(row);
    if (pool) counts[pool] += 1;
  }
  return counts;
}

/** @deprecated Server filters by demandPool — kept for tests */
export function filterMrsByQueueTab<T extends { sourceType?: string | null; source?: { type?: string | null } | null }>(
  rows: T[],
  demandPool: ProcurementDemandPoolKey,
): T[] {
  return rows.filter((row) => mrMatchesDemandPool(row, demandPool));
}

export function workspaceQueryForDemandPool(
  demandPool: ProcurementDemandPoolKey,
  opts?: { salesOrderId?: number | null },
): string {
  const params = new URLSearchParams();
  params.set("demandPool", demandPool);
  if (opts?.salesOrderId != null && opts.salesOrderId > 0) {
    params.set("salesOrderId", String(opts.salesOrderId));
  }
  return `?${params.toString()}`;
}

/** @deprecated Use workspaceQueryForDemandPool */
export function workspaceQueryForQueueTab(
  demandPool: ProcurementDemandPoolKey,
  salesOrderId?: number,
): string {
  return workspaceQueryForDemandPool(demandPool, { salesOrderId });
}

export function appendDemandPoolToSearchParams(
  params: URLSearchParams,
  demandPool: ProcurementDemandPoolKey,
): URLSearchParams {
  params.set("demandPool", demandPool);
  return params;
}
