/**
 * Shift Session production-quantity lock (SUBMITTED / VERIFIED report versions).
 * Single source of truth — do not reimplement in routes.
 */

const { domainError } = require("./machineShiftSessionErrors");

const REPORT_VERSION_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  RETURNED: "RETURNED",
  VERIFIED: "VERIFIED",
});

const PRODUCTION_QTY_LOCKED_STATUSES = Object.freeze(
  new Set([REPORT_VERSION_STATUS.SUBMITTED, REPORT_VERSION_STATUS.VERIFIED]),
);

const SHIFT_REPORT_PRODUCTION_LOCKED_MESSAGE =
  "Shift Report has already been submitted. Production quantities cannot change unless the report is returned or the shift is reopened.";

const SHIFT_REPORT_PRODUCTION_LOCKED_UI =
  "Shift Report submitted — production quantities are locked pending manager review.";

/**
 * @param {string | null | undefined} status
 * @returns {{ productionQtyLocked: boolean, productionQtyLockReason: string | null, latestReportStatus: string | null }}
 */
function productionQtyLockFromLatestStatus(status) {
  const latestReportStatus = status != null && status !== "" ? String(status).toUpperCase() : null;
  if (!latestReportStatus) {
    return { productionQtyLocked: false, productionQtyLockReason: null, latestReportStatus: null };
  }
  if (PRODUCTION_QTY_LOCKED_STATUSES.has(latestReportStatus)) {
    return {
      productionQtyLocked: true,
      productionQtyLockReason: SHIFT_REPORT_PRODUCTION_LOCKED_UI,
      latestReportStatus,
    };
  }
  return { productionQtyLocked: false, productionQtyLockReason: null, latestReportStatus };
}

/**
 * Resolve lock state for a shift session from its latest report version.
 * Unlocked when: no report, no versions, DRAFT, or RETURNED (incl. reopen new DRAFT).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 * @param {number} sessionId
 */
async function getShiftSessionProductionQtyLock(db, sessionId) {
  const sid = Number(sessionId);
  if (!Number.isInteger(sid) || sid <= 0) {
    return productionQtyLockFromLatestStatus(null);
  }

  const report = await db.shiftProductionReport.findUnique({
    where: { sessionId: sid },
    select: { id: true, latestVersionNo: true },
  });
  if (!report || Number(report.latestVersionNo) <= 0) {
    return productionQtyLockFromLatestStatus(null);
  }

  const latest = await db.shiftProductionReportVersion.findFirst({
    where: { reportId: report.id, versionNo: report.latestVersionNo },
    select: { status: true, versionNo: true },
  });
  return productionQtyLockFromLatestStatus(latest?.status);
}

function throwShiftReportProductionLocked(details) {
  throw domainError(409, "SHIFT_REPORT_PRODUCTION_LOCKED", SHIFT_REPORT_PRODUCTION_LOCKED_MESSAGE, details);
}

/**
 * Throw if the given session is quantity-locked.
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 * @param {number} sessionId
 */
async function assertShiftSessionProductionQtyUnlocked(db, sessionId) {
  const lock = await getShiftSessionProductionQtyLock(db, sessionId);
  if (lock.productionQtyLocked) {
    throwShiftReportProductionLocked({
      sessionId: Number(sessionId),
      latestReportStatus: lock.latestReportStatus,
    });
  }
  return lock;
}

/**
 * Block PE mutations that are linked—or safely resolvable—to a locked session.
 * Does not invent links; uses existing FKs first, else {@link resolveShiftLinkForProductionEntry}.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{
 *   workOrderId: number,
 *   runAllocationId?: number | null,
 *   shiftSessionId?: number | null,
 *   shiftRunSegmentId?: number | null,
 * }} input
 */
async function assertProductionEntryMutationAllowedForShiftLock(tx, input) {
  const existingSessionId =
    input?.shiftSessionId != null && input.shiftSessionId !== ""
      ? Number(input.shiftSessionId)
      : null;

  if (Number.isInteger(existingSessionId) && existingSessionId > 0) {
    await assertShiftSessionProductionQtyUnlocked(tx, existingSessionId);
    return { lockedSessionId: null, resolved: { shiftSessionId: existingSessionId } };
  }

  const { resolveShiftLinkForProductionEntry } = require("./productionEntryShiftLinkService");
  const resolved = await resolveShiftLinkForProductionEntry(tx, {
    workOrderId: input.workOrderId,
    runAllocationId: input.runAllocationId ?? null,
  });
  if (!resolved) {
    return { lockedSessionId: null, resolved: null };
  }

  await assertShiftSessionProductionQtyUnlocked(tx, resolved.shiftSessionId);
  return { lockedSessionId: null, resolved };
}

module.exports = {
  REPORT_VERSION_STATUS,
  PRODUCTION_QTY_LOCKED_STATUSES,
  SHIFT_REPORT_PRODUCTION_LOCKED_MESSAGE,
  SHIFT_REPORT_PRODUCTION_LOCKED_UI,
  productionQtyLockFromLatestStatus,
  getShiftSessionProductionQtyLock,
  assertShiftSessionProductionQtyUnlocked,
  assertProductionEntryMutationAllowedForShiftLock,
  throwShiftReportProductionLocked,
};
