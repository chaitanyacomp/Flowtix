import { isGreenLevelReplenishmentSourceType } from "./productionFlowContract";
import { displayWorkOrderNo } from "./docNoDisplay";

export type GreenLevelWorkOrderLike = {
  id: number;
  sourceType?: string | null;
  docNo?: string | null;
};

export function isGreenLevelProductionWorkOrder(wo?: GreenLevelWorkOrderLike | null): boolean {
  return isGreenLevelReplenishmentSourceType(wo?.sourceType);
}

export function filterGreenLevelExecutableWorkOrders<T extends GreenLevelWorkOrderLike>(
  workOrders: T[],
): T[] {
  return workOrders.filter(isGreenLevelProductionWorkOrder);
}

export type GreenLevelProductionEntryLike = {
  orderType?: string;
  salesOrder?: { orderType?: string };
  workOrderLine?: {
    workOrder?: {
      sourceType?: string | null;
      orderType?: string;
      salesOrder?: { orderType?: string };
    };
  };
};

export function isGreenLevelProductionEntry(e?: GreenLevelProductionEntryLike | null): boolean {
  return isGreenLevelReplenishmentSourceType(e?.workOrderLine?.workOrder?.sourceType);
}

function prodEntryOrderTypeRaw(e: GreenLevelProductionEntryLike): string {
  const pick = [e.orderType, e.salesOrder?.orderType, e.workOrderLine?.workOrder?.salesOrder?.orderType].find(
    (v) => v != null && String(v).trim() !== "",
  );
  return pick != null ? String(pick).trim() : "";
}

/** REGULAR batches use RM consumption review; NO_QTY and Green Level skip it. */
export function productionEntryUsesRmConsumptionReview(e?: GreenLevelProductionEntryLike | null): boolean {
  if (!e || isGreenLevelProductionEntry(e)) return false;
  return prodEntryOrderTypeRaw(e) !== "NO_QTY";
}

export function greenLevelWorkOrderSelectLabel(wo: GreenLevelWorkOrderLike): string {
  return displayWorkOrderNo(wo.id, wo.docNo);
}

const GL_QUEUE_EPS = 1e-6;

const GL_TERMINAL_WO_STATUSES = new Set([
  "COMPLETED",
  "CLOSED",
  "CLOSED_WITH_SHORTFALL",
  "REJECTED",
  "MANUALLY_CLOSED", "CLOSED_WITH_WAIVER",
]);

export type GreenLevelProductionQueueAction = "open" | "review" | "view" | "waiting_qa";

export type GreenLevelProductionQueueRow = {
  workOrderId: number;
  workOrderLineId: number;
  woLabel: string;
  itemName: string;
  plannedQty: number;
  producedQty: number;
  balanceQty: number;
  statusLabel: string;
  action: GreenLevelProductionQueueAction;
  actionLabel: string;
  readOnly: boolean;
};

export type GreenLevelWoLineInput = {
  id: number;
  qty: string;
  approvedProducedQty?: number;
  remainingQty?: number;
  qcPendingQty?: number;
  fgItem: { itemName: string };
};

export type GreenLevelWoInput = GreenLevelWorkOrderLike & {
  status?: string | null;
  lines: GreenLevelWoLineInput[];
  productionExecution?: { executionStatus?: string | null } | null;
};

export type GreenLevelProductionEntryInput = {
  workflowStatus?: string;
  workOrderLine?: {
    id: number;
    fgItem?: { itemName: string };
    workOrder?: {
      id: number;
      sourceType?: string | null;
      docNo?: string | null;
      status?: string | null;
    };
  };
};

function isDraftEntry(e: GreenLevelProductionEntryInput): boolean {
  return String(e.workflowStatus ?? "APPROVED").toUpperCase() === "DRAFT";
}

function isTerminalGreenLevelWo(status?: string | null): boolean {
  return GL_TERMINAL_WO_STATUSES.has(String(status ?? "").toUpperCase());
}

function resolveGreenLevelQueueRowState(input: {
  woStatus?: string | null;
  executionStatus?: string | null;
  plannedQty: number;
  producedQty: number;
  balanceQty: number;
  qcPendingQty: number;
  hasDraft: boolean;
}): Pick<GreenLevelProductionQueueRow, "statusLabel" | "action" | "actionLabel" | "readOnly"> {
  const exec = String(input.executionStatus ?? "").toUpperCase();
  if (isTerminalGreenLevelWo(input.woStatus) || exec === "COMPLETED") {
    return { statusLabel: "Closed", action: "view", actionLabel: "View", readOnly: true };
  }
  if (input.qcPendingQty > GL_QUEUE_EPS) {
    return {
      statusLabel: "QA pending",
      action: "waiting_qa",
      actionLabel: "View",
      readOnly: true,
    };
  }
  if (input.hasDraft) {
    return { statusLabel: "Draft pending", action: "review", actionLabel: "Review", readOnly: false };
  }
  if (exec === "SHORTFALL_PENDING") {
    return { statusLabel: "Shortfall decision", action: "open", actionLabel: "Open", readOnly: false };
  }
  if (exec === "BLOCKED") {
    return { statusLabel: "Paused", action: "open", actionLabel: "Open", readOnly: false };
  }
  if (input.balanceQty <= GL_QUEUE_EPS && input.producedQty > GL_QUEUE_EPS) {
    return { statusLabel: "Complete", action: "view", actionLabel: "View", readOnly: true };
  }
  if (input.producedQty > GL_QUEUE_EPS && input.balanceQty > GL_QUEUE_EPS) {
    return { statusLabel: "In progress", action: "open", actionLabel: "Open", readOnly: false };
  }
  if (input.balanceQty > GL_QUEUE_EPS) {
    return { statusLabel: "Ready", action: "open", actionLabel: "Open", readOnly: false };
  }
  return { statusLabel: "Closed", action: "view", actionLabel: "View", readOnly: true };
}

export function buildGreenLevelProductionQueueRows(input: {
  workOrders: GreenLevelWoInput[];
  entries: GreenLevelProductionEntryInput[];
}): GreenLevelProductionQueueRow[] {
  const rows: GreenLevelProductionQueueRow[] = [];
  const seenLineIds = new Set<number>();

  const draftsByWoId = new Map<number, boolean>();
  for (const e of input.entries) {
    if (!isGreenLevelProductionEntry(e) || !isDraftEntry(e)) continue;
    const woId = Number(e.workOrderLine?.workOrder?.id ?? 0);
    if (woId > 0) draftsByWoId.set(woId, true);
  }

  for (const wo of filterGreenLevelExecutableWorkOrders(input.workOrders)) {
    for (const line of wo.lines ?? []) {
      const plannedQty = Math.max(0, Number(line.qty ?? 0));
      const producedQty = Math.max(0, Number(line.approvedProducedQty ?? 0));
      const balanceQty = Math.max(0, Number(line.remainingQty ?? Math.max(0, plannedQty - producedQty)));
      const qcPendingQty = Math.max(0, Number(line.qcPendingQty ?? 0));
      const state = resolveGreenLevelQueueRowState({
        woStatus: wo.status,
        executionStatus: wo.productionExecution?.executionStatus,
        plannedQty,
        producedQty,
        balanceQty,
        qcPendingQty,
        hasDraft: draftsByWoId.get(wo.id) === true,
      });
      rows.push({
        workOrderId: wo.id,
        workOrderLineId: line.id,
        woLabel: greenLevelWorkOrderSelectLabel(wo),
        itemName: line.fgItem?.itemName ?? "—",
        plannedQty,
        producedQty,
        balanceQty,
        ...state,
      });
      seenLineIds.add(line.id);
    }
  }

  for (const e of input.entries) {
    if (!isGreenLevelProductionEntry(e)) continue;
    const lineId = Number(e.workOrderLine?.id ?? 0);
    const woId = Number(e.workOrderLine?.workOrder?.id ?? 0);
    if (!(lineId > 0) || !(woId > 0) || seenLineIds.has(lineId)) continue;
    const wo = e.workOrderLine?.workOrder;
    const state = resolveGreenLevelQueueRowState({
      woStatus: wo?.status,
      executionStatus: null,
      plannedQty: 0,
      producedQty: 0,
      balanceQty: 0,
      qcPendingQty: 0,
      hasDraft: isDraftEntry(e),
    });
    rows.push({
      workOrderId: woId,
      workOrderLineId: lineId,
      woLabel: greenLevelWorkOrderSelectLabel(wo ?? { id: woId }),
      itemName: e.workOrderLine?.fgItem?.itemName ?? "—",
      plannedQty: 0,
      producedQty: 0,
      balanceQty: 0,
      ...state,
    });
    seenLineIds.add(lineId);
  }

  return rows.sort((a, b) => b.workOrderId - a.workOrderId);
}

export function greenLevelRowAllowsProductionEntry(row: GreenLevelProductionQueueRow | null | undefined): boolean {
  return row?.action === "open";
}

export function greenLevelRowShowsQcWaiting(row: GreenLevelProductionQueueRow | null | undefined): boolean {
  return row?.action === "waiting_qa";
}
