/**
 * RM Control Center — selection vs queue-filter separation (RMCC-A1).
 * Card clicks select a case; filter bar narrows the queue via API filters.
 */

export type CaseSelection = {
  workOrderId?: number | null;
  materialRequirementId?: number | null;
  rmItemId?: number | null;
};

export type QueueSearchFilters = {
  salesOrderId: string;
  workOrderId: string;
  materialRequirementId: string;
  rmItemId: string;
  status: string;
  onlyBlocked: boolean;
};

export const EMPTY_QUEUE_SEARCH_FILTERS: QueueSearchFilters = {
  salesOrderId: "",
  workOrderId: "",
  materialRequirementId: "",
  rmItemId: "",
  status: "",
  onlyBlocked: false,
};

function readPositiveInt(raw: string | null): number | null {
  if (!raw?.trim()) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Deep-link params (workOrderId, mr, rm) → selection; SO/status/blocked → queue filters. */
export function splitSearchParams(params: URLSearchParams): {
  queueFilters: QueueSearchFilters;
  initialSelection: CaseSelection | null;
} {
  const workOrderId = readPositiveInt(params.get("workOrderId"));
  const materialRequirementId = readPositiveInt(params.get("materialRequirementId"));
  const rmItemId = readPositiveInt(params.get("rmItemId"));

  const initialSelection: CaseSelection | null =
    workOrderId || materialRequirementId || rmItemId
      ? { workOrderId, materialRequirementId, rmItemId }
      : null;

  return {
    queueFilters: {
      salesOrderId: params.get("salesOrderId") ?? "",
      workOrderId: "",
      materialRequirementId: "",
      rmItemId: "",
      status: params.get("status") ?? "",
      onlyBlocked: params.get("onlyBlocked") === "true",
    },
    initialSelection,
  };
}

/** API query for workspace load — queue search filters only (not card selection). */
export function buildQueueApiQuery(filters: QueueSearchFilters): string {
  const q = new URLSearchParams();
  if (filters.salesOrderId.trim()) q.set("salesOrderId", filters.salesOrderId.trim());
  if (filters.workOrderId.trim()) q.set("workOrderId", filters.workOrderId.trim());
  if (filters.materialRequirementId.trim()) q.set("materialRequirementId", filters.materialRequirementId.trim());
  if (filters.rmItemId.trim()) q.set("rmItemId", filters.rmItemId.trim());
  if (filters.status) q.set("status", filters.status);
  if (filters.onlyBlocked) q.set("onlyBlocked", "true");
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Browser URL: selection + queue-level filters (not filter-bar WO narrow). */
export function buildPageSearchParams(
  queueFilters: QueueSearchFilters,
  selection: CaseSelection | null,
  returnTo?: string | null,
): string {
  const q = new URLSearchParams();
  if (selection?.workOrderId != null && selection.workOrderId > 0) {
    q.set("workOrderId", String(selection.workOrderId));
  }
  if (selection?.materialRequirementId != null && selection.materialRequirementId > 0) {
    q.set("materialRequirementId", String(selection.materialRequirementId));
  }
  if (selection?.rmItemId != null && selection.rmItemId > 0) {
    q.set("rmItemId", String(selection.rmItemId));
  }
  if (queueFilters.salesOrderId.trim()) q.set("salesOrderId", queueFilters.salesOrderId.trim());
  if (queueFilters.status) q.set("status", queueFilters.status);
  if (queueFilters.onlyBlocked) q.set("onlyBlocked", "true");
  if (returnTo?.trim()) q.set("returnTo", returnTo.trim());
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function selectionFromQueueRow(row: {
  workOrderId?: number | null;
  materialRequirementId?: number | null;
  rmItemId: number;
}): CaseSelection {
  return {
    workOrderId: row.workOrderId ?? null,
    materialRequirementId: row.materialRequirementId ?? null,
    rmItemId: row.rmItemId,
  };
}

export function resolveDetailFromWorkspace<
  T extends {
    workOrder?: { id?: number | null } | null;
    woShortageCase?: { materialRequirement?: { id?: number | null } | null } | null;
  },
>(details: T[], selection: CaseSelection | null): T | null {
  if (!details.length) return null;
  if (selection?.workOrderId != null && selection.workOrderId > 0) {
    return details.find((d) => d.workOrder?.id === selection.workOrderId) ?? null;
  }
  if (selection?.materialRequirementId != null && selection.materialRequirementId > 0) {
    return (
      details.find((d) => d.woShortageCase?.materialRequirement?.id === selection.materialRequirementId) ?? null
    );
  }
  return details[0] ?? null;
}

export function reconcileSelectionAfterLoad(
  selection: CaseSelection | null,
  actionQueue: Array<{
    workOrderId?: number | null;
    materialRequirementId?: number | null;
    rmItemId: number;
  }>,
  autoSelectFirst: boolean,
): CaseSelection | null {
  if (!actionQueue.length) return null;

  if (selection?.workOrderId != null && selection.workOrderId > 0) {
    const row = actionQueue.find((r) => r.workOrderId === selection.workOrderId);
    if (row) {
      return {
        workOrderId: row.workOrderId,
        materialRequirementId: row.materialRequirementId ?? null,
        rmItemId: selection.rmItemId ?? row.rmItemId,
      };
    }
  }

  if (selection?.materialRequirementId != null && selection.materialRequirementId > 0) {
    const row = actionQueue.find((r) => r.materialRequirementId === selection.materialRequirementId);
    if (row) {
      return {
        workOrderId: row.workOrderId ?? null,
        materialRequirementId: row.materialRequirementId,
        rmItemId: selection.rmItemId ?? row.rmItemId,
      };
    }
  }

  if (autoSelectFirst) {
    return selectionFromQueueRow(actionQueue[0]);
  }

  return selection;
}

export function isCaseGroupSelected(
  selection: CaseSelection | null,
  group: { workOrderId: number | null; materialRequirementId: number | null },
): boolean {
  if (!selection) return false;
  if (group.workOrderId != null) return selection.workOrderId === group.workOrderId;
  if (group.materialRequirementId != null) {
    return selection.materialRequirementId === group.materialRequirementId;
  }
  return false;
}

export function resolveRmItemIdForDetail(
  detail: { rmLines: Array<{ rmItemId: number; shortageAfterReservationQty?: number }> } | null,
  selection: CaseSelection | null,
  currentRmItemId: number | null,
): number | null {
  if (!detail?.rmLines.length) return null;
  if (currentRmItemId != null && detail.rmLines.some((l) => l.rmItemId === currentRmItemId)) {
    return currentRmItemId;
  }
  const fromSelection = selection?.rmItemId;
  if (fromSelection != null && detail.rmLines.some((l) => l.rmItemId === fromSelection)) {
    return fromSelection;
  }
  return (
    detail.rmLines.find((l) => Number(l.shortageAfterReservationQty ?? 0) > 0)?.rmItemId ??
    detail.rmLines[0]?.rmItemId ??
    null
  );
}
