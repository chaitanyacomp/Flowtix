/**
 * Phase 3A.1 — Stock movement / material transfer ledger (read-only reporting).
 * Reads StockTransaction only; does not change stock calculations.
 */

const { prisma } = require("../utils/prisma");
const { mapLocationRow } = require("./locationService");
const { UNASSIGNED_LOCATION_LABEL } = require("./grnLocationService");
const { getUsableItemStockQty } = require("./stockService");

const MOVEMENT_FILTERS = new Set([
  "ALL",
  "GRN",
  "LOCATION_TRANSFER",
  "MATERIAL_RETURN",
  "PRODUCTION_CONSUMPTION",
  "DISPATCH",
  "QC",
  "REVERSAL",
  "ADJUSTMENT",
  "OPENING",
  "BUCKET_TRANSFER",
]);

const STOCK_TXN_TYPES = new Set([
  "OPENING",
  "OPENING_REVERSAL",
  "GRN",
  "ISSUE",
  "PRODUCTION",
  "QC",
  "DISPATCH",
  "SCRAP",
  "ADJUSTMENT",
  "BUCKET_TRANSFER",
  "LOCATION_TRANSFER",
  "DISPATCH_REVERSAL",
  "QC_REVERSAL",
  "CUSTOMER_RETURN",
]);

function qtyNum(v) {
  return Number(v) || 0;
}

function locName(loc) {
  if (!loc) return UNASSIGNED_LOCATION_LABEL;
  return loc.locationName || loc.locationCode || UNASSIGNED_LOCATION_LABEL;
}

/**
 * Operational activity label for movement ledger UI.
 * @param {{ transactionType: string, qtyIn: unknown, qtyOut: unknown, reversalOfId?: number | null }} row
 */
function movementActivityLabel(row) {
  const t = String(row.transactionType || "");
  const qIn = qtyNum(row.qtyIn);
  const qOut = qtyNum(row.qtyOut);
  if (t === "GRN") return "Goods Receipt";
  if (t === "LOCATION_TRANSFER") return "Material Transfer";
  if (t === "ISSUE") {
    if (qOut > 0) return "Production Consumption";
    if (qIn > 0) return "Production Return";
    return "Production Issue";
  }
  if (t === "DISPATCH") return "Dispatch";
  if (t === "DISPATCH_REVERSAL") return "Dispatch Reversal";
  if (t === "QC") return "QC Posting";
  if (t === "QC_REVERSAL") return "QC Reversal";
  if (t === "PRODUCTION") return "Production";
  if (t === "OPENING") return "Opening Stock";
  if (t === "OPENING_REVERSAL") return "Opening Reversal";
  if (t === "SCRAP") return "Scrap / Loss";
  if (t === "RM_WASTAGE") return "RM Wastage";
  if (t === "BUCKET_TRANSFER") return "Bucket Transfer";
  if (t === "CUSTOMER_RETURN") return "Customer Return";
  if (t === "ADJUSTMENT") {
    if (row.reversalOfId != null) return "Adjustment Reversal";
    if (qIn > 0 && qOut <= 0) return "Stock Increase";
    if (qOut > 0 && qIn <= 0) return "Stock Decrease";
    return "Stock Adjustment";
  }
  return t.replace(/_/g, " ");
}

/**
 * @param {string} filter
 * @returns {import('@prisma/client').Prisma.StockTransactionWhereInput}
 */
function buildMovementFilterWhere(filter) {
  const f = String(filter || "ALL").toUpperCase();
  if (!MOVEMENT_FILTERS.has(f) || f === "ALL") return {};
  if (f === "GRN") return { transactionType: "GRN" };
  if (f === "LOCATION_TRANSFER") return { transactionType: "LOCATION_TRANSFER" };
  if (f === "PRODUCTION_CONSUMPTION") return { transactionType: "ISSUE", qtyOut: { gt: 0 } };
  if (f === "DISPATCH") return { transactionType: { in: ["DISPATCH", "DISPATCH_REVERSAL"] } };
  if (f === "QC") return { transactionType: { in: ["QC", "QC_REVERSAL", "PRODUCTION"] } };
  if (f === "ADJUSTMENT") return { transactionType: "ADJUSTMENT" };
  if (f === "OPENING") return { transactionType: { in: ["OPENING", "OPENING_REVERSAL"] } };
  if (f === "BUCKET_TRANSFER") return { transactionType: "BUCKET_TRANSFER" };
  if (f === "REVERSAL") {
    return {
      OR: [
        { transactionType: "QC_REVERSAL" },
        { transactionType: "DISPATCH_REVERSAL" },
        { transactionType: "OPENING_REVERSAL" },
        { AND: [{ transactionType: "ADJUSTMENT" }, { reversalOfId: { not: null } }] },
      ],
    };
  }
  return {};
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} locationId
 */
async function locationTransferRefIdsAtLocation(db, locationId) {
  const rows = await db.stockTransaction.findMany({
    where: { transactionType: "LOCATION_TRANSFER", locationId, refId: { gt: 0 } },
    select: { refId: true },
    distinct: ["refId"],
  });
  return rows.map((r) => r.refId).filter((id) => id > 0);
}

/**
 * @param {Array<import('@prisma/client').StockTransaction & { item?: import('@prisma/client').Item, location?: import('@prisma/client').Location | null }>} rows
 * @param {import('@prisma/client').PrismaClient} db
 */
async function enrichMovementRows(rows, db = prisma) {
  const transferKeys = new Set();
  for (const r of rows) {
    if (r.transactionType === "LOCATION_TRANSFER" && r.refId > 0) {
      transferKeys.add(`${r.refId}:${r.itemId}`);
    }
  }

  /** @type {Map<string, { out: typeof rows[0] | null, in: typeof rows[0] | null }>} */
  const pairByKey = new Map();
  if (transferKeys.size > 0) {
    const refIds = [...new Set([...transferKeys].map((k) => Number(k.split(":")[0])))];
    const itemIds = [...new Set([...transferKeys].map((k) => Number(k.split(":")[1])))];
    const pairRows = await db.stockTransaction.findMany({
      where: {
        transactionType: "LOCATION_TRANSFER",
        refId: { in: refIds },
        itemId: { in: itemIds },
      },
      include: { location: true },
    });
    for (const pr of pairRows) {
      const key = `${pr.refId}:${pr.itemId}`;
      if (!pairByKey.has(key)) pairByKey.set(key, { out: null, in: null });
      const slot = pairByKey.get(key);
      if (qtyNum(pr.qtyOut) > 0) slot.out = pr;
      if (qtyNum(pr.qtyIn) > 0) slot.in = pr;
    }
  }

  const transferRefIds = [
    ...new Set(rows.filter((r) => r.transactionType === "LOCATION_TRANSFER" && r.refId > 0).map((r) => r.refId)),
  ];
  const minById = new Map();
  const mrnById = new Map();
  if (transferRefIds.length) {
    const [minNotes, mrnNotes] = await Promise.all([
      db.materialIssueNote.findMany({
        where: { id: { in: transferRefIds } },
        select: { id: true, docNo: true },
      }),
      db.materialReturnNote.findMany({
        where: { id: { in: transferRefIds } },
        select: { id: true, docNo: true },
      }),
    ]);
    for (const note of minNotes) minById.set(note.id, note.docNo);
    for (const note of mrnNotes) mrnById.set(note.id, note.docNo);
  }

  const grnLineIds = rows.filter((r) => r.transactionType === "GRN" && r.refId > 0).map((r) => r.refId);
  const grnLineById = new Map();
  if (grnLineIds.length) {
    const glRows = await db.grnLine.findMany({
      where: { id: { in: grnLineIds } },
      select: {
        id: true,
        grnId: true,
        grn: { select: { id: true, rmPoId: true } },
      },
    });
    for (const g of glRows) grnLineById.set(g.id, g);
  }

  return rows.map((r) => {
    const qIn = qtyNum(r.qtyIn);
    const qOut = qtyNum(r.qtyOut);
    let activity = movementActivityLabel(r);
    const rowLoc = r.location ? mapLocationRow(r.location) : null;
    const rowLocationName = locName(rowLoc);

    let fromLocationId = r.locationId ?? null;
    let fromLocationName = rowLocationName;
    let toLocationId = null;
    let toLocationName = null;
    let refDisplay = r.refId > 0 ? `#${r.refId}` : "";

    if (r.transactionType === "LOCATION_TRANSFER" && r.refId > 0) {
      const pair = pairByKey.get(`${r.refId}:${r.itemId}`);
      const outRow = pair?.out;
      const inRow = pair?.in;
      if (outRow?.location) {
        fromLocationId = outRow.locationId;
        fromLocationName = locName(mapLocationRow(outRow.location));
      }
      if (inRow?.location) {
        toLocationId = inRow.locationId;
        toLocationName = locName(mapLocationRow(inRow.location));
      }
      const mrnDoc = mrnById.get(r.refId);
      const minDoc = minById.get(r.refId);
      if (mrnDoc) {
        activity = "Material Return";
        refDisplay = mrnDoc || `MRN #${r.refId}`;
      } else {
        refDisplay = minDoc || `MIN #${r.refId}`;
      }
    } else if (r.transactionType === "GRN" && r.refId > 0) {
      const gl = grnLineById.get(r.refId);
      refDisplay = gl?.grnId ? `GRN-${gl.grnId}` : `GRN line #${r.refId}`;
    } else if (r.transactionType === "ISSUE" && r.refId > 0) {
      refDisplay = `Production #${r.refId}`;
    } else if (r.transactionType === "ADJUSTMENT" && r.refId > 0) {
      refDisplay = `Adjustment #${r.id}`;
    } else if (r.transactionType === "DISPATCH" && r.refId > 0) {
      refDisplay = `Dispatch #${r.refId}`;
    } else if (r.transactionType === "QC" && r.refId > 0) {
      refDisplay = `QC #${r.refId}`;
    }

    let sourceRoute = null;
    if (r.transactionType === "GRN") {
      const gl = grnLineById.get(r.refId);
      const rmPoId = gl?.grn?.rmPoId;
      if (rmPoId) sourceRoute = `/rm-po-grn/${rmPoId}`;
    } else if (r.transactionType === "LOCATION_TRANSFER" && r.refId > 0) {
      sourceRoute = mrnById.has(r.refId) ? "/production/rm-returns" : "/material-issue";
    } else if (r.transactionType === "ISSUE" && r.refId > 0) {
      sourceRoute = "/production";
    }

    return {
      id: r.id,
      date: r.date,
      itemId: r.itemId,
      itemName: r.item?.itemName ?? "",
      itemType: r.item?.itemType ?? "",
      unit: r.item?.unit ?? "",
      transactionType: r.transactionType,
      activityLabel: activity,
      refId: r.refId,
      refDisplay,
      stockBucket: r.stockBucket,
      locationId: r.locationId,
      locationName: rowLocationName,
      fromLocationId,
      fromLocationName,
      toLocationId,
      toLocationName,
      qtyIn: qIn,
      qtyOut: qOut,
      notes: (r.reason || "").trim() || null,
      reversalOfId: r.reversalOfId,
      sourceRoute,
      runningBalanceAfter: null,
    };
  });
}

/**
 * @param {{
 *   itemId?: number | null,
 *   locationId?: number | null,
 *   itemType?: string | null,
 *   movement?: string,
 *   transactionType?: string | null,
 *   dateFrom?: Date,
 *   dateTo?: Date,
 *   page?: number,
 *   pageSize?: number,
 *   sort?: 'asc' | 'desc',
 *   stockBucket?: string | null,
 * }} params
 */
async function listMovementHistory(params = {}) {
  const page = Math.max(1, Math.floor(params.page) || 1);
  const pageSize = Math.max(1, Math.min(200, Math.floor(params.pageSize) || 50));
  const sort = params.sort === "asc" ? "asc" : "desc";
  const movement =
    params.movement && MOVEMENT_FILTERS.has(String(params.movement).toUpperCase())
      ? String(params.movement).toUpperCase()
      : "ALL";

  const txnRaw = params.transactionType != null ? String(params.transactionType).trim().toUpperCase() : "";

  /** @type {import('@prisma/client').Prisma.StockTransactionWhereInput} */
  const where = {
    ...buildMovementFilterWhere(movement),
  };

  if (movement === "MATERIAL_RETURN") {
    const mrnRows = await prisma.materialReturnNote.findMany({ select: { id: true } });
    const refIds = mrnRows.map((m) => m.id).filter((id) => id > 0);
    where.transactionType = "LOCATION_TRANSFER";
    where.refId = refIds.length ? { in: refIds } : { in: [-1] };
  }

  if (txnRaw && STOCK_TXN_TYPES.has(txnRaw)) {
    where.transactionType = txnRaw;
  }

  const itemId = params.itemId != null && Number.isFinite(params.itemId) && params.itemId > 0 ? params.itemId : null;
  if (itemId) where.itemId = itemId;

  const itemTypeRaw = params.itemType != null ? String(params.itemType).trim().toUpperCase() : "";
  if (itemTypeRaw === "FG" || itemTypeRaw === "RM") {
    where.item = { itemType: itemTypeRaw };
  }

  const bucketRaw = params.stockBucket != null ? String(params.stockBucket).trim().toUpperCase() : "";
  if (bucketRaw && bucketRaw !== "ALL") {
    where.stockBucket = bucketRaw;
  }

  const locationId =
    params.locationId != null && Number.isFinite(params.locationId) && params.locationId > 0
      ? params.locationId
      : null;
  if (locationId) {
    const transferRefIds = await locationTransferRefIdsAtLocation(prisma, locationId);
    where.OR = [
      { locationId },
      ...(transferRefIds.length
        ? [{ transactionType: "LOCATION_TRANSFER", refId: { in: transferRefIds } }]
        : []),
    ];
  }

  if (params.dateFrom || params.dateTo) {
    where.date = {};
    if (params.dateFrom) where.date.gte = params.dateFrom;
    if (params.dateTo) where.date.lte = params.dateTo;
  }

  const orderBy =
    sort === "asc" ? [{ date: "asc" }, { id: "asc" }] : [{ date: "desc" }, { id: "desc" }];

  const skip = (page - 1) * pageSize;

  const [total, rows] = await Promise.all([
    prisma.stockTransaction.count({ where }),
    prisma.stockTransaction.findMany({
      where,
      orderBy,
      skip,
      take: pageSize,
      include: { item: true, location: true },
    }),
  ]);

  let items = await enrichMovementRows(rows);

  let openingBalanceUsable = null;
  let runningBalanceNote = null;

  const runningEligible = itemId && locationId && sort === "asc" && rows.length > 0;
  const runningItemOnly = itemId && !locationId && sort === "asc" && rows.length > 0;

  if (runningEligible || runningItemOnly) {
    const first = rows[0];
    const openingWhere = {
      AND: [
        where,
        {
          OR: [{ date: { lt: first.date } }, { AND: [{ date: first.date }, { id: { lt: first.id } }] }],
        },
      ],
    };
    if (runningEligible) {
      openingWhere.stockBucket = "USABLE";
      openingWhere.locationId = locationId;
    } else {
      openingWhere.stockBucket = "USABLE";
    }
    const openAgg = await prisma.stockTransaction.aggregate({
      where: openingWhere,
      _sum: { qtyIn: true, qtyOut: true },
    });
    openingBalanceUsable = qtyNum(openAgg._sum.qtyIn) - qtyNum(openAgg._sum.qtyOut);
    let running = openingBalanceUsable;
    items = items.map((it, i) => {
      const r = rows[i];
      const affects =
        runningEligible
          ? String(r.stockBucket).toUpperCase() === "USABLE" && r.locationId === locationId
          : String(r.stockBucket).toUpperCase() === "USABLE";
      if (affects) running += qtyNum(r.qtyIn) - qtyNum(r.qtyOut);
      return { ...it, runningBalanceAfter: affects ? running : null };
    });
    runningBalanceNote = null;
  } else if (itemId && locationId) {
    runningBalanceNote =
      "Select oldest-first sort to show balance after each movement at this location.";
  } else if (itemId) {
    runningBalanceNote = "Select oldest-first sort to show usable balance after each movement.";
  }

  let currentBalance = null;
  if (itemId && locationId) {
    const { getItemStockQty } = require("./stockService");
    currentBalance = await getItemStockQty(itemId, prisma, {
      stockBucket: "USABLE",
      locationId,
    });
  } else if (itemId) {
    currentBalance = await getUsableItemStockQty(itemId, prisma);
  }

  return {
    items,
    total,
    page,
    pageSize,
    sort,
    movement,
    openingBalanceUsable,
    runningBalanceNote,
    currentBalance,
    filterOptions: [...MOVEMENT_FILTERS].map((v) => ({
      value: v,
      label:
        v === "ALL"
          ? "All movements"
          : v === "GRN"
            ? "Goods Receipt"
            : v === "LOCATION_TRANSFER"
              ? "Material Transfer"
              : v === "PRODUCTION_CONSUMPTION"
                ? "Production Consumption"
                : v === "DISPATCH"
                  ? "Dispatch"
                  : v === "QC"
                    ? "QC"
                    : v === "REVERSAL"
                      ? "Reversal"
                      : v.replace(/_/g, " "),
    })),
  };
}

module.exports = {
  MOVEMENT_FILTERS,
  movementActivityLabel,
  buildMovementFilterWhere,
  enrichMovementRows,
  listMovementHistory,
};
