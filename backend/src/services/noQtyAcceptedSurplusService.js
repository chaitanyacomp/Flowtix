const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");
const { getProductionBatchQcPendingQty } = require("./reportMetrics");

const EPS = 1e-6;
const round3 = (value) => Math.round((Number(value) || 0) * 1000) / 1000;

function computeAcceptedSurplusBalance(input) {
  const accepted = Math.max(0, round3(input.priorAcceptedQty));
  const demand = Math.max(0, round3(input.priorCustomerDemandQty));
  const dispatched = Math.max(0, round3(input.priorNetDispatchedQty));
  const gross = Math.max(0, round3(accepted - demand));
  const acceptedRemaining = Math.max(0, round3(accepted - dispatched));
  // Demand and dispatch are overlapping consumption views, so dispatch caps the surplus;
  // it is not subtracted a second time from accepted - demand.
  const available = Math.max(0, round3(Math.min(gross, acceptedRemaining)));
  const grossRequirement = Math.max(0, round3(input.currentGrossRequirementQty));
  const allocated = Math.max(0, round3(Math.min(available, grossRequirement)));
  return {
    priorAcceptedQty: accepted,
    priorCustomerDemandQty: demand,
    priorNetDispatchedQty: dispatched,
    grossAcceptedSurplusQty: gross,
    acceptedRemainingQty: acceptedRemaining,
    availableAcceptedSurplusQty: available,
    allocatedAcceptedSurplusQty: allocated,
    unusedAcceptedSurplusQty: Math.max(0, round3(available - allocated)),
    currentGrossRequirementQty: grossRequirement,
    netProductionRequirementQty: Math.max(0, round3(grossRequirement - allocated)),
  };
}

/**
 * Canonical NO_QTY accepted-surplus reconstruction for a target cycle.
 * All calculations are scoped by SO + FG and use only prior cycles.
 */
async function loadNoQtyAcceptedSurplusForCycle(db, input) {
  const salesOrderId = Number(input?.salesOrderId);
  const targetCycleId = Number(input?.targetCycleId);
  if (!(salesOrderId > 0) || !(targetCycleId > 0)) return new Map();

  const [so, targetCycle] = await Promise.all([
    db.salesOrder.findUnique({ where: { id: salesOrderId }, select: { orderType: true } }),
    db.salesOrderCycle.findFirst({
      where: { id: targetCycleId, salesOrderId },
      select: { id: true, cycleNo: true },
    }),
  ]);
  if (so?.orderType !== "NO_QTY" || !targetCycle) return new Map();

  const priorCycles = await db.salesOrderCycle.findMany({
    where: { salesOrderId, cycleNo: { lt: targetCycle.cycleNo } },
    select: { id: true },
  });
  const priorCycleIds = priorCycles.map((row) => Number(row.id)).filter((id) => id > 0);
  if (!priorCycleIds.length) return new Map();

  const [sheets, productions, dispatches] = await Promise.all([
    db.requirementSheet.findMany({
      where: { salesOrderId, cycleId: { in: priorCycleIds }, status: "LOCKED" },
      orderBy: [{ cycleId: "asc" }, { version: "desc" }, { id: "desc" }],
      select: {
        id: true,
        cycleId: true,
        version: true,
        lines: { select: { itemId: true, requirementQty: true, baseDemandQty: true } },
      },
    }),
    db.productionEntry.findMany({
      where: {
        workflowStatus: "APPROVED",
        workOrderLine: { workOrder: { salesOrderId, cycleId: { in: priorCycleIds }, status: { not: "REJECTED" } } },
      },
      select: {
        producedQty: true,
        workOrderLine: { select: { fgItemId: true } },
        qcEntries: { where: QC_ENTRY_ACTIVE_WHERE, select: { acceptedQty: true, rejectedQty: true } },
      },
    }),
    db.dispatch.findMany({
      where: { soId: salesOrderId, cycleId: { in: priorCycleIds }, workflowStatus: "LOCKED" },
      select: { itemId: true, dispatchedQty: true },
    }),
  ]);

  // Only the highest locked non-cancelled version per cycle contributes customer demand.
  const winningSheetByCycle = new Map();
  for (const sheet of sheets) if (!winningSheetByCycle.has(Number(sheet.cycleId))) winningSheetByCycle.set(Number(sheet.cycleId), sheet);

  const demandByItem = new Map();
  for (const sheet of winningSheetByCycle.values()) for (const line of sheet.lines || []) {
    const itemId = Number(line.itemId);
    const qty = Math.max(0, round3(line.baseDemandQty ?? line.requirementQty));
    if (itemId > 0) demandByItem.set(itemId, round3((demandByItem.get(itemId) || 0) + qty));
  }

  const acceptedByItem = new Map();
  const pendingQcByItem = new Map();
  for (const production of productions) {
    const itemId = Number(production.workOrderLine?.fgItemId);
    if (!(itemId > 0)) continue;
    let accepted = 0;
    let rejected = 0;
    for (const qc of production.qcEntries || []) {
      accepted += Number(qc.acceptedQty) || 0;
      rejected += Number(qc.rejectedQty) || 0;
    }
    acceptedByItem.set(itemId, round3((acceptedByItem.get(itemId) || 0) + accepted));
    const pending = getProductionBatchQcPendingQty(Number(production.producedQty) || 0, accepted, rejected);
    pendingQcByItem.set(itemId, round3((pendingQcByItem.get(itemId) || 0) + pending));
  }

  const dispatchedByItem = new Map();
  for (const row of dispatches) {
    const itemId = Number(row.itemId);
    if (itemId > 0) dispatchedByItem.set(itemId, round3((dispatchedByItem.get(itemId) || 0) + (Number(row.dispatchedQty) || 0)));
  }

  const grossByItem = input?.grossRequirementByItem instanceof Map ? input.grossRequirementByItem : new Map();
  const itemIds = new Set([...demandByItem.keys(), ...acceptedByItem.keys(), ...grossByItem.keys()]);
  const result = new Map();
  for (const itemId of itemIds) {
    const balance = computeAcceptedSurplusBalance({
      priorAcceptedQty: acceptedByItem.get(itemId) || 0,
      priorCustomerDemandQty: demandByItem.get(itemId) || 0,
      priorNetDispatchedQty: dispatchedByItem.get(itemId) || 0,
      currentGrossRequirementQty: grossByItem.get(itemId) || 0,
    });
    result.set(itemId, { ...balance, pendingQcQty: Math.max(0, round3(pendingQcByItem.get(itemId) || 0)) });
  }
  return result;
}

module.exports = { EPS, computeAcceptedSurplusBalance, loadNoQtyAcceptedSurplusForCycle };
