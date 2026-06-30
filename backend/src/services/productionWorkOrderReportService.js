/**
 * Work-order production report — read-only audit view of FG production + RM consumption authority.
 * REGULAR: immutable ProductionEntryRmConsumption snapshots are the consumption authority.
 * Issued / returnable RM derived from existing material issue + return ledgers.
 */

const { prisma } = require("../utils/prisma");
const { AuditAction, AuditEntityType } = require("../prismaClientPackage");
const { qtyToNumber } = require("./rmPurchaseHelpers");
const { round3 } = require("./bomExplosionService");
const { computeExecutionSummary } = require("./productionExecutionService");
const { buildReturnableLinesForWorkOrder } = require("./materialReturnService");
const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");

const EPS = 1e-6;

function n(v) {
  return qtyToNumber(v);
}

async function loadApprovedByMap(db, productionEntryIds) {
  const map = new Map();
  if (!productionEntryIds.length) return map;
  const ids = [...new Set(productionEntryIds)].map(String);
  const logs = await db.auditLog.findMany({
    where: {
      entityType: AuditEntityType.PRODUCTION_ENTRY,
      action: AuditAction.APPROVE,
      entityId: { in: ids },
    },
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  for (const log of logs) {
    if (!log.entityId || map.has(log.entityId)) continue;
    map.set(log.entityId, log.actor?.name ?? null);
  }
  return map;
}

function sumQcForProduction(prod) {
  let acceptedQty = 0;
  let rejectedQty = 0;
  for (const qc of prod.qcEntries || []) {
    acceptedQty += n(qc.acceptedQty);
    rejectedQty += n(qc.rejectedQty);
  }
  const producedQty = n(prod.producedQty);
  const pendingQcQty = round3(Math.max(0, producedQty - acceptedQty - rejectedQty));
  return {
    acceptedQty: round3(acceptedQty),
    rejectedQty: round3(rejectedQty),
    pendingQcQty: pendingQcQty > EPS ? pendingQcQty : 0,
  };
}

function mapBatchRow(prod, approvedByName) {
  const wol = prod.workOrderLine;
  const qc = sumQcForProduction(prod);
  return {
    productionEntryId: prod.id,
    productionEntryDocNo: prod.docNo ?? `PE-${prod.id}`,
    productionDate: prod.date,
    workOrderLineId: wol?.id ?? null,
    fgItemId: wol?.fgItemId ?? null,
    fgItemName: wol?.fgItem?.itemName ?? null,
    producedQty: round3(n(prod.producedQty)),
    acceptedQty: qc.acceptedQty,
    rejectedQty: qc.rejectedQty,
    pendingQcQty: qc.pendingQcQty,
    approvedByName,
    rmLines: (prod.rmConsumptions || []).map((c) => ({
      itemId: c.itemId,
      itemName: c.item?.itemName ?? `Item #${c.itemId}`,
      unit: c.item?.unit ?? "",
      standardQty: round3(n(c.standardQty)),
      actualQty: round3(n(c.actualQty)),
      varianceQty: round3(n(c.varianceQty)),
      variancePercent: c.variancePercent != null ? round3(n(c.variancePercent)) : null,
      consumptionType: c.consumptionType ?? null,
      remarks: c.remarks ?? null,
    })),
  };
}

function aggregateRmAuthorityLines(batches) {
  /** @type {Map<number, { itemId: number, itemName: string, unit: string, standardQty: number, actualQty: number, varianceQty: number }>} */
  const byItem = new Map();
  for (const batch of batches) {
    for (const ln of batch.rmLines || []) {
      const prev = byItem.get(ln.itemId);
      if (!prev) {
        byItem.set(ln.itemId, {
          itemId: ln.itemId,
          itemName: ln.itemName,
          unit: ln.unit,
          standardQty: ln.standardQty,
          actualQty: ln.actualQty,
          varianceQty: ln.varianceQty,
        });
      } else {
        prev.standardQty = round3(prev.standardQty + ln.standardQty);
        prev.actualQty = round3(prev.actualQty + ln.actualQty);
        prev.varianceQty = round3(prev.varianceQty + ln.varianceQty);
      }
    }
  }
  return [...byItem.values()].sort((a, b) => a.itemId - b.itemId);
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} workOrderId
 */
async function buildWorkOrderProductionReport(db = prisma, workOrderId) {
  const id = Number(workOrderId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error("Invalid work order id");
    err.statusCode = 400;
    throw err;
  }

  const wo = await db.workOrder.findUnique({
    where: { id },
    include: {
      lines: { include: { fgItem: { select: { id: true, itemName: true, unit: true } } } },
      salesOrder: {
        select: {
          id: true,
          docNo: true,
          orderType: true,
          customer: { select: { name: true } },
        },
      },
      requirementSheet: { select: { id: true, docNo: true, cycleId: true } },
      cycle: { select: { id: true, cycleNo: true } },
      productionExecution: {
        include: {
          completedBy: { select: { name: true } },
          blockedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!wo) {
    const err = new Error("Work order not found");
    err.statusCode = 404;
    throw err;
  }

  const orderType = wo.salesOrder?.orderType ?? "NORMAL";
  const isRegular = orderType !== "NO_QTY";
  const lineIds = wo.lines.map((l) => l.id);

  const productions = lineIds.length
    ? await db.productionEntry.findMany({
        where: { workOrderLineId: { in: lineIds }, workflowStatus: "APPROVED" },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        include: {
          workOrderLine: { include: { fgItem: { select: { id: true, itemName: true, unit: true } } } },
          qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
          rmConsumptions: { include: { item: { select: { id: true, itemName: true, unit: true } } } },
        },
      })
    : [];

  const approvedBy = await loadApprovedByMap(
    db,
    productions.map((p) => p.id),
  );
  const batches = productions.map((p) =>
    mapBatchRow(p, approvedBy.get(String(p.id)) ?? null),
  );

  const executionSummary = await computeExecutionSummary(db, wo);
  const exec = wo.productionExecution;

  let rmLedger = { lines: [] };
  if (productions.length > 0 || exec) {
    try {
      rmLedger = await buildReturnableLinesForWorkOrder(db, { workOrderId: id });
    } catch {
      rmLedger = { lines: [] };
    }
  }

  const authorityByItem = aggregateRmAuthorityLines(batches);
  const authorityMap = new Map(authorityByItem.map((r) => [r.itemId, r]));

  const rmLines = (rmLedger.lines || []).map((ln) => {
    const auth = authorityMap.get(ln.itemId);
    return {
      itemId: ln.itemId,
      itemName: ln.itemName,
      unit: ln.unit,
      issuedQty: ln.grossIssuedQty,
      ledgerConsumedQty: ln.consumedQty,
      returnedQty: ln.returnedQty,
      returnableQty: ln.returnableQty,
      unusedQty: ln.unusedQty,
      standardQty: auth?.standardQty ?? null,
      reportedConsumedQty: auth?.actualQty ?? null,
      varianceQty: auth?.varianceQty ?? null,
    };
  });

  for (const auth of authorityByItem) {
    if (rmLines.some((r) => r.itemId === auth.itemId)) continue;
    rmLines.push({
      itemId: auth.itemId,
      itemName: auth.itemName,
      unit: auth.unit,
      issuedQty: null,
      ledgerConsumedQty: null,
      returnedQty: null,
      returnableQty: null,
      unusedQty: null,
      standardQty: auth.standardQty,
      reportedConsumedQty: auth.actualQty,
      varianceQty: auth.varianceQty,
    });
  }
  rmLines.sort((a, b) => a.itemId - b.itemId);

  const primaryLine = wo.lines[0] ?? null;

  return {
    workOrderId: wo.id,
    workOrderNo: wo.docNo ?? `WO-${wo.id}`,
    workOrderStatus: wo.status,
    salesOrderId: wo.salesOrder?.id ?? null,
    salesOrderNo: wo.salesOrder?.docNo ?? null,
    salesOrderOrderType: orderType,
    customerName: wo.salesOrder?.customer?.name ?? null,
    requirementSheetId: wo.requirementSheet?.id ?? null,
    requirementSheetNo: wo.requirementSheet?.docNo ?? null,
    cycleId: wo.cycle?.id ?? wo.requirementSheet?.cycleId ?? null,
    cycleNo: wo.cycle?.cycleNo ?? null,
    fgItemId: primaryLine?.fgItemId ?? null,
    fgItemName: primaryLine?.fgItem?.itemName ?? null,
    fgUnit: primaryLine?.fgItem?.unit ?? null,
    isRegular,
    hasApprovedProduction: batches.length > 0,
    execution: {
      status: exec?.executionStatus ?? (isRegular ? null : "RUNNING"),
      blockReason: exec?.blockReason ?? null,
      blockRemarks: exec?.blockRemarks ?? null,
      blockedAt: exec?.blockedAt ?? null,
      blockedByName: exec?.blockedBy?.name ?? null,
      completedAt: exec?.completedAt ?? null,
      completedByName: exec?.completedBy?.name ?? null,
      startedAt: exec?.createdAt ?? null,
      updatedAt: exec?.updatedAt ?? null,
    },
    summary: {
      plannedQty: executionSummary.plannedQty,
      producedQty: executionSummary.producedQty,
      remainderQty: executionSummary.remainderQty,
      surplusQty: executionSummary.surplusQty,
      productionPendingQty: executionSummary.productionPendingQty,
      lines: executionSummary.lines,
    },
    batches,
    rmLines,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildWorkOrderProductionReport,
  loadApprovedByMap,
  sumQcForProduction,
};
