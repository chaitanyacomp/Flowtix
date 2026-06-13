/**
 * P7F-C — Canonical Monthly Planning procurement vocabulary (presentation only).
 *
 * Stage model: Requirement Snapshot → Demand Released → Ordered → Received
 */

/** Standard KPI / column labels for Monthly Planning procurement surfaces. */
export const MP_PROCUREMENT = {
  REQUIREMENT_SNAPSHOT: "Requirement Snapshot",
  DEMAND_RELEASED: "Demand Released",
  ORDERED_QTY: "Ordered Qty",
  RECEIVED_QTY: "Received Qty",
  ADDITIONAL_REQUIREMENT: "Additional Requirement",
  REDUCTION_TOTAL: "Reduction Total",
  RELEASE_COVERAGE_PCT: "Release Coverage %",
  PHYSICAL_RECEIPT_COVERAGE_PCT: "Physical Receipt Coverage %",
  SUGGESTED_BUY_QTY: "Suggested Buy Qty",
  PENDING_RECEIPT_QTY: "Pending Receipt Qty",
  OVER_RECEIVED_QTY: "Over Received Qty",
  PENDING_OR_OVER_RECEIPT_QTY: "Pending / Over Received Qty",
  LINE_RECEIPT_COVERAGE_PCT: "Line Receipt Coverage %",
} as const;

export type MpReleaseStatus =
  | "NOT_RELEASED"
  | "PARTIALLY_RELEASED"
  | "FULLY_RELEASED"
  | "OVER_RELEASED";

export const MP_RELEASE_STATUS_META: Record<MpReleaseStatus, { label: string; cls: string }> = {
  NOT_RELEASED: { label: "Not Released", cls: "bg-slate-100 text-slate-600" },
  PARTIALLY_RELEASED: { label: "Partially Released", cls: "bg-amber-100 text-amber-800" },
  FULLY_RELEASED: { label: "Released", cls: "bg-emerald-100 text-emerald-800" },
  OVER_RELEASED: { label: "Over Released", cls: "bg-red-100 text-red-800" },
};

export function procurementProgressModelLine(): string {
  return `${MP_PROCUREMENT.REQUIREMENT_SNAPSHOT} → ${MP_PROCUREMENT.DEMAND_RELEASED} → Ordered → Received`;
}

export function purchasePlanningOperationalStatusMessage(
  additionalRequirementTotal: number,
  demandReleasedTotal = 0,
): string {
  if (additionalRequirementTotal > 1e-9) {
    return `Additional requirement pending — release delta to create new ${MP_PROCUREMENT.DEMAND_RELEASED.toLowerCase()}.`;
  }
  if (demandReleasedTotal > 1e-9) {
    return `${MP_PROCUREMENT.DEMAND_RELEASED} complete for this plan. Track Ordered → Received below.`;
  }
  return `Review requirement snapshot and release demand when the plan is approved (${procurementProgressModelLine()}).`;
}

export function purchasePlanningReductionMessageText(): string {
  return `Plan requires less RM than current ${MP_PROCUREMENT.DEMAND_RELEASED.toLowerCase()}. Open MR quantity will be reduced where possible.`;
}

export function releaseDeltaDisabledStatusMessage(
  additionalRequirementTotal: number,
  demandReleasedTotal: number,
  usesPlanDocumentUx: boolean,
): string {
  if (additionalRequirementTotal > 1e-9) return "";
  if (demandReleasedTotal > 1e-9) {
    return usesPlanDocumentUx
      ? `${MP_PROCUREMENT.DEMAND_RELEASED} complete — no additional release required.`
      : `${MP_PROCUREMENT.DEMAND_RELEASED} complete for this legacy plan snapshot.`;
  }
  return "No additional requirement to release.";
}

export function formatReleaseSuccessSummaryMessage(params: {
  planLabel: string;
  materialRequirementDocNo?: string | null;
  releasedLineCount: number;
  totalDeltaQty: number;
  skippedLineCount: number;
  surplusLineCount: number;
}): string {
  const mrPart = params.materialRequirementDocNo ? ` → MR ${params.materialRequirementDocNo}` : "";
  return `${MP_PROCUREMENT.DEMAND_RELEASED} from ${params.planLabel}${mrPart}: ${params.releasedLineCount} line(s) (${params.totalDeltaQty.toLocaleString()} qty), ${params.skippedLineCount} skipped, ${params.surplusLineCount} surplus. Next: Ordered → Received.`;
}

export function physicalReceiptProgressBannerLine(physicalCoveragePct: number | null | undefined): string {
  const pct =
    physicalCoveragePct != null && Number.isFinite(Number(physicalCoveragePct))
      ? `${Number(physicalCoveragePct).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
      : "—";
  return `${MP_PROCUREMENT.PHYSICAL_RECEIPT_COVERAGE_PCT}: ${pct} (Received vs ${MP_PROCUREMENT.REQUIREMENT_SNAPSHOT.toLowerCase()})`;
}
