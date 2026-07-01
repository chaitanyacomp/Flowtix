import type { ProductionRmReadiness } from "../components/erp/ProductionRmReadinessStrip";
import { isProductionBlockedByRmReadiness } from "../components/erp/ProductionRmReadinessStrip";
import {
  filterExecutableProductionLines,
  sortProductionLinesFifo,
  type ProductionQueueLine,
} from "./productionWorkspaceQueue";

const EPS = 1e-6;

export type ProductionReadinessFetchResult = ProductionRmReadiness | { skipped: boolean } | null | undefined;

export function isFreshProductionReadinessExecutable(data: ProductionReadinessFetchResult): data is ProductionRmReadiness {
  if (!data || "skipped" in data) return false;
  if (data.bomMissing) return false;
  if (data.gate !== "READY_FOR_PRODUCTION") return false;
  if (isProductionBlockedByRmReadiness(data)) return false;
  return Number(data.productionAllowedNowQty ?? 0) > EPS;
}

export async function pickFreshExecutableProductionLine<T extends ProductionQueueLine>(
  lines: T[],
  fetchReadiness: (workOrderLineId: number) => Promise<ProductionReadinessFetchResult>,
): Promise<{ line: T; readiness: ProductionRmReadiness } | null> {
  const fifo = sortProductionLinesFifo(filterExecutableProductionLines(lines));
  for (const line of fifo) {
    const readiness = await fetchReadiness(line.id);
    if (isFreshProductionReadinessExecutable(readiness)) {
      return { line, readiness };
    }
  }
  return null;
}

