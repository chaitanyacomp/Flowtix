/**
 * Store RM Workspace — operator-facing copy and status helpers (presentation only).
 */

export type StoreRmQueueStatus = "ready" | "partial" | "shortage";

export type StoreRmQueueStatusPresentation = {
  status: StoreRmQueueStatus;
  label: string;
  badgeVariant: "success" | "default" | "rejected";
  cardRingClass: string;
  cardBgClass: string;
};

export type RmLineStockView = {
  rmItemId?: number;
  rmItemName?: string;
  requiredQty?: number;
  freeStockQty?: number;
  physicalUsableStockQty?: number;
  shortageAfterReservationQty?: number;
  activeAllocatedQty?: number;
};

const WO_CREATE_PROCUREMENT_COPY = /complete procurement,\s*then create work order/i;

/** Rewrites legacy backend/procurement strings for Store operators. */
export function sanitizeStoreOperatorCopy(text: string | null | undefined): string {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  if (WO_CREATE_PROCUREMENT_COPY.test(raw)) {
    return "RM shortage blocking production";
  }
  if (/create work order first/i.test(raw)) {
    return "RM shortage blocking production";
  }
  return raw;
}

export function operatorQueueStatus(row: {
  shortageAfterReservationQty?: number;
  freeStockQty?: number;
  queueType?: string;
}): StoreRmQueueStatusPresentation {
  const shortage = Math.max(0, Number(row.shortageAfterReservationQty ?? 0));
  const free = Math.max(0, Number(row.freeStockQty ?? 0));
  const qt = String(row.queueType ?? "");

  if (qt === "RM_RECEIVED_CREATE_WO") {
    return {
      status: "partial",
      label: "RM received in Store",
      badgeVariant: "default",
      cardRingClass: "ring-sky-300/90",
      cardBgClass: "bg-sky-50/50",
    };
  }

  if (
    shortage <= 0 ||
    qt === "RM_READY_FOR_ISSUE" ||
    qt === "READY_TO_RELEASE_WO" ||
    qt === "READY_ISSUE"
  ) {
    return {
      status: "ready",
      label: "Ready for issue",
      badgeVariant: "success",
      cardRingClass: "ring-emerald-300/90",
      cardBgClass: "bg-emerald-50/40",
    };
  }
  if (free > 0) {
    return {
      status: "partial",
      label: "Partial",
      badgeVariant: "default",
      cardRingClass: "ring-amber-300/90",
      cardBgClass: "bg-amber-50/50",
    };
  }
  return {
    status: "shortage",
    label: "Shortage",
      badgeVariant: "rejected",
    cardRingClass: "ring-red-300/90",
    cardBgClass: "bg-red-50/55",
  };
}

export function countShortageLinesForWorkOrder(
  rows: Array<{ workOrderId?: number | null; shortageAfterReservationQty?: number }>,
  workOrderId: number | null | undefined,
): number {
  if (!workOrderId) return 0;
  return rows.filter(
    (r) => Number(r.workOrderId) === Number(workOrderId) && Number(r.shortageAfterReservationQty ?? 0) > 0,
  ).length;
}

export type RmQueueCaseRow = {
  workOrderId?: number | null;
  materialRequirementId?: number | null;
  salesOrderId?: number | null;
  rmItemId?: number | null;
  shortageAfterReservationQty?: number;
  freeStockQty?: number;
  queueType?: string;
};

export type RmQueueCaseGroup<T extends RmQueueCaseRow> = {
  caseKey: string;
  representative: T;
  workOrderId: number | null;
  materialRequirementId: number | null;
  rmLineCount: number;
  shortageLineCount: number;
  status: StoreRmQueueStatus;
};

const QUEUE_STATUS_RANK: Record<StoreRmQueueStatus, number> = {
  shortage: 0,
  partial: 1,
  ready: 2,
};

/**
 * Collapses a per-RM-line action queue into one entry per case (work order, else
 * material requirement, else RM item). The representative line is the most blocking
 * one so the card badge/next-action reflect the work order's overall gate. Input order
 * is preserved by first appearance.
 */
export function groupRmQueueByCase<T extends RmQueueCaseRow>(rows: T[]): RmQueueCaseGroup<T>[] {
  const order: string[] = [];
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    const key =
      row.workOrderId != null
        ? `wo-${row.workOrderId}`
        : row.materialRequirementId != null
          ? `mr-${row.materialRequirementId}`
          : row.salesOrderId != null
            ? `so-${row.salesOrderId}`
            : `rm-${row.rmItemId ?? "x"}`;
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      byKey.set(key, [row]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const group = byKey.get(key) as T[];
    let representative = group[0];
    let worstRank = QUEUE_STATUS_RANK[operatorQueueStatus(group[0]).status];
    let shortageLineCount = 0;
    for (const row of group) {
      if (Math.max(0, Number(row.shortageAfterReservationQty ?? 0)) > 0) shortageLineCount += 1;
      const rank = QUEUE_STATUS_RANK[operatorQueueStatus(row).status];
      if (rank < worstRank) {
        worstRank = rank;
        representative = row;
      }
    }
    const status =
      (Object.keys(QUEUE_STATUS_RANK) as StoreRmQueueStatus[]).find(
        (k) => QUEUE_STATUS_RANK[k] === worstRank,
      ) ?? "ready";
    return {
      caseKey: key,
      representative,
      workOrderId: representative.workOrderId ?? null,
      materialRequirementId: representative.materialRequirementId ?? null,
      rmLineCount: group.length,
      shortageLineCount,
      status,
    };
  });
}

/** True when no RM line has free stock available to allocate. */
export function caseHasZeroAllocatableStock(lines: RmLineStockView[]): boolean {
  if (!lines.length) return false;
  return lines.every((l) => Math.max(0, Number(l.freeStockQty ?? 0)) <= 0);
}

/** True when physical stock exists somewhere but nothing is free (committed elsewhere). */
export function caseHasPhysicalButNoFreeStock(lines: RmLineStockView[]): boolean {
  const anyPhysical = lines.some((l) => Math.max(0, Number(l.physicalUsableStockQty ?? 0)) > 0);
  const anyFree = lines.some((l) => Math.max(0, Number(l.freeStockQty ?? 0)) > 0);
  return anyPhysical && !anyFree;
}

export function operatorStageLabel(input: {
  allocationFirstLabel?: string | null;
  guidedPhaseTitle?: string | null;
  nextAction?: string | null;
  hasWorkOrder?: boolean;
}): string {
  const alloc = sanitizeStoreOperatorCopy(input.allocationFirstLabel);
  if (alloc) return alloc;
  const guided = sanitizeStoreOperatorCopy(input.guidedPhaseTitle);
  if (guided) return guided;
  const next = sanitizeStoreOperatorCopy(input.nextAction);
  if (next) return next;
  return input.hasWorkOrder ? "Review RM case" : "RM shortage blocking production";
}

export function operatorNextActionHint(row: {
  nextAction?: string | null;
  recommendedAction?: string | null;
  blockerReason?: string | null;
  queueType?: string;
}): string {
  const next = sanitizeStoreOperatorCopy(row.nextAction ?? row.recommendedAction);
  if (next) return next;
  const status = operatorQueueStatus(row);
  if (status.status === "ready") return "Issue RM to Production";
  if (status.status === "partial" && row.queueType === "RM_RECEIVED_CREATE_WO") {
    return "Create Work Order in Prepare WO";
  }
  if (status.status === "partial") return "Allocate RM from available stock";
  return "Arrange RM procurement or GRN";
}
