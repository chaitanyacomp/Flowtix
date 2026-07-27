import type { ProductionRmReadiness } from "../components/erp/ProductionRmReadinessStrip";
import { isProductionBlockedByRmReadiness } from "../components/erp/ProductionRmReadinessStrip";
import { resolveProductionEntryCapacityPhase } from "./productionEntryCapacityUx";

export type ProductionConciseRmLabel = "READY" | "PARTIAL" | "WAITING RM" | "COMPLETE";

export function deriveProductionConciseRmLabel(
  data: ProductionRmReadiness | null | undefined,
): ProductionConciseRmLabel | null {
  if (!data) return null;
  if (data.bomMissing) return "WAITING RM";

  const phase = resolveProductionEntryCapacityPhase({
    gate: data.gate,
    bomMissing: data.bomMissing,
    productionAllowedNowQty: data.productionAllowedNowQty,
    maxAdditionalQty: data.maxAdditionalQty,
    woQty: data.woQty,
    woRemainingQty: data.woRemainingQty,
    approvedProducedQty: data.approvedProducedQty,
    rmSupportedCumulativeCapacityQty: data.rmSupportedCumulativeCapacityQty,
  });

  if (phase === "QUANTITY_COMPLETED") return "COMPLETE";
  if (phase === "WAITING_RM") return "WAITING RM";

  if (data.gate === "READY_FOR_PRODUCTION") return "READY";
  if (!isProductionBlockedByRmReadiness(data)) return "READY";
  return "WAITING RM";
}

export function productionConciseRmTone(
  label: ProductionConciseRmLabel,
): "ready" | "partial" | "waiting" | "complete" {
  if (label === "READY") return "ready";
  if (label === "PARTIAL") return "partial";
  if (label === "COMPLETE") return "complete";
  return "waiting";
}
