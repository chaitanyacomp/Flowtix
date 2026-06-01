import type { OperationalSoAction } from "./operationalBlockers";
import type { DashboardProductionStatusSource } from "./dashboardProductionStatus";

export type DashboardOperationalCoverage = {
  soIds: Set<number>;
  woIds: Set<number>;
};

const MATERIAL_WAIT_GATES = new Set(["NO_PMR", "PMR_DRAFT_ONLY", "WAITING_STORE_ISSUE"]);

/** SO / WO ids that already have a primary action in Operational Blockers. */
export function coverageFromOperationalBlockers(
  actions: OperationalSoAction[] | null | undefined,
): DashboardOperationalCoverage {
  const soIds = new Set<number>();
  const woIds = new Set<number>();
  for (const row of actions ?? []) {
    if (row.salesOrderId > 0) soIds.add(row.salesOrderId);
    const woMatch = /[?&]workOrderId=(\d+)/.exec(row.actionTo);
    if (woMatch) woIds.add(Number(woMatch[1]));
  }
  return { soIds, woIds };
}

function isRegularProductionQueueRow(row: DashboardProductionStatusSource): boolean {
  if (row.orderType === "NO_QTY") return false;
  const bal = Number(row.balanceQty ?? 0);
  if (bal <= 1e-6) return false;
  const status = String(row.status ?? "").toUpperCase();
  return status === "PENDING" || status === "IN_PROGRESS";
}

function rowCoveredByBlockers(
  row: DashboardProductionStatusSource,
  coverage: DashboardOperationalCoverage,
): boolean {
  const soId = Number(row.salesOrderId ?? 0);
  const woId = Number(row.workOrderId ?? 0);
  if (soId > 0 && coverage.soIds.has(soId)) return true;
  if (woId > 0 && coverage.woIds.has(woId)) return true;
  return false;
}

/**
 * Hide the aggregate "Production pending — regular SO(s)" Operational Control card when
 * every regular production-queue SO already owns its action in Operational Blockers.
 */
export function shouldShowProductionPendingRegularControlCard(args: {
  woProdRegularSalesOrderIds: number[];
  hasOperationalBlockerCards: boolean;
  blockerCoverage: DashboardOperationalCoverage;
  prodQueue: DashboardProductionStatusSource[] | null | undefined;
}): boolean {
  if (args.woProdRegularSalesOrderIds.length === 0) return false;
  if (!args.hasOperationalBlockerCards) return true;

  const regularLines = (args.prodQueue ?? []).filter(isRegularProductionQueueRow);
  if (regularLines.length === 0) {
    return !args.woProdRegularSalesOrderIds.every((soId) => args.blockerCoverage.soIds.has(soId));
  }

  const materialWaitingLines = regularLines.filter((row) => {
    const gate = row.rmReadinessGate ?? null;
    return gate != null && MATERIAL_WAIT_GATES.has(gate);
  });

  if (materialWaitingLines.length > 0) {
    const allMaterialWaitingCovered = materialWaitingLines.every((row) =>
      rowCoveredByBlockers(row, args.blockerCoverage),
    );
    if (allMaterialWaitingCovered) {
      const uncoveredProdSo = args.woProdRegularSalesOrderIds.filter(
        (soId) => !args.blockerCoverage.soIds.has(soId),
      );
      return uncoveredProdSo.length > 0;
    }
  }

  return !args.woProdRegularSalesOrderIds.every((soId) => args.blockerCoverage.soIds.has(soId));
}

/** Operational Control column renders only when it has unique cards or NO_QTY continuation rows. */
export function operationalControlColumnHasContent(args: {
  neutralCardCount: number;
  regularCardCount: number;
  noQtyCardCount: number;
  hasVisibleNoQtyContinuation: boolean;
}): boolean {
  return (
    args.neutralCardCount > 0 ||
    args.regularCardCount > 0 ||
    args.noQtyCardCount > 0 ||
    args.hasVisibleNoQtyContinuation
  );
}
