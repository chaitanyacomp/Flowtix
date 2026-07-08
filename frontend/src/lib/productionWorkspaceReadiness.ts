import type { ProductionRmReadiness } from "../components/erp/ProductionRmReadinessStrip";
import { isProductionBlockedByRmReadiness } from "../components/erp/ProductionRmReadinessStrip";
import type { DashboardProductionStatusSource } from "./dashboardProductionStatus";
import {
  buildReadinessSeedFromQueueRow,
  isQueueRmGateBlocked,
  isQueueRmReadinessSufficient,
} from "./productionWorkspaceReadinessUx";
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

function queueRowAllowsFifoCandidate(
  line: ProductionQueueLine,
  queueByLineId?: Map<number, DashboardProductionStatusSource>,
): boolean {
  const queueRow = queueByLineId?.get(line.id);
  if (!queueRow) return true;
  if (isQueueRmGateBlocked(queueRow)) return false;
  const next = String(queueRow.nextAction ?? "").trim().toUpperCase();
  return next === "PRODUCTION_PENDING";
}

export async function pickFreshExecutableProductionLine<T extends ProductionQueueLine>(
  lines: T[],
  fetchReadiness: (workOrderLineId: number) => Promise<ProductionReadinessFetchResult>,
  queueByLineId?: Map<number, DashboardProductionStatusSource>,
): Promise<{ line: T; readiness: ProductionRmReadiness } | null> {
  const fifo = sortProductionLinesFifo(
    filterExecutableProductionLines(lines).filter((line) =>
      queueRowAllowsFifoCandidate(line, queueByLineId),
    ),
  );
  for (const line of fifo) {
    const queueRow = queueByLineId?.get(line.id);
    if (queueRow && isQueueRmReadinessSufficient(queueRow)) {
      const seeded = buildReadinessSeedFromQueueRow(queueRow);
      if (seeded && isFreshProductionReadinessExecutable(seeded)) {
        return { line, readiness: seeded };
      }
      if (seeded && !isFreshProductionReadinessExecutable(seeded)) {
        continue;
      }
    }
    const readiness = await fetchReadiness(line.id);
    if (isFreshProductionReadinessExecutable(readiness)) {
      return { line, readiness };
    }
  }
  return null;
}

