/**
 * P7A — Purchase Planning physical receipt coverage UX helpers.
 */

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
  FULLY_COVERED: { label: "Fully Covered", cls: "bg-emerald-100 text-emerald-800" },
  PARTIALLY_COVERED: { label: "Partially Covered", cls: "bg-amber-100 text-amber-800" },
  NOT_RECEIVED: { label: "Not Received", cls: "bg-slate-100 text-slate-600" },
  OVER_COVERED: { label: "Over Covered", cls: "bg-sky-100 text-sky-800" },
};

export function formatPhysicalCoveragePct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(Number(pct))) return "—";
  return `${Number(pct).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

export function physicalReceiptCoverageBannerLine(physicalCoveragePct: number | null | undefined): string {
  const label = formatPhysicalCoveragePct(physicalCoveragePct);
  return `Physical receipt coverage: ${label}`;
}

export function physicalReceiptCoverageDetailMessage(
  physicalCoveragePct: number | null | undefined,
): string | null {
  if (physicalCoveragePct == null || !Number.isFinite(Number(physicalCoveragePct))) return null;
  const pct = Number(physicalCoveragePct);
  if (pct >= 100 - 1e-6) {
    return "All planned procurement has been received.";
  }
  if (pct <= 1e-9) {
    return "Procurement released but no receipts recorded.";
  }
  return "Procurement released. Physical receipts are partially completed.";
}

export function lookupReceiptCoverageForLine(
  line: { rmItemId: number; poQty?: number; receivedQty?: number; pendingReceiptQty?: number; physicalCoveragePct?: number | null; receiptCoverageStatus?: ReceiptCoverageStatus; receiptCoverageStatusLabel?: string },
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
          receiptCoverageStatusLabel: line.receiptCoverageStatusLabel ?? "Not Received",
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
    receiptCoverageStatusLabel: "Not Received",
  };
}
