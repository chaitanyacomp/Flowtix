/**
 * Production-location RM wastage (MWN). Final loss — RM_WASTAGE qtyOut at production only.
 */

const { prisma } = require("../utils/prisma");
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("./docNoService");
const { mapLocationRow } = require("./locationService");
const {
  STOCK_EPS,
  assertSufficientStockForQtyOut,
} = require("./stockService");
const { qtyToNumber } = require("./rmPurchaseHelpers");
const { round3 } = require("./bomExplosionService");
const auditLog = require("./auditLog");
const {
  isProductionSourceLocation,
  buildReturnableLinesForWorkOrder,
} = require("./materialReturnService");
const {
  isMaterialWastageSchemaUnavailable,
  MIGRATION_GUIDANCE,
} = require("./materialWastageSchemaGuard");

const TXN_TYPE = "RM_WASTAGE";

const WASTAGE_REASON_LABELS = {
  PROCESS_LOSS: "Process Loss",
  MACHINE_SETTING: "Machine Setting",
  SPILLAGE: "Spillage",
  CONTAMINATION: "Contamination",
  PURGING: "Purging",
  OTHER: "Other",
};

function n(v) {
  return qtyToNumber(v);
}

function wastageReasonLabel(reason) {
  return WASTAGE_REASON_LABELS[String(reason)] ?? String(reason || "");
}

async function assertRegularWorkOrderForWastage(tx, workOrderId) {
  const wo = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    include: { salesOrder: { select: { orderType: true } } },
  });
  if (!wo) {
    const err = new Error("Work order not found");
    err.statusCode = 404;
    throw err;
  }
  if (wo.salesOrder?.orderType === "NO_QTY") {
    const err = new Error("RM wastage is available for Regular work orders only.");
    err.statusCode = 400;
    throw err;
  }
  return wo;
}

async function assertProductionFromLocation(tx, fromLocationId) {
  const fromLoc = await tx.location.findUnique({ where: { id: fromLocationId } });
  if (!fromLoc?.isActive) {
    const err = new Error("Production location must be active.");
    err.statusCode = 400;
    throw err;
  }
  if (!fromLoc.allowRm) {
    const err = new Error("Location must allow RM items.");
    err.statusCode = 400;
    throw err;
  }
  const mapped = mapLocationRow(fromLoc);
  if (!isProductionSourceLocation(mapped)) {
    const err = new Error("Wastage must be declared from a Production or WIP location.");
    err.statusCode = 400;
    throw err;
  }
  return mapped;
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {{ workOrderId: number, productionMaterialRequestId?: number | null, fromLocationId?: number | null, itemId: number }} opts
 */
async function buildWastageContextForLine(db, opts) {
  const returnableCtx = await buildReturnableLinesForWorkOrder(db, {
    workOrderId: opts.workOrderId,
    productionMaterialRequestId: opts.productionMaterialRequestId ?? null,
    fromLocationId: opts.fromLocationId ?? null,
  });
  const line = returnableCtx.lines.find((l) => l.itemId === opts.itemId);
  if (!line) {
    const err = new Error("RM item not found on this work order returnable list.");
    err.statusCode = 404;
    throw err;
  }
  return {
    ...returnableCtx,
    line: {
      ...line,
      availableWastageQty: line.returnableQty,
      canDeclareWastage: line.returnableQty > STOCK_EPS,
    },
  };
}

/**
 * @param {{ workOrderId: number, productionMaterialRequestId?: number | null, fromLocationId: number, itemId: number, qty: number, reason: string, remarks?: string | null }} input
 * @param {{ userId?: number, role?: string }} actor
 */
function assertMaterialWastageSchemaReady(db = prisma) {
  if (!db.materialWastageNote?.create) {
    const err = new Error(`RM Wastage is not available on this server. ${MIGRATION_GUIDANCE}`);
    err.statusCode = 503;
    err.code = "MATERIAL_WASTAGE_SCHEMA_MISSING";
    throw err;
  }
}

async function createMaterialWastageNote(input, actor = {}) {
  assertMaterialWastageSchemaReady(prisma);
  const workOrderId = Number(input.workOrderId);
  const itemId = Number(input.itemId);
  const qty = round3(n(input.qty));
  const reason = String(input.reason || "").toUpperCase();
  const allowedReasons = Object.keys(WASTAGE_REASON_LABELS);
  if (!allowedReasons.includes(reason)) {
    const err = new Error(`Invalid wastage reason. Use one of: ${allowedReasons.join(", ")}.`);
    err.statusCode = 400;
    throw err;
  }
  if (!(qty > STOCK_EPS)) {
    const err = new Error("Wastage quantity must be greater than zero.");
    err.statusCode = 400;
    throw err;
  }

  try {
    return await prisma.$transaction(async (tx) => {
    await assertRegularWorkOrderForWastage(tx, workOrderId);
    await assertProductionFromLocation(tx, input.fromLocationId);

    if (input.productionMaterialRequestId) {
      const pmr = await tx.productionMaterialRequest.findFirst({
        where: { id: input.productionMaterialRequestId, workOrderId },
      });
      if (!pmr) {
        const err = new Error("Production material request not found for this work order");
        err.statusCode = 404;
        throw err;
      }
    }

    const ctx = await buildReturnableLinesForWorkOrder(tx, {
      workOrderId,
      productionMaterialRequestId: input.productionMaterialRequestId ?? null,
      fromLocationId: input.fromLocationId,
    });
    const line = ctx.lines.find((l) => l.itemId === itemId);
    if (!line) {
      const err = new Error("RM item not found for wastage on this work order.");
      err.statusCode = 404;
      throw err;
    }
    if (qty > line.returnableQty + STOCK_EPS) {
      const err = new Error(
        `Wastage qty exceeds available returnable qty (${line.returnableQty}). Declare return or reduce wastage.`,
      );
      err.statusCode = 400;
      throw err;
    }

    const item = await tx.item.findUnique({ where: { id: itemId } });
    if (!item || item.itemType !== "RM") {
      const err = new Error("Only RM items can be declared as wastage.");
      err.statusCode = 400;
      throw err;
    }

    await assertSufficientStockForQtyOut(
      tx,
      itemId,
      qty,
      `Insufficient RM at production for wastage. Item #${itemId}, required out: ${qty}.`,
      { stockBucket: "USABLE", locationId: input.fromLocationId },
    );

    const docNo = await allocateDocNo(tx, { docType: DocType.MATERIAL_WASTAGE_NOTE, date: new Date() });
    const note = await tx.materialWastageNote.create({
      data: {
        docNo,
        workOrderId,
        productionMaterialRequestId: input.productionMaterialRequestId ?? null,
        fromLocationId: input.fromLocationId,
        itemId,
        qty: String(qty),
        reason,
        remarks: input.remarks?.trim() || null,
        createdByUserId: actor.userId ?? null,
      },
      include: {
        fromLocation: true,
        workOrder: { select: { docNo: true } },
        item: { select: { itemName: true, unit: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    await tx.stockTransaction.create({
      data: {
        itemId,
        locationId: input.fromLocationId,
        transactionType: TXN_TYPE,
        refId: note.id,
        stockBucket: "USABLE",
        qtyIn: "0",
        qtyOut: String(qty),
        createdByUserId: actor.userId ?? null,
      },
    });

    const userId = actor.userId;
    if (typeof userId === "number" && Number.isFinite(userId)) {
      await auditLog.write(tx, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `MATERIAL_WASTAGE:${note.id}`,
        actorUserId: userId,
        actorRole: actor.role,
        summary: `RM wastage ${docNo} — ${item.itemName} ${qty} ${item.unit || ""} (${wastageReasonLabel(reason)})`,
        payload: {
          module: "MATERIAL_WASTAGE",
          actionLabel: "RM_WASTAGE",
          ref: { type: "MATERIAL_WASTAGE_NOTE", id: String(note.id), no: docNo },
          snapshot: { workOrderId, itemId, qty, reason },
        },
      });
    }

    return {
      id: note.id,
      docNo: note.docNo,
      workOrderId: note.workOrderId,
      workOrderNo: note.workOrder?.docNo ?? null,
      itemId: note.itemId,
      itemName: note.item?.itemName ?? "",
      unit: note.item?.unit ?? "",
      qty: n(note.qty),
      reason: note.reason,
      reasonLabel: wastageReasonLabel(note.reason),
      remarks: note.remarks,
      createdAt: note.createdAt,
      createdByName: note.createdBy?.name ?? null,
      fromLocation: mapLocationRow(note.fromLocation),
    };
    });
  } catch (e) {
    if (isMaterialWastageSchemaUnavailable(e)) {
      const err = new Error(`RM Wastage is not available on this database. ${MIGRATION_GUIDANCE}`);
      err.statusCode = 503;
      err.code = "MATERIAL_WASTAGE_SCHEMA_MISSING";
      throw err;
    }
    throw e;
  }
}

async function listMaterialWastageNotes(db = prisma, { limit = 50, workOrderId } = {}) {
  if (!db.materialWastageNote?.findMany) return [];
  const where = {};
  if (workOrderId) where.workOrderId = Number(workOrderId);
  try {
    const rows = await db.materialWastageNote.findMany({
      where,
      orderBy: { id: "desc" },
      take: limit,
      include: {
        fromLocation: true,
        workOrder: { select: { docNo: true } },
        item: { select: { itemName: true, unit: true } },
        createdBy: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      docNo: r.docNo,
      workOrderId: r.workOrderId,
      workOrderNo: r.workOrder?.docNo ?? null,
      itemId: r.itemId,
      itemName: r.item?.itemName ?? "",
      unit: r.item?.unit ?? "",
      qty: n(r.qty),
      reason: r.reason,
      reasonLabel: wastageReasonLabel(r.reason),
      remarks: r.remarks,
      createdAt: r.createdAt,
      createdByName: r.createdBy?.name ?? null,
      fromLocation: mapLocationRow(r.fromLocation),
    }));
  } catch (e) {
    if (isMaterialWastageSchemaUnavailable(e)) return [];
    throw e;
  }
}

async function loadWastageHistoryRows(db, limit) {
  if (!db.materialWastageNote?.findMany) return [];
  try {
    return await db.materialWastageNote.findMany({
      orderBy: { id: "desc" },
      take: limit,
      include: {
        fromLocation: true,
        workOrder: { select: { docNo: true } },
        item: { select: { itemName: true, unit: true } },
      },
    });
  } catch (e) {
    if (isMaterialWastageSchemaUnavailable(e)) {
      // eslint-disable-next-line no-console
      console.warn("[materialWastageService] MaterialWastageNote unavailable; history shows returns only.");
      return [];
    }
    throw e;
  }
}

/**
 * Merged returns + wastage for RM Return workspace history.
 */
async function listProductionRmDispositionHistory(db = prisma, { limit = 50 } = {}) {
  const returns = await db.materialReturnNote.findMany({
    orderBy: { id: "desc" },
    take: limit,
    include: {
      fromLocation: true,
      toLocation: true,
      workOrder: { select: { docNo: true } },
      lines: { include: { item: { select: { itemName: true, unit: true } } } },
    },
  });
  const wastage = await loadWastageHistoryRows(db, limit);

  /** @type {Array<{ kind: string, sortKey: number, payload: Record<string, unknown> }>} */
  const merged = [];
  for (const r of returns) {
    merged.push({
      kind: "RETURN",
      sortKey: r.id,
      payload: {
        id: r.id,
        docNo: r.docNo,
        createdAt: r.createdAt,
        direction: `${r.fromLocation.locationName} → ${r.toLocation.locationName}`,
        workOrderNo: r.workOrder?.docNo ?? null,
        lines: r.lines.map((ln) => ({
          itemName: ln.item?.itemName ?? "",
          qty: n(ln.returnQty),
          unit: ln.unitSnapshot || ln.item?.unit || "",
        })),
      },
    });
  }
  for (const w of wastage) {
    merged.push({
      kind: "WASTAGE",
      sortKey: w.id,
      payload: {
        id: w.id,
        docNo: w.docNo,
        createdAt: w.createdAt,
        direction: "Production → Wastage",
        workOrderNo: w.workOrder?.docNo ?? null,
        reason: w.reason,
        reasonLabel: wastageReasonLabel(w.reason),
        lines: [
          {
            itemName: w.item?.itemName ?? "",
            qty: n(w.qty),
            unit: w.item?.unit ?? "",
          },
        ],
      },
    });
  }

  merged.sort((a, b) => {
    const ta = new Date(a.payload.createdAt).getTime();
    const tb = new Date(b.payload.createdAt).getTime();
    if (tb !== ta) return tb - ta;
    return b.sortKey - a.sortKey;
  });

  return merged.slice(0, limit).map((m) => ({ kind: m.kind, ...m.payload }));
}

/**
 * Future dashboard KPIs — aggregate wastage without UI coupling.
 */
async function getRmWastageAggregateStats(db = prisma, { dateFrom, dateTo } = {}) {
  const where = {};
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = dateFrom;
    if (dateTo) where.createdAt.lte = dateTo;
  }
  const rows = await db.materialWastageNote.findMany({
    where,
    select: { id: true, itemId: true, qty: true, createdAt: true },
  });
  const byItem = new Map();
  let totalQty = 0;
  for (const r of rows) {
    const q = n(r.qty);
    totalQty = round3(totalQty + q);
    byItem.set(r.itemId, round3((byItem.get(r.itemId) || 0) + q));
  }
  const top = [...byItem.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    noteCount: rows.length,
    totalWastageQty: totalQty,
    topWastageItemId: top?.[0] ?? null,
    topWastageQty: top?.[1] ?? 0,
  };
}

module.exports = {
  TXN_TYPE,
  WASTAGE_REASON_LABELS,
  wastageReasonLabel,
  buildWastageContextForLine,
  createMaterialWastageNote,
  listMaterialWastageNotes,
  listProductionRmDispositionHistory,
  getRmWastageAggregateStats,
};
