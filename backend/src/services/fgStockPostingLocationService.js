/**
 * Physical location resolution for FG QC and Dispatch stock postings.
 * Buckets (USABLE, QC_HOLD, …) remain separate from locations.
 */

const { DEFAULT_FG_STORE_CODE, findActiveLocationIdByCode } = require("./locationService");

const DEFAULT_SCRAP_LOCATION_CODE = "LOC-SCRAP";

/** @type {number | null} */
let cachedFgStoreLocationId = null;
/** @type {number | null} */
let cachedScrapLocationId = null;

function clearFgStockPostingLocationCache() {
  cachedFgStoreLocationId = null;
  cachedScrapLocationId = null;
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 */
async function getDefaultFgStoreLocationId(db) {
  if (cachedFgStoreLocationId) return cachedFgStoreLocationId;
  const id = await findActiveLocationIdByCode(db, DEFAULT_FG_STORE_CODE);
  if (!id) {
    const err = new Error("Default FG Store location is not configured. Run database migrations.");
    err.statusCode = 500;
    err.code = "FG_STORE_LOCATION_MISSING";
    throw err;
  }
  cachedFgStoreLocationId = id;
  return id;
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 */
async function getDefaultScrapLocationId(db) {
  if (cachedScrapLocationId) return cachedScrapLocationId;
  let id = await findActiveLocationIdByCode(db, DEFAULT_SCRAP_LOCATION_CODE);
  if (!id) {
    const row = await db.location.findFirst({
      where: { locationType: "SCRAP", isActive: true },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    id = row?.id ?? null;
  }
  if (!id) {
    const err = new Error("Default Scrap location is not configured. Run database migrations.");
    err.statusCode = 500;
    err.code = "SCRAP_LOCATION_MISSING";
    throw err;
  }
  cachedScrapLocationId = id;
  return id;
}

/**
 * Physical location for new FG QC stock rows by inventory bucket.
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {string} stockBucket
 */
async function resolveFgQcStockPostingLocationId(db, stockBucket) {
  const bucket = String(stockBucket || "USABLE").trim().toUpperCase();
  if (bucket === "SCRAP") return getDefaultScrapLocationId(db);
  return getDefaultFgStoreLocationId(db);
}

/** FG dispatch qtyOut source location (same as accepted usable FG). */
async function resolveFgDispatchSourceLocationId(db) {
  return getDefaultFgStoreLocationId(db);
}

/**
 * Reversal rows: preserve forward location when set; else resolve from bucket (legacy null forwards).
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {{ forwardLocationId?: number | null, stockBucket?: string | null }} input
 */
async function resolveStockTxnReversalLocationId(db, { forwardLocationId, stockBucket }) {
  const forwardId = Number(forwardLocationId ?? 0);
  if (Number.isFinite(forwardId) && forwardId > 0) return forwardId;
  return resolveFgQcStockPostingLocationId(db, stockBucket ?? "USABLE");
}

/**
 * Cached per-transaction resolver for repeated QC bucket lookups in one posting.
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 */
async function createFgQcStockLocationResolver(db) {
  /** @type {Map<string, number>} */
  const cache = new Map();
  return async function locationIdForQcBucket(stockBucket) {
    const key = String(stockBucket || "USABLE").trim().toUpperCase();
    if (!cache.has(key)) {
      cache.set(key, await resolveFgQcStockPostingLocationId(db, key));
    }
    return cache.get(key);
  };
}

module.exports = {
  DEFAULT_SCRAP_LOCATION_CODE,
  clearFgStockPostingLocationCache,
  getDefaultFgStoreLocationId,
  getDefaultScrapLocationId,
  resolveFgQcStockPostingLocationId,
  resolveFgDispatchSourceLocationId,
  resolveStockTxnReversalLocationId,
  createFgQcStockLocationResolver,
};
