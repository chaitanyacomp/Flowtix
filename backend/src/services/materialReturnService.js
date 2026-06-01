/**
 * Phase 3D — Production → Store RM return (MRN). Paired LOCATION_TRANSFER (inverse of MIN).
 */

const { prisma } = require("../utils/prisma");
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("./docNoService");
const { mapLocationRow } = require("./locationService");
const {
  STOCK_EPS,
  getItemStockQty,
  usableStockDisplayQty,
  assertSufficientStockForQtyOut,
} = require("./stockService");
const { qtyToNumber } = require("./rmPurchaseHelpers");
const { round3 } = require("./bomExplosionService");
const auditLog = require("./auditLog");

const TXN_TYPE = "LOCATION_TRANSFER";
const SUBMITTED_PMR_STATUSES = ["REQUESTED", "PARTIALLY_ISSUED", "FULLY_ISSUED"];

function n(v) {
  return qtyToNumber(v);
}

function isProductionSourceLocation(loc) {
  return loc.locationType === "PRODUCTION" || loc.locationType === "WIP";
}

function isStoreDestinationLocation(loc) {
  return loc.locationType === "RM_STORE" || loc.locationType === "CONSUMABLE";
}

/** Logical unused issued RM still attributed to production (not consumption reversal). */
function computeUnusedIssuedRmQty(grossIssued, consumed, returned) {
  return round3(Math.max(0, n(grossIssued) - n(consumed) - n(returned)));
}

/** Returnable cap: unused logical qty capped by physical on-hand at production. */
function computePhysicalReturnableQty(grossIssued, consumed, returned, onHand) {
  const logical = computeUnusedIssuedRmQty(grossIssued, consumed, returned);
  return round3(Math.min(logical, Math.max(0, n(onHand))));
}

/**
 * Production / WIP locations for this WO (PMR-linked MINs + legacy MIN without PMR).
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
async function getWorkOrderProductionLocationIdsForReturn(db, workOrderId) {
  const notes = await db.materialIssueNote.findMany({
    where: { workOrderId },
    select: { toLocationId: true },
  });
  return [...new Set(notes.map((m) => m.toLocationId).filter((id) => Number.isFinite(id)))];
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
async function loadGrossIssuedByWorkOrder(db, workOrderId) {
  const pmrs = await db.productionMaterialRequest.findMany({
    where: { workOrderId, status: { in: SUBMITTED_PMR_STATUSES } },
    include: { lines: true },
  });
  const map = new Map();
  for (const pmr of pmrs) {
    for (const ln of pmr.lines) {
      map.set(ln.itemId, round3((map.get(ln.itemId) || 0) + n(ln.issuedQty)));
    }
  }

  const legacyMins = await db.materialIssueNote.findMany({
    where: { workOrderId, productionMaterialRequestId: null },
    include: { lines: true },
  });
  for (const min of legacyMins) {
    for (const ln of min.lines) {
      const cur = map.get(ln.itemId) || 0;
      if (cur <= STOCK_EPS) {
        map.set(ln.itemId, round3((map.get(ln.itemId) || 0) + n(ln.issueQty)));
      }
    }
  }
  return map;
}

/**
 * Net ISSUE consumption at production locations (qtyOut − reversal qtyIn).
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
async function loadNetConsumedAtProduction(db, workOrderId, locationIds) {
  if (!locationIds.length) return new Map();
  const approved = await db.productionEntry.findMany({
    where: {
      workflowStatus: "APPROVED",
      workOrderLine: { workOrderId },
    },
    select: { id: true },
  });
  const refIds = approved.map((p) => p.id);
  if (!refIds.length) return new Map();

  const rows = await db.stockTransaction.findMany({
    where: {
      refId: { in: refIds },
      transactionType: "ISSUE",
      locationId: { in: locationIds },
      stockBucket: "USABLE",
    },
    select: { itemId: true, qtyIn: true, qtyOut: true },
  });
  const map = new Map();
  for (const r of rows) {
    const net = n(r.qtyOut) - n(r.qtyIn);
    if (net > STOCK_EPS) {
      map.set(r.itemId, round3((map.get(r.itemId) || 0) + net));
    }
  }
  return map;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
async function loadReturnedByWorkOrder(db, workOrderId) {
  const notes = await db.materialReturnNote.findMany({
    where: { workOrderId },
    include: { lines: true },
  });
  const map = new Map();
  for (const note of notes) {
    for (const ln of note.lines) {
      map.set(ln.itemId, round3((map.get(ln.itemId) || 0) + n(ln.returnQty)));
    }
  }
  return map;
}

async function sumStockAtLocations(db, itemId, locationIds) {
  if (!locationIds.length) return 0;
  let total = 0;
  for (const locId of locationIds) {
    total += await getItemStockQty(itemId, db, { stockBucket: "USABLE", locationId: locId });
  }
  return Math.max(0, total);
}

async function assertLocationPairForReturn(tx, fromLocationId, toLocationId) {
  const [fromLoc, toLoc] = await Promise.all([
    tx.location.findUnique({ where: { id: fromLocationId } }),
    tx.location.findUnique({ where: { id: toLocationId } }),
  ]);
  if (!fromLoc?.isActive || !toLoc?.isActive) {
    const err = new Error("From and to locations must be active.");
    err.statusCode = 400;
    throw err;
  }
  if (!fromLoc.allowRm || !toLoc.allowRm) {
    const err = new Error("Both locations must allow RM items.");
    err.statusCode = 400;
    throw err;
  }
  const fromMapped = mapLocationRow(fromLoc);
  const toMapped = mapLocationRow(toLoc);
  if (!isProductionSourceLocation(fromMapped)) {
    const err = new Error("From location must be Production or WIP.");
    err.statusCode = 400;
    throw err;
  }
  if (!isStoreDestinationLocation(toMapped)) {
    const err = new Error("To location must be RM Store or Consumable.");
    err.statusCode = 400;
    throw err;
  }
  if (fromLocationId === toLocationId) {
    const err = new Error("From and to locations must differ.");
    err.statusCode = 400;
    throw err;
  }
  return { fromLoc: fromMapped, toLoc: toMapped };
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 * @param {{ workOrderId: number, productionMaterialRequestId?: number | null, fromLocationId?: number | null, toLocationId?: number | null }} opts
 */
async function buildReturnableLinesForWorkOrder(db = prisma, opts) {
  const workOrderId = opts.workOrderId;
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, docNo: true },
  });
  if (!wo) {
    const err = new Error("Work order not found");
    err.statusCode = 404;
    throw err;
  }

  let pmr = null;
  if (opts.productionMaterialRequestId) {
    pmr = await db.productionMaterialRequest.findFirst({
      where: { id: opts.productionMaterialRequestId, workOrderId },
      include: { lines: { include: { item: { select: { id: true, itemName: true, unit: true } } } } },
    });
    if (!pmr) {
      const err = new Error("Production material request not found for this work order");
      err.statusCode = 404;
      throw err;
    }
  }

  const prodLocIds = await getWorkOrderProductionLocationIdsForReturn(db, workOrderId);
  const [grossMap, consumedMap, returnedMap] = await Promise.all([
    loadGrossIssuedByWorkOrder(db, workOrderId),
    loadNetConsumedAtProduction(db, workOrderId, prodLocIds),
    loadReturnedByWorkOrder(db, workOrderId),
  ]);

  const itemIds = new Set([...grossMap.keys(), ...consumedMap.keys()]);
  if (pmr) {
    for (const ln of pmr.lines) itemIds.add(ln.itemId);
  }

  const items = itemIds.size
    ? await db.item.findMany({
        where: { id: { in: [...itemIds] } },
        select: { id: true, itemName: true, unit: true, itemType: true },
      })
    : [];
  const itemById = new Map(items.map((i) => [i.id, i]));

  const defaultFromId = opts.fromLocationId ?? prodLocIds[0] ?? null;
  let defaultToId = opts.toLocationId ?? null;
  if (!defaultToId) {
    const storeLoc =
      (await db.location.findFirst({
        where: { isActive: true, allowRm: true, locationType: "RM_STORE" },
        orderBy: { id: "asc" },
      })) ??
      (await db.location.findFirst({
        where: { isActive: true, allowRm: true, locationType: "CONSUMABLE" },
        orderBy: { id: "asc" },
      }));
    defaultToId = storeLoc?.id ?? null;
  }

  const lines = [];
  for (const itemId of [...itemIds].sort((a, b) => a - b)) {
    const grossIssued = n(grossMap.get(itemId));
    const consumed = n(consumedMap.get(itemId));
    const returned = n(returnedMap.get(itemId));
    const netIssued = round3(Math.max(0, grossIssued - returned));
    const unusedQty = computeUnusedIssuedRmQty(grossIssued, consumed, returned);
    const onHand = await sumStockAtLocations(db, itemId, prodLocIds);
    const physicalReturnable = computePhysicalReturnableQty(grossIssued, consumed, returned, onHand);

    if (grossIssued <= STOCK_EPS && onHand <= STOCK_EPS) continue;

    lines.push({
      itemId,
      itemName: itemById.get(itemId)?.itemName ?? `Item #${itemId}`,
      unit: itemById.get(itemId)?.unit ?? "",
      grossIssuedQty: round3(grossIssued),
      consumedQty: round3(consumed),
      returnedQty: round3(returned),
      unusedQty,
      netIssuedQty: netIssued,
      returnableQty: physicalReturnable,
      onHandAtProduction: round3(onHand),
      canReturn: physicalReturnable > STOCK_EPS,
    });
  }

  return {
    workOrderId: wo.id,
    workOrderNo: wo.docNo,
    productionMaterialRequestId: pmr?.id ?? null,
    productionMaterialRequestDocNo: pmr?.docNo ?? null,
    productionLocationIds: prodLocIds,
    defaultFromLocationId: defaultFromId,
    defaultToLocationId: defaultToId,
    lines,
  };
}

async function buildMaterialReturnFormContext(db = prisma) {
  const [fromLocations, toLocations, workOrders] = await Promise.all([
    db.location.findMany({
      where: { isActive: true, allowRm: true, locationType: { in: ["PRODUCTION", "WIP"] } },
      orderBy: { locationName: "asc" },
    }),
    db.location.findMany({
      where: { isActive: true, allowRm: true, locationType: { in: ["RM_STORE", "CONSUMABLE"] } },
      orderBy: { locationName: "asc" },
    }),
    db.workOrder.findMany({
      where: { status: { in: ["PENDING", "IN_PROGRESS", "HOLD", "COMPLETED"] } },
      orderBy: { id: "desc" },
      take: 100,
      select: {
        id: true,
        docNo: true,
        salesOrder: { select: { docNo: true, id: true } },
        productionMaterialRequests: {
          where: { status: { in: SUBMITTED_PMR_STATUSES } },
          orderBy: { id: "desc" },
          select: { id: true, docNo: true, status: true },
        },
      },
    }),
  ]);

  return {
    fromLocations: fromLocations.map(mapLocationRow),
    toLocations: toLocations.map(mapLocationRow),
    workOrders: workOrders.map((wo) => ({
      id: wo.id,
      docNo: wo.docNo,
      salesOrderNo: wo.salesOrder?.docNo ?? null,
      label: `${wo.docNo || `WO-${wo.id}`}${wo.salesOrder?.docNo ? ` · ${wo.salesOrder.docNo}` : ""}`,
      pmrs: wo.productionMaterialRequests,
    })),
  };
}

async function listMaterialReturnNotes(db = prisma, { limit = 50 } = {}) {
  const rows = await db.materialReturnNote.findMany({
    orderBy: { id: "desc" },
    take: limit,
    include: {
      fromLocation: true,
      toLocation: true,
      workOrder: { select: { id: true, docNo: true } },
      productionMaterialRequest: { select: { id: true, docNo: true } },
      lines: { include: { item: { select: { id: true, itemName: true, unit: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    docNo: r.docNo,
    fromLocation: mapLocationRow(r.fromLocation),
    toLocation: mapLocationRow(r.toLocation),
    workOrderId: r.workOrderId,
    workOrderNo: r.workOrder?.docNo ?? null,
    productionMaterialRequestId: r.productionMaterialRequestId,
    pmrDocNo: r.productionMaterialRequest?.docNo ?? null,
    remarks: r.remarks,
    createdAt: r.createdAt,
    lineCount: r.lines.length,
    lines: r.lines.map((ln) => ({
      id: ln.id,
      itemId: ln.itemId,
      itemName: ln.item?.itemName ?? "",
      unit: ln.unitSnapshot || ln.item?.unit || "",
      returnQty: n(ln.returnQty),
    })),
  }));
}

async function getMaterialReturnNoteById(id, db = prisma) {
  const r = await db.materialReturnNote.findUnique({
    where: { id },
    include: {
      fromLocation: true,
      toLocation: true,
      workOrder: { select: { id: true, docNo: true } },
      productionMaterialRequest: { select: { id: true, docNo: true } },
      lines: { include: { item: { select: { id: true, itemName: true, unit: true } } } },
      createdBy: { select: { id: true, name: true } },
    },
  });
  if (!r) {
    const err = new Error("Material return not found");
    err.statusCode = 404;
    throw err;
  }
  return {
    id: r.id,
    docNo: r.docNo,
    fromLocation: mapLocationRow(r.fromLocation),
    toLocation: mapLocationRow(r.toLocation),
    workOrderId: r.workOrderId,
    workOrderNo: r.workOrder?.docNo ?? null,
    productionMaterialRequestId: r.productionMaterialRequestId,
    pmrDocNo: r.productionMaterialRequest?.docNo ?? null,
    remarks: r.remarks,
    createdAt: r.createdAt,
    createdByName: r.createdBy?.name ?? null,
    lines: r.lines.map((ln) => ({
      id: ln.id,
      itemId: ln.itemId,
      itemName: ln.item?.itemName ?? "",
      unit: ln.unitSnapshot || ln.item?.unit || "",
      returnQty: n(ln.returnQty),
      remarks: ln.remarks,
    })),
  };
}

/**
 * @param {{ fromLocationId: number, toLocationId: number, workOrderId?: number | null, productionMaterialRequestId?: number | null, remarks?: string | null, lines: Array<{ itemId: number, returnQty: number, remarks?: string | null }> }} input
 * @param {{ userId?: number, role?: string }} actor
 */
async function createMaterialReturnNote(input, actor = {}) {
  if (!input.lines?.length) {
    const err = new Error("Add at least one RM line to return.");
    err.statusCode = 400;
    throw err;
  }
  if (!input.workOrderId) {
    const err = new Error("Work order is required for material return.");
    err.statusCode = 400;
    throw err;
  }

  const run = async (tx) => {
    await assertLocationPairForReturn(tx, input.fromLocationId, input.toLocationId);

    const wo = await tx.workOrder.findUnique({ where: { id: input.workOrderId } });
    if (!wo) {
      const err = new Error("Work order not found");
      err.statusCode = 404;
      throw err;
    }

    if (input.productionMaterialRequestId) {
      const pmr = await tx.productionMaterialRequest.findFirst({
        where: { id: input.productionMaterialRequestId, workOrderId: input.workOrderId },
      });
      if (!pmr) {
        const err = new Error("Production material request not found for this work order");
        err.statusCode = 404;
        throw err;
      }
    }

    const returnableCtx = await buildReturnableLinesForWorkOrder(tx, {
      workOrderId: input.workOrderId,
      productionMaterialRequestId: input.productionMaterialRequestId ?? null,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
    });
    const returnableByItem = new Map(returnableCtx.lines.map((l) => [l.itemId, l]));

    const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
    const items = await tx.item.findMany({ where: { id: { in: itemIds } } });
    if (items.length !== itemIds.length) {
      const err = new Error("One or more items not found");
      err.statusCode = 400;
      throw err;
    }
    const bad = items.filter((i) => i.itemType !== "RM");
    if (bad.length) {
      const err = new Error("Only RM items can be returned to store.");
      err.statusCode = 400;
      throw err;
    }
    const itemById = new Map(items.map((i) => [i.id, i]));

    for (const line of input.lines) {
      const qty = n(line.returnQty);
      if (qty <= STOCK_EPS) {
        const err = new Error("Return qty must be positive.");
        err.statusCode = 400;
        throw err;
      }
      const row = returnableByItem.get(line.itemId);
      const it = itemById.get(line.itemId);
      if (!row || row.returnableQty <= STOCK_EPS) {
        const err = new Error(
          `No returnable quantity for ${it?.itemName || line.itemId} on this work order.`,
        );
        err.statusCode = 400;
        throw err;
      }
      if (qty > row.returnableQty + STOCK_EPS) {
        const err = new Error(
          `Return qty exceeds returnable (${row.returnableQty}) for ${it?.itemName || line.itemId}.`,
        );
        err.statusCode = 400;
        throw err;
      }
      await assertSufficientStockForQtyOut(
        tx,
        line.itemId,
        qty,
        `Insufficient stock at production location for ${it?.itemName || line.itemId}.`,
        { stockBucket: "USABLE", locationId: input.fromLocationId },
      );
    }

    const docNo = await allocateDocNo(tx, { docType: DocType.MATERIAL_RETURN_NOTE, date: new Date() });
    const note = await tx.materialReturnNote.create({
      data: {
        docNo,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        workOrderId: input.workOrderId,
        productionMaterialRequestId: input.productionMaterialRequestId ?? null,
        remarks: input.remarks?.trim() || null,
        createdByUserId: actor.userId ?? null,
        lines: {
          create: input.lines.map((l) => {
            const it = itemById.get(l.itemId);
            return {
              itemId: l.itemId,
              returnQty: String(l.returnQty),
              remarks: l.remarks?.trim() || null,
              unitSnapshot: it?.unit ?? null,
            };
          }),
        },
      },
      include: {
        fromLocation: true,
        toLocation: true,
        workOrder: { select: { docNo: true } },
        lines: { include: { item: true } },
      },
    });

    if (input.productionMaterialRequestId) {
      for (const line of input.lines) {
        const pmrLine = await tx.productionMaterialRequestLine.findUnique({
          where: {
            productionMaterialRequestId_itemId: {
              productionMaterialRequestId: input.productionMaterialRequestId,
              itemId: line.itemId,
            },
          },
        });
        if (pmrLine) {
          const newReturned = round3(n(pmrLine.returnedQty) + n(line.returnQty));
          await tx.productionMaterialRequestLine.update({
            where: { id: pmrLine.id },
            data: { returnedQty: String(newReturned) },
          });
        }
      }
    }

    const refId = note.id;
    for (const line of input.lines) {
      const qty = String(line.returnQty);
      await tx.stockTransaction.create({
        data: {
          itemId: line.itemId,
          locationId: input.fromLocationId,
          transactionType: TXN_TYPE,
          refId,
          stockBucket: "USABLE",
          qtyIn: "0",
          qtyOut: qty,
          createdByUserId: actor.userId ?? null,
        },
      });
      await tx.stockTransaction.create({
        data: {
          itemId: line.itemId,
          locationId: input.toLocationId,
          transactionType: TXN_TYPE,
          refId,
          stockBucket: "USABLE",
          qtyIn: qty,
          qtyOut: "0",
          createdByUserId: actor.userId ?? null,
        },
      });
    }

    const userId = actor.userId;
    if (typeof userId === "number" && Number.isFinite(userId)) {
      await auditLog.write(tx, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `MATERIAL_RETURN:${note.id}`,
        actorUserId: userId,
        actorRole: actor.role,
        summary: `Material return ${docNo} — ${note.lines.length} line(s) to ${note.toLocation.locationName}`,
        payload: {
          module: "MATERIAL_RETURN",
          actionLabel: "LOCATION_TRANSFER",
          ref: { type: "MATERIAL_RETURN_NOTE", id: String(note.id), no: docNo },
        },
      });
    }

    return note;
  };

  return prisma.$transaction(run);
}

module.exports = {
  TXN_TYPE,
  isProductionSourceLocation,
  isStoreDestinationLocation,
  computeUnusedIssuedRmQty,
  computePhysicalReturnableQty,
  getWorkOrderProductionLocationIdsForReturn,
  loadGrossIssuedByWorkOrder,
  loadNetConsumedAtProduction,
  loadReturnedByWorkOrder,
  buildReturnableLinesForWorkOrder,
  buildMaterialReturnFormContext,
  createMaterialReturnNote,
  listMaterialReturnNotes,
  getMaterialReturnNoteById,
};
