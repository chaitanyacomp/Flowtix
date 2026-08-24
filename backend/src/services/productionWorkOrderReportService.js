/**
 * Work-order production report — read-only audit view of FG production + RM consumption authority.
 * REGULAR: immutable ProductionEntryRmConsumption snapshots are the consumption authority.
 * Issued / returnable RM derived from existing material issue + return ledgers.
 */

const { prisma } = require("../utils/prisma");
const { AuditAction, AuditEntityType } = require("../prismaClientPackage");
const { qtyToNumber } = require("./rmPurchaseHelpers");
const { round3 } = require("./bomExplosionService");
const { buildReturnableLinesForWorkOrder, createMaterialReturnNote, resolveSuggestedRmReturnLocations } = require("./materialReturnService");
const { createMaterialWastageNote } = require("./materialWastageService");
const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");
const auditLog = require("./auditLog");
const { assertNoOpenProductionRmReturnPending } = require("./productionRmReturnPendingGuard");
const { listWastageTypes } = require("./wastageTypeService");
const {
  normalizeWastageDetailsInput,
  assertWastageClassificationMatches,
  mapWastageDetailRows,
} = require("./productionWastageClassificationService");

const EPS = 1e-6;
const RECONCILIATION_TOLERANCE = 0.0005;

function computeRmReconciliation({ issuedQty, consumedQty, returnedQty = 0, classifiedWastageQty = 0 }) {
  const issued = round3(n(issuedQty));
  const consumed = round3(n(consumedQty));
  const returned = round3(n(returnedQty));
  const wastage = round3(n(classifiedWastageQty));
  const physicalBalance = round3(Math.max(0, issued - consumed));
  const rawRemaining = round3(issued - consumed - returned - wastage);
  return {
    physicalBalance,
    remainingUnreconciled: Math.abs(rawRemaining) <= RECONCILIATION_TOLERANCE ? 0 : rawRemaining,
  };
}

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

function buildReportRequiredError() {
  const err = new Error("Confirm Production Report before closing the work order.");
  err.statusCode = 409;
  err.code = "PRODUCTION_REPORT_REQUIRED";
  return err;
}

function cleanRemarks(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeInputLines(lines) {
  const byItem = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const itemId = Number(line?.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) continue;
    byItem.set(itemId, {
      itemId,
      rmConsumedQty: line.rmConsumedQty == null ? null : round3(n(line.rmConsumedQty)),
      rmReturnQty: line.rmReturnQty == null ? 0 : round3(n(line.rmReturnQty)),
      scrapWasteQty: line.scrapWasteQty == null ? 0 : round3(n(line.scrapWasteQty)),
      varianceQty: line.varianceQty == null ? null : round3(n(line.varianceQty)),
      remarks: cleanRemarks(line.remarks),
    });
  }
  return byItem;
}

function mapConfirmedReportRow(row) {
  if (!row) {
    return {
      confirmed: false,
      reportId: null,
      status: null,
      confirmedAt: null,
      confirmedByUserId: null,
      confirmedByName: null,
      remarks: null,
      lines: [],
      returnPendings: [],
      wastageDetails: [],
    };
  }
  return {
    confirmed: row.status === "CONFIRMED",
    reportId: row.id,
    status: row.status,
    confirmedAt: row.confirmedAt,
    confirmedByUserId: row.confirmedByUserId ?? null,
    confirmedByName: row.confirmedBy?.name ?? null,
    remarks: row.remarks ?? null,
    plannedQty: round3(n(row.plannedQty)),
    producedQty: round3(n(row.producedQty)),
    remainingQty: round3(n(row.remainingQty)),
    productionResult: row.productionResult ?? null,
    lines: (row.lines || []).map((ln) => ({
      id: ln.id,
      itemId: ln.itemId,
      itemName: ln.item?.itemName ?? `Item #${ln.itemId}`,
      unit: ln.item?.unit ?? "",
      rmIssuedQty: round3(n(ln.rmIssuedQty)),
      rmConsumedQty: round3(n(ln.rmConsumedQty)),
      rmReturnQty: round3(n(ln.rmReturnQty)),
      scrapWasteQty: round3(n(ln.scrapWasteQty)),
      varianceQty: round3(n(ln.varianceQty)),
      runnerWasteQty: round3(n(ln.runnerWasteQty)),
      remarks: ln.remarks ?? null,
    })),
    returnPendings: (row.returnPendings || []).map((p) => ({
      id: p.id,
      workOrderId: p.workOrderId,
      workOrderNo: p.workOrder?.docNo ?? null,
      itemId: p.itemId,
      itemName: p.item?.itemName ?? `Item #${p.itemId}`,
      unit: p.item?.unit ?? "",
      requestedQty: round3(n(p.requestedQty)),
      status: p.status,
      materialReturnNoteId: p.materialReturnNoteId ?? null,
      materialReturnNoteNo: p.materialReturnNote?.docNo ?? null,
      receivedAt: p.receivedAt ?? null,
      receivedByName: p.receivedBy?.name ?? null,
      remarks: p.remarks ?? null,
      createdAt: p.createdAt,
    })),
    wastageDetails: mapWastageDetailRows(row.wastageDetails || []),
  };
}

async function loadConfirmedReport(db, workOrderId) {
  if (!db.productionWorkOrderReport?.findUnique) return null;
  const row = await db.productionWorkOrderReport.findUnique({
    where: { workOrderId },
    include: {
      confirmedBy: { select: { id: true, name: true } },
      lines: { include: { item: { select: { id: true, itemName: true, unit: true } } }, orderBy: { itemId: "asc" } },
      returnPendings: {
        include: {
          item: { select: { id: true, itemName: true, unit: true } },
          workOrder: { select: { id: true, docNo: true } },
          materialReturnNote: { select: { id: true, docNo: true } },
          receivedBy: { select: { id: true, name: true } },
        },
        orderBy: { id: "asc" },
      },
      wastageDetails: {
        include: { wastageType: { select: { id: true, code: true, name: true, category: true, isActive: true } }, item: { select: { id: true, itemName: true, unit: true } } },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
    },
  });
  return row;
}

async function assertProductionReportConfirmed(db, workOrderId) {
  const row = await db.productionWorkOrderReport.findUnique({
    where: { workOrderId },
    select: { id: true, status: true },
  });
  if (!row || row.status !== "CONFIRMED") throw buildReportRequiredError();
  return row;
}

/** Shared guard for work order completion and production execution finish paths. */
async function assertProductionReportConfirmedForCompletion(db, workOrderId) {
  return assertProductionReportConfirmed(db, workOrderId);
}

/**
 * Guards the single Production Report approval path — duplicate confirm is rejected.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} workOrderId
 */
async function assertProductionReportNotConfirmed(db, workOrderId) {
  const id = Number(workOrderId);
  const existing = await loadConfirmedReport(db, id);
  if (existing) {
    const err = new Error("Production Report is already confirmed for this work order.");
    err.statusCode = 409;
    err.code = "PRODUCTION_REPORT_ALREADY_CONFIRMED";
    throw err;
  }
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} workOrderId
 */
async function assertProductionReportHasApprovedEntries(db, workOrderId) {
  const report = await buildWorkOrderProductionReport(db, workOrderId);
  if (!report.hasApprovedProduction || report.summary.producedQty <= EPS) {
    const err = new Error("Record at least one approved production batch before confirming Production Report.");
    err.statusCode = 409;
    err.code = "PRODUCTION_REPORT_NO_APPROVED_ENTRIES";
    throw err;
  }
  return report;
}

async function countOpenProductionRmReturnPending(db, workOrderId) {
  return db.productionRmReturnPending.count({
    where: { workOrderId, status: "PENDING" },
  });
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

  const { computeExecutionSummary } = require("./productionExecutionService");
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
  // BOM line baseQty already contains its allocated runner share. Recover that
  // share for the report by applying the approved BOM runner/shot ratio to the
  // immutable theoretical consumption snapshot; this does not add RM again.
  const runnerWasteByItem = new Map();
  for (const batch of batches) {
    if (!batch.fgItemId) continue;
    const bom = db.bom?.findFirst ? await db.bom.findFirst({
      where: { fgItemId: batch.fgItemId, status: "APPROVED" },
      orderBy: { revisionNo: "desc" },
      select: { fgWeight: true, runnerWeight: true },
    }) : null;
    const shotWeight = n(bom?.fgWeight) + n(bom?.runnerWeight);
    const runnerRatio = shotWeight > EPS ? n(bom?.runnerWeight) / shotWeight : 0;
    for (const line of batch.rmLines || []) {
      runnerWasteByItem.set(line.itemId, round3(n(runnerWasteByItem.get(line.itemId)) + n(line.standardQty) * runnerRatio));
    }
  }

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
      availableForContinuationQty: Math.max(
        0,
        round3(n(ln.grossIssuedQty) - n(ln.consumedQty) - n(ln.returnedQty)),
      ),
      standardQty: auth?.standardQty ?? null,
      reportedConsumedQty: auth?.actualQty ?? null,
      varianceQty: auth?.varianceQty ?? null,
      runnerWasteQty: runnerWasteByItem.get(ln.itemId) ?? 0,
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
      availableForContinuationQty: null,
      standardQty: auth.standardQty,
      reportedConsumedQty: auth.actualQty,
      varianceQty: auth.varianceQty,
      runnerWasteQty: runnerWasteByItem.get(auth.itemId) ?? 0,
    });
  }
  rmLines.sort((a, b) => a.itemId - b.itemId);

  const primaryLine = wo.lines[0] ?? null;
  const confirmedReport = await loadConfirmedReport(db, id);

  const wastageTypes = db.wastageType?.findMany ? await listWastageTypes(db, { includeInactive: false }) : [];
  const totalWastageQty = confirmedReport
    ? round3((confirmedReport.lines || []).reduce((acc, ln) => acc + Math.max(0, n(ln.scrapWasteQty)), 0))
    : 0;
  const rmAvailableForContinuation = round3(
    (rmLines || []).reduce((acc, ln) => acc + Math.max(0, n(ln.availableForContinuationQty)), 0),
  );

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
    rmAvailableForContinuation,
    wastageTypes,
    totalWastageQty,
    confirmation: mapConfirmedReportRow(confirmedReport),
    generatedAt: new Date().toISOString(),
  };
}

async function confirmProductionWorkOrderReport(db, workOrderId, input = {}, actor = {}, options = {}) {
  const id = Number(workOrderId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error("Invalid work order id");
    err.statusCode = 400;
    throw err;
  }

  await assertProductionReportNotConfirmed(db, id);
  const report = await assertProductionReportHasApprovedEntries(db, id);
  const openDraftCount = db.productionEntry?.count ? await db.productionEntry.count({
    where: { workOrderLine: { workOrderId: id }, workflowStatus: "DRAFT" },
  }) : 0;
  if (openDraftCount > 0) {
    const err = new Error("Cancel or finalize every editable production draft before confirming the Production Report.");
    err.statusCode = 409;
    err.code = "PRODUCTION_REPORT_OPEN_DRAFT";
    throw err;
  }

  const inputByItem = normalizeInputLines(input.lines);
  const wastageDetails = normalizeWastageDetailsInput(input.wastageDetails);
  const wastageByItem = new Map();
  for (const row of wastageDetails) {
    if (!(row.itemId > 0) && report.rmLines.length === 1) row.itemId = report.rmLines[0].itemId;
    if (!(row.itemId > 0)) {
      const err = new Error("Every wastage detail must identify its RM item.");
      err.statusCode = 400;
      throw err;
    }
    wastageByItem.set(row.itemId, round3(n(wastageByItem.get(row.itemId)) + n(row.qty)));
  }
  const lineCreates = [];
  for (const rm of report.rmLines || []) {
    const issuedQty = rm.issuedQty == null ? 0 : round3(n(rm.issuedQty));
    const inputLine = inputByItem.get(rm.itemId) || {};
    const consumedQty =
      inputLine.rmConsumedQty != null
        ? inputLine.rmConsumedQty
        : round3(n(rm.reportedConsumedQty ?? rm.ledgerConsumedQty ?? 0));
    const returnQty = round3(n(inputLine.rmReturnQty ?? 0));
    const manualWasteQty = round3(n(wastageByItem.get(rm.itemId) ?? 0));
    const runnerWasteQty = round3(n(rm.runnerWasteQty ?? 0));
    const scrapWasteQty = manualWasteQty;
    const reconciliation = computeRmReconciliation({
      issuedQty,
      consumedQty,
      returnedQty: returnQty,
      classifiedWastageQty: scrapWasteQty,
    });
    const varianceQty = reconciliation.remainingUnreconciled;

    if (consumedQty < -EPS || returnQty < -EPS || scrapWasteQty < -EPS) {
      const err = new Error("Production Report quantities cannot be negative.");
      err.statusCode = 400;
      throw err;
    }
    if (returnQty > reconciliation.physicalBalance + RECONCILIATION_TOLERANCE) {
      const err = new Error(`RM return qty exceeds available physical balance (${reconciliation.physicalBalance} ${rm.unit || ""}) for ${rm.itemName || rm.itemId}.`);
      err.statusCode = 400;
      throw err;
    }
    if (Math.abs(varianceQty) > RECONCILIATION_TOLERANCE) {
      const err = new Error(`RM reconciliation is incomplete for ${rm.itemName || rm.itemId}: unexplained balance ${varianceQty} ${rm.unit || ""}. Allocate it to RM return and/or classified wastage before confirming.`);
      err.statusCode = 409;
      err.code = "PRODUCTION_REPORT_RM_RECONCILIATION_INCOMPLETE";
      throw err;
    }

    lineCreates.push({
      itemId: rm.itemId,
      rmIssuedQty: String(issuedQty),
      rmConsumedQty: String(round3(consumedQty)),
      rmReturnQty: String(returnQty),
      scrapWasteQty: String(scrapWasteQty),
      manualWasteQty,
      runnerWasteQty: String(runnerWasteQty),
      varianceQty: String(varianceQty),
      remarks: inputLine.remarks ?? null,
      itemName: rm.itemName,
      unit: rm.unit,
    });
  }

  const totalWastageQty = round3(lineCreates.reduce((acc, ln) => acc + n(ln.manualWasteQty), 0));
  const wastageUnit =
    lineCreates.find((ln) => n(ln.scrapWasteQty) > EPS && ln.unit)?.unit ||
    report.rmLines.find((ln) => ln.unit)?.unit ||
    "Kg";
  if (wastageDetails.length > 0 && db.wastageType?.findMany) {
    const activeTypes = await db.wastageType.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } });
    const activeTypeIds = new Set(activeTypes.map((row) => row.id));
    const typeById = new Map(activeTypes.map((row) => [row.id, row]));
    for (const row of wastageDetails) {
      if (!activeTypeIds.has(row.wastageTypeId)) {
        const err = new Error("One or more wastage types are inactive or invalid.");
        err.statusCode = 400;
        throw err;
      }
      const type = typeById.get(row.wastageTypeId);
      if (/^other$/i.test(String(type?.name || "").trim()) && !row.remarks) {
        const err = new Error("Remarks are required for Other wastage.");
        err.statusCode = 400;
        err.code = "OTHER_WASTAGE_REMARKS_REQUIRED";
        throw err;
      }
    }
  }
  assertWastageClassificationMatches(totalWastageQty, wastageDetails, wastageUnit);

  const created = await db.productionWorkOrderReport.create({
    data: {
      workOrderId: id,
      status: "CONFIRMED",
      plannedQty: String(report.summary.plannedQty),
      producedQty: String(report.summary.producedQty),
      remainingQty: String(report.summary.remainderQty),
      productionResult: report.summary.remainderQty > EPS ? "SHORTAGE" : report.summary.surplusQty > EPS ? "EXTRA" : "EQUAL",
      remarks: cleanRemarks(input.remarks),
      confirmedByUserId: actor.userId ?? actor.actorUserId ?? null,
      lines: {
        create: lineCreates.map((ln) => ({
          itemId: ln.itemId,
          rmIssuedQty: ln.rmIssuedQty,
          rmConsumedQty: ln.rmConsumedQty,
          rmReturnQty: ln.rmReturnQty,
          scrapWasteQty: ln.scrapWasteQty,
          varianceQty: ln.varianceQty,
          runnerWasteQty: ln.runnerWasteQty,
          remarks: ln.remarks,
        })),
      },
      ...(wastageDetails.length > 0 && db.productionWorkOrderReportWastageDetail?.create
        ? {
            wastageDetails: {
              create: wastageDetails.map((row, index) => ({
                wastageTypeId: row.wastageTypeId,
                itemId: row.itemId ?? null,
                source: "MANUAL_PRODUCTION",
                qty: String(row.qty),
                remarks: row.remarks,
                sortOrder: row.sortOrder ?? index,
              })),
            },
          }
        : {}),
    },
  });

  let returnPendingCount = 0;
  for (const line of lineCreates) {
    const qty = round3(n(line.rmReturnQty));
    if (qty <= EPS) continue;
    returnPendingCount += 1;
    await db.productionRmReturnPending.create({
      data: {
        productionReportId: created.id,
        workOrderId: id,
        itemId: line.itemId,
        requestedQty: String(qty),
        status: "PENDING",
        remarks: line.remarks,
      },
    });
  }

  // Post classified RM wastage once inside the same confirmation transaction.
  for (const line of lineCreates) {
    const scrapQty = round3(n(line.scrapWasteQty));
    if (scrapQty <= EPS) continue;
    const locations = await resolveSuggestedRmReturnLocations(db, {
      workOrderId: id,
      itemId: line.itemId,
    });
    const fromLocationId = locations?.suggestedFromLocationId ?? null;
    if (!fromLocationId) continue;
    try {
      await createMaterialWastageNote(
        {
          workOrderId: id,
          fromLocationId,
          itemId: line.itemId,
          qty: scrapQty,
          reason: "PROCESS_LOSS",
          remarks: `Auto-declared from Production Report confirm (wastage-only disposition).`,
        },
        actor,
        db,
      );
    } catch (err) {
      if (String(err?.message ?? "").includes("exceeds available returnable")) {
        continue;
      }
      throw err;
    }
  }

  const actorUserId = actor.userId ?? actor.actorUserId;
  if (typeof actorUserId === "number") {
    await auditLog.write(db, {
      action: auditLog.AuditAction.APPROVE,
      entityType: auditLog.AuditEntityType.WORK_ORDER,
      entityId: String(id),
      actorUserId,
      actorRole: actor.role ?? actor.actorRole,
      summary: `Production Report confirmed for ${report.workOrderNo}`,
      payload: {
        module: "PRODUCTION_REPORT",
        actionLabel: "CONFIRM",
        plannedQty: report.summary.plannedQty,
        producedQty: report.summary.producedQty,
        remainingQty: report.summary.remainderQty,
        returnPendingCount: lineCreates.filter((ln) => n(ln.rmReturnQty) > EPS).length,
      },
    });
  }

  const confirmed = await loadConfirmedReport(db, id);
  // The full report is a heavy read-only reconstruction (~21 queries). When the
  // caller owns the transaction (e.g. the confirm-and-close route) it passes
  // `includeReport: false` and rebuilds the response AFTER commit on the root
  // client, keeping the write transaction small. Standalone callers keep the
  // report inline (default) for backward compatibility.
  const includeReport = options.includeReport !== false;
  return {
    report: includeReport ? await buildWorkOrderProductionReport(db, id) : null,
    confirmation: mapConfirmedReportRow(confirmed),
    requiresShortfallDecision: report.summary.remainderQty > EPS,
    returnPendingCount,
    // Decision fields the transactional caller needs without a full rebuild,
    // sourced from the report already built during validation above.
    salesOrderOrderType: report.salesOrderOrderType,
    executionStatus: report.execution?.status ?? null,
    remainderQty: report.summary.remainderQty,
  };
}

async function listProductionRmReturnPending(db = prisma, { status = "PENDING", limit = 100, skipLocationResolution = false } = {}) {
  if (!db.productionRmReturnPending?.findMany) return [];
  const where = status ? { status } : {};
  const rows = await db.productionRmReturnPending.findMany({
    where,
    orderBy: [{ status: "asc" }, { id: "desc" }],
    take: limit,
    include: {
      productionReport: { select: { id: true, confirmedAt: true } },
      workOrder: {
        select: {
          id: true,
          docNo: true,
          sourceType: true,
          salesOrder: { select: { orderType: true } },
        },
      },
      item: { select: { id: true, itemName: true, unit: true } },
      materialReturnNote: { select: { id: true, docNo: true } },
      receivedBy: { select: { id: true, name: true } },
    },
  });
  if (skipLocationResolution) {
    return rows.map((p) => ({
      id: p.id,
      productionReportId: p.productionReportId,
      workOrderId: p.workOrderId,
      workOrderNo: p.workOrder?.docNo ?? `WO-${p.workOrderId}`,
      workOrderSourceType: p.workOrder?.sourceType ?? null,
      workOrderOrderType:
        String(p.workOrder?.sourceType ?? "").toUpperCase() === "GREEN_LEVEL_REPLENISHMENT"
          ? "GREEN_LEVEL"
          : (p.workOrder?.salesOrder?.orderType ?? null),
      itemId: p.itemId,
      itemName: p.item?.itemName ?? `Item #${p.itemId}`,
      unit: p.item?.unit ?? "",
      requestedQty: round3(n(p.requestedQty)),
      status: p.status,
      materialReturnNoteId: p.materialReturnNoteId ?? null,
      materialReturnNoteNo: p.materialReturnNote?.docNo ?? null,
      confirmedAt: p.productionReport?.confirmedAt ?? null,
      createdAt: p.createdAt,
      receivedAt: p.receivedAt ?? null,
      receivedByName: p.receivedBy?.name ?? null,
      remarks: p.remarks ?? null,
    }));
  }
  return Promise.all(
    rows.map(async (p) => {
      const base = {
        id: p.id,
        productionReportId: p.productionReportId,
        workOrderId: p.workOrderId,
        workOrderNo: p.workOrder?.docNo ?? `WO-${p.workOrderId}`,
        workOrderSourceType: p.workOrder?.sourceType ?? null,
        workOrderOrderType:
          String(p.workOrder?.sourceType ?? "").toUpperCase() === "GREEN_LEVEL_REPLENISHMENT"
            ? "GREEN_LEVEL"
            : (p.workOrder?.salesOrder?.orderType ?? null),
        itemId: p.itemId,
        itemName: p.item?.itemName ?? `Item #${p.itemId}`,
        unit: p.item?.unit ?? "",
        requestedQty: round3(n(p.requestedQty)),
        status: p.status,
        materialReturnNoteId: p.materialReturnNoteId ?? null,
        materialReturnNoteNo: p.materialReturnNote?.docNo ?? null,
        confirmedAt: p.productionReport?.confirmedAt ?? null,
        createdAt: p.createdAt,
        receivedAt: p.receivedAt ?? null,
        receivedByName: p.receivedBy?.name ?? null,
        remarks: p.remarks ?? null,
      };
      const locations = await resolveSuggestedRmReturnLocations(db, {
        workOrderId: p.workOrderId,
        itemId: p.itemId,
      });
      return { ...base, ...locations };
    }),
  );
}

async function buildRmDispositionSummaryForWorkOrder(db, workOrderId) {
  const report = await loadConfirmedReport(db, workOrderId);
  if (!report || report.status !== "CONFIRMED") {
    return { finalized: false, lines: [] };
  }
  const openPending = await countOpenProductionRmReturnPending(db, workOrderId);
  if (openPending > 0) {
    return { finalized: false, lines: [] };
  }
  return {
    finalized: true,
    lines: (report.lines ?? []).map((ln) => ({
      itemId: ln.itemId,
      itemName: ln.item?.itemName ?? `Item #${ln.itemId}`,
      unit: ln.item?.unit ?? "",
      issuedQty: round3(n(ln.rmIssuedQty)),
      consumedQty: round3(n(ln.rmConsumedQty)),
      returnedQty: round3(n(ln.rmReturnQty)),
      wastageQty: round3(n(ln.scrapWasteQty)),
      returnableQty: 0,
    })),
  };
}

async function receiveProductionRmReturnPending(input, actor = {}, db = prisma) {
  const pendingId = Number(input?.pendingId ?? input?.id);
  if (!Number.isFinite(pendingId) || pendingId <= 0) {
    const err = new Error("Invalid pending return id");
    err.statusCode = 400;
    throw err;
  }
  const run = async (tx) => {
    const pending = await tx.productionRmReturnPending.findUnique({
      where: { id: pendingId },
      include: {
        item: { select: { id: true, itemName: true } },
      },
    });
    if (!pending) {
      const err = new Error("RM Return Pending row not found");
      err.statusCode = 404;
      throw err;
    }
    if (pending.status !== "PENDING") {
      const err = new Error("RM Return Pending row is already processed.");
      err.statusCode = 409;
      throw err;
    }

    const note = await createMaterialReturnNote(
      {
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        workOrderId: pending.workOrderId,
        productionMaterialRequestId: null,
        remarks: cleanRemarks(input.remarks) || `Received pending RM return #${pending.id}`,
        lines: [
          {
            itemId: pending.itemId,
            returnQty: round3(n(pending.requestedQty)),
            remarks: pending.remarks,
          },
        ],
      },
      actor,
      tx,
    );

    const updated = await tx.productionRmReturnPending.update({
      where: { id: pending.id },
      data: {
        status: "RECEIVED",
        materialReturnNoteId: note.id,
        receivedAt: new Date(),
        receivedByUserId: actor.userId ?? actor.actorUserId ?? null,
      },
    });
    const openCount = await countOpenProductionRmReturnPending(tx, pending.workOrderId);
    const { reconcileWorkOrderStatusFromProduction } = require("./workOrderCompletionService");
    await reconcileWorkOrderStatusFromProduction(tx, pending.workOrderId, {
      actorUserId: actor.userId ?? actor.actorUserId ?? null,
      actorRole: actor.role ?? actor.actorRole ?? null,
      source: "RM_RETURN_RECEIVED",
    });
    return { pending: updated, materialReturnNote: { id: note.id, docNo: note.docNo }, openReturnPendingCount: openCount };
  };
  const result =
    typeof db.$transaction === "function" ? await db.$transaction(run) : await run(db);

  const receivedPending = result.pending;
  const report = await loadConfirmedReport(db, receivedPending.workOrderId);
  const reportLine = report?.lines?.find((ln) => ln.itemId === receivedPending.itemId);
  const scrapQty = reportLine ? round3(n(reportLine.scrapWasteQty)) : 0;
  const postedWastage = db.materialWastageNote?.findMany
    ? await db.materialWastageNote.findMany({
        where: { workOrderId: receivedPending.workOrderId, itemId: receivedPending.itemId },
        select: { qty: true, reason: true, remarks: true },
      })
    : [];
  // Exclude PURGING_CONSUMPTION from process scrap auto-post baseline.
  const { isPurgingConsumptionNote } = require("./materialWastageService");
  const alreadyPostedWastageQty = round3(
    postedWastage
      .filter((row) => !isPurgingConsumptionNote(row))
      .reduce((sum, row) => sum + n(row.qty), 0),
  );
  const wastageQtyToPost = round3(Math.max(0, scrapQty - alreadyPostedWastageQty));
  let wastageNote = null;
  // Finalized report wastage must leave PRODUCTION USABLE for Regular and NO_QTY.
  // Consumption (ISSUE) and return (LOCATION_TRANSFER) remain separate — no double deduction.
  if (wastageQtyToPost > EPS) {
    try {
      wastageNote = await createMaterialWastageNote(
        {
          workOrderId: receivedPending.workOrderId,
          fromLocationId: input.fromLocationId,
          itemId: receivedPending.itemId,
          qty: wastageQtyToPost,
          reason: "PROCESS_LOSS",
          remarks: `Auto-declared from Production Report after Store received RM return (pending #${pendingId}).`,
        },
        actor,
        db,
      );
    } catch (err) {
      if (String(err?.message ?? "").includes("exceeds available returnable")) {
        // Wastage may already be posted — idempotent receive path.
      } else {
        throw err;
      }
    }
  }

  return {
    ...result,
    wastageNote: wastageNote ? { id: wastageNote.id, docNo: wastageNote.docNo } : null,
    disposition: await buildRmDispositionSummaryForWorkOrder(db, receivedPending.workOrderId),
  };
}

module.exports = {
  RECONCILIATION_TOLERANCE,
  computeRmReconciliation,
  buildWorkOrderProductionReport,
  confirmProductionWorkOrderReport,
  assertProductionReportConfirmed,
  assertProductionReportConfirmedForCompletion,
  assertProductionReportNotConfirmed,
  assertProductionReportHasApprovedEntries,
  assertNoOpenProductionRmReturnPending,
  listProductionRmReturnPending,
  receiveProductionRmReturnPending,
  buildRmDispositionSummaryForWorkOrder,
  loadApprovedByMap,
  sumQcForProduction,
};
