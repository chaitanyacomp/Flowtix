/**
 * Shared NO_QTY Requirement Sheet display/compute helpers for the FG workbench grid.
 * Re-exports cycle summary helpers; mirrors RS page draft qty composition (no decision logic).
 */
export {
  allCyclesQtyForItem,
  previousCyclesQtyForItem,
  type NoQtyRsCycleSummaryEntry,
} from "./noQtyRsCycleSummary";

export const PLAN_EPS = 1e-6;

export function safeNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Operational USABLE for planning UI — floor at 0. */
export function usableDisplayStock(v: unknown): number {
  return Math.max(0, safeNum(v));
}

export function fmtPlan(n: number, unit?: string | null): string {
  const s = n.toFixed(3).replace(/\.000$/, "");
  return unit ? `${s} ${unit}` : s;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Line shape needed for draft production required (subset of RS sheet line). */
export type DraftProductionLine = {
  newWoQty?: string | number | null;
  requirementQty?: string | number | null;
  baseDemandQty?: string | number | null;
  totalRsQty?: string | number | null;
  productionShortfallQty?: string | number | null;
  shortfallQty?: string | number | null;
  qcRejectionRecoveryQty?: string | number | null;
  approvedManualAdjustmentQty?: string | number | null;
  availableStockQty?: string | number | null;
  postCycleApprovalQty?: string | number | null;
  fulfillmentQty?: string | number | null;
};

/**
 * Draft: matches backend `productionRequiredQty` / `totalRsQty` composition.
 * NO_QTY: base + production shortfall + QC recovery (+ adj); shortfall applies even when base = 0.
 */
export function computeDraftProductionRequired(line: DraftProductionLine, isNoQtyOrder: boolean): number {
  const newWo = safeNum(line.newWoQty ?? line.requirementQty ?? line.baseDemandQty);
  if (isNoQtyOrder) {
    if (line.totalRsQty != null && Number.isFinite(Number(line.totalRsQty)) && safeNum(line.totalRsQty) > PLAN_EPS) {
      return Math.max(0, Math.round(safeNum(line.totalRsQty) * 1000) / 1000);
    }
    const short = safeNum(line.productionShortfallQty ?? line.shortfallQty);
    const qc = safeNum(line.qcRejectionRecoveryQty);
    const adj = safeNum(line.approvedManualAdjustmentQty);
    return Math.max(0, Math.round((short + newWo + qc + adj) * 1000) / 1000);
  }
  const stock = usableDisplayStock(line.availableStockQty);
  const post = safeNum(line.postCycleApprovalQty);
  const gross =
    line.fulfillmentQty != null && Number.isFinite(Number(line.fulfillmentQty))
      ? safeNum(line.fulfillmentQty)
      : safeNum(line.shortfallQty) + newWo;
  const r = gross > PLAN_EPS ? gross : 0;
  const gapPercent = r > 0 ? round2(((r - stock) / r) * 100) : null;
  let pr = Math.max(0, Math.round((gross - post - stock) * 1000) / 1000);
  if (gapPercent != null && gapPercent < 0) pr = 0;
  return pr;
}

/**
 * Live preview of accepted-surplus allocation for the current draft demand edit.
 * Mirrors backend `computeAcceptedSurplusBalance` allocation against a known available pool
 * (`allocated + unused` from the last authoritative server response).
 *
 * Net Production Requirement =
 *   max(Customer Demand + Kept Recovery − Prior Accepted Excess allocated, 0)
 */
export function computeLiveNetProductionRequirement(input: {
  customerDemandQty: number;
  keptProductionShortageQty?: number;
  keptQcRejectionQty?: number;
  approvedManualAdjustmentQty?: number;
  /** Allocated excess from last server response. */
  priorAcceptedExcessQty?: number;
  /** Unused remainder from last server response. */
  unusedAcceptedExcessQty?: number;
  /** Optional explicit available pool (preferred when present). */
  availableAcceptedSurplusQty?: number | null;
}): {
  grossRequirementQty: number;
  availableAcceptedSurplusQty: number;
  allocatedAcceptedSurplusQty: number;
  unusedAcceptedSurplusQty: number;
  netProductionRequirementQty: number;
} {
  const demand = Math.max(0, round3(safeNum(input.customerDemandQty)));
  const ps = Math.max(0, round3(safeNum(input.keptProductionShortageQty)));
  const qc = Math.max(0, round3(safeNum(input.keptQcRejectionQty)));
  const adj = Math.max(0, round3(safeNum(input.approvedManualAdjustmentQty)));
  const gross = Math.max(0, round3(demand + ps + qc + adj));

  const availableExplicit =
    input.availableAcceptedSurplusQty != null && Number.isFinite(Number(input.availableAcceptedSurplusQty))
      ? Math.max(0, round3(safeNum(input.availableAcceptedSurplusQty)))
      : null;
  const available =
    availableExplicit != null
      ? availableExplicit
      : Math.max(
          0,
          round3(safeNum(input.priorAcceptedExcessQty) + safeNum(input.unusedAcceptedExcessQty)),
        );
  const allocated = Math.max(0, round3(Math.min(available, gross)));
  return {
    grossRequirementQty: gross,
    availableAcceptedSurplusQty: available,
    allocatedAcceptedSurplusQty: allocated,
    unusedAcceptedSurplusQty: Math.max(0, round3(available - allocated)),
    netProductionRequirementQty: Math.max(0, round3(gross - allocated)),
  };
}
