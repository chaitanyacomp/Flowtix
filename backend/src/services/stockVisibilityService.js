/**
 * Phase 1 — Godown / department stock visibility (read-only reporting).
 * Uses existing StockTransaction + Location + StockBucket; does not post stock.
 */

const { prisma } = require("../utils/prisma");
const { loadStockUsableByItemAndLocation, loadStockBucketsByItemIdMap } = require("./stockService");
const { listMovementHistory } = require("./stockMovementLedgerService");
const { STOCK_EPS } = require("./stockService");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");

const STORE_LOCATION_TYPES = new Set(["RM_STORE", "CONSUMABLE"]);
const PRODUCTION_LOCATION_TYPES = new Set(["PRODUCTION"]);
const WIP_LOCATION_TYPES = new Set(["WIP"]);
const FG_STORE_LOCATION_TYPES = new Set(["FG_STORE"]);

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function emptyGodownQty() {
  return {
    rmStore: 0,
    reservedStock: 0,
    freeStock: 0,
    production: 0,
    wip: 0,
    fgStore: 0,
    qcHold: 0,
    scrap: 0,
    unassignedUsable: 0,
  };
}

/**
 * Map physical location type → godown column (USABLE bucket only).
 * @param {string | null | undefined} locationType
 * @returns {'rmStore'|'production'|'wip'|'fgStore'|'unassignedUsable'|null}
 */
function godownColumnForLocationType(locationType) {
  const t = String(locationType || "").toUpperCase();
  if (STORE_LOCATION_TYPES.has(t)) return "rmStore";
  if (PRODUCTION_LOCATION_TYPES.has(t)) return "production";
  if (WIP_LOCATION_TYPES.has(t)) return "wip";
  if (FG_STORE_LOCATION_TYPES.has(t)) return "fgStore";
  return "unassignedUsable";
}

/**
 * @param {Record<string, number>} cols
 */
function godownRowTotal(cols) {
  return round3(
    n(cols.rmStore) +
      n(cols.production) +
      n(cols.wip) +
      n(cols.fgStore) +
      n(cols.qcHold) +
      n(cols.scrap) +
      n(cols.unassignedUsable),
  );
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {{ itemType?: 'RM'|'FG'|'ALL', q?: string }} [opts]
 */
async function buildGodownStockOverview(db = prisma, opts = {}) {
  const itemTypeFilter = opts.itemType != null ? String(opts.itemType).toUpperCase() : "ALL";
  const q = String(opts.q || "")
    .trim()
    .toLowerCase();

  const [usableRows, bucketsByItem, locations, items] = await Promise.all([
    loadStockUsableByItemAndLocation(db),
    loadStockBucketsByItemIdMap(db, { allLocations: true }),
    db.location.findMany({
      where: { isActive: true },
      select: { id: true, locationType: true, locationName: true },
    }),
    db.item.findMany({
      select: { id: true, itemName: true, itemType: true, unit: true },
      orderBy: { itemName: "asc" },
    }),
  ]);

  const locTypeById = new Map(locations.map((l) => [l.id, l.locationType]));
  const storeLocationIds = locations
    .filter((l) => STORE_LOCATION_TYPES.has(String(l.locationType || "").toUpperCase()))
    .map((l) => l.id);

  /** @type {Map<number, ReturnType<typeof emptyGodownQty>>} */
  const byItem = new Map();

  for (const row of usableRows) {
    if (row.qty <= STOCK_EPS) continue;
    const cols = byItem.get(row.itemId) || emptyGodownQty();
    const locType = row.locationId != null ? locTypeById.get(row.locationId) : null;
    const col = godownColumnForLocationType(locType);
    if (col) cols[col] = round3(cols[col] + row.qty);
    byItem.set(row.itemId, cols);
  }

  for (const [itemId, buckets] of bucketsByItem) {
    const cols = byItem.get(itemId) || emptyGodownQty();
    cols.qcHold = round3(Math.max(0, n(buckets.QC_HOLD)));
    cols.scrap = round3(Math.max(0, n(buckets.SCRAP)));
    byItem.set(itemId, cols);
  }

  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemIds = new Set([...byItem.keys(), ...items.map((i) => i.id)]);
  const rmItemIds = items.filter((i) => i.itemType === "RM").map((i) => i.id);
  const availabilityRows = rmItemIds.length
    ? await getMaterialAvailabilityByItems({
        db,
        itemIds: rmItemIds,
        locationScope: storeLocationIds.length ? { where: { locationId: { in: storeLocationIds } } } : {},
        includeIncoming: false,
        includeIssued: false,
      })
    : [];
  const availabilityByItem = new Map((availabilityRows || []).map((row) => [row.itemId, row]));

  const rows = [];
  for (const itemId of itemIds) {
    const item = itemById.get(itemId);
    if (!item) continue;
    if (itemTypeFilter === "RM" && item.itemType !== "RM") continue;
    if (itemTypeFilter === "FG" && item.itemType !== "FG") continue;
    if (q && !item.itemName.toLowerCase().includes(q)) continue;

    const cols = byItem.get(itemId) || emptyGodownQty();
    const availability = item.itemType === "RM" ? availabilityByItem.get(itemId) : null;
    if (availability) {
      cols.reservedStock = round3(n(availability.effectiveReservedQty));
      cols.freeStock = round3(n(availability.freeStockQty));
    }
    const total = godownRowTotal(cols);
    if (total <= STOCK_EPS) continue;

    rows.push({
      itemId,
      itemName: item.itemName,
      itemType: item.itemType,
      unit: item.unit || "",
      total,
      ...cols,
    });
  }

  rows.sort((a, b) => a.itemName.localeCompare(b.itemName));

  const totals = emptyGodownQty();
  for (const r of rows) {
    totals.rmStore = round3(totals.rmStore + r.rmStore);
    totals.reservedStock = round3(totals.reservedStock + n(r.reservedStock));
    totals.freeStock = round3(totals.freeStock + n(r.freeStock));
    totals.production = round3(totals.production + r.production);
    totals.wip = round3(totals.wip + r.wip);
    totals.fgStore = round3(totals.fgStore + r.fgStore);
    totals.qcHold = round3(totals.qcHold + r.qcHold);
    totals.scrap = round3(totals.scrap + r.scrap);
    totals.unassignedUsable = round3(totals.unassignedUsable + r.unassignedUsable);
  }

  return {
    rows,
    totals: { total: godownRowTotal(totals), ...totals },
    columnLabels: {
      rmStore: "RM Store",
      reservedStock: "Reserved",
      freeStock: "Free",
      production: "At Production",
      wip: "WIP",
      fgStore: "FG Store",
      qcHold: "Under QC",
      scrap: "Scrap",
      unassignedUsable: "Unassigned",
    },
  };
}

/**
 * Lifetime operational flow totals for one item (all WOs combined).
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} itemId
 */
async function aggregateItemOperationalFlows(db, itemId, locTypeById) {
  const txns = await db.stockTransaction.findMany({
    where: { itemId },
    select: {
      transactionType: true,
      locationId: true,
      stockBucket: true,
      qtyIn: true,
      qtyOut: true,
    },
  });

  let grnReceived = 0;
  let issuedToProduction = 0;
  let returnedToStore = 0;
  let consumedInProduction = 0;
  let dispatchOut = 0;

  for (const t of txns) {
    const qIn = n(t.qtyIn);
    const qOut = n(t.qtyOut);
    const locType =
      t.locationId != null ? String(locTypeById.get(t.locationId) || "").toUpperCase() : "";

    if (t.transactionType === "GRN" && qIn > STOCK_EPS) {
      grnReceived += qIn;
    }
    if (t.transactionType === "DISPATCH" && qOut > STOCK_EPS) {
      dispatchOut += qOut;
    }
    if (t.transactionType === "LOCATION_TRANSFER") {
      if (STORE_LOCATION_TYPES.has(locType) && qOut > STOCK_EPS) issuedToProduction += qOut;
      if (STORE_LOCATION_TYPES.has(locType) && qIn > STOCK_EPS) returnedToStore += qIn;
    }
    if (t.transactionType === "ISSUE" && t.stockBucket === "USABLE") {
      if (PRODUCTION_LOCATION_TYPES.has(locType) || WIP_LOCATION_TYPES.has(locType)) {
        const net = qOut - qIn;
        if (net > STOCK_EPS) consumedInProduction += net;
      }
    }
  }

  return {
    grnReceived: round3(grnReceived),
    issuedToProduction: round3(issuedToProduction),
    returnedToStore: round3(returnedToStore),
    consumedInProduction: round3(consumedInProduction),
    dispatchOut: round3(dispatchOut),
  };
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} itemId
 */
async function buildItemStockDrilldown(db = prisma, itemId) {
  const item = await db.item.findUnique({
    where: { id: itemId },
    select: { id: true, itemName: true, itemType: true, unit: true },
  });
  if (!item) {
    const err = new Error("Item not found");
    err.statusCode = 404;
    throw err;
  }

  const locations = await db.location.findMany({
    where: { isActive: true },
    select: { id: true, locationType: true, locationName: true },
  });
  const locTypeById = new Map(locations.map((l) => [l.id, l.locationType]));

  const overview = await buildGodownStockOverview(db, { itemType: "ALL" });
  const position =
    overview.rows.find((r) => r.itemId === itemId) ||
    (() => {
      const cols = emptyGodownQty();
      return { itemId, total: 0, ...cols };
    })();

  const flows = await aggregateItemOperationalFlows(db, itemId, locTypeById);

  const remainingAtProduction = round3(position.production);
  const freeInStore = round3(position.rmStore + position.fgStore);

  const history = await listMovementHistory({
    itemId,
    movement: "ALL",
    page: 1,
    pageSize: 25,
    sort: "desc",
  });

  const summaryLines = [];
  if (item.itemType === "RM") {
    if (flows.issuedToProduction > STOCK_EPS) {
      summaryLines.push({
        key: "issued",
        label: "RM Store → Production",
        qty: flows.issuedToProduction,
        tone: "transfer",
      });
    }
    if (flows.consumedInProduction > STOCK_EPS) {
      summaryLines.push({
        key: "consumed",
        label: "Consumed in Production",
        qty: flows.consumedInProduction,
        tone: "consumption",
      });
    }
    if (flows.returnedToStore > STOCK_EPS) {
      summaryLines.push({
        key: "returned",
        label: "Returned to Store",
        qty: flows.returnedToStore,
        tone: "return",
      });
    }
    if (remainingAtProduction > STOCK_EPS) {
      summaryLines.push({
        key: "atProduction",
        label: "Remaining at Production",
        qty: remainingAtProduction,
        tone: "position",
      });
    }
    if (freeInStore > STOCK_EPS) {
      summaryLines.push({
        key: "store",
        label: "Free in Store",
        qty: freeInStore,
        tone: "position",
      });
    }
    if (position.wip > STOCK_EPS) {
      summaryLines.push({
        key: "wip",
        label: "At WIP",
        qty: position.wip,
        tone: "position",
      });
    }
  } else {
    if (flows.grnReceived > STOCK_EPS) {
      summaryLines.push({ key: "grn", label: "Received (GRN)", qty: flows.grnReceived, tone: "receipt" });
    }
    if (position.fgStore > STOCK_EPS) {
      summaryLines.push({ key: "fgStore", label: "Free in FG Store", qty: position.fgStore, tone: "position" });
    }
    if (position.qcHold > STOCK_EPS) {
      summaryLines.push({ key: "qcHold", label: "Under QC", qty: position.qcHold, tone: "qc" });
    }
    if (position.scrap > STOCK_EPS) {
      summaryLines.push({ key: "scrap", label: "Scrap", qty: position.scrap, tone: "scrap" });
    }
    if (flows.dispatchOut > STOCK_EPS) {
      summaryLines.push({ key: "dispatch", label: "Dispatched", qty: flows.dispatchOut, tone: "dispatch" });
    }
  }

  if (flows.grnReceived > STOCK_EPS && item.itemType === "RM") {
    summaryLines.unshift({
      key: "grn",
      label: "Received (GRN)",
      qty: flows.grnReceived,
      tone: "receipt",
    });
  }

  return {
    item,
    positions: position,
    flows,
    summaryLines,
    movementHistory: history.items,
    movementHistoryTotal: history.total,
  };
}

module.exports = {
  STORE_LOCATION_TYPES,
  PRODUCTION_LOCATION_TYPES,
  WIP_LOCATION_TYPES,
  FG_STORE_LOCATION_TYPES,
  godownColumnForLocationType,
  godownRowTotal,
  emptyGodownQty,
  buildGodownStockOverview,
  buildItemStockDrilldown,
};
