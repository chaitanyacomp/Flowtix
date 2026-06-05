import { apiFetch } from "../services/api";

/** Board swimlane order — mirrors backend `controlTowerBoardGroups.js`. */
export const CONTROL_TOWER_BOARD_GROUP_ORDER = [
  "RM_READINESS",
  "PRODUCTION",
  "QUALITY",
  "DISPATCH",
  "COMMERCIAL_CLOSURE",
  "PLANNING",
] as const;

export type ControlTowerBoardGroupKey = (typeof CONTROL_TOWER_BOARD_GROUP_ORDER)[number];

export const CONTROL_TOWER_BOARD_GROUP_LABELS: Record<ControlTowerBoardGroupKey, string> = {
  RM_READINESS: "RM & Readiness",
  PRODUCTION: "Production",
  QUALITY: "Quality",
  DISPATCH: "Dispatch",
  COMMERCIAL_CLOSURE: "Commercial Closure",
  PLANNING: "Planning",
};

export type ControlTowerRow = {
  rowKey?: string;
  documentNo: string | null;
  currentStatus: string;
  currentOwner: string;
  nextAction: string;
};

export type ControlTowerBoardGroup = {
  groupKey: string;
  label: string;
  ownerRole: string;
  order: number;
  count: number;
  rows: ControlTowerRow[];
};

export type ControlTowerPanelMetricsData = {
  liveFactoryPanel: {
    rmShortageCount: number;
    rmReadyCount: number;
    productionPendingCount: number;
    qaPendingCount: number;
    dispatchPendingLineCount: number;
    dispatchPendingQty: number;
    activeSalesOrders: number;
    activeWorkOrders: number;
    billingReadyCount: number | null;
    billingPendingCount: number | null;
    exportPendingCount: number | null;
  };
  liveProcessBoard: {
    pendingProcesses: number;
    delayedProcesses: number;
  };
  criticalAlerts: {
    rmCriticalCount: number;
    blockedWorkOrders: number;
    systemExceptions: number;
    alertTotal: number;
  };
  noQtyControlPanel: {
    activeNoQtyOrders: number;
    planningPending: number;
  };
  commercialControl: {
    billingReady: number | null;
    billingPending: number | null;
    exportPending: number | null;
    paymentPending: number | null;
  };
};

type PanelMetricsResponse = {
  success: boolean;
  data: ControlTowerPanelMetricsData;
  meta?: {
    generatedAt?: string;
    panelOnly?: boolean;
    commercialIncluded?: boolean;
  };
};

export type ControlTowerBoardMeta = {
  rowCount?: number;
  groupedCount?: number;
  ungroupedCount?: number;
  generatedAt?: string;
  mode?: string;
  sampled?: boolean;
  totalRows?: number;
  page?: number;
  pageSize?: number;
};

export type ControlTowerRoleQueueMeta = {
  role?: string;
  mode?: string;
  sampled?: boolean;
  page?: number;
  pageSize?: number;
  totalRows?: number;
  totalRowsBeforeRoleFilter?: number;
  totalRowsAfterRoleFilter?: number;
  totalRowsAfterRoleDedupe?: number;
  generatedAt?: string;
};

type BoardResponse = {
  success: boolean;
  data: {
    groups: ControlTowerBoardGroup[];
    ungrouped: ControlTowerRow[];
    meta?: ControlTowerBoardMeta;
  };
};

type RoleQueueResponse = {
  success: boolean;
  data: {
    role: string;
    count: number;
    groups: ControlTowerBoardGroup[];
    ungrouped: ControlTowerRow[];
    meta?: ControlTowerRoleQueueMeta;
  };
};

export type ControlTowerPanelMetricsResult = {
  data: ControlTowerPanelMetricsData;
  meta: PanelMetricsResponse["meta"];
};

export type ControlTowerBoardResult = {
  groups: ControlTowerBoardGroup[];
  ungrouped: ControlTowerRow[];
  meta: ControlTowerBoardMeta;
};

export type ControlTowerRoleQueueResult = {
  role: string;
  count: number;
  groups: ControlTowerBoardGroup[];
  ungrouped: ControlTowerRow[];
  meta: ControlTowerRoleQueueMeta;
};

export async function fetchControlTowerPanelMetrics(): Promise<ControlTowerPanelMetricsResult> {
  const res = await apiFetch<PanelMetricsResponse>("/api/control-tower/panel-metrics");
  return { data: res.data, meta: res.meta ?? {} };
}

export async function fetchControlTowerBoard(): Promise<ControlTowerBoardResult> {
  const res = await apiFetch<BoardResponse>("/api/control-tower/board");
  return {
    groups: res.data.groups ?? [],
    ungrouped: res.data.ungrouped ?? [],
    meta: res.data.meta ?? {},
  };
}

export async function fetchControlTowerRoleQueue(role: string): Promise<ControlTowerRoleQueueResult> {
  const token = String(role ?? "")
    .trim()
    .toUpperCase();
  const res = await apiFetch<RoleQueueResponse>(`/api/control-tower/role-queue/${encodeURIComponent(token)}`);
  return {
    role: res.data.role ?? token,
    count: res.data.count ?? 0,
    groups: res.data.groups ?? [],
    ungrouped: res.data.ungrouped ?? [],
    meta: res.data.meta ?? {},
  };
}

/** Sort board groups into the approved swimlane order; unknown groups trail at the end. */
export function sortControlTowerBoardGroups(groups: ControlTowerBoardGroup[]): ControlTowerBoardGroup[] {
  const orderIndex = new Map(CONTROL_TOWER_BOARD_GROUP_ORDER.map((key, idx) => [key, idx]));
  return [...groups].sort((a, b) => {
    const ai = orderIndex.get(a.groupKey as ControlTowerBoardGroupKey) ?? 999;
    const bi = orderIndex.get(b.groupKey as ControlTowerBoardGroupKey) ?? 999;
    if (ai !== bi) return ai - bi;
    return a.order - b.order;
  });
}

export function controlTowerGroupsWithRows(groups: ControlTowerBoardGroup[]): ControlTowerBoardGroup[] {
  return groups.filter((g) => g.count > 0 || g.rows.length > 0);
}
