/**
 * Shared helpers for master-data bulk activate / deactivate / hard-delete.
 * Partial success is intentional: each id is classified independently.
 * Never cascade-deletes operational documents — callers supply reference guards.
 */

const { z } = require("zod");

const BULK_IDS_MAX = 500;

const bulkIdsBodySchema = z.object({
  ids: z
    .array(z.number().int().positive())
    .min(1, "ids must be a non-empty array")
    .max(BULK_IDS_MAX, `ids cannot exceed ${BULK_IDS_MAX}`),
});

/**
 * @param {unknown} body
 * @returns {number[]} Unique positive ids (order preserved).
 */
function parseBulkIds(body) {
  const { ids } = bulkIdsBodySchema.parse(body ?? {});
  const seen = new Set();
  const unique = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

/** @param {number} requested */
function emptyBulkResult(requested) {
  return {
    requested,
    changed: [],
    skipped: [],
    blocked: [],
    failed: [],
  };
}

/**
 * Bulk set `isActive`. Already at target state → skipped (idempotent).
 *
 * @param {import("@prisma/client").PrismaClient} db
 * @param {{
 *   model: "customer" | "supplier" | "item",
 *   ids: number[],
 *   isActive: boolean,
 *   alreadyReason: string,
 *   notFoundReason: string,
 * }} opts
 */
async function runBulkIsActiveMutation(db, opts) {
  const { model, ids, isActive, alreadyReason, notFoundReason } = opts;
  const result = emptyBulkResult(ids.length);
  if (ids.length === 0) return result;

  const rows = await db[model].findMany({
    where: { id: { in: ids } },
    select: { id: true, isActive: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const toChange = [];

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      result.failed.push({ id, reason: notFoundReason });
      continue;
    }
    const currentlyActive = row.isActive !== false;
    if (currentlyActive === isActive) {
      result.skipped.push({ id, reason: alreadyReason });
      continue;
    }
    toChange.push(id);
  }

  if (toChange.length === 0) return result;

  try {
    await db.$transaction(async (tx) => {
      await tx[model].updateMany({
        where: { id: { in: toChange } },
        data: { isActive },
      });
    });
    result.changed.push(...toChange);
  } catch (e) {
    const reason = (e && e.message) || "Update failed";
    for (const id of toChange) {
      result.failed.push({ id, reason });
    }
  }
  return result;
}

/**
 * Bulk hard-delete with per-id reference protection and partial success.
 *
 * @param {import("@prisma/client").PrismaClient} db
 * @param {{
 *   model: "customer" | "supplier" | "item",
 *   ids: number[],
 *   hasBlockingReferences: (db: any, id: number) => Promise<boolean | string>,
 *   defaultBlockedReason: string,
 *   notFoundReason: string,
 * }} opts
 */
async function runBulkHardDelete(db, opts) {
  const { model, ids, hasBlockingReferences, defaultBlockedReason, notFoundReason } = opts;
  const result = emptyBulkResult(ids.length);
  if (ids.length === 0) return result;

  const rows = await db[model].findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existing = new Set(rows.map((r) => r.id));
  const deletable = [];

  for (const id of ids) {
    if (!existing.has(id)) {
      result.failed.push({ id, reason: notFoundReason });
      continue;
    }
    let block;
    try {
      block = await hasBlockingReferences(db, id);
    } catch (e) {
      result.failed.push({ id, reason: (e && e.message) || "Dependency check failed" });
      continue;
    }
    if (block) {
      result.blocked.push({
        id,
        reason: typeof block === "string" ? block : defaultBlockedReason,
      });
      continue;
    }
    deletable.push(id);
  }

  for (const id of deletable) {
    try {
      await db[model].delete({ where: { id } });
      result.changed.push(id);
    } catch (delErr) {
      if (delErr && delErr.code === "P2003") {
        result.blocked.push({ id, reason: defaultBlockedReason });
      } else if (delErr && delErr.code === "P2025") {
        result.failed.push({ id, reason: notFoundReason });
      } else {
        result.failed.push({ id, reason: (delErr && delErr.message) || "Delete failed" });
      }
    }
  }
  return result;
}

/**
 * Same protection as single customer DELETE, plus other Restrict FKs.
 * @param {any} db
 * @param {number} customerId
 */
async function customerHasBlockingReferences(db, customerId) {
  const [enquiryCount, poCount, salesOrderCount, rateContractCount, returnCount, salesBillCount] =
    await Promise.all([
      db.enquiry.count({ where: { customerId } }),
      db.customerPO.count({ where: { customerId } }),
      db.salesOrder.count({ where: { customerId } }),
      db.rateContractLine.count({ where: { customerId } }),
      db.customerReturn.count({ where: { customerId } }),
      db.salesBill.count({ where: { customerId } }),
    ]);
  return (
    enquiryCount > 0 ||
    poCount > 0 ||
    salesOrderCount > 0 ||
    rateContractCount > 0 ||
    returnCount > 0 ||
    salesBillCount > 0
  );
}

/**
 * Same protection as single supplier DELETE (RM PO), plus purchase bills / GRNs.
 * @param {any} db
 * @param {number} supplierId
 */
async function supplierHasBlockingReferences(db, supplierId) {
  const [rmPoCount, billCount, grnCount] = await Promise.all([
    db.rmPurchaseOrder.count({ where: { supplierId } }),
    db.purchaseBill.count({ where: { supplierId } }),
    db.grn.count({ where: { supplierId } }),
  ]);
  return rmPoCount > 0 || billCount > 0 || grnCount > 0;
}

module.exports = {
  BULK_IDS_MAX,
  parseBulkIds,
  emptyBulkResult,
  runBulkIsActiveMutation,
  runBulkHardDelete,
  customerHasBlockingReferences,
  supplierHasBlockingReferences,
};
