/**
 * Phase 3B — Production Material Request (PMR). Request/control layer; stock moves via MIN only.
 */

const { prisma } = require("../utils/prisma");
const { filterNoQtyExecutionReleasedWorkOrders, assertNoQtyWorkOrderExecutionReleased } = require("./noQtyExecutionBoundaryService");
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("./docNoService");
const { aggregateRmDemandForFgLines, loadApprovedBomWithLines } = require("./bomExplosionService");
const { STOCK_EPS, getItemStockQty } = require("./stockService");
const { qtyToNumber } = require("./rmPurchaseHelpers");
const {
  createMaterialIssueNote,
  loadIssuedByWorkOrderFromMaterialIssues,
  computeMaterialIssuePlanLine,
} = require("./materialIssueService");
const {
  getWorkOrderProductionLocationIdsForReturn,
  loadNetConsumedAtProduction,
  loadReturnedByWorkOrder,
} = require("./materialReturnService");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");
const {
  createAllocationsForPmr,
  cancelAllocationsForPmr,
  loadPmrAllocationByItem,
  syncAllocationsForPmrIssueStatus,
} = require("./materialAllocationService");
const auditLog = require("./auditLog");

const STORE_ISSUE_STATUSES = ["REQUESTED", "PARTIALLY_ISSUED"];

function n(v) {
  return qtyToNumber(v);
}

function round3(v) {
  return Math.round((Number(v) || 0) * 1000) / 1000;
}

function runInTransaction(db, fn) {
  return typeof db?.$transaction === "function" ? db.$transaction(fn) : fn(db);
}

function pendingQty(line) {
  return Math.max(0, n(line.requiredQty) - n(line.issuedQty));
}

function computeFreeStoreStockLine({ totalStoreStock, reservedForOtherOrdersQty }) {
  const total = round3(Math.max(0, n(totalStoreStock)));
  const reserved = round3(Math.max(0, n(reservedForOtherOrdersQty)));
  return {
    totalStoreStock: total,
    reservedForOtherOrdersQty: reserved,
    freeStoreStock: round3(Math.max(0, total - reserved)),
  };
}

async function loadReservedForOtherOpenPmrsByItem(db, { itemIds, excludePmrId }) {
  const ids = [...new Set((itemIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return new Map();
  const rows = await getMaterialAvailabilityByItems({
    db,
    itemIds: ids,
    excludePmrId,
    includeIncoming: false,
    includeIssued: false,
  });
  const out = new Map();
  for (const row of rows || []) {
    if (n(row.effectiveReservedQty) <= STOCK_EPS) continue;
    out.set(row.itemId, round3(n(row.effectiveReservedQty)));
  }
  return out;
}

function mapPmrLine(ln) {
  const required = n(ln.requiredQty);
  const issued = n(ln.issuedQty);
  const pending = Math.max(0, required - issued);
  return {
    id: ln.id,
    itemId: ln.itemId,
    itemName: ln.item?.itemName ?? "",
    unit: ln.unitSnapshot || ln.item?.unit || "",
    requiredQty: required,
    issuedQty: issued,
    pendingQty: pending,
  };
}

function mapPmrRow(row) {
  const lines = (row.lines || []).map(mapPmrLine);
  const totalRequired = lines.reduce((s, l) => s + l.requiredQty, 0);
  const totalIssued = lines.reduce((s, l) => s + l.issuedQty, 0);
  const totalPending = lines.reduce((s, l) => s + l.pendingQty, 0);
  return {
    id: row.id,
    docNo: row.docNo,
    status: row.status,
    remarks: row.remarks,
    workOrderId: row.workOrderId,
    workOrderNo: row.workOrder?.docNo ?? null,
    salesOrderNo: row.workOrder?.salesOrder?.docNo ?? null,
    requestedAt: row.requestedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lineCount: lines.length,
    totalRequired,
    totalIssued,
    totalPending,
    lines,
    materialIssues: (row.materialIssueNotes || []).map((m) => ({
      id: m.id,
      docNo: m.docNo,
      createdAt: m.createdAt,
    })),
  };
}

async function recalcPmrStatus(tx, pmrId) {
  const pmr = await tx.productionMaterialRequest.findUnique({
    where: { id: pmrId },
    include: { lines: true },
  });
  if (!pmr || pmr.status === "CANCELLED" || pmr.status === "DRAFT") return pmr?.status;

  let allFull = true;
  let anyIssued = false;
  for (const ln of pmr.lines) {
    const req = n(ln.requiredQty);
    const iss = n(ln.issuedQty);
    if (iss > STOCK_EPS) anyIssued = true;
    if (iss + STOCK_EPS < req) allFull = false;
  }

  let next = pmr.status;
  if (!anyIssued) next = "REQUESTED";
  else if (allFull) next = "FULLY_ISSUED";
  else next = "PARTIALLY_ISSUED";

  if (next !== pmr.status) {
    await tx.productionMaterialRequest.update({ where: { id: pmrId }, data: { status: next } });
  }
  await syncAllocationsForPmrIssueStatus(tx, pmrId);
  return next;
}

/**
 * BOM-based RM suggestions for a work order (approved BOM explosion on planned FG qty).
 */
async function buildBomSuggestionsForWorkOrder(workOrderId, db = prisma) {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      lines: { include: { fgItem: { select: { id: true, itemName: true } } } },
      salesOrder: { select: { docNo: true } },
    },
  });
  if (!wo) {
    const err = new Error("Work order not found");
    err.statusCode = 404;
    throw err;
  }

  const fgLines = [];
  for (const ln of wo.lines) {
    const bom = await loadApprovedBomWithLines(db, ln.fgItemId);
    const planned = n(ln.plannedQty) > STOCK_EPS ? n(ln.plannedQty) : n(ln.qty);
    fgLines.push({
      fgItemId: ln.fgItemId,
      fgItemName: ln.fgItem?.itemName ?? "",
      fgQty: planned,
      bomMissing: !bom?.lines?.length,
    });
  }

  const { rmNeeded, missingChildBoms } = await aggregateRmDemandForFgLines(db, fgLines);
  const itemIds = [...rmNeeded.keys()];
  const items =
    itemIds.length > 0
      ? await db.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, itemName: true, unit: true, itemType: true } })
      : [];
  const itemById = new Map(items.map((i) => [i.id, i]));

  const lines = [...rmNeeded.entries()]
    .map(([itemId, requiredQty]) => {
      const it = itemById.get(itemId);
      return {
        itemId,
        itemName: it?.itemName ?? `Item #${itemId}`,
        unit: it?.unit ?? "",
        itemType: it?.itemType ?? "RM",
        requiredQty,
        issuedQty: 0,
        pendingQty: requiredQty,
      };
    })
    .sort((a, b) => a.itemName.localeCompare(b.itemName));

  return {
    workOrderId: wo.id,
    workOrderNo: wo.docNo,
    salesOrderNo: wo.salesOrder?.docNo ?? null,
    fgLines,
    lines,
    missingChildBoms,
  };
}

async function loadApprovedProducedQtyByWorkOrderLine(db, workOrderLineIds) {
  if (!workOrderLineIds.length) return new Map();
  const rows = await db.productionEntry.groupBy({
    by: ["workOrderLineId"],
    where: {
      workOrderLineId: { in: workOrderLineIds },
      workflowStatus: "APPROVED",
    },
    _sum: { producedQty: true },
  });
  return new Map(rows.map((r) => [r.workOrderLineId, n(r._sum.producedQty)]));
}

async function buildWorkOrderMaterialIssueSnapshot(db, workOrderId, fromLocationId = null) {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      docNo: true,
      status: true,
      salesOrder: { select: { id: true, docNo: true, orderType: true } },
      lines: {
        select: {
          id: true,
          fgItemId: true,
          qty: true,
          plannedQty: true,
          fgItem: { select: { id: true, itemName: true } },
        },
      },
    },
  });
  if (!wo) {
    const err = new Error("Work order not found");
    err.statusCode = 404;
    throw err;
  }

  const workOrderLineIds = (wo.lines || []).map((ln) => ln.id);
  const approvedProducedByLine = await loadApprovedProducedQtyByWorkOrderLine(db, workOrderLineIds);
  const shortfallClosed = String(wo.status) === "CLOSED_WITH_SHORTFALL";

  const fullFgLines = [];
  const balanceFgLines = [];
  const fgLineSummaries = [];
  for (const ln of wo.lines || []) {
    const planned = n(ln.plannedQty) > STOCK_EPS ? n(ln.plannedQty) : n(ln.qty);
    const produced = n(approvedProducedByLine.get(ln.id));
    const shortfallQty = shortfallClosed ? Math.max(0, planned - produced) : 0;
    const remaining = Math.max(0, planned - produced - shortfallQty);
    fgLineSummaries.push({
      workOrderLineId: ln.id,
      fgItemId: ln.fgItemId,
      fgItemName: ln.fgItem?.itemName ?? "",
      plannedQty: round3(planned),
      approvedProducedQty: round3(produced),
      shortfallClosedQty: round3(shortfallQty),
      remainingQty: round3(remaining),
    });
    fullFgLines.push({
      fgItemId: ln.fgItemId,
      fgItemName: ln.fgItem?.itemName ?? "",
      fgQty: planned,
      bomMissing: false,
    });
    if (remaining > STOCK_EPS) {
      balanceFgLines.push({
        fgItemId: ln.fgItemId,
        fgItemName: ln.fgItem?.itemName ?? "",
        fgQty: remaining,
        bomMissing: false,
      });
    }
  }

  const [fullDemand, balanceDemand, prodLocIds, issuedMap, returnedMap] = await Promise.all([
    aggregateRmDemandForFgLines(db, fullFgLines),
    aggregateRmDemandForFgLines(db, balanceFgLines),
    getWorkOrderProductionLocationIdsForReturn(db, wo.id),
    loadIssuedByWorkOrderFromMaterialIssues(db, wo.id),
    loadReturnedByWorkOrder(db, wo.id),
  ]);
  const consumedMap = await loadNetConsumedAtProduction(db, wo.id, prodLocIds);

  const itemIds = new Set([
    ...fullDemand.rmNeeded.keys(),
    ...balanceDemand.rmNeeded.keys(),
    ...issuedMap.keys(),
    ...consumedMap.keys(),
    ...returnedMap.keys(),
  ]);
  const items =
    itemIds.size > 0
      ? await db.item.findMany({
          where: { id: { in: [...itemIds] } },
          select: { id: true, itemName: true, unit: true },
        })
      : [];
  const itemById = new Map(items.map((it) => [it.id, it]));

  const linesByItemId = new Map();
  for (const itemId of itemIds) {
    const available =
      fromLocationId != null
        ? await getItemStockQty(itemId, db, { stockBucket: "USABLE", locationId: fromLocationId })
        : null;
    const calc = computeMaterialIssuePlanLine({
      fullWoRmNeed: fullDemand.rmNeeded.get(itemId) ?? 0,
      consumedQty: consumedMap.get(itemId) ?? 0,
      returnedQty: returnedMap.get(itemId) ?? 0,
      issuedToProductionQty: issuedMap.get(itemId) ?? 0,
      requiredForBalanceQty: balanceDemand.rmNeeded.get(itemId) ?? 0,
      availableInStore: available,
    });
    linesByItemId.set(itemId, {
      itemId,
      itemName: itemById.get(itemId)?.itemName ?? `Item #${itemId}`,
      unit: itemById.get(itemId)?.unit ?? "",
      ...calc,
    });
  }

  return {
    workOrderId: wo.id,
    workOrderNo: wo.docNo,
    orderType: wo.salesOrder?.orderType ?? null,
    fgLines: fgLineSummaries,
    linesByItemId,
    missingChildBoms: [
      ...(fullDemand.missingChildBoms || []),
      ...(balanceDemand.missingChildBoms || []),
    ],
  };
}

async function listProductionMaterialRequests(db = prisma, { status, pendingForStore, limit = 100 } = {}) {
  /** @type {import('@prisma/client').Prisma.ProductionMaterialRequestWhereInput} */
  const where = {};
  if (pendingForStore) {
    where.status = { in: STORE_ISSUE_STATUSES };
  } else if (status) {
    where.status = status;
  }

  const rows = await db.productionMaterialRequest.findMany({
    where,
    orderBy: { id: "desc" },
    take: limit,
    include: {
      workOrder: {
        select: {
          id: true,
          docNo: true,
          salesOrderId: true,
          cycleId: true,
          requirementSheetId: true,
          salesOrder: { select: { docNo: true, orderType: true } },
        },
      },
      lines: { include: { item: { select: { id: true, itemName: true, unit: true } } } },
      materialIssueNotes: { select: { id: true, docNo: true, createdAt: true }, orderBy: { id: "desc" } },
    },
  });
  const mapped = rows.map(mapPmrRow);
  const woRows = rows.map((r) => ({
    id: r.workOrderId,
    salesOrderId: r.workOrder?.salesOrderId,
    cycleId: r.workOrder?.cycleId,
    requirementSheetId: r.workOrder?.requirementSheetId,
    salesOrder: r.workOrder?.salesOrder,
  }));
  const visibleWoIds = new Set(
    (await filterNoQtyExecutionReleasedWorkOrders(db, woRows)).map((wo) => wo.id),
  );
  return mapped.filter((pmr) => visibleWoIds.has(pmr.workOrderId));
}

async function getProductionMaterialRequestById(id, db = prisma) {
  const row = await db.productionMaterialRequest.findUnique({
    where: { id },
    include: {
      workOrder: { select: { docNo: true, salesOrder: { select: { docNo: true } } } },
      lines: { include: { item: { select: { id: true, itemName: true, unit: true } } } },
      materialIssueNotes: { select: { id: true, docNo: true, createdAt: true }, orderBy: { id: "desc" } },
    },
  });
  if (!row) {
    const err = new Error("Production material request not found");
    err.statusCode = 404;
    throw err;
  }
  return mapPmrRow(row);
}

/**
 * @param {{ workOrderId: number, remarks?: string | null, lines?: Array<{ itemId: number, requiredQty: number }>, useBom?: boolean }} input
 */
async function createProductionMaterialRequest(input, actor = {}, db = prisma) {
  return runInTransaction(db, async (tx) => {
    const wo = await tx.workOrder.findUnique({
      where: { id: input.workOrderId },
      include: { salesOrder: { select: { orderType: true } } },
    });
    if (!wo) {
      const err = new Error("Work order not found");
      err.statusCode = 404;
      throw err;
    }
    await assertNoQtyWorkOrderExecutionReleased(tx, input.workOrderId, "Material request");
    if (!["PENDING", "IN_PROGRESS"].includes(wo.status)) {
      const err = new Error("Work order must be pending or in progress to request material.");
      err.statusCode = 400;
      throw err;
    }

    let linePayload = input.lines;
    if (!linePayload?.length && input.useBom !== false) {
      const bom = await buildBomSuggestionsForWorkOrder(input.workOrderId, tx);
      linePayload = bom.lines.map((l) => ({ itemId: l.itemId, requiredQty: l.requiredQty }));
    }
    if (!linePayload?.length) {
      const err = new Error("Add at least one RM line or enable BOM suggestions.");
      err.statusCode = 400;
      throw err;
    }

    const itemIds = [...new Set(linePayload.map((l) => l.itemId))];
    const items = await tx.item.findMany({ where: { id: { in: itemIds } } });
    if (items.length !== itemIds.length) {
      const err = new Error("One or more items not found");
      err.statusCode = 400;
      throw err;
    }
    const bad = items.filter((i) => i.itemType !== "RM");
    if (bad.length) {
      const err = new Error("Only RM items can be requested.");
      err.statusCode = 400;
      throw err;
    }
    const itemById = new Map(items.map((i) => [i.id, i]));

    const docNo = await allocateDocNo(tx, { docType: DocType.PRODUCTION_MATERIAL_REQUEST, date: new Date() });
    const pmr = await tx.productionMaterialRequest.create({
      data: {
        docNo,
        workOrderId: input.workOrderId,
        status: "DRAFT",
        remarks: input.remarks?.trim() || null,
        createdByUserId: actor.userId ?? null,
        lines: {
          create: linePayload.map((l) => {
            const qty = n(l.requiredQty);
            if (qty <= STOCK_EPS) {
              const err = new Error("Required qty must be positive.");
              err.statusCode = 400;
              throw err;
            }
            const it = itemById.get(l.itemId);
            return {
              itemId: l.itemId,
              requiredQty: String(qty),
              unitSnapshot: it?.unit ?? null,
            };
          }),
        },
      },
      include: {
        workOrder: { select: { docNo: true, salesOrderId: true, salesOrder: { select: { docNo: true } } } },
        lines: { include: { item: true } },
        materialIssueNotes: true,
      },
    });

    await createAllocationsForPmr(
      tx,
      { ...pmr, salesOrderId: wo.salesOrderId, workOrderId: input.workOrderId },
      pmr.lines,
      actor,
    );

    return mapPmrRow(pmr);
  });
}

async function submitProductionMaterialRequest(pmrId, actor = {}, db = prisma) {
  return runInTransaction(db, async (tx) => {
    const pmr = await tx.productionMaterialRequest.findUnique({
      where: { id: pmrId },
      include: { lines: true },
    });
    if (!pmr) {
      const err = new Error("Production material request not found");
      err.statusCode = 404;
      throw err;
    }
    if (pmr.status !== "DRAFT") {
      const err = new Error("Only draft requests can be submitted.");
      err.statusCode = 400;
      throw err;
    }
    if (!pmr.lines.length) {
      const err = new Error("Add at least one line before submitting.");
      err.statusCode = 400;
      throw err;
    }

    await tx.productionMaterialRequest.update({
      where: { id: pmrId },
      data: {
        status: "REQUESTED",
        requestedAt: new Date(),
        requestedByUserId: actor.userId ?? null,
      },
    });

    const userId = actor.userId;
    if (typeof userId === "number" && Number.isFinite(userId)) {
      await auditLog.write(tx, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `PMR:${pmrId}`,
        actorUserId: userId,
        actorRole: actor.role,
        summary: `PMR ${pmr.docNo || pmrId} submitted for store issue`,
        payload: { module: "PMR", actionLabel: "REQUESTED", ref: { type: "PMR", id: String(pmrId), no: pmr.docNo } },
      });
    }

    return getProductionMaterialRequestById(pmrId, tx);
  });
}

async function cancelProductionMaterialRequest(pmrId, actor = {}, db = prisma) {
  return runInTransaction(db, async (tx) => {
    const pmr = await tx.productionMaterialRequest.findUnique({ where: { id: pmrId } });
    if (!pmr) {
      const err = new Error("Production material request not found");
      err.statusCode = 404;
      throw err;
    }
    if (pmr.status === "FULLY_ISSUED") {
      const err = new Error("Fully issued requests cannot be cancelled.");
      err.statusCode = 400;
      throw err;
    }
    const withLines = await tx.productionMaterialRequest.findUnique({
      where: { id: pmrId },
      include: { lines: true },
    });
    if (withLines?.lines?.some((l) => n(l.issuedQty) > STOCK_EPS)) {
      const err = new Error("Cannot cancel after material has been issued.");
      err.statusCode = 400;
      throw err;
    }

    await tx.productionMaterialRequest.update({
      where: { id: pmrId },
      data: { status: "CANCELLED" },
    });
    await cancelAllocationsForPmr(tx, pmrId, actor);
    return getProductionMaterialRequestById(pmrId, tx);
  });
}

/**
 * Ensure a submitted PMR exists for a regular work order so Store issue can proceed.
 * Reuses an existing draft/submitted request where possible.
 */
async function ensureSubmittedProductionMaterialRequestForWorkOrder(workOrderId, actor = {}, db = prisma) {
  await assertNoQtyWorkOrderExecutionReleased(db, workOrderId, "Material request");
  const woId = Number(workOrderId);
  if (!Number.isFinite(woId) || woId <= 0) {
    const err = new Error("Work order id is required.");
    err.statusCode = 400;
    throw err;
  }

  const existingSubmitted = await db.productionMaterialRequest.findFirst({
    where: { workOrderId: woId, status: { in: STORE_ISSUE_STATUSES } },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  if (existingSubmitted) {
    return getProductionMaterialRequestById(existingSubmitted.id, db);
  }

  const existingDraft = await db.productionMaterialRequest.findFirst({
    where: { workOrderId: woId, status: "DRAFT" },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  if (existingDraft) {
    return submitProductionMaterialRequest(existingDraft.id, actor, db);
  }

  const created = await createProductionMaterialRequest({ workOrderId: woId, useBom: true }, actor, db);
  return submitProductionMaterialRequest(created.id, actor, db);
}

/**
 * Store issues material against PMR → creates MIN + updates issued qty on PMR lines.
 */
async function issueMaterialAgainstPmr(pmrId, input, actor = {}) {
  const pmr = await prisma.productionMaterialRequest.findUnique({
    where: { id: pmrId },
    include: { lines: true, workOrder: { include: { salesOrder: { select: { orderType: true } } } } },
  });
  if (!pmr) {
    const err = new Error("Production material request not found");
    err.statusCode = 404;
    throw err;
  }
  if (!STORE_ISSUE_STATUSES.includes(pmr.status)) {
    const err = new Error("This request is not open for store issue.");
    err.statusCode = 400;
    throw err;
  }
  if (!input.lines?.length) {
    const err = new Error("Add at least one line to issue.");
    err.statusCode = 400;
    throw err;
  }

  const lineById = new Map(pmr.lines.map((l) => [l.id, l]));
  const itemIds = [...new Set(pmr.lines.map((l) => l.itemId))];
  const issueAvailabilityRows = await getMaterialAvailabilityByItems({
    db: prisma,
    itemIds,
    excludePmrId: pmrId,
    locationScope: { locationId: input.fromLocationId },
    includeIncoming: false,
    includeIssued: false,
  });
  const issueAvailabilityByItem = new Map(issueAvailabilityRows.map((row) => [row.itemId, row]));
  const woIssueSnapshot = await buildWorkOrderMaterialIssueSnapshot(prisma, pmr.workOrderId, input.fromLocationId);
  const issueLines = [];
  for (const row of input.lines) {
    const pl = lineById.get(row.pmrLineId);
    if (!pl) {
      const err = new Error("Invalid PMR line.");
      err.statusCode = 400;
      throw err;
    }
    const qty = n(row.issueQty);
    if (qty <= STOCK_EPS) continue;
    const pend = pendingQty(pl);
    if (qty > pend + STOCK_EPS) {
      const err = new Error(`Issue qty exceeds pending qty for line #${row.pmrLineId}.`);
      err.statusCode = 400;
      throw err;
    }
    const woLine = woIssueSnapshot?.linesByItemId?.get(pl.itemId);
    if (woLine && qty > n(woLine.stillRequiredQty) + STOCK_EPS) {
      const err = new Error(
        `Issue qty exceeds WO balance requirement for ${woLine.itemName || `item #${pl.itemId}`}.`,
      );
      err.statusCode = 400;
      throw err;
    }
    const availability = issueAvailabilityByItem.get(pl.itemId);
    const freeStoreStock = n(availability?.freeStockQty);
    if (qty > freeStoreStock + STOCK_EPS) {
      const err = new Error(
        `Issue qty exceeds free store stock for item #${pl.itemId}. Free: ${round3(freeStoreStock)}, requested: ${round3(qty)}.`,
      );
      err.statusCode = 409;
      err.code = "PMR_FREE_STOCK_EXCEEDED";
      throw err;
    }
    issueLines.push({ itemId: pl.itemId, issueQty: qty, pmrLineId: pl.id });
  }
  if (!issueLines.length) {
    const err = new Error("Add at least one positive issue quantity.");
    err.statusCode = 400;
    throw err;
  }

  const note = await prisma.$transaction(async (tx) => {
    const created = await createMaterialIssueNote(
      {
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        workOrderId: pmr.workOrderId,
        productionMaterialRequestId: pmrId,
        remarks: input.remarks?.trim() || `Issue against ${pmr.docNo || `PMR-${pmrId}`}`,
        lines: issueLines.map((l) => ({ itemId: l.itemId, issueQty: l.issueQty })),
      },
      actor,
      tx,
    );

    for (const il of issueLines) {
      const pl = lineById.get(il.pmrLineId);
      const nextIssued = n(pl.issuedQty) + il.issueQty;
      await tx.productionMaterialRequestLine.update({
        where: { id: il.pmrLineId },
        data: { issuedQty: String(nextIssued) },
      });
    }
    await recalcPmrStatus(tx, pmrId);
    return created;
  });

  return {
    materialIssue: {
      id: note.id,
      docNo: note.docNo,
      toLocation: note.toLocation,
    },
    pmr: await getProductionMaterialRequestById(pmrId),
  };
}

/** Store issue context for a PMR (all lines + store availability for guided issue UI). */
async function buildPmrIssueContext(pmrId, fromLocationId, db = prisma) {
  const pmr = await getProductionMaterialRequestById(pmrId, db);
  if (!STORE_ISSUE_STATUSES.includes(pmr.status)) {
    const err = new Error("This request is not open for store issue.");
    err.statusCode = 400;
    throw err;
  }

  const rawPmr = await db.productionMaterialRequest.findUnique({
    where: { id: pmrId },
    select: {
      workOrder: {
        select: {
          salesOrder: { select: { orderType: true } },
          lines: {
            orderBy: { id: "asc" },
            select: { fgItem: { select: { itemName: true } } },
          },
        },
      },
    },
  });
  const fgNames = [
    ...new Set(
      (rawPmr?.workOrder?.lines || [])
        .map((ln) => ln.fgItem?.itemName)
        .filter(Boolean),
    ),
  ];
  const productionItemName = fgNames.length ? fgNames.join(", ") : null;

  const woIssueSnapshot = await buildWorkOrderMaterialIssueSnapshot(db, pmr.workOrderId, fromLocationId ?? null);
  const itemIds = pmr.lines.map((l) => l.itemId);
  const requiredQtyByItemId = new Map(pmr.lines.map((l) => [l.itemId, n(l.pendingQty)]));
  const globalAvailabilityRows =
    fromLocationId
      ? await getMaterialAvailabilityByItems({
          db,
          itemIds,
          requiredQtyByItemId,
          locationScope: { locationId: fromLocationId },
          includeIncoming: true,
          includeIssued: true,
        })
      : [];
  const issueAvailabilityRows =
    fromLocationId
      ? await getMaterialAvailabilityByItems({
          db,
          itemIds,
          requiredQtyByItemId,
          excludePmrId: pmrId,
          locationScope: { locationId: fromLocationId },
          includeIncoming: true,
          includeIssued: true,
        })
      : [];
  const globalAvailabilityByItem = new Map(globalAvailabilityRows.map((row) => [row.itemId, row]));
  const issueAvailabilityByItem = new Map(issueAvailabilityRows.map((row) => [row.itemId, row]));
  const currentAllocationByItem = await loadPmrAllocationByItem(db, pmrId);

  async function enrichLine(l) {
    let totalStoreStock = null;
    let reservedForOtherOrdersQty = 0;
    let freeStoreStock = null;
    const availability = globalAvailabilityByItem.get(l.itemId) ?? null;
    const issueAvailability = issueAvailabilityByItem.get(l.itemId) ?? null;
    const currentAllocation = currentAllocationByItem.get(l.itemId) ?? null;
    if (fromLocationId) {
      totalStoreStock = availability?.physicalUsableStockQty ?? 0;
      reservedForOtherOrdersQty = issueAvailability?.effectiveReservedQty ?? 0;
      freeStoreStock = issueAvailability?.freeStockQty ?? 0;
    }
    const woLine = woIssueSnapshot?.linesByItemId?.get(l.itemId) ?? null;
    const pendingQty = n(l.pendingQty);
    const issueCapQty = woLine ? Math.min(pendingQty, n(woLine.stillRequiredQty)) : pendingQty;
    const suggestedIssueQty =
      freeStoreStock == null
        ? 0
        : round3(Math.min(Math.max(0, issueCapQty), Math.max(0, n(freeStoreStock))));
    return {
      ...l,
      totalStoreStock,
      reservedForOtherOrdersQty,
      freeStoreStock,
      physicalUsableStockQty: availability?.physicalUsableStockQty ?? totalStoreStock,
      activeAllocatedQty: availability?.activeAllocatedQty ?? 0,
      legacyReservedQty: availability?.legacyReservedQty ?? reservedForOtherOrdersQty,
      effectiveReservedQty: availability?.effectiveReservedQty ?? reservedForOtherOrdersQty,
      freeStockQty: availability?.freeStockQty ?? freeStoreStock,
      totalReservedQty: availability?.effectiveReservedQty ?? reservedForOtherOrdersQty,
      globalFreeStockQty: availability?.freeStockQty ?? freeStoreStock,
      issueAvailableStoreQty: freeStoreStock,
      reservationForCurrentPmrQty: round3(
        Math.max(0, n(availability?.effectiveReservedQty) - n(issueAvailability?.effectiveReservedQty)),
      ),
      reservationBreakdown: availability?.reservationBreakdown ?? [],
      incomingQty: availability?.incomingQty ?? 0,
      issuedToProductionQty: availability?.issuedToProductionQty ?? 0,
      shortageAfterReservationQty: availability?.shortageAfterReservationQty ?? null,
      coveredByIncomingQty: availability?.coveredByIncomingQty ?? 0,
      netShortageAfterIncomingQty: availability?.netShortageAfterIncomingQty ?? null,
      allocationCoverageQty: currentAllocation?.activeAllocatedQty ?? availability?.allocationCoverageQty ?? 0,
      allocationShortageQty:
        currentAllocation != null
          ? round3(Math.max(0, pendingQty - n(currentAllocation.activeAllocatedQty)))
          : availability?.allocationShortageQty ?? null,
      allocationStatus:
        currentAllocation?.activeAllocatedQty > STOCK_EPS
          ? currentAllocation.activeAllocatedQty + STOCK_EPS >= pendingQty
            ? "FULLY_ALLOCATED"
            : "PARTIALLY_ALLOCATED"
          : availability?.allocationStatus ?? "NOT_ALLOCATED",
      availabilityWarnings: availability?.warnings ?? [],
      availableStoreQty: freeStoreStock,
      /** @deprecated alias for older clients */
      available: freeStoreStock,
      pmrPendingQty: pendingQty,
      fullWoRmNeed: woLine?.fullWoRmNeed ?? l.requiredQty,
      consumedQty: woLine?.consumedQty ?? 0,
      returnedQty: woLine?.returnedQty ?? 0,
      atProductionQty: woLine?.atProductionQty ?? 0,
      requiredForBalanceQty: woLine?.requiredForBalanceQty ?? pendingQty,
      stillRequiredQty: issueCapQty,
      issueCapQty,
      suggestedIssueQty,
    };
  }

  const lines = await Promise.all(pmr.lines.map(enrichLine));
  const pendingLines = lines.filter((l) => n(l.issueCapQty) > STOCK_EPS);

  return {
    pmr: { ...pmr, productionItemName },
    lines,
    pendingLines,
  };
}

module.exports = {
  STORE_ISSUE_STATUSES,
  buildBomSuggestionsForWorkOrder,
  listProductionMaterialRequests,
  getProductionMaterialRequestById,
  createProductionMaterialRequest,
  submitProductionMaterialRequest,
  ensureSubmittedProductionMaterialRequestForWorkOrder,
  cancelProductionMaterialRequest,
  issueMaterialAgainstPmr,
  buildPmrIssueContext,
  buildWorkOrderMaterialIssueSnapshot,
  loadReservedForOtherOpenPmrsByItem,
  computeFreeStoreStockLine,
  recalcPmrStatus,
  pendingQty,
};
