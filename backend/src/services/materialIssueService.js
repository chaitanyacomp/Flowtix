/**
 * Phase 3A — Store material issue (location transfer). Stock movement only; not production BOM consumption.
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
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");
const auditLog = require("./auditLog");

const TXN_TYPE = "LOCATION_TRANSFER";

function n(v) {
  return qtyToNumber(v);
}

async function loadActiveRmLocations(db = prisma) {
  const rows = await db.location.findMany({
    where: { isActive: true, allowRm: true },
    orderBy: [{ locationType: "asc" }, { locationName: "asc" }],
  });
  return rows.map(mapLocationRow);
}

function isStoreSourceLocation(loc) {
  return loc.locationType === "RM_STORE" || loc.locationType === "CONSUMABLE";
}

function isProductionDestinationLocation(loc) {
  return loc.locationType === "PRODUCTION" || loc.locationType === "WIP";
}

async function assertLocationPairForIssue(tx, fromLocationId, toLocationId) {
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
  if (!isStoreSourceLocation(fromMapped)) {
    const err = new Error("From location must be a store (RM Store or Consumable).");
    err.statusCode = 400;
    throw err;
  }
  if (!isProductionDestinationLocation(toMapped)) {
    const err = new Error("To location must be Production or WIP.");
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

async function getAvailableRmAtLocation(itemId, locationId, db = prisma) {
  const [line] = await getMaterialAvailabilityByItems({
    db,
    itemIds: [itemId],
    locationScope: { locationId },
    includeIncoming: false,
    includeIssued: false,
  });
  return {
    available: round3(Math.max(0, n(line?.freeStockQty))),
    physicalUsableStockQty: round3(Math.max(0, n(line?.physicalUsableStockQty))),
    totalReservedQty: round3(Math.max(0, n(line?.effectiveReservedQty))),
    legacyReservedQty: round3(Math.max(0, n(line?.legacyReservedQty))),
    activeAllocatedQty: round3(Math.max(0, n(line?.activeAllocatedQty))),
    freeStockQty: round3(Math.max(0, n(line?.freeStockQty))),
    reservationBreakdown: line?.reservationBreakdown || [],
  };
}

function round3(v) {
  return Math.round((Number(v) || 0) * 1000) / 1000;
}

async function loadIssuedByWorkOrderFromMaterialIssues(db, workOrderId) {
  const notes = await db.materialIssueNote.findMany({
    where: { workOrderId },
    select: {
      lines: {
        select: {
          itemId: true,
          issueQty: true,
        },
      },
    },
  });
  const out = new Map();
  for (const note of notes) {
    for (const ln of note.lines || []) {
      out.set(ln.itemId, round3((out.get(ln.itemId) || 0) + n(ln.issueQty)));
    }
  }
  return out;
}

function computeMaterialIssuePlanLine({
  fullWoRmNeed,
  consumedQty,
  returnedQty,
  issuedToProductionQty,
  requiredForBalanceQty,
  availableInStore,
}) {
  const full = round3(Math.max(0, n(fullWoRmNeed)));
  const consumed = round3(Math.max(0, n(consumedQty)));
  const returned = round3(Math.max(0, n(returnedQty)));
  const issued = round3(Math.max(0, n(issuedToProductionQty)));
  const requiredForBalance = round3(Math.max(0, n(requiredForBalanceQty)));
  const atProduction = round3(Math.max(0, issued - consumed - returned));
  const stillRequired = round3(Math.max(0, requiredForBalance - atProduction));
  const available = availableInStore == null ? null : round3(Math.max(0, n(availableInStore)));
  const issueNow = available == null ? 0 : round3(Math.min(stillRequired, available));
  return {
    fullWoRmNeed: full,
    consumedQty: consumed,
    returnedQty: returned,
    issuedToProductionQty: issued,
    atProductionQty: atProduction,
    requiredForBalanceQty: requiredForBalance,
    stillRequiredQty: stillRequired,
    availableInStore: available,
    issueNowQty: issueNow,
  };
}

async function buildMaterialIssueFormContext(db = prisma) {
  const [fromLocations, toLocations, workOrders, rmItems] = await Promise.all([
    db.location.findMany({
      where: { isActive: true, allowRm: true, locationType: { in: ["RM_STORE", "CONSUMABLE"] } },
      orderBy: { locationName: "asc" },
    }),
    db.location.findMany({
      where: { isActive: true, allowRm: true, locationType: { in: ["PRODUCTION", "WIP"] } },
      orderBy: { locationName: "asc" },
    }),
    db.workOrder.findMany({
      where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
      orderBy: { id: "desc" },
      take: 100,
      select: {
        id: true,
        docNo: true,
        salesOrder: { select: { docNo: true, id: true } },
      },
    }),
    db.item.findMany({
      where: { itemType: "RM" },
      orderBy: { itemName: "asc" },
      select: { id: true, itemName: true, unit: true },
    }),
  ]);

  return {
    fromLocations: fromLocations.map(mapLocationRow),
    toLocations: toLocations.map(mapLocationRow),
    workOrders: workOrders.map((wo) => ({
      id: wo.id,
      docNo: wo.docNo,
      salesOrderId: wo.salesOrder?.id ?? null,
      salesOrderNo: wo.salesOrder?.docNo ?? null,
      label: `${wo.docNo || `WO-${wo.id}`}${wo.salesOrder?.docNo ? ` · ${wo.salesOrder.docNo}` : ""}`,
    })),
    rmItems,
  };
}

async function listMaterialIssueNotes(db = prisma, { limit = 50 } = {}) {
  const rows = await db.materialIssueNote.findMany({
    orderBy: { id: "desc" },
    take: limit,
    include: {
      fromLocation: true,
      toLocation: true,
      workOrder: { select: { id: true, docNo: true } },
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
    remarks: r.remarks,
    createdAt: r.createdAt,
    lineCount: r.lines.length,
    lines: r.lines.map((ln) => ({
      id: ln.id,
      itemId: ln.itemId,
      itemName: ln.item?.itemName ?? "",
      unit: ln.unitSnapshot || ln.item?.unit || "",
      issueQty: n(ln.issueQty),
    })),
  }));
}

/**
 * @param {{ fromLocationId: number, toLocationId: number, workOrderId?: number | null, productionMaterialRequestId?: number | null, remarks?: string | null, lines: Array<{ itemId: number, issueQty: number }> }} input
 * @param {{ userId?: number, role?: string }} actor
 * @param {import('@prisma/client').Prisma.TransactionClient} [outerTx] When set, runs inside caller transaction (PMR issue).
 */
async function createMaterialIssueNote(input, actor = {}, outerTx = null) {
  if (!input.lines?.length) {
    const err = new Error("Add at least one RM line to issue.");
    err.statusCode = 400;
    throw err;
  }

  const run = async (tx) => {
    await assertLocationPairForIssue(tx, input.fromLocationId, input.toLocationId);

    if (input.workOrderId) {
      const wo = await tx.workOrder.findUnique({ where: { id: input.workOrderId } });
      if (!wo) {
        const err = new Error("Work order not found");
        err.statusCode = 404;
        throw err;
      }
    }

    const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
    const items = await tx.item.findMany({ where: { id: { in: itemIds } } });
    if (items.length !== itemIds.length) {
      const err = new Error("One or more items not found");
      err.statusCode = 400;
      throw err;
    }
    const bad = items.filter((i) => i.itemType !== "RM");
    if (bad.length) {
      const err = new Error("Only RM items can be issued to production.");
      err.statusCode = 400;
      throw err;
    }
    const itemById = new Map(items.map((i) => [i.id, i]));
    const manualAvailabilityByItem = input.productionMaterialRequestId
      ? new Map()
      : new Map(
          (
            await getMaterialAvailabilityByItems({
              db: tx,
              itemIds,
              locationScope: { locationId: input.fromLocationId },
              includeIncoming: false,
              includeIssued: false,
            })
          ).map((row) => [row.itemId, row]),
        );

    for (const line of input.lines) {
      const qty = n(line.issueQty);
      if (qty <= STOCK_EPS) {
        const err = new Error("Issue qty must be positive.");
        err.statusCode = 400;
        throw err;
      }
      const it = itemById.get(line.itemId);
      const availability = manualAvailabilityByItem.get(line.itemId);
      if (availability && qty > n(availability.freeStockQty) + STOCK_EPS) {
        const err = new Error(
          `Issue qty exceeds free store stock for ${it?.itemName || line.itemId}. Free: ${round3(
            availability.freeStockQty,
          )}, requested: ${round3(qty)}.`,
        );
        err.statusCode = 409;
        err.code = "MATERIAL_ISSUE_FREE_STOCK_EXCEEDED";
        throw err;
      }
      await assertSufficientStockForQtyOut(
        tx,
        line.itemId,
        qty,
        `Insufficient stock at source location for ${it?.itemName || line.itemId}.`,
        { stockBucket: "USABLE", locationId: input.fromLocationId },
      );
    }

    const docNo = await allocateDocNo(tx, { docType: DocType.MATERIAL_ISSUE_NOTE, date: new Date() });
    const note = await tx.materialIssueNote.create({
      data: {
        docNo,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        workOrderId: input.workOrderId ?? null,
        productionMaterialRequestId: input.productionMaterialRequestId ?? null,
        remarks: input.remarks?.trim() || null,
        createdByUserId: actor.userId ?? null,
        lines: {
          create: input.lines.map((l) => {
            const it = itemById.get(l.itemId);
            return {
              itemId: l.itemId,
              issueQty: String(l.issueQty),
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

    const refId = note.id;
    for (const line of input.lines) {
      const qty = String(line.issueQty);
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
        entityId: `MATERIAL_ISSUE:${note.id}`,
        actorUserId: userId,
        actorRole: actor.role,
        summary: `Material issue ${docNo} — ${note.lines.length} line(s) to ${note.toLocation.locationName}`,
        payload: {
          module: "MATERIAL_ISSUE",
          actionLabel: "LOCATION_TRANSFER",
          ref: { type: "MATERIAL_ISSUE_NOTE", id: String(note.id), no: docNo },
        },
      });
    }

    return note;
  };

  if (outerTx) return run(outerTx);
  return prisma.$transaction(run);
}

/** Grouped stock-by-location for reports (location → items with qty). */
async function buildStockGroupedByLocation(db = prisma) {
  const rows = await db.stockTransaction.groupBy({
    by: ["itemId", "locationId"],
    where: { stockBucket: "USABLE" },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const locationIds = [...new Set(rows.map((r) => r.locationId).filter((id) => id != null))];
  const itemIds = [...new Set(rows.map((r) => r.itemId))];
  const [locations, items] = await Promise.all([
    locationIds.length
      ? db.location.findMany({ where: { id: { in: locationIds } }, orderBy: { locationName: "asc" } })
      : [],
    itemIds.length ? db.item.findMany({ where: { id: { in: itemIds } } }) : [],
  ]);
  const locById = new Map(locations.map((l) => [l.id, mapLocationRow(l)]));
  const itemById = new Map(items.map((i) => [i.id, i]));

  const byLoc = new Map();
  for (const r of rows) {
    const qty = Math.max(0, n(r._sum.qtyIn) - n(r._sum.qtyOut));
    if (qty <= STOCK_EPS) continue;
    const locKey = r.locationId ?? "unassigned";
    if (!byLoc.has(locKey)) {
      const loc = r.locationId != null ? locById.get(r.locationId) : null;
      byLoc.set(locKey, {
        locationId: r.locationId,
        locationName: loc?.locationName ?? "Unassigned",
        locationCode: loc?.locationCode ?? null,
        locationType: loc?.locationType ?? null,
        items: [],
      });
    }
    const bucket = byLoc.get(locKey);
    const item = itemById.get(r.itemId);
    bucket.items.push({
      itemId: r.itemId,
      itemName: item?.itemName ?? `Item #${r.itemId}`,
      unit: item?.unit ?? "",
      qty,
    });
  }

  return [...byLoc.values()]
    .map((g) => ({
      ...g,
      items: g.items.sort((a, b) => a.itemName.localeCompare(b.itemName)),
    }))
    .sort((a, b) => a.locationName.localeCompare(b.locationName));
}

module.exports = {
  TXN_TYPE,
  getAvailableRmAtLocation,
  buildMaterialIssueFormContext,
  createMaterialIssueNote,
  listMaterialIssueNotes,
  buildStockGroupedByLocation,
  loadIssuedByWorkOrderFromMaterialIssues,
  computeMaterialIssuePlanLine,
};
