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
};

type BoardResponse = {
  success: boolean;
  data: {
    groups: ControlTowerBoardGroup[];
    ungrouped: ControlTowerRow[];
  };
};

type RoleQueueResponse = {
  success: boolean;
  data: {
    role: string;
    count: number;
    groups: ControlTowerBoardGroup[];
    ungrouped: ControlTowerRow[];
  };
};

export async function fetchControlTowerPanelMetrics(): Promise<ControlTowerPanelMetricsData> {
  const res = await apiFetch<PanelMetricsResponse>("/api/control-tower/panel-metrics");
  return res.data;
}

export async function fetchControlTowerBoard(): Promise<BoardResponse["data"]> {
  const res = await apiFetch<BoardResponse>("/api/control-tower/board");
  return res.data;
}

export async function fetchControlTowerRoleQueue(role: string): Promise<RoleQueueResponse["data"]> {
  const token = String(role ?? "")
    .trim()
    .toUpperCase();
  const res = await apiFetch<RoleQueueResponse>(`/api/control-tower/role-queue/${encodeURIComponent(token)}`);
  return res.data;
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
