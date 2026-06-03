/**
 * Phase 1 — allocation visibility (presentation only).
 * Does not change reservation, stock, or procurement calculations.
 */

export type StockCommitmentSourceRow = {
  sourceType?: string;
  pmrId?: number | null;
  pmrDocNo?: string | null;
  pmrStatus?: string | null;
  workOrderId?: number | null;
  workOrderNo?: string | null;
  reservedQty: number;
  allocationStatus?: string | null;
};

export type StockCommitmentDisplayRow = {
  key: string;
  workOrderId: number | null;
  workOrderLabel: string;
  customerLabel: string | null;
  committedQty: number;
  pmrStatusLabel: string;
  operationalStage: string;
};

const EPS = 1e-6;

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

export function isStockCommittedElsewhere(physicalQty: number, freeQty: number): boolean {
  return n(physicalQty) > EPS && n(freeQty) <= EPS;
}

export function operationalStageFromCommitment(row: StockCommitmentSourceRow): string {
  const status = String(row.pmrStatus ?? row.allocationStatus ?? "").toUpperCase();
  if (status === "REQUESTED") return "Waiting for store issue";
  if (status === "PARTIALLY_ISSUED") return "Partially issued";
  if (status === "FULLY_ISSUED") return "Fully issued";
  if (status === "DRAFT") return "Material request draft";
  if (row.sourceType === "ALLOCATION") return "Committed to work order";
  if (status.includes("PROCUREMENT") || status.includes("PENDING")) return "Procurement in progress";
  return "Active on work order";
}

export function pmrStatusLabelForCommitment(row: StockCommitmentSourceRow): string {
  const status = String(row.pmrStatus ?? "").toUpperCase();
  switch (status) {
    case "REQUESTED":
      return "Pending issue";
    case "PARTIALLY_ISSUED":
      return "Partial issue";
    case "FULLY_ISSUED":
      return "Fully issued";
    case "DRAFT":
      return "Draft";
    default:
      return row.sourceType === "ALLOCATION" ? "Allocated" : status ? status.replaceAll("_", " ") : "Active";
  }
}

/** Rows for other work orders holding stock on this RM item (excludes current WO). */
export function buildStockCommitmentDisplayRows(
  breakdown: StockCommitmentSourceRow[] | undefined,
  currentWorkOrderId?: number | null,
): StockCommitmentDisplayRow[] {
  const byWo = new Map<string, StockCommitmentDisplayRow>();

  for (const row of breakdown ?? []) {
    const qty = n(row.reservedQty);
    if (qty <= EPS) continue;
    const woId = row.workOrderId ?? null;
    if (woId != null && currentWorkOrderId != null && woId === currentWorkOrderId) continue;

    const woLabel = row.workOrderNo?.trim() || (woId ? `WO-${woId}` : "Other work order");
    const mapKey = woId != null ? `wo-${woId}` : `other-${row.pmrId ?? row.pmrDocNo ?? woLabel}`;

    const existing = byWo.get(mapKey);
    if (existing) {
      existing.committedQty += qty;
      continue;
    }

    byWo.set(mapKey, {
      key: mapKey,
      workOrderId: woId,
      workOrderLabel: woLabel,
      customerLabel: null,
      committedQty: qty,
      pmrStatusLabel: pmrStatusLabelForCommitment(row),
      operationalStage: operationalStageFromCommitment(row),
    });
  }

  return [...byWo.values()].sort((a, b) => b.committedQty - a.committedQty);
}

export function stockCommittedElsewhereHeadline(physicalQty: number, unit?: string): string {
  const u = unit?.trim() ? ` ${unit}` : "";
  return `Physical stock is ${n(physicalQty).toLocaleString(undefined, { maximumFractionDigits: 3 })}${u} in store, but available stock is already committed to other work orders.`;
}

export function stockCommittedElsewhereSummary(): string {
  return "Available stock is already committed to other work orders. Store must complete procurement or wait for commitments to clear before issuing to this work order.";
}

/** Production-facing RM status (no reservation math). */
export type ProductionRmOperationalStatus =
  | "READY"
  | "WAITING_RM_ISSUE"
  | "PROCUREMENT_IN_PROGRESS"
  | "WAITING_GRN";

export function productionRmOperationalStatus(
  gate: string | null | undefined,
  opts?: { procurementInitiated?: boolean; waitingGrn?: boolean },
): { status: ProductionRmOperationalStatus; label: string; detail: string } {
  const g = String(gate ?? "").toUpperCase();
  if (opts?.waitingGrn) {
    return {
      status: "WAITING_GRN",
      label: "Waiting GRN",
      detail: "Material is on order — waiting for goods receipt at store.",
    };
  }
  if (opts?.procurementInitiated) {
    return {
      status: "PROCUREMENT_IN_PROGRESS",
      label: "Procurement in progress",
      detail: "Store is procuring RM for this work order.",
    };
  }
  if (g === "NO_PMR" || g === "PMR_DRAFT_ONLY") {
    return {
      status: "WAITING_RM_ISSUE",
      label: "Waiting for RM issue",
      detail: "Store must issue required RM before production can start.",
    };
  }
  if (g === "WAITING_STORE_ISSUE") {
    return {
      status: "WAITING_RM_ISSUE",
      label: "Waiting for Store RM Issue",
      detail: "Store must issue RM to production before you can save or approve production.",
    };
  }
  if (g === "PARTIAL_READY" || g === "FULLY_ISSUED_READY") {
    return {
      status: "READY",
      label: "Ready",
      detail: "RM is available for production entry.",
    };
  }
  return {
    status: "WAITING_RM_ISSUE",
    label: "Waiting for RM issue",
    detail: "Store is resolving RM for this work order.",
  };
}
