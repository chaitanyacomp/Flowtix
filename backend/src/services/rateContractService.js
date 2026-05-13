/**
 * Customer + item rate contracts (append-only; rate changes insert new rows).
 */

function endOfUtcCalendarDay(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), 23, 59, 59, 999));
}

function normalizeUtcDateOnly(input) {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Ensures the generated client includes `RateContractLine` (camelCase delegate `rateContractLine`).
 * Stale `node_modules/@prisma/client` after adding the model yields undefined here.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} tx
 */
function getRateContractLineDelegate(tx) {
  const delegate = tx?.rateContractLine;
  if (!delegate || typeof delegate.findFirst !== "function") {
    const err = new Error("Rate contracts are temporarily unavailable. Please restart the backend.");
    err.statusCode = 503;
    throw err;
  }
  return delegate;
}

/**
 * Latest APPROVED contract line where effectiveFrom <= as-of calendar day (UTC).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ customerId: number; itemId: number; asOf: Date }} input
 */
async function findApplicableRateContractLine(tx, input) {
  const customerId = Number(input?.customerId);
  const itemId = Number(input?.itemId);
  if (!Number.isFinite(customerId) || customerId <= 0 || !Number.isFinite(itemId) || itemId <= 0) return null;
  const end = endOfUtcCalendarDay(input.asOf);
  if (!end) return null;
  const rateContractLine = getRateContractLineDelegate(tx);
  return rateContractLine.findFirst({
    where: {
      customerId,
      itemId,
      status: "APPROVED",
      effectiveFrom: { lte: end },
    },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
  });
}

module.exports = {
  findApplicableRateContractLine,
  endOfUtcCalendarDay,
  normalizeUtcDateOnly,
  getRateContractLineDelegate,
};
