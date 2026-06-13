/**
 * P7A / P7F-B — Purchase Planning physical receipt coverage UX helpers.
 */

import { MP_PROCUREMENT } from "./monthlyPlanningProcurementLabels";

export type ReceiptCoverageStatus =
  | "FULLY_COVERED"
  | "PARTIALLY_COVERED"
  | "NOT_RECEIVED"
  | "OVER_COVERED";

export type ReceiptCoverageTotals = {
  requirementQty: number;
  releasedQty: number;
  poQty: number;
  receivedQty: number;
  pendingReceiptQty: number;
  physicalCoveragePct: number | null;
};

export type ReceiptCoverageLine = ReceiptCoverageTotals & {
  rmItemId: number;
  receiptCoverageStatus: ReceiptCoverageStatus;
  receiptCoverageStatusLabel: string;
};

export const RECEIPT_COVERAGE_STATUS_META: Record<
  ReceiptCoverageStatus,
  { label: string; cls: string }
> = {
  NOT_RECEIVED: { label: "Pending Receipt", cls: "bg-slate-100 text-slate-600" },
  PARTIALLY_COVERED: { label: "Partially Received", cls: "bg-amber-100 text-amber-800" },
  FULLY_COVERED: { label: "Fully Received", cls: "bg-emerald-100 text-emerald-800" },
  OVER_COVERED: { label: "Over Received", cls: "bg-sky-100 text-sky-800" },
};

export function formatReceiptStatusLabel(status: ReceiptCoverageStatus): string {
  return RECEIPT_COVERAGE_STATUS_META[status]?.label ?? "Pending Receipt";
}

export function formatPhysicalCoveragePct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(Number(pct))) return "—";
  return `${Number(pct).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

export function physicalReceiptCoverageBannerLine(physicalCoveragePct: number | null | undefined): string {
  const label = formatPhysicalCoveragePct(physicalCoveragePct);
  return `${MP_PROCUREMENT.PHYSICAL_RECEIPT_COVERAGE_PCT}: ${label}`;
}

export function physicalReceiptCoverageSectionIntro(): string {
  return `Tracks ${MP_PROCUREMENT.RECEIVED_QTY.toLowerCase()} through GRN against the ${MP_PROCUREMENT.REQUIREMENT_SNAPSHOT.toLowerCase()}.`;
}

export function physicalReceiptCoverageDetailMessage(
  physicalCoveragePct: number | null | undefined,
): string | null {
  if (physicalCoveragePct == null || !Number.isFinite(Number(physicalCoveragePct))) return null;
  const pct = Number(physicalCoveragePct);
  if (pct > 100 + 1e-6) {
    return "Received quantity exceeds approved requirement snapshot.";
  }
  if (pct >= 100 - 1e-6) {
    return `${MP_PROCUREMENT.RECEIVED_QTY} meets or exceeds the ${MP_PROCUREMENT.REQUIREMENT_SNAPSHOT.toLowerCase()}.`;
  }
  if (pct <= 1e-9) {
    return `${MP_PROCUREMENT.DEMAND_RELEASED} — no ${MP_PROCUREMENT.RECEIVED_QTY.toLowerCase()} recorded yet.`;
  }
  return `${MP_PROCUREMENT.RECEIVED_QTY} in progress against the ${MP_PROCUREMENT.REQUIREMENT_SNAPSHOT.toLowerCase()}.`;
}

export type PendingReceiptQtyDisplay = {
  value: string;
  /** User-facing KPI/column label for this row. */
  label: string;
  overReceived: boolean;
  hint: string | null;
};

/** Clarifies negative pending qty (over-receipt) without changing underlying values. */
export function formatPendingReceiptQtyDisplay(pendingQty: number): PendingReceiptQtyDisplay {
  const n = Number(pendingQty);
  if (!Number.isFinite(n)) {
    return {
      value: "—",
      label: MP_PROCUREMENT.PENDING_RECEIPT_QTY,
      overReceived: false,
      hint: null,
    };
  }
  if (n < -1e-6) {
    return {
      value: Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 3 }),
      label: MP_PROCUREMENT.OVER_RECEIVED_QTY,
      overReceived: true,
      hint: "Received quantity exceeds approved requirement snapshot.",
    };
  }
  return {
    value: n.toLocaleString(undefined, { maximumFractionDigits: 3 }),
    label: MP_PROCUREMENT.PENDING_RECEIPT_QTY,
    overReceived: false,
    hint: null,
  };
}

export function lookupReceiptCoverageForLine(
  line: {
    rmItemId: number;
    poQty?: number;
    receivedQty?: number;
    pendingReceiptQty?: number;
    physicalCoveragePct?: number | null;
    receiptCoverageStatus?: ReceiptCoverageStatus;
    receiptCoverageStatusLabel?: string;
  },
  byRmItemId?: Record<number, ReceiptCoverageLine>,
): Pick<
  ReceiptCoverageLine,
  "poQty" | "receivedQty" | "pendingReceiptQty" | "physicalCoveragePct" | "receiptCoverageStatus" | "receiptCoverageStatusLabel"
> {
  const fromLine =
    line.poQty != null
      ? {
          poQty: line.poQty,
          receivedQty: line.receivedQty ?? 0,
          pendingReceiptQty: line.pendingReceiptQty ?? 0,
          physicalCoveragePct: line.physicalCoveragePct ?? null,
          receiptCoverageStatus: line.receiptCoverageStatus ?? "NOT_RECEIVED",
          receiptCoverageStatusLabel:
            line.receiptCoverageStatusLabel ??
            formatReceiptStatusLabel(line.receiptCoverageStatus ?? "NOT_RECEIVED"),
        }
      : null;
  const fromMap = byRmItemId?.[line.rmItemId];
  if (fromLine) return fromLine as ReceiptCoverageLine;
  if (fromMap) {
    return {
      poQty: fromMap.poQty,
      receivedQty: fromMap.receivedQty,
      pendingReceiptQty: fromMap.pendingReceiptQty,
      physicalCoveragePct: fromMap.physicalCoveragePct,
      receiptCoverageStatus: fromMap.receiptCoverageStatus,
      receiptCoverageStatusLabel: fromMap.receiptCoverageStatusLabel,
    };
  }
  return {
    poQty: 0,
    receivedQty: 0,
    pendingReceiptQty: 0,
    physicalCoveragePct: null,
    receiptCoverageStatus: "NOT_RECEIVED",
    receiptCoverageStatusLabel: formatReceiptStatusLabel("NOT_RECEIVED"),
  };
}
