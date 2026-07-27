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
  const clamped = Math.min(10, Math.max(0, p));
  // Preserve decimals (max 2 places) — do not integer-round.
  return Math.round((clamped + Number.EPSILON) * 100) / 100;
}

/** Apply FG UOM precision (default Nos = 0 dp) without rounding the WO qty upward. */
function applyFgUomPrecisionToPlannedQty(qty, decimalPlaces = 0) {
  const q = n(qty);
  if (!Number.isFinite(q) || q <= 0) return 0;
  const dp = Math.max(0, Math.floor(Number(decimalPlaces) || 0));
  if (dp <= 0) return Math.floor(q + 1e-9);
  const factor = 10 ** dp;
  return Math.floor(q * factor + 1e-9) / factor;
}

function capPlannedQtyByRmSupportedMax(plannedQty, rmSupportedMaxQty) {
  const planned = Math.max(0, n(plannedQty) || 0);
  if (rmSupportedMaxQty == null || rmSupportedMaxQty === "") return planned;
  const cap = Number(rmSupportedMaxQty);
  if (!Number.isFinite(cap) || cap < 0) return planned;
  return Math.min(planned, cap);
}

const REGULAR_SO_BUFFER_SOFT_MAX = 5;
const REGULAR_SO_BUFFER_HARD_MAX = 10;

/**
 * Validate production buffer % for REGULAR SO planning snapshot.
 * 0–5%: ok · >5–10%: Admin + reason, or Store with matching APPROVED request · >10%: blocked.
 * Hard-max check uses 2-decimal normalization so exactly 10% is never treated as blocked.
 * @returns {{ ok: true, bufferPercent: number } | { ok: false, statusCode: number, code: string, message: string }}
 */
function assertRegularSoBufferPercentForPersist(
  bufferPercent,
  { role = null, bufferReason = null, hasMatchingApprovedRequest = false } = {},
) {
  const raw = n(bufferPercent);
  if (!Number.isFinite(raw) || raw < 0) {
    return {
      ok: false,
      statusCode: 400,
      code: "INVALID_BUFFER_PERCENT",
      message: "Production buffer % must be a non-negative number.",
    };
  }
  // 2-decimal round first so exactly 10% (and float noise that rounds to 10) stays valid.
  const rounded = Math.round((raw + Number.EPSILON) * 100) / 100;
  if (rounded > REGULAR_SO_BUFFER_HARD_MAX + 1e-9) {
    return {
      ok: false,
      statusCode: 400,
      code: "BUFFER_PERCENT_BLOCKED",
      message: `Production buffer above ${REGULAR_SO_BUFFER_HARD_MAX}% is blocked.`,
    };
  }
  const normalized = clampBufferPercent(raw);
  if (normalized > REGULAR_SO_BUFFER_SOFT_MAX + 1e-9) {
    const r = String(role ?? "").trim().toUpperCase();
    const reasonOk = Boolean(String(bufferReason ?? "").trim());
    if (r === "ADMIN" || hasMatchingApprovedRequest) {
      if (!reasonOk) {
        return {
          ok: false,
          statusCode: 400,
          code: "BUFFER_PERCENT_REASON_REQUIRED",
          message: "A reason is required when Production buffer is above 5%.",
        };
      }
    } else {
      return {
        ok: false,
        statusCode: 403,
        code: "BUFFER_PERCENT_ADMIN_REQUIRED",
        message: "Buffer above 5% requires Admin approval.",
      };
    }
  }
  return { ok: true, bufferPercent: normalized };
}

function snapshotLineFromSalesOrderLine(line, bufferPercent, fgStockQty, opts = {}) {
  const customerCommittedQty = n(line.customerPoQty ?? line.qty);
  const productionBufferPercent = clampBufferPercent(bufferPercent);
  const rawPlanned = computePlannedQtyFromCustomerBuffer(customerCommittedQty, productionBufferPercent);
  let plannedProductionQty = applyFgUomPrecisionToPlannedQty(rawPlanned, opts.uomDecimalPlaces ?? 0);
  plannedProductionQty = capPlannedQtyByRmSupportedMax(plannedProductionQty, opts.rmSupportedMaxQty);
  const productionBufferQty = Math.max(0, plannedProductionQty - customerCommittedQty);
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

async function upsertRegularSoPlanningSnapshot(
  {
    salesOrderId,
    bufferPercent = 0,
    createdByUserId = null,
    actorRole = null,
    bufferReason = null,
    skipBufferApprovalSupersede = false,
  },
  db = prisma,
) {
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

  // Lazy require avoids circular load with regularSoBufferApprovalService (approve → upsert).
  const {
    hasMatchingApprovedRegularSoBufferRequest,
    supersedeRegularSoBufferApprovalsForSalesOrder,
  } = require("./regularSoBufferApprovalService");

  const hasMatchingApprovedRequest = await hasMatchingApprovedRegularSoBufferRequest(
    soId,
    { bufferPercent, bufferReason },
    db,
  );

  const bufferGate = assertRegularSoBufferPercentForPersist(bufferPercent, {
    role: actorRole,
    bufferReason,
    hasMatchingApprovedRequest,
  });
  if (!bufferGate.ok) {
    const err = new Error(bufferGate.message);
    err.statusCode = bufferGate.statusCode;
    err.code = bufferGate.code;
    throw err;
  }
  const normalizedBufferPercent = bufferGate.bufferPercent;

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

  // Root Prisma client starts a transaction; when already inside a tx (interactive client),
  // reuse it — do not call nested `$transaction` (tx.$transaction is undefined).
  const run = async (tx) => {
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
      const rawPlanned = computePlannedQtyFromCustomerBuffer(customerCommittedQty, normalizedBufferPercent);
      const plannedProductionQty = applyFgUomPrecisionToPlannedQty(rawPlanned, 0);
      const productionBufferQty = Math.max(0, plannedProductionQty - customerCommittedQty);
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

    if (!skipBufferApprovalSupersede) {
      const roleUpper = String(actorRole ?? "").trim().toUpperCase();
      // Admin direct apply or buffer drop to ≤5% invalidates outstanding Store approval requests.
      // Store persist of a matching APPROVED fingerprint keeps that approval intact.
      const shouldSupersede =
        roleUpper === "ADMIN" ||
        normalizedBufferPercent <= REGULAR_SO_BUFFER_SOFT_MAX + 1e-9 ||
        !hasMatchingApprovedRequest;
      if (shouldSupersede) {
        await supersedeRegularSoBufferApprovalsForSalesOrder(soId, tx);
      }
    }

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
  };

  return typeof db.$transaction === "function" ? db.$transaction(run) : run(db);
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
  clampBufferPercent,
  assertRegularSoBufferPercentForPersist,
  applyFgUomPrecisionToPlannedQty,
  capPlannedQtyByRmSupportedMax,
  REGULAR_SO_BUFFER_SOFT_MAX,
  REGULAR_SO_BUFFER_HARD_MAX,
};
