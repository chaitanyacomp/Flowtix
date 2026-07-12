/**
 * Authoritative NO_QTY recovery / waiver / carry-forward cleanup (FT-PD-022).
 *
 * Child-first reverse FK order — do not change Prisma onDelete Restrict to Cascade.
 * All admin reset paths must call this helper instead of inventing local delete sequences.
 *
 * Order:
 * 1. RecoveryAllocation
 * 2. NoQtySoWaiverLine
 * 3. NoQtySoWaiver
 * 4. CarryForwardPending
 * 5. ProductionShortfallResolution
 */

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string[] | string} candidates
 */
async function tableExists(tx, candidates) {
  const names = Array.isArray(candidates) ? candidates : [candidates];
  for (const n of names) {
    const rows = await tx.$queryRaw`
      SELECT 1 as ok
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND LOWER(table_name) = LOWER(${String(n)})
      LIMIT 1
    `;
    if (Array.isArray(rows) && rows.length > 0) return true;
  }
  return false;
}

/**
 * Tables deleted by {@link cleanupNoQtyRecoveryDependencies} / step builders (verify lists).
 */
const NO_QTY_RECOVERY_CLEANUP_TABLES = Object.freeze([
  "recoveryAllocation",
  "noQtySoWaiverLine",
  "noQtySoWaiver",
  "carryForwardPending",
  "productionShortfallResolution",
]);

/**
 * @param {number[] | null | undefined} ids
 * @returns {number[]}
 */
function normalizeIdList(ids) {
  return (ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ salesOrderIds?: number[] | null; workOrderIds?: number[] | null }} [scope]
 * @returns {Promise<{
 *   recoveryAllocation: { delete: () => Promise<{ count?: number }>; count: () => Promise<number> };
 *   noQtySoWaiverLine: { delete: () => Promise<{ count?: number }>; count: () => Promise<number> };
 *   noQtySoWaiver: { delete: () => Promise<{ count?: number }>; count: () => Promise<number> };
 *   carryForwardPending: { delete: () => Promise<{ count?: number }>; count: () => Promise<number> };
 *   productionShortfallResolution: { delete: () => Promise<{ count?: number }>; count: () => Promise<number> };
 * }>}
 */
async function resolveNoQtyRecoveryCleanupOps(tx, scope = {}) {
  const soIds = normalizeIdList(scope.salesOrderIds);
  const woIds = normalizeIdList(scope.workOrderIds);
  const scoped = soIds.length > 0;

  const hasRecoveryAllocation = await tableExists(tx, ["recoveryallocation", "RecoveryAllocation"]);
  const hasWaiverLine = await tableExists(tx, ["noqtysowaiverline", "NoQtySoWaiverLine"]);
  const hasWaiver = await tableExists(tx, ["noqtysowaiver", "NoQtySoWaiver"]);
  const hasCarryForward = await tableExists(tx, ["carryforwardpending", "CarryForwardPending"]);
  const hasShortfall = await tableExists(tx, ["productionshortfallresolution", "ProductionShortfallResolution"]);

  const empty = async () => ({ count: 0 });
  const zero = async () => 0;

  /** @type {import("@prisma/client").Prisma.RecoveryAllocationWhereInput | undefined} */
  let recoveryAllocationWhere;
  if (scoped && hasRecoveryAllocation) {
    recoveryAllocationWhere = {
      OR: [
        { recoverySource: { salesOrderId: { in: soIds } } },
        { requirementSheet: { salesOrderId: { in: soIds } } },
      ],
    };
  }

  /** @type {import("@prisma/client").Prisma.NoQtySoWaiverLineWhereInput | undefined} */
  let waiverLineWhere;
  if (scoped && hasWaiverLine) {
    waiverLineWhere = {
      OR: [
        { recoverySource: { salesOrderId: { in: soIds } } },
        { waiver: { salesOrderId: { in: soIds } } },
      ],
    };
  }

  /** @type {import("@prisma/client").Prisma.NoQtySoWaiverWhereInput | undefined} */
  let waiverWhere;
  if (scoped && hasWaiver) {
    waiverWhere = { salesOrderId: { in: soIds } };
  }

  /** @type {import("@prisma/client").Prisma.CarryForwardPendingWhereInput | undefined} */
  let carryForwardWhere;
  if (scoped && hasCarryForward) {
    carryForwardWhere = { salesOrderId: { in: soIds } };
  }

  /** @type {import("@prisma/client").Prisma.ProductionShortfallResolutionWhereInput | undefined} */
  let shortfallWhere;
  if (hasShortfall) {
    if (woIds.length > 0) {
      shortfallWhere = { workOrderId: { in: woIds } };
    } else if (scoped) {
      // Scoped SO reset without WO ids: delete shortfall rows for WOs on those SOs.
      shortfallWhere = { workOrder: { salesOrderId: { in: soIds } } };
    }
  }

  return {
    recoveryAllocation: {
      delete: hasRecoveryAllocation
        ? () => tx.recoveryAllocation.deleteMany(recoveryAllocationWhere ? { where: recoveryAllocationWhere } : {})
        : empty,
      count: hasRecoveryAllocation
        ? () => tx.recoveryAllocation.count(recoveryAllocationWhere ? { where: recoveryAllocationWhere } : {})
        : zero,
    },
    noQtySoWaiverLine: {
      delete: hasWaiverLine
        ? () => tx.noQtySoWaiverLine.deleteMany(waiverLineWhere ? { where: waiverLineWhere } : {})
        : empty,
      count: hasWaiverLine
        ? () => tx.noQtySoWaiverLine.count(waiverLineWhere ? { where: waiverLineWhere } : {})
        : zero,
    },
    noQtySoWaiver: {
      delete: hasWaiver ? () => tx.noQtySoWaiver.deleteMany(waiverWhere ? { where: waiverWhere } : {}) : empty,
      count: hasWaiver ? () => tx.noQtySoWaiver.count(waiverWhere ? { where: waiverWhere } : {}) : zero,
    },
    carryForwardPending: {
      delete: hasCarryForward
        ? () => tx.carryForwardPending.deleteMany(carryForwardWhere ? { where: carryForwardWhere } : {})
        : empty,
      count: hasCarryForward
        ? () => tx.carryForwardPending.count(carryForwardWhere ? { where: carryForwardWhere } : {})
        : zero,
    },
    productionShortfallResolution: {
      delete: hasShortfall
        ? () =>
            tx.productionShortfallResolution.deleteMany(shortfallWhere ? { where: shortfallWhere } : {})
        : empty,
      count: hasShortfall
        ? () => tx.productionShortfallResolution.count(shortfallWhere ? { where: shortfallWhere } : {})
        : zero,
    },
  };
}

/**
 * Step list for Reset Transaction Data / Full Demo (global deleteMany).
 * Compatible with buildResetTransactionDataCleanupSteps step shape.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @returns {Array<{ table: string; delete: () => Promise<{ count?: number }>; count: () => Promise<number> }>}
 */
function buildNoQtyRecoveryDependencyCleanupSteps(tx) {
  // Ops are resolved lazily inside each delete/count so tableExists runs at execution time.
  return NO_QTY_RECOVERY_CLEANUP_TABLES.map((table) => ({
    table,
    delete: async () => {
      const ops = await resolveNoQtyRecoveryCleanupOps(tx, {});
      return ops[table].delete();
    },
    count: async () => {
      const ops = await resolveNoQtyRecoveryCleanupOps(tx, {});
      return ops[table].count();
    },
  }));
}

/**
 * Execute the recovery dependency cluster in reverse FK order.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ salesOrderIds?: number[] | null; workOrderIds?: number[] | null }} [scope]
 *   When salesOrderIds is non-empty, deletes are scoped to those SOs (and related WOs for shortfall).
 *   When omitted/empty, deletes are global.
 * @returns {Promise<Record<string, number>>}
 */
async function cleanupNoQtyRecoveryDependencies(tx, scope = {}) {
  const ops = await resolveNoQtyRecoveryCleanupOps(tx, scope);
  /** @type {Record<string, number>} */
  const counts = {};
  for (const table of NO_QTY_RECOVERY_CLEANUP_TABLES) {
    const res = await ops[table].delete();
    counts[table] = typeof res?.count === "number" ? res.count : 0;
  }
  return counts;
}

/**
 * Merge recovery cleanup counts into an existing deletedCounts bag.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {Record<string, number>} deletedCounts
 * @param {{ salesOrderIds?: number[] | null; workOrderIds?: number[] | null }} [scope]
 */
async function applyNoQtyRecoveryDependencyCleanup(tx, deletedCounts, scope = {}) {
  const counts = await cleanupNoQtyRecoveryDependencies(tx, scope);
  for (const [key, value] of Object.entries(counts)) {
    deletedCounts[key] = (deletedCounts[key] ?? 0) + value;
  }
  return counts;
}

module.exports = {
  NO_QTY_RECOVERY_CLEANUP_TABLES,
  applyNoQtyRecoveryDependencyCleanup,
  buildNoQtyRecoveryDependencyCleanupSteps,
  cleanupNoQtyRecoveryDependencies,
  resolveNoQtyRecoveryCleanupOps,
};
