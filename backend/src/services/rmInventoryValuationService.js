/**
 * RM inventory rate for reporting — latest non-reversed GRN rate snapshot per item.
 */

const { prisma } = require("../utils/prisma");
const { qtyToNumber } = require("./rmPurchaseHelpers");

function n(v) {
  return qtyToNumber(v);
}

/**
 * @param {number} itemId
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} [db]
 * @returns {Promise<{ rate: number, source: string | null }>}
 */
async function getLatestRmGrnRateForItem(itemId, db = prisma) {
  const line = await db.grnLine.findFirst({
    where: {
      rmPoLine: { itemId: Number(itemId) },
      grn: { reversedAt: null },
      rateSnapshot: { gt: 0 },
    },
    orderBy: { grn: { date: "desc" } },
    select: { rateSnapshot: true, grn: { select: { id: true, date: true } } },
  });
  if (!line) return { rate: 0, source: null };
  return {
    rate: n(line.rateSnapshot),
    source: line.grn?.id ? `GRN-${line.grn.id}` : null,
  };
}

/**
 * @param {number[]} itemIds
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} [db]
 */
async function getLatestRmGrnRatesByItemIds(itemIds, db = prisma) {
  const ids = [...new Set((itemIds || []).map(Number).filter((id) => id > 0))];
  const map = new Map();
  await Promise.all(
    ids.map(async (itemId) => {
      map.set(itemId, await getLatestRmGrnRateForItem(itemId, db));
    }),
  );
  return map;
}

module.exports = {
  getLatestRmGrnRateForItem,
  getLatestRmGrnRatesByItemIds,
};
