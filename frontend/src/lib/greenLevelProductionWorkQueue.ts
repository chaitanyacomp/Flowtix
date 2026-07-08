import { GREEN_LEVEL_WO_SOURCE_TYPE } from "./productionFlowContract";
import { displayWorkOrderTraceNo } from "./docNoDisplay";
import { greenLevelWorkOrderSelectLabel, isGreenLevelProductionWorkOrder } from "./greenLevelProductionExecution";

const EPS = 1e-6;

export type GreenLevelWorkQueueAction = "open" | "review" | "view" | "waiting_qa";

export type GreenLevelWorkQueueRow = {
  workOrderLineId: number;
  workOrderId: number;
  woLabel: string;
  itemName: string;
  plannedQty: number;
  producedQty: number;
  balanceQty: number;
  statusLabel: string;
  action: GreenLevelWorkQueueAction;
  actionLabel: string;
  /** When true, hide production qty entry form for this row. */
  readOnly: boolean;
  flatLine: {
    id: number;
    workOrderId: number;
    salesOrderId: number;
    fgItemId: number;
    qty: string;
    approvedProducedQty?: number;
    remainingQty?: number;
    qcPendingQty?: number;
    fgItem: { itemName: string };
  };
};

type WoLineLike = {
  id: number;
  fgItemId: number;
  qty: string;
  approvedProducedQty?: number;
  remainingQty?: number;
  qcPendingQty?: number;
  fgItem: { itemName: string };
};

type WoLike = {
  id: number;
  salesOrderId?: number | null;
  docNo?: string | null;
  status?: string | null;
  sourceType?: string | null;
  productionExecution?: { executionStatus?: string | null } | null;
  lines: WoLineLike[];
};

type EntryLike = {
  workflowStatus?: string | null;
  qcPendingQty?: number;
  workOrderLine?: { id?: number; workOrder?: { id?: number; sourceType?: string | null } };
};

function woStatusNorm(status?: string | null): string {
  return String(status ?? "").trim().toUpperCase();
}

function lineBalance(line: WoLineLike): number {
  if (line.remainingQty != null && Number.isFinite(Number(line.remainingQty))) {
    return Math.max(0, Number(line.remainingQty));
  }
  const planned = Number(line.qty);
  const produced = Number(line.approvedProducedQty ?? 0);
  return Math.max(0, (Number.isFinite(planned) ? planned : 0) - (Number.isFinite(produced) ? produced : 0));
}

function hasDraftOnLine(entries: EntryLike[], workOrderLineId: number): boolean {
  return entries.some(
    (e) =>
      String(e.workflowStatus ?? "").toUpperCase() === "DRAFT" &&
      Number(e.workOrderLine?.id ?? 0) === workOrderLineId,
  );
}

function qcPendingQtyForLine(line: WoLineLike, entries: EntryLike[]): number {
  const fromLine = Number(line.qcPendingQty ?? 0);
  if (fromLine > EPS) return fromLine;
  let sum = 0;
  for (const e of entries) {
    if (String(e.workflowStatus ?? "").toUpperCase() !== "APPROVED") continue;
    if (Number(e.workOrderLine?.id ?? 0) !== line.id) continue;
    const pending = Number(e.qcPendingQty ?? 0);
    if (Number.isFinite(pending) && pending > 0) sum += pending;
  }
  return sum;
}

function classifyGreenLevelWorkQueueRow(input: {
  wo: WoLike;
  line: WoLineLike;
  entries: EntryLike[];
}): Pick<GreenLevelWorkQueueRow, "statusLabel" | "action" | "actionLabel" | "readOnly"> {
  const status = woStatusNorm(input.wo.status);
  const execStatus = String(input.wo.productionExecution?.executionStatus ?? "").toUpperCase();
  const produced = Number(input.line.approvedProducedQty ?? 0);
  const balance = lineBalance(input.line);
  const qcPending = qcPendingQtyForLine(input.line, input.entries);
  const draftPending = hasDraftOnLine(input.entries, input.line.id);
  const terminal = ["COMPLETED", "CLOSED_WITH_SHORTFALL", "REJECTED"].includes(status);
  const onHold = status === "HOLD";

  if (onHold) {
    return { statusLabel: "On Hold", action: "view", actionLabel: "View", readOnly: true };
  }
  if (execStatus === "BLOCKED") {
    return { statusLabel: "Paused", action: "open", actionLabel: "Open", readOnly: false };
  }
  if (execStatus === "SHORTFALL_PENDING") {
    return { statusLabel: "Resolve shortfall", action: "open", actionLabel: "Open", readOnly: false };
  }
  if (draftPending) {
    return {
      statusLabel: "Draft approval pending",
      action: "review",
      actionLabel: "Review",
      readOnly: false,
    };
  }
  if (qcPending > EPS) {
    return {
      statusLabel: "Waiting for QA",
      action: "waiting_qa",
      actionLabel: "View",
      readOnly: true,
    };
  }
  if (terminal && balance <= EPS) {
    return { statusLabel: "Closed", action: "view", actionLabel: "View", readOnly: true };
  }
  if (produced > EPS && balance > EPS) {
    return { statusLabel: "In progress", action: "open", actionLabel: "Open", readOnly: false };
  }
  return { statusLabel: "Ready", action: "open", actionLabel: "Open", readOnly: false };
}

export function buildGreenLevelProductionWorkQueueRows(input: {
  workOrders: WoLike[];
  entries: EntryLike[];
  selectedWorkOrderLineId?: number;
}): GreenLevelWorkQueueRow[] {
  const rows: GreenLevelWorkQueueRow[] = [];
  const seenLineIds = new Set<number>();

  for (const wo of input.workOrders) {
    if (!isGreenLevelProductionWorkOrder(wo)) continue;
    for (const line of wo.lines ?? []) {
      if (!(line.id > 0)) continue;
      seenLineIds.add(line.id);
      const plannedQty = Number(line.qty);
      const producedQty = Number(line.approvedProducedQty ?? 0);
      const balanceQty = lineBalance(line);
      const classification = classifyGreenLevelWorkQueueRow({ wo, line, entries: input.entries });
      rows.push({
        workOrderLineId: line.id,
        workOrderId: wo.id,
        woLabel: greenLevelWorkOrderSelectLabel(wo),
        itemName: line.fgItem?.itemName ?? "—",
        plannedQty: Number.isFinite(plannedQty) ? plannedQty : 0,
        producedQty: Number.isFinite(producedQty) ? producedQty : 0,
        balanceQty,
        ...classification,
        flatLine: {
          ...line,
          workOrderId: wo.id,
          salesOrderId: Number(wo.salesOrderId ?? 0),
        },
      });
    }
  }

  for (const e of input.entries) {
    const sourceType = e.workOrderLine?.workOrder?.sourceType;
    if (String(sourceType ?? "").toUpperCase() !== GREEN_LEVEL_WO_SOURCE_TYPE) continue;
    const lineId = Number(e.workOrderLine?.id ?? 0);
    const woId = Number(e.workOrderLine?.workOrder?.id ?? 0);
    if (!(lineId > 0) || seenLineIds.has(lineId)) continue;
    const pending = Number(e.qcPendingQty ?? 0);
    if (String(e.workflowStatus ?? "").toUpperCase() !== "APPROVED" || !(pending > EPS)) continue;
    seenLineIds.add(lineId);
    const producedQty = Number(e.producedQty ?? 0);
    rows.push({
      workOrderLineId: lineId,
      workOrderId: woId,
      woLabel: woId > 0 ? displayWorkOrderTraceNo(woId) : "—",
      itemName: "—",
      plannedQty: producedQty,
      producedQty,
      balanceQty: 0,
      statusLabel: "Waiting for QA",
      action: "waiting_qa",
      actionLabel: "View",
      readOnly: true,
      flatLine: {
        id: lineId,
        workOrderId: woId,
        salesOrderId: 0,
        fgItemId: 0,
        qty: String(producedQty),
        approvedProducedQty: producedQty,
        remainingQty: 0,
        qcPendingQty: pending,
        fgItem: { itemName: "—" },
      },
    });
  }

  const selectedId = Number(input.selectedWorkOrderLineId ?? 0);
  return rows
    .map((row) => ({ ...row, selected: selectedId > 0 && row.workOrderLineId === selectedId }))
    .sort((a, b) => b.workOrderId - a.workOrderId || a.workOrderLineId - b.workOrderLineId);
}

export type GreenLevelWorkQueueRowWithSelected = GreenLevelWorkQueueRow & { selected?: boolean };
