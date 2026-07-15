/**
 * Batch 2B — Gate G3 orchestrator: Production Report (WO) approval.
 *
 * Orchestrator only — business rules live in {@link productionWorkOrderReportService}.
 *
 * ## Authoritative sequence (do not reorder without owner-doc review)
 *
 * 1. **Work order identity** — WO exists
 * 2. **Report not already confirmed** — single approval path
 * 3. **Approved production entries exist** — valid production evidence
 * 4. **RM consumption authority** — derived from approved entry snapshots + issue ledger
 * 5. **Persist confirmed report** — immutable WO manufacturing record (no WO completion in this batch)
 *
 * Production ledger posting for batches occurs on entry approval (G2), not here.
 */

const {
  buildWorkOrderProductionReport,
  confirmProductionWorkOrderReport,
  assertProductionReportNotConfirmed,
  assertProductionReportHasApprovedEntries,
} = require("./productionWorkOrderReportService");

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} db
 * @param {number} workOrderId
 */
async function assertProductionReportApprovalAllowed(db, workOrderId) {
  await assertProductionReportNotConfirmed(db, workOrderId);
  await assertProductionReportHasApprovedEntries(db, workOrderId);
}

/**
 * Confirm the authoritative WO Production Report (Store/Production sign-off).
 * Does not complete the work order — WO completion is deferred to a later batch.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} db
 * @param {number} workOrderId
 * @param {{ remarks?: string | null; lines?: object[]; wastageDetails?: object[] }} input
 * @param {{ userId?: number; actorUserId?: number; role?: string; actorRole?: string }} actor
 */
async function approveProductionWorkOrderReport(db, workOrderId, input = {}, actor = {}, options = {}) {
  await assertProductionReportApprovalAllowed(db, workOrderId);
  return confirmProductionWorkOrderReport(db, workOrderId, input, actor, options);
}

module.exports = {
  assertProductionReportApprovalAllowed,
  approveProductionWorkOrderReport,
  buildWorkOrderProductionReport,
};
