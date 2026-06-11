/** P5C-3 — Procurement Workspace demand-class queue tabs (no Emergency). */

export const PROCUREMENT_QUEUE_SOURCE_TYPES = [
  "MONTHLY_PLAN",
  "WORK_ORDER_PLANNING",
  "STOCK_REPLENISHMENT",
] as const;

export type ProcurementQueueSourceType = (typeof PROCUREMENT_QUEUE_SOURCE_TYPES)[number];

export type ProcurementQueueTabId = "ALL" | ProcurementQueueSourceType;

export type ProcurementQueueCounts = {
  all: number;
  monthlyPlan: number;
  woShortage: number;
  minStock: number;
};

export type ProcurementQueueTabDef = {
  id: ProcurementQueueTabId;
  label: string;
  sourceType: ProcurementQueueSourceType | null;
  countKey: keyof ProcurementQueueCounts;
};

export const PROCUREMENT_QUEUE_TABS: ProcurementQueueTabDef[] = [
  { id: "ALL", label: "All Open", sourceType: null, countKey: "all" },
  { id: "MONTHLY_PLAN", label: "Monthly Planning", sourceType: "MONTHLY_PLAN", countKey: "monthlyPlan" },
  { id: "WORK_ORDER_PLANNING", label: "WO Shortage", sourceType: "WORK_ORDER_PLANNING", countKey: "woShortage" },
  { id: "STOCK_REPLENISHMENT", label: "Min Stock", sourceType: "STOCK_REPLENISHMENT", countKey: "minStock" },
];

export function emptyProcurementQueueCounts(): ProcurementQueueCounts {
  return { all: 0, monthlyPlan: 0, woShortage: 0, minStock: 0 };
}

export function deriveQueueCountsFromMrs(
  rows: ReadonlyArray<{ sourceType?: string | null }>,
): ProcurementQueueCounts {
  const counts = emptyProcurementQueueCounts();
  counts.all = rows.length;
  for (const row of rows) {
    switch (String(row.sourceType ?? "")) {
      case "MONTHLY_PLAN":
        counts.monthlyPlan += 1;
        break;
      case "WORK_ORDER_PLANNING":
        counts.woShortage += 1;
        break;
      case "STOCK_REPLENISHMENT":
        counts.minStock += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

export function filterMrsByQueueTab<T extends { sourceType?: string | null }>(
  rows: T[],
  tabId: ProcurementQueueTabId,
): T[] {
  if (tabId === "ALL") return rows;
  return rows.filter((row) => String(row.sourceType ?? "") === tabId);
}

export function workspaceQueryForQueueTab(
  tabId: ProcurementQueueTabId,
  salesOrderId?: number,
): string {
  const params = new URLSearchParams();
  if (salesOrderId != null && salesOrderId > 0) {
    params.set("salesOrderId", String(salesOrderId));
  }
  const tab = PROCUREMENT_QUEUE_TABS.find((t) => t.id === tabId);
  if (tab?.sourceType) params.set("sourceType", tab.sourceType);
  const q = params.toString();
  return q ? `?${q}` : "";
}
