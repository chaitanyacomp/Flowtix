/**
 * Step 2C — Historical shift report adjustment (request / decide / apply).
 * Reporting history only — no ProductionEntry, QC, stock, WO, or session reopen.
 */

const { prisma } = require("../utils/prisma");
const {
  domainError,
  mapShiftSessionPersistenceError,
} = require("./machineShiftSessionErrors");
const {
  withShiftSessionTx,
  normalizePositiveInt,
  normalizeChangeReason,
  SESSION_STATUS,
} = require("./machineShiftSessionService");
const {
  REPORT_VERSION_STATUS,
  toQty,
  normalizeRemarks,
  normalizeProposedAdjustmentLines,
  assertHeaderMatchesLines,
  loadSessionRunSegmentsMap,
} = require("./machineShiftProductionReportService");

const ADJUSTMENT_STATUS = Object.freeze({
  REQUESTED: "REQUESTED",
  APPROVED: "APPROVED",
  DENIED: "DENIED",
  APPLIED: "APPLIED",
});

const UNRESOLVED_STATUSES = Object.freeze([ADJUSTMENT_STATUS.REQUESTED, ADJUSTMENT_STATUS.APPROVED]);

function normalizeDecisionNote(value, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) {
      throw domainError(400, "DECISION_NOTE_REQUIRED", "A decision note is required when denying an adjustment.");
    }
    return null;
  }
  const text = String(value).trim().replace(/\s+/g, " ");
  if (!text) {
    if (required) {
      throw domainError(400, "DECISION_NOTE_REQUIRED", "A decision note is required when denying an adjustment.");
    }
    return null;
  }
  return text.slice(0, 2000);
}

async function loadAdjustmentRequest(tx, requestId, { includeLines = true } = {}) {
  const request = await tx.shiftProductionReportAdjustmentRequest.findUnique({
    where: { id: requestId },
    include: includeLines
      ? {
          proposedLines: { orderBy: { id: "asc" } },
          reportVersion: { include: { lines: true, report: true } },
          appliedReportVersion: true,
        }
      : {
          reportVersion: { include: { report: true } },
          appliedReportVersion: true,
        },
  });
  if (!request) {
    throw domainError(404, "ADJUSTMENT_NOT_FOUND", "Historical adjustment request was not found.");
  }
  return request;
}

/**
 * Request historical adjustment of a VERIFIED version on a SHIFT_OVER session.
 * Stores full proposed totals + lines; does not mutate the verified version.
 */
async function requestShiftReportAdjustment(input, db = prisma) {
  const reportVersionId = normalizePositiveInt(
    input?.reportVersionId ?? input?.versionId,
    "VERSION_ID_INVALID",
    "Verified report version is required.",
  );
  const requestedByUserId = normalizePositiveInt(
    input?.requestedByUserId ?? input?.actorUserId,
    "USER_ID_INVALID",
    "The requesting user is required.",
  );
  const adjustReason = normalizeChangeReason(input?.adjustReason ?? input?.reason, {
    required: true,
    message: "A clear adjustment reason is required.",
  });
  const remarks = normalizeRemarks(input?.remarks);

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const target = await tx.shiftProductionReportVersion.findUnique({
        where: { id: reportVersionId },
        include: { report: { include: { session: true } } },
      });
      if (!target) {
        throw domainError(404, "REPORT_VERSION_NOT_FOUND", "Shift report version was not found.");
      }
      if (target.status !== REPORT_VERSION_STATUS.VERIFIED) {
        throw domainError(
          409,
          "ADJUSTMENT_REQUIRES_VERIFIED",
          "Historical adjustment is allowed only for a verified shift report version.",
        );
      }
      const lineCount = await tx.shiftProductionReportVersionLine.count({
        where: { reportVersionId },
      });
      if (lineCount === 0 || target.zeroProductionReason) {
        throw domainError(
          409,
          "ADJUSTMENT_NOT_AVAILABLE_FOR_ZERO_REPORT",
          "Historical adjustment is not available for a zero-production Shift Report with no lines.",
        );
      }
      const session = target.report?.session;
      if (!session || session.status !== SESSION_STATUS.SHIFT_OVER) {
        throw domainError(
          409,
          "ADJUSTMENT_REQUIRES_SHIFT_OVER",
          "Historical adjustment is allowed only after Shift Over for that session.",
        );
      }

      const existingOpen = await tx.shiftProductionReportAdjustmentRequest.findFirst({
        where: {
          reportVersionId,
          status: { in: [...UNRESOLVED_STATUSES] },
        },
        orderBy: { id: "desc" },
      });
      if (existingOpen) {
        throw domainError(
          409,
          "ADJUSTMENT_ALREADY_OPEN",
          "An unresolved historical adjustment already exists for this verified report version.",
          { adjustmentRequestId: existingOpen.id, status: existingOpen.status },
        );
      }

      const runSegmentsById = await loadSessionRunSegmentsMap(tx, session.id);
      const { lines, totals } = normalizeProposedAdjustmentLines(input?.lines || [], {
        sessionId: session.id,
        runSegmentsById,
      });

      if (input?.grossOutputQty != null || input?.proposedGrossOutputQty != null) {
        assertHeaderMatchesLines(
          {
            grossOutputQty: toQty(
              input.proposedGrossOutputQty ?? input.grossOutputQty ?? totals.grossOutputQty,
              "Gross output quantity",
            ),
            productionScrapQty: toQty(
              input.proposedProductionScrapQty ?? input.productionScrapQty ?? totals.productionScrapQty,
              "Production scrap quantity",
            ),
            qtySentToQc: toQty(
              input.proposedQtySentToQc ?? input.qtySentToQc ?? totals.qtySentToQc,
              "Quantity sent to QC",
            ),
          },
          totals,
        );
      }

      const now = new Date();
      let request;
      try {
        request = await tx.shiftProductionReportAdjustmentRequest.create({
          data: {
            reportVersionId,
            requestedByUserId,
            requestedAt: now,
            adjustReason,
            proposedGrossOutputQty: totals.grossOutputQty,
            proposedProductionScrapQty: totals.productionScrapQty,
            proposedQtySentToQc: totals.qtySentToQc,
            status: ADJUSTMENT_STATUS.REQUESTED,
            remarks,
            proposedLines: {
              create: lines.map((l) => ({
                runSegmentId: l.runSegmentId,
                itemId: l.itemId,
                grossOutputQty: l.grossOutputQty,
                productionScrapQty: l.productionScrapQty,
                qtySentToQc: l.qtySentToQc,
                remarks: l.remarks,
              })),
            },
          },
          include: { proposedLines: { orderBy: { id: "asc" } } },
        });
      } catch (e) {
        throw mapShiftSessionPersistenceError(e, { action: "requestAdjustment" });
      }

      return {
        request,
        created: true,
        session,
        targetVersion: target,
        verifiedVersionUnchanged: true,
      };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "requestAdjustment" });
  }
}

/**
 * Approve REQUESTED adjustment. Does not modify the historical report.
 */
async function approveShiftReportAdjustment(input, db = prisma) {
  const requestId = normalizePositiveInt(input?.requestId, "REQUEST_ID_INVALID", "Adjustment request is required.");
  const decidedByUserId = normalizePositiveInt(
    input?.decidedByUserId ?? input?.actorUserId,
    "USER_ID_INVALID",
    "The deciding user is required.",
  );
  const decisionNote = normalizeDecisionNote(input?.decisionNote, { required: false });

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const request = await loadAdjustmentRequest(tx, requestId);
      if (request.status === ADJUSTMENT_STATUS.APPROVED) {
        return { request, approved: false, alreadyApproved: true };
      }
      if (request.status === ADJUSTMENT_STATUS.DENIED) {
        throw domainError(409, "ADJUSTMENT_ALREADY_DENIED", "This adjustment request was already denied.");
      }
      if (request.status === ADJUSTMENT_STATUS.APPLIED) {
        throw domainError(409, "ADJUSTMENT_ALREADY_APPLIED", "This adjustment request was already applied.");
      }
      if (request.status !== ADJUSTMENT_STATUS.REQUESTED) {
        throw domainError(409, "ADJUSTMENT_NOT_REQUESTED", "Only a pending adjustment request can be approved.");
      }

      const now = new Date();
      const updated = await tx.shiftProductionReportAdjustmentRequest.update({
        where: { id: requestId },
        data: {
          status: ADJUSTMENT_STATUS.APPROVED,
          decidedByUserId,
          decidedAt: now,
          decisionNote,
        },
        include: { proposedLines: { orderBy: { id: "asc" } } },
      });
      return { request: updated, approved: true, alreadyApproved: false };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "approveAdjustment" });
  }
}

/**
 * Deny REQUESTED adjustment (decision note required). Session/report unchanged.
 */
async function denyShiftReportAdjustment(input, db = prisma) {
  const requestId = normalizePositiveInt(input?.requestId, "REQUEST_ID_INVALID", "Adjustment request is required.");
  const decidedByUserId = normalizePositiveInt(
    input?.decidedByUserId ?? input?.actorUserId,
    "USER_ID_INVALID",
    "The deciding user is required.",
  );
  const decisionNote = normalizeDecisionNote(input?.decisionNote, { required: true });

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const request = await loadAdjustmentRequest(tx, requestId);
      if (request.status === ADJUSTMENT_STATUS.DENIED) {
        return { request, denied: false, alreadyDenied: true };
      }
      if (request.status === ADJUSTMENT_STATUS.APPROVED) {
        throw domainError(409, "ADJUSTMENT_ALREADY_APPROVED", "This adjustment request was already approved.");
      }
      if (request.status === ADJUSTMENT_STATUS.APPLIED) {
        throw domainError(409, "ADJUSTMENT_ALREADY_APPLIED", "This adjustment request was already applied.");
      }
      if (request.status !== ADJUSTMENT_STATUS.REQUESTED) {
        throw domainError(409, "ADJUSTMENT_NOT_REQUESTED", "Only a pending adjustment request can be denied.");
      }

      const now = new Date();
      const updated = await tx.shiftProductionReportAdjustmentRequest.update({
        where: { id: requestId },
        data: {
          status: ADJUSTMENT_STATUS.DENIED,
          decidedByUserId,
          decidedAt: now,
          decisionNote,
        },
        include: { proposedLines: { orderBy: { id: "asc" } } },
      });
      return { request: updated, denied: true, alreadyDenied: false };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "denyAdjustment" });
  }
}

/**
 * Apply APPROVED adjustment: create new immutable VERIFIED version from stored proposal.
 * Keeps session SHIFT_OVER; never mutates original VERIFIED version.
 */
async function applyShiftReportAdjustment(input, db = prisma) {
  const requestId = normalizePositiveInt(input?.requestId, "REQUEST_ID_INVALID", "Adjustment request is required.");
  const appliedByUserId = normalizePositiveInt(
    input?.appliedByUserId ?? input?.actorUserId,
    "USER_ID_INVALID",
    "The applying user is required.",
  );

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const request = await loadAdjustmentRequest(tx, requestId);

      if (request.status === ADJUSTMENT_STATUS.APPLIED) {
        return {
          request,
          applied: false,
          alreadyApplied: true,
          correctedVersion: request.appliedReportVersion,
        };
      }
      if (request.status !== ADJUSTMENT_STATUS.APPROVED) {
        throw domainError(
          409,
          "ADJUSTMENT_NOT_APPROVED",
          "Only an approved historical adjustment can be applied.",
        );
      }

      const target = request.reportVersion;
      if (!target || target.status !== REPORT_VERSION_STATUS.VERIFIED) {
        throw domainError(
          409,
          "ADJUSTMENT_TARGET_INVALID",
          "The target report version is no longer a verified version.",
        );
      }

      const report = target.report;
      const session = await tx.machineShiftSession.findUnique({ where: { id: report.sessionId } });
      if (!session || session.status !== SESSION_STATUS.SHIFT_OVER) {
        throw domainError(
          409,
          "ADJUSTMENT_REQUIRES_SHIFT_OVER",
          "Historical adjustment apply requires the shift session to remain Shift Over.",
        );
      }

      const proposedLines = request.proposedLines || [];
      if (proposedLines.length === 0) {
        throw domainError(
          409,
          "ADJUSTMENT_PROPOSAL_EMPTY",
          "This adjustment has no stored proposed lines and cannot be applied.",
        );
      }

      const runSegmentsById = await loadSessionRunSegmentsMap(tx, session.id);
      const { lines, totals } = normalizeProposedAdjustmentLines(
        proposedLines.map((l) => ({
          runSegmentId: l.runSegmentId,
          itemId: l.itemId,
          grossOutputQty: l.grossOutputQty,
          productionScrapQty: l.productionScrapQty,
          qtySentToQc: l.qtySentToQc,
          remarks: l.remarks,
        })),
        { sessionId: session.id, runSegmentsById },
      );
      assertHeaderMatchesLines(
        {
          grossOutputQty: request.proposedGrossOutputQty,
          productionScrapQty: request.proposedProductionScrapQty,
          qtySentToQc: request.proposedQtySentToQc,
        },
        totals,
      );

      const now = new Date();
      const nextNo = Number(report.latestVersionNo) + 1;

      let correctedVersion;
      try {
        correctedVersion = await tx.shiftProductionReportVersion.create({
          data: {
            reportId: report.id,
            versionNo: nextNo,
            status: REPORT_VERSION_STATUS.VERIFIED,
            previousVersionId: target.id,
            declaredOperatorId: target.declaredOperatorId,
            declaredByUserId: target.declaredByUserId,
            declaredAt: target.declaredAt,
            submittedAt: target.submittedAt,
            submittedByUserId: target.submittedByUserId,
            verifiedAt: now,
            verifiedByUserId: appliedByUserId,
            grossOutputQty: totals.grossOutputQty,
            productionScrapQty: totals.productionScrapQty,
            qtySentToQc: totals.qtySentToQc,
            remarks: target.remarks ?? null,
            lines: {
              create: lines.map((l) => ({
                runSegmentId: l.runSegmentId,
                itemId: l.itemId,
                grossOutputQty: l.grossOutputQty,
                productionScrapQty: l.productionScrapQty,
                qtySentToQc: l.qtySentToQc,
                remarks: l.remarks,
              })),
            },
          },
          include: { lines: { orderBy: { id: "asc" } } },
        });
      } catch (e) {
        throw mapShiftSessionPersistenceError(e, { action: "applyAdjustment" });
      }

      await tx.shiftProductionReport.update({
        where: { id: report.id },
        data: { latestVersionNo: nextNo },
      });

      const updatedRequest = await tx.shiftProductionReportAdjustmentRequest.update({
        where: { id: requestId },
        data: {
          status: ADJUSTMENT_STATUS.APPLIED,
          appliedAt: now,
          appliedByUserId,
          appliedReportVersionId: correctedVersion.id,
        },
        include: {
          proposedLines: { orderBy: { id: "asc" } },
          appliedReportVersion: { include: { lines: { orderBy: { id: "asc" } } } },
        },
      });

      // Confirm session still SHIFT_OVER and original target unchanged.
      const targetAfter = await tx.shiftProductionReportVersion.findUnique({ where: { id: target.id } });
      const sessionAfter = await tx.machineShiftSession.findUnique({ where: { id: session.id } });

      return {
        request: updatedRequest,
        applied: true,
        alreadyApplied: false,
        correctedVersion,
        originalVersion: targetAfter,
        session: sessionAfter,
        sessionRemainsShiftOver: sessionAfter?.status === SESSION_STATUS.SHIFT_OVER,
        originalVerifiedUnchanged:
          targetAfter?.status === REPORT_VERSION_STATUS.VERIFIED &&
          Number(targetAfter.grossOutputQty) === Number(target.grossOutputQty),
      };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "applyAdjustment" });
  }
}

module.exports = {
  ADJUSTMENT_STATUS,
  UNRESOLVED_STATUSES,
  requestShiftReportAdjustment,
  approveShiftReportAdjustment,
  denyShiftReportAdjustment,
  applyShiftReportAdjustment,
};
