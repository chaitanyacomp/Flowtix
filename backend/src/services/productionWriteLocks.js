/**
 * Row locks for production / QC writes (LOCK → RE-READ → VALIDATE → WRITE).
 * QC reversal uses SalesOrder + Item + QcEntry order via dispatchWriteLocks + lockQcEntryForUpdate.
 * Uses MySQL SELECT … FOR UPDATE via Prisma raw SQL.
 */

const { Prisma } = require("@prisma/client");

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} workOrderLineId
 */
async function lockWorkOrderLineForUpdate(tx, workOrderLineId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT id FROM WorkOrderLine WHERE id = ${workOrderLineId} LIMIT 1 FOR UPDATE`,
  );
  if (!rows?.length) {
    const err = new Error("Work order line not found");
    err.statusCode = 404;
    throw err;
  }
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} productionEntryId
 */
async function lockProductionEntryForUpdate(tx, productionEntryId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT id FROM ProductionEntry WHERE id = ${productionEntryId} LIMIT 1 FOR UPDATE`,
  );
  if (!rows?.length) {
    const err = new Error("Production entry not found");
    err.statusCode = 404;
    throw err;
  }
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} workOrderId
 */
async function lockWorkOrderForUpdate(tx, workOrderId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT id FROM WorkOrder WHERE id = ${workOrderId} LIMIT 1 FOR UPDATE`,
  );
  if (!rows?.length) {
    const err = new Error("Work order not found");
    err.statusCode = 404;
    throw err;
  }
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} qcEntryId
 */
async function lockQcEntryForUpdate(tx, qcEntryId) {
  const rows = await tx.$queryRaw(Prisma.sql`SELECT id FROM QcEntry WHERE id = ${qcEntryId} LIMIT 1 FOR UPDATE`);
  if (!rows?.length) {
    const err = new Error("QC entry not found");
    err.statusCode = 404;
    throw err;
  }
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} dispositionId
 */
async function lockQcRejectedDispositionForUpdate(tx, dispositionId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT id FROM QcRejectedDisposition WHERE id = ${dispositionId} LIMIT 1 FOR UPDATE`,
  );
  if (!rows?.length) {
    const err = new Error("Disposition not found");
    err.statusCode = 404;
    throw err;
  }
}

module.exports = {
  lockWorkOrderLineForUpdate,
  lockProductionEntryForUpdate,
  lockWorkOrderForUpdate,
  lockQcEntryForUpdate,
  lockQcRejectedDispositionForUpdate,
};
