const { prisma } = require("../utils/prisma");
const { computePlannedQtyFromCustomerBuffer } = require("./regularSoBufferQty");
const { getItemStockQty, usableStockDisplayQty } = require("./stockService");

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** First candidate that coerces to a finite number > 0, else 0 (explicit 0 does not block fallback). */
function firstFinitePositive(...candidates) {
  for (const c of candidates) {
    const x = typeof c === "number" ? c : Number(c);
    if (Number.isFinite(x) && x > 0) return x;
  }
  return 0;
}

function clampBufferPercent(v) {
  const p = n(v);
  if (!Number.isFinite(p)) return 0;
  return Math.min(10, Math.max(0, p));
}

function snapshotLineFromSalesOrderLine(line, bufferPercent, fgStockQty) {
  const customerCommittedQty = n(line.customerPoQty ?? line.qty);
  const productionBufferPercent = clampBufferPercent(bufferPercent);
  const plannedProductionQty = computePlannedQtyFromCustomerBuffer(customerCommittedQty, productionBufferPercent);
  const productionBufferQty = plannedProductionQty - customerCommittedQty;
  const fgStockAdjustmentQty = Math.max(0, n(fgStockQty));
  // Full planned production drives RM demand — surplus FG in store is informational only (Decision 3/4).
  const rmPlanningQty = plannedProductionQty;
  return {
    salesOrderLineId: line.id,
    salesOrderId: line.soId,
    itemId: line.itemId,
    itemName: line.item?.itemName ?? `#${line.itemId}`,
    // FG identity contract expected by fgDemandInputFromPlanningView /
    // fgShortageDemandInputFromPlanningView (parity with the SNAPSHOT branch).
    lineId: line.id,
    fgItemId: line.itemId,
    fgName: line.item?.itemName ?? `#${line.itemId}`,
    customerCommittedQty,
    productionBufferPercent,
    productionBufferQty,
    plannedProductionQty,
    fgStockAdjustmentQty,
    rmPlanningQty,
    orderQty: customerCommittedQty,
    fgStock: fgStockAdjustmentQty,
    toProduce: rmPlanningQty,
  };
}

async function loadRegularSoPlanningSnapshot(salesOrderId, db = prisma) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return null;
  if (typeof db?.regularSoPlanningSnapshot?.findUnique !== "function") return null;
  return db.regularSoPlanningSnapshot.findUnique({
    where: { salesOrderId: soId },
    include: {
      salesOrder: {
        include: {
          lines: { include: { item: true }, orderBy: { id: "asc" } },
          customer: true,
          quotation: { select: { id: true, quotationNo: true } },
        },
      },
      createdBy: { select: { id: true, name: true, email: true } },
      updatedBy: { select: { id: true, name: true, email: true } },
      lines: {
        include: {
          salesOrderLine: { include: { item: true } },
        },
        orderBy: { id: "asc" },
      },
    },
  });
}

async function buildRegularSoPlanningSnapshotView(salesOrderId, db = prisma) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) {
    const err = new Error("Invalid salesOrderId");
    err.statusCode = 400;
    throw err;
  }

  const snapshot = await loadRegularSoPlanningSnapshot(soId, db);
  const so = snapshot?.salesOrder ?? (await db.salesOrder.findUnique({
    where: { id: soId },
    include: {
      lines: { include: { item: true }, orderBy: { id: "asc" } },
      customer: true,
      quotation: { select: { id: true, quotationNo: true } },
    },
  }));

  if (!so) {
    const err = new Error("Sales order not found");
    err.statusCode = 404;
    throw err;
  }

  const orderType = so.orderType ?? "NORMAL";
  const fgLines = (so.lines ?? []).filter((line) => line.item?.itemType === "FG");
  const bufferPercent = snapshot ? clampBufferPercent(snapshot.bufferPercent) : 0;
  const lines = [];

  for (const line of fgLines) {
    const lineSnapshot = snapshot?.lines?.find((row) => Number(row.salesOrderLineId) === Number(line.id)) ?? null;
    if (lineSnapshot) {
      const customerCommittedQty = n(lineSnapshot.customerCommittedQty);
      const productionBufferPercent = clampBufferPercent(lineSnapshot.productionBufferPercent);
      const productionBufferQty = n(lineSnapshot.productionBufferQty);
      const plannedProductionQty = n(lineSnapshot.plannedProductionQty);
      const fgStockAdjustmentQty = n(lineSnapshot.fgStockAdjustmentQty);
      // Always derive RM demand from full planned qty (ignore legacy net-of-FG-stock snapshots).
      const rmPlanningQty = plannedProductionQty;
      lines.push({
        lineId: line.id,
        salesOrderLineId: line.id,
        fgItemId: line.itemId,
        fgName: line.item.itemName,
        customerCommittedQty,
        productionBufferPercent,
        productionBufferQty,
        plannedProductionQty,
        fgStockAdjustmentQty,
        rmPlanningQty,
        orderQty: customerCommittedQty,
        fgStock: fgStockAdjustmentQty,
        toProduce: rmPlanningQty,
      });
      continue;
    }
    const fgStockRaw = await getItemStockQty(line.itemId, db, { stockBucket: "USABLE" });
    const fgStock = usableStockDisplayQty(fgStockRaw);
    lines.push(snapshotLineFromSalesOrderLine(line, bufferPercent, fgStock));
  }

  const allFgEnough = lines.every((l) => Number(l.rmPlanningQty ?? l.toProduce ?? 0) <= 1e-6);

  return {
    source: snapshot ? "SNAPSHOT" : "DERIVED",
    salesOrderId: soId,
    orderType,
    bufferPercent,
    snapshotId: snapshot?.id ?? null,
    snapshotUpdatedAt: snapshot?.updatedAt ?? null,
    lines,
    allFgEnough,
    salesOrder: so,
  };
}

async function upsertRegularSoPlanningSnapshot({ salesOrderId, bufferPercent = 0, createdByUserId = null }, db = prisma) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) {
    const err = new Error("Invalid salesOrderId");
    err.statusCode = 400;
    throw err;
  }

  const so = await db.salesOrder.findUnique({
    where: { id: soId },
    include: {
      lines: { include: { item: true }, orderBy: { id: "asc" } },
    },
  });
  if (!so) {
    const err = new Error("Sales order not found");
    err.statusCode = 404;
    throw err;
  }
  if ((so.orderType ?? "NORMAL") === "NO_QTY") {
    const err = new Error("Production planning snapshot is not available for NO_QTY sales orders.");
    err.statusCode = 400;
    throw err;
  }

  const fgLines = (so.lines ?? []).filter((line) => line.item?.itemType === "FG");
  if (!fgLines.length) {
    const err = new Error("Sales order has no FG lines for production planning.");
    err.statusCode = 400;
    throw err;
  }

  const normalizedBufferPercent = clampBufferPercent(bufferPercent);
  const fgStockRows = await Promise.all(
    fgLines.map(async (line) => {
      const fgStockRaw = await getItemStockQty(line.itemId, db, { stockBucket: "USABLE" });
      return {
        salesOrderLineId: line.id,
        fgStock: usableStockDisplayQty(fgStockRaw),
      };
    }),
  );
  const fgStockByLineId = new Map(fgStockRows.map((row) => [row.salesOrderLineId, row.fgStock]));

  return db.$transaction(async (tx) => {
    const existing = await tx.regularSoPlanningSnapshot.findUnique({
      where: { salesOrderId: soId },
      select: { id: true, createdByUserId: true },
    });

    const snapshot = existing
      ? await tx.regularSoPlanningSnapshot.update({
          where: { salesOrderId: soId },
          data: {
            bufferPercent: String(normalizedBufferPercent),
            ...(createdByUserId != null ? { updatedByUserId: createdByUserId } : {}),
          },
        })
      : await tx.regularSoPlanningSnapshot.create({
          data: {
            salesOrderId: soId,
            bufferPercent: String(normalizedBufferPercent),
            createdByUserId,
            updatedByUserId: createdByUserId,
          },
        });

    await tx.regularSoPlanningSnapshotLine.deleteMany({
      where: { salesOrderId: soId },
    });

    const rows = fgLines.map((line) => {
    const fgStock = fgStockByLineId.get(line.id) ?? 0;
    const customerCommittedQty = n(line.customerPoQty ?? line.qty);
      const plannedProductionQty = computePlannedQtyFromCustomerBuffer(customerCommittedQty, normalizedBufferPercent);
      const productionBufferQty = plannedProductionQty - customerCommittedQty;
      const fgStockAdjustmentQty = Math.max(0, n(fgStock));
      const rmPlanningQty = plannedProductionQty;
      return {
        snapshotId: snapshot.id,
        salesOrderId: soId,
        salesOrderLineId: line.id,
        customerCommittedQty: String(customerCommittedQty),
        productionBufferPercent: String(normalizedBufferPercent),
        productionBufferQty: String(productionBufferQty),
        plannedProductionQty: String(plannedProductionQty),
        fgStockAdjustmentQty: String(fgStockAdjustmentQty),
        rmPlanningQty: String(rmPlanningQty),
      };
    });

    await tx.regularSoPlanningSnapshotLine.createMany({ data: rows });

    return tx.regularSoPlanningSnapshot.findUnique({
      where: { salesOrderId: soId },
      include: {
        salesOrder: {
          include: {
            lines: { include: { item: true }, orderBy: { id: "asc" } },
            customer: true,
            quotation: { select: { id: true, quotationNo: true } },
          },
        },
        createdBy: { select: { id: true, name: true, email: true } },
        updatedBy: { select: { id: true, name: true, email: true } },
        lines: {
          include: {
            salesOrderLine: { include: { item: true } },
          },
          orderBy: { id: "asc" },
        },
      },
    });
  });
}

/**
 * Canonical FG demand rows for BOM explosion — always uses plannedProductionQty (buffer-aware).
 * @param {{ lines?: Array<{ lineId?: number, fgItemId?: number, fgName?: string, plannedProductionQty?: number, rmPlanningQty?: number, toProduce?: number, unit?: string, note?: string }> }} planningView
 */
function fgDemandInputFromPlanningView(planningView) {
  return (planningView?.lines ?? [])
    .filter((line) => !line.note)
    .map((line) => ({
      lineId: line.lineId ?? null,
      fgItemId: line.fgItemId,
      fgName: line.fgName ?? "",
      fgQty: n(line.plannedProductionQty ?? line.rmPlanningQty ?? line.toProduce ?? 0),
      unit: line.unit ?? "",
    }))
    .filter((row) => row.fgItemId && row.fgQty > 1e-6);
}

/**
 * Operational FG demand for RM Control Center / Material Planning shortage detection.
 * Uses full planned production qty (buffer-aware). Surplus FG in store does not reduce RM demand.
 */
function fgShortageDemandInputFromPlanningView(planningView) {
  return (planningView?.lines ?? [])
    .filter((line) => !line.note)
    .map((line) => ({
      lineId: line.lineId ?? null,
      fgItemId: line.fgItemId,
      fgName: line.fgName ?? "",
      fgQty: firstFinitePositive(line.plannedProductionQty, line.rmPlanningQty, line.toProduce),
      unit: line.unit ?? "",
    }))
    .filter((row) => row.fgItemId && row.fgQty > 1e-6);
}

/**
 * Suggested default buffer from approved BOM for the SO primary FG (optional).
 */
async function resolveSuggestedFgPlanningBufferPercentForSalesOrder(salesOrderId, db = prisma) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return null;
  const so = await db.salesOrder.findUnique({
    where: { id: soId },
    include: {
      lines: {
        where: { item: { itemType: "FG" } },
        include: { item: { select: { id: true, itemName: true } } },
        orderBy: { id: "asc" },
        take: 1,
      },
    },
  });
  const fgLine = so?.lines?.[0];
  if (!fgLine?.itemId) return null;
  const bom = await db.bom.findFirst({
    where: { fgItemId: fgLine.itemId, status: "APPROVED" },
    orderBy: { revisionNo: "desc" },
    select: { suggestedFgPlanningBufferPercent: true },
  });
  if (bom?.suggestedFgPlanningBufferPercent == null) return null;
  const pct = n(bom.suggestedFgPlanningBufferPercent);
  return Number.isFinite(pct) ? clampBufferPercent(pct) : null;
}

function regularSoPlanningSnapshotToDto(snapshot) {
  if (!snapshot) return null;
  return {
    id: snapshot.id,
    salesOrderId: snapshot.salesOrderId,
    bufferPercent: n(snapshot.bufferPercent),
    createdByUserId: snapshot.createdByUserId ?? null,
    updatedByUserId: snapshot.updatedByUserId ?? null,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    lines: (snapshot.lines ?? []).map((line) => ({
      id: line.id,
      salesOrderLineId: line.salesOrderLineId,
      itemId: line.salesOrderLine?.itemId ?? null,
      itemName: line.salesOrderLine?.item?.itemName ?? "",
      customerCommittedQty: n(line.customerCommittedQty),
      productionBufferPercent: n(line.productionBufferPercent),
      productionBufferQty: n(line.productionBufferQty),
      plannedProductionQty: n(line.plannedProductionQty),
      fgStockAdjustmentQty: n(line.fgStockAdjustmentQty),
      rmPlanningQty: n(line.rmPlanningQty),
    })),
  };
}

module.exports = {
  buildRegularSoPlanningSnapshotView,
  fgDemandInputFromPlanningView,
  fgShortageDemandInputFromPlanningView,
  loadRegularSoPlanningSnapshot,
  regularSoPlanningSnapshotToDto,
  resolveSuggestedFgPlanningBufferPercentForSalesOrder,
  snapshotLineFromSalesOrderLine,
  upsertRegularSoPlanningSnapshot,
};
