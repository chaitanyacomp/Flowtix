import type { ProductionRmReadiness } from "../components/erp/ProductionRmReadinessStrip";
import { isProductionBlockedByRmReadiness } from "../components/erp/ProductionRmReadinessStrip";

export type ProductionConciseRmLabel = "READY" | "PARTIAL" | "WAITING RM";

export function deriveProductionConciseRmLabel(
  data: ProductionRmReadiness | null | undefined,
): ProductionConciseRmLabel | null {
  if (!data) return null;
  if (data.bomMissing) return "WAITING RM";
  if (data.gate === "READY_FOR_PRODUCTION") {
    return Number(data.productionAllowedNowQty ?? 0) > 0 ? "READY" : "WAITING RM";
  }
  if (data.gate === "WAITING_RELEASE_TO_PRODUCTION") return "WAITING RM";
  if (!isProductionBlockedByRmReadiness(data)) return "READY";
  return "WAITING RM";
}

export function productionConciseRmTone(label: ProductionConciseRmLabel): "ready" | "partial" | "waiting" {
  if (label === "READY") return "ready";
  if (label === "PARTIAL") return "partial";
  return "waiting";
}
