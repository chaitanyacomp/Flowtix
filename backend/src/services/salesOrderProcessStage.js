/**
 * Sales order operational flow stage (WO → Production → QC → Dispatch → Completed).
 * Single place for list/detail “current stage” — uses same quantity primitives as WO tracking / dispatch reports.
 */

const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const {
  getWoLineRemainingProductionQty,
  getProductionBatchQcPendingQty,
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
  computeSalesOrderDispatchLineStats,
} = require("./reportMetrics");

const EPS = 1e-6;

/** @typedef {{ key: string; label: string }} ProcessStage */

/**
 * Sum of finalized Sales Bill line qty per sales order (via dispatch.soId).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {number[]} soIds
 * @returns {Promise<Map<number, number>>}
 */
async function fetchInvoicedQtyBySoId(prisma, soIds) {
  /** @type {Map<number, number>} */
  const invoicedBySoId = new Map();
  const ids = (soIds || []).filter((id) => Number.isFinite(Number(id)) && Number(id) > 0);
  if (!ids.length) return invoicedBySoId;

  const bills = await prisma.salesBill.findMany({
    where: {
      status: "FINALIZED",
      dispatch: { soId: { in: ids } },
    },
    select: {
      dispatch: { select: { soId: true } },
      lines: { select: { qty: true } },
    },
  });
  for (const b of bills) {
    const soId = b.dispatch?.soId;
    if (!soId) continue;
    const qty = (b.lines || []).reduce((s, ln) => s + Number(ln.qty || 0), 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    invoicedBySoId.set(soId, (invoicedBySoId.get(soId) ?? 0) + qty);
  }
  return invoicedBySoId;
}

function resolvePostDispatchProcessStage(dispatchSummary, invoicedQty = 0) {
  const dispatched = Number(dispatchSummary?.totalDispatched ?? 0);
  const invoiced = Number(invoicedQty ?? 0);
  if (dispatched > EPS && invoiced + EPS < dispatched) {
    return { key: "SALES_BILL_PENDING", label: "Sales Bill pending" };
  }
  return { key: "COMPLETED", label: "Completed" };
}

/**
 * @param {{ lines?: { item?: { itemType?: string } }[] }} so
 */
function salesOrderHasFgLines(so) {
  return (so.lines || []).some((l) => l.item?.itemType === "FG");
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Array<object>} enrichedSalesOrders — rows already passed through enrichSalesOrderWithDispatchStats (lines + dispatch + dispatchSummary).
 * @param {{ invoicedQtyBySoId?: Map<number, number> | null }} [opts]
 * @returns {Promise<Array<object & { processStage: ProcessStage }>>}
 */
async function enrichSalesOrdersWithProcessStage(prisma, enrichedSalesOrders, opts = {}) {
  const list = enrichedSalesOrders || [];
  if (!list.length) return [];
  const invoicedQtyBySoId = opts.invoicedQtyBySoId instanceof Map ? opts.invoicedQtyBySoId : new Map();

  const byId = new Map();
  for (const so of list) byId.set(so.id, so);

  const ids = list.map((r) => r.id).filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) return list.map((r) => ({ ...r, processStage: { key: "UNKNOWN", label: "—" } }));

  const workOrders = await prisma.workOrder.findMany({
    where: { salesOrderId: { in: ids }, status: { not: "REJECTED" } },
    include: { lines: true },
  });

  const wolsBySo = new Map();
  const allWolIds = [];
  for (const wo of workOrders) {
    const so = byId.get(wo.salesOrderId);
    const isNoQty = so?.orderType === "NO_QTY";
    const currentCycleId = so?.currentCycleId != null ? Number(so.currentCycleId) : null;
    if (isNoQty) {
      if (!currentCycleId || currentCycleId <= 0) continue;
      if (!wo.cycleId || Number(wo.cycleId) !== currentCycleId) continue;
    }
    for (const l of wo.lines || []) {
      allWolIds.push(l.id);
      if (!wolsBySo.has(wo.salesOrderId)) wolsBySo.set(wo.salesOrderId, []);
      wolsBySo.get(wo.salesOrderId).push(l);
    }
  }

  const producedByWol = await getApprovedProducedQtyByWorkOrderLineIds(prisma, allWolIds);

  const soIdByWolId = new Map();
  for (const wo of workOrders) {
    for (const l of wo.lines || []) {
      soIdByWolId.set(l.id, wo.salesOrderId);
    }
  }

  const prodEntries = allWolIds.length
    ? await prisma.productionEntry.findMany({
        where: { workOrderLineId: { in: allWolIds }, workflowStatus: "APPROVED" },
        include: { qcEntries: true },
      })
    : [];

  const peBySo = new Map();
  for (const pe of prodEntries) {
    const soId = soIdByWolId.get(pe.workOrderLineId);
    if (soId == null) continue;
    if (!peBySo.has(soId)) peBySo.set(soId, []);
    peBySo.get(soId).push(pe);
  }

  return list.map((so) => {
    const isNoQty = so.orderType === "NO_QTY";
    const currentCycleId = so.currentCycleId != null ? Number(so.currentCycleId) : null;
    const dispatchForStage =
      isNoQty && currentCycleId && currentCycleId > 0
        ? (so.dispatch ?? []).filter((d) => Number(d.cycleId) === currentCycleId && d.workflowStatus === "LOCKED")
        : so.dispatch ?? [];
    const dispatchSummary =
      so.dispatchSummary != null && !isNoQty
        ? so.dispatchSummary
        : computeSalesOrderDispatchLineStats(so.lines ?? [], dispatchForStage, so.orderType).dispatchSummary;
    const invoicedQty = invoicedQtyBySoId.get(so.id) ?? Number(so.invoicedQty ?? 0);

    /** Replacement SOs: dispatch-only lifecycle (no WO / production / QC pipeline stages). */
    if (so.orderType === "REPLACEMENT") {
      if (so.internalStatus === "DRAFT") {
        return { ...so, processStage: { key: "DRAFT", label: "Draft" } };
      }
      if (dispatchSummary.fullyDispatched) {
        return { ...so, processStage: resolvePostDispatchProcessStage(dispatchSummary, invoicedQty) };
      }
      return { ...so, processStage: { key: "DISPATCH_PENDING", label: "Dispatch pending" } };
    }

    if (so.internalStatus === "DRAFT") {
      return { ...so, processStage: { key: "DRAFT", label: "Draft" } };
    }

    if (!salesOrderHasFgLines(so)) {
      if (dispatchSummary.fullyDispatched) {
        return { ...so, processStage: resolvePostDispatchProcessStage(dispatchSummary, invoicedQty) };
      }
      return { ...so, processStage: { key: "DISPATCH_PENDING", label: "Dispatch pending" } };
    }

    const wols = wolsBySo.get(so.id) || [];
    const hasWo = wols.length > 0;
    if (!hasWo) {
      return { ...so, processStage: { key: "WO_PENDING", label: "WO pending" } };
    }

    let productionPending = false;
    for (const l of wols) {
      const produced = producedByWol.get(l.id) || 0;
      if (getWoLineRemainingProductionQty(l.qty, produced) > EPS) {
        productionPending = true;
        break;
      }
    }
    if (productionPending) {
      return { ...so, processStage: { key: "PRODUCTION_PENDING", label: "Production pending" } };
    }

    const pes = peBySo.get(so.id) || [];
    let qcPending = false;
    for (const pe of pes) {
      const producedQty = Number(pe.producedQty ?? 0);
      const acc = sumActiveQcAcceptedQty(pe.qcEntries);
      const rej = sumActiveQcRejectedQty(pe.qcEntries);
      if (getProductionBatchQcPendingQty(producedQty, acc, rej) > EPS) {
        qcPending = true;
        break;
      }
    }
    if (qcPending) {
      return { ...so, processStage: { key: "QC_PENDING", label: "QA in progress" } };
    }

    if (!dispatchSummary.fullyDispatched) {
      return { ...so, processStage: { key: "DISPATCH_PENDING", label: "Dispatch pending" } };
    }

    return { ...so, processStage: resolvePostDispatchProcessStage(dispatchSummary, invoicedQty) };
  });
}

module.exports = {
  enrichSalesOrdersWithProcessStage,
  fetchInvoicedQtyBySoId,
  resolvePostDispatchProcessStage,
};
