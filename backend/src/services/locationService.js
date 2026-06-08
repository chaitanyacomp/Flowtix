/**
 * Location master + default RM Store resolution for stock reads/writes.
 * Buckets (USABLE, QC_HOLD, …) remain separate from locations.
 */

const { prisma } = require("../utils/prisma");

const DEFAULT_RM_STORE_CODE = "LOC-RM-STORE";
const DEFAULT_FG_STORE_CODE = "LOC-FG-STORE";
const DEFAULT_CONSUMABLE_STORE_CODE = "LOC-CONSUMABLE-STORE";

/** @type {number | null} */
let cachedDefaultRmLocationId = null;

function itemTypeFlagsFromCheckboxes(body) {
  return {
    allowRm: Boolean(body.allowRm),
    allowFg: Boolean(body.allowFg),
    allowSfg: Boolean(body.allowSfg),
    allowConsumable: Boolean(body.allowConsumable),
  };
}

function assertAtLeastOneItemType(flags) {
  if (flags.allowRm || flags.allowFg || flags.allowSfg || flags.allowConsumable) return;
  const err = new Error("Select at least one allowed item type.");
  err.statusCode = 400;
  throw err;
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 */
async function getDefaultRmStoreLocationId(db = prisma) {
  if (cachedDefaultRmLocationId) return cachedDefaultRmLocationId;
  const row = await db.location.findFirst({
    where: { locationCode: DEFAULT_RM_STORE_CODE, isActive: true },
    select: { id: true },
  });
  if (!row) {
    const err = new Error("Default RM Store location is not configured. Run database migrations.");
    err.statusCode = 500;
    throw err;
  }
  cachedDefaultRmLocationId = row.id;
  return row.id;
}

function clearDefaultRmLocationCache() {
  cachedDefaultRmLocationId = null;
}

/**
 * Default read scope: RM Store + legacy null rows (pre-backfill safety).
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {{ locationId?: number | null, allLocations?: boolean }} opts
 */
async function resolveLocationReadScope(db, opts = {}) {
  if (opts.allLocations) return {};
  if (opts.locationId != null && Number.isFinite(Number(opts.locationId))) {
    return { locationId: Number(opts.locationId) };
  }
  const rmId = await getDefaultRmStoreLocationId(db);
  return { OR: [{ locationId: rmId }, { locationId: null }] };
}

/**
 * Data fragment for new stock transactions (Phase 1: default RM Store).
 */
async function defaultStockTxnLocationData(db = prisma) {
  return { locationId: await getDefaultRmStoreLocationId(db) };
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {string} locationCode
 */
async function findActiveLocationIdByCode(db, locationCode) {
  const row = await db.location.findFirst({
    where: { locationCode, isActive: true },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Default store location for approved opening stock by item type.
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {string} itemType
 */
async function resolveDefaultOpeningStockLocationId(db, itemType) {
  const type = String(itemType || "RM").toUpperCase();
  if (type === "FG") {
    const fgId = await findActiveLocationIdByCode(db, DEFAULT_FG_STORE_CODE);
    if (fgId) return fgId;
    const err = new Error("Default FG Store location is not configured. Run database migrations.");
    err.statusCode = 500;
    throw err;
  }
  if (type === "CONSUMABLE") {
    let consumableId = await findActiveLocationIdByCode(db, DEFAULT_CONSUMABLE_STORE_CODE);
    if (!consumableId) {
      const row = await db.location.findFirst({
        where: { locationType: "CONSUMABLE", isActive: true },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      consumableId = row?.id ?? null;
    }
    if (consumableId) return consumableId;
    const err = new Error("Default Consumable Store location is not configured. Run database migrations.");
    err.statusCode = 500;
    throw err;
  }
  return getDefaultRmStoreLocationId(db);
}

/**
 * Physical location for ADJUSTMENT ledger rows: preserve original when set, else default store by item type.
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {{ locationId?: number | null, itemType: string }} input
 */
async function resolveAdjustmentLocationId(db, { locationId, itemType }) {
  if (locationId != null && Number.isFinite(Number(locationId)) && Number(locationId) > 0) {
    return Number(locationId);
  }
  return resolveDefaultOpeningStockLocationId(db, itemType);
}

async function allocateLocationCode(db = prisma) {
  const customCount = await db.location.count({ where: { isSystem: false } });
  return `LOC-N-${String(customCount + 1).padStart(4, "0")}`;
}

const LOCATION_TYPE_LABELS = {
  RM_STORE: "RM Store",
  PRODUCTION: "Production",
  FG_STORE: "FG Store",
  WIP: "WIP",
  SCRAP: "Scrap",
  VENDOR: "Vendor",
  CONSUMABLE: "Consumable",
  DISPATCH: "Dispatch",
};

const DEPARTMENT_LABELS = {
  STORES: "Stores",
  PRODUCTION: "Production",
  PURCHASE: "Purchase",
  PLANT_HEAD: "Plant Head",
};

function mapLocationRow(row) {
  if (!row) return row;
  const types = [];
  if (row.allowRm) types.push("RM");
  if (row.allowSfg) types.push("SFG");
  if (row.allowFg) types.push("FG");
  if (row.allowConsumable) types.push("CONSUMABLE");
  return {
    ...row,
    locationTypeLabel: LOCATION_TYPE_LABELS[row.locationType] ?? row.locationType,
    departmentLabel: DEPARTMENT_LABELS[row.departmentOwner] ?? row.departmentOwner,
    allowedItemTypes: types,
    allowedItemTypesLabel: types.join(", ") || "—",
  };
}

module.exports = {
  DEFAULT_RM_STORE_CODE,
  DEFAULT_FG_STORE_CODE,
  DEFAULT_CONSUMABLE_STORE_CODE,
  LOCATION_TYPE_LABELS,
  DEPARTMENT_LABELS,
  getDefaultRmStoreLocationId,
  findActiveLocationIdByCode,
  resolveDefaultOpeningStockLocationId,
  resolveAdjustmentLocationId,
  clearDefaultRmLocationCache,
  resolveLocationReadScope,
  defaultStockTxnLocationData,
  allocateLocationCode,
  itemTypeFlagsFromCheckboxes,
  assertAtLeastOneItemType,
  mapLocationRow,
};
