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

/** Human-friendly `source` query aliases → demand pool tab keys. */
export const PROCUREMENT_SOURCE_TAB_ALIASES: Record<string, ProcurementDemandPoolKey> = {
  "monthly-planning": "MPRS",
  monthly_planning: "MPRS",
  mprs: "MPRS",
  "sales-orders": "REGULAR_SO",
  sales_orders: "REGULAR_SO",
  regular_so: "REGULAR_SO",
  "stock-replenishment": "STOCK_REPLENISHMENT",
  stock_replenishment: "STOCK_REPLENISHMENT",
};

type SearchParamsLike = { get: (key: string) => string | null };

/** Resolve active procurement tab from `demandPool` or legacy `source` navigation hints. */
export function parseProcurementWorkspaceDemandPool(
  params: SearchParamsLike,
): ProcurementDemandPoolKey | null {
  const fromPool = parseDemandPoolParam(params.get("demandPool"));
  if (fromPool) return fromPool;
  const sourceKey = String(params.get("source") ?? "")
    .trim()
    .toLowerCase();
  if (sourceKey && PROCUREMENT_SOURCE_TAB_ALIASES[sourceKey]) {
    return PROCUREMENT_SOURCE_TAB_ALIASES[sourceKey];
  }
  return null;
}

export function procurementSourceAliasForDemandPool(
  demandPool: ProcurementDemandPoolKey,
): string | null {
  switch (demandPool) {
    case "MPRS":
      return "monthly-planning";
    case "REGULAR_SO":
      return "sales-orders";
    case "STOCK_REPLENISHMENT":
      return "stock-replenishment";
    default:
      return null;
  }
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
  opts?: { salesOrderId?: number | null; materialRequirementId?: number | null },
): string {
  const params = new URLSearchParams();
  params.set("demandPool", demandPool);
  const sourceAlias = procurementSourceAliasForDemandPool(demandPool);
  if (sourceAlias) params.set("source", sourceAlias);
  if (demandPool === "REGULAR_SO" && opts?.salesOrderId != null && opts.salesOrderId > 0) {
    params.set("salesOrderId", String(opts.salesOrderId));
  }
  if (demandPool === "MPRS" && opts?.materialRequirementId != null && opts.materialRequirementId > 0) {
    params.set("materialRequirementId", String(opts.materialRequirementId));
  }
  return `?${params.toString()}`;
}

/** Workspace API query — omit demandPool when bootstrapping tab from a focused MR. */
export function workspaceBootstrapQuery(opts: {
  demandPool?: ProcurementDemandPoolKey | null;
  salesOrderId?: number | null;
  materialRequirementId?: number | null;
}): string {
  const params = new URLSearchParams();
  if (opts.demandPool) {
    params.set("demandPool", opts.demandPool);
    const sourceAlias = procurementSourceAliasForDemandPool(opts.demandPool);
    if (sourceAlias) params.set("source", sourceAlias);
  }
  if (opts.salesOrderId != null && opts.salesOrderId > 0) {
    params.set("salesOrderId", String(opts.salesOrderId));
  }
  if (opts.materialRequirementId != null && opts.materialRequirementId > 0) {
    params.set("materialRequirementId", String(opts.materialRequirementId));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function resolveDemandPoolForMaterialRequirementInWorkspace(
  ws: {
    pools?: PoolsMapLike | null;
    sections?: {
      pendingMaterialRequirements?: Array<{
        materialRequirementId?: number | null;
        sourceType?: string | null;
        source?: { type?: string | null } | null;
      }> | null;
    } | null;
  } | null,
  materialRequirementId: number,
): ProcurementDemandPoolKey | null {
  const mrId = Number(materialRequirementId);
  if (!Number.isFinite(mrId) || mrId <= 0 || !ws) return null;

  for (const row of ws.sections?.pendingMaterialRequirements ?? []) {
    if (Number(row.materialRequirementId ?? 0) === mrId) {
      return resolveMrDemandPool(row);
    }
  }

  for (const poolKey of PROCUREMENT_DEMAND_POOL_KEYS) {
    const items = ws.pools?.[poolKey]?.items ?? [];
    for (const item of items) {
      for (const origin of item.origins ?? []) {
        if (Number(origin.materialRequirementId ?? 0) === mrId) return poolKey;
      }
    }
  }
  return null;
}

/** Pick the first non-empty demand pool for dashboard deep-links (MPRS before REGULAR_SO). */
export function preferProcurementDemandPoolFromCounts(
  counts: Partial<ProcurementDemandPoolCounts>,
  opts?: {
    materialRequirementId?: number | null;
    rows?: ReadonlyArray<{
      materialRequirementId?: number | null;
      sourceType?: string | null;
      source?: { type?: string | null } | null;
    }>;
  },
): ProcurementDemandPoolKey {
  const focusMrId = Number(opts?.materialRequirementId ?? 0);
  if (focusMrId > 0 && opts?.rows?.length) {
    const row = opts.rows.find((r) => Number(r.materialRequirementId ?? 0) === focusMrId);
    const pool = row ? resolveMrDemandPool(row) : null;
    if (pool) return pool;
  }
  for (const key of PROCUREMENT_DEMAND_POOL_KEYS) {
    if (Number(counts[key] ?? 0) > 0) return key;
  }
  return DEFAULT_PROCUREMENT_DEMAND_POOL;
}

export function buildProcurementWorkspaceEntryHref(opts?: {
  demandPool?: ProcurementDemandPoolKey | null;
  materialRequirementId?: number | null;
  salesOrderId?: number | null;
  workOrderId?: number | null;
  returnTo?: string | null;
  source?: string | null;
  rows?: ReadonlyArray<{
    materialRequirementId?: number | null;
    sourceType?: string | null;
    source?: { type?: string | null } | null;
  }>;
  queueCounts?: Partial<ProcurementDemandPoolCounts> | null;
}): string {
  const pool =
    opts?.demandPool ??
    preferProcurementDemandPoolFromCounts(opts?.queueCounts ?? {}, {
      materialRequirementId: opts?.materialRequirementId,
      rows: opts?.rows,
    });
  const params = new URLSearchParams();
  params.set("demandPool", pool);
  const sourceAlias = opts?.source?.trim() || procurementSourceAliasForDemandPool(pool);
  if (sourceAlias) params.set("source", sourceAlias);
  if (opts?.returnTo) params.set("returnTo", opts.returnTo);
  if (opts?.salesOrderId != null && opts.salesOrderId > 0) {
    params.set("salesOrderId", String(opts.salesOrderId));
  }
  if (opts?.workOrderId != null && opts.workOrderId > 0) {
    params.set("workOrderId", String(opts.workOrderId));
  }
  if (opts?.materialRequirementId != null && opts.materialRequirementId > 0) {
    params.set("materialRequirementId", String(opts.materialRequirementId));
  }
  return `/procurement-planning?${params.toString()}`;
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
