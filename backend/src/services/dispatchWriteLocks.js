/**
 * Row locks for dispatch create / reversal (LOCK → RE-READ → VALIDATE → WRITE).
 * Uses MySQL SELECT … FOR UPDATE via Prisma raw SQL.
 *
 * Lock order (required for any route that touches the same rows): SalesOrder → Item → Dispatch.
 * Always take locks in that sequence to reduce deadlock risk with other writers.
 * Dispatch create locks only SalesOrder + Item (no forward Dispatch row exists yet).
 */

const { Prisma } = require("../prismaClientPackage");

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} soId
 */
async function lockSalesOrderForUpdate(tx, soId) {
  const rows = await tx.$queryRaw(Prisma.sql`SELECT id FROM SalesOrder WHERE id = ${soId} LIMIT 1 FOR UPDATE`);
  if (!rows?.length) {
    const err = new Error("Sales order not found");
    err.statusCode = 404;
    throw err;
  }
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} itemId
 */
async function lockItemForUpdate(tx, itemId) {
  const rows = await tx.$queryRaw(Prisma.sql`SELECT id FROM Item WHERE id = ${itemId} LIMIT 1 FOR UPDATE`);
  if (!rows?.length) {
    const err = new Error("Item not found");
    err.statusCode = 404;
    throw err;
  }
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} dispatchId
 */
async function lockDispatchForUpdate(tx, dispatchId) {
  const rows = await tx.$queryRaw(Prisma.sql`SELECT id FROM Dispatch WHERE id = ${dispatchId} LIMIT 1 FOR UPDATE`);
  if (!rows?.length) {
    const err = new Error("Dispatch not found");
    err.statusCode = 404;
    throw err;
  }
}

module.exports = {
  lockSalesOrderForUpdate,
  lockItemForUpdate,
  lockDispatchForUpdate,
};
