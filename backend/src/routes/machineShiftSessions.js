/**
 * Machine Shift Session lifecycle API (Steps 2A–2C + Step 3 auth).
 */
const express = require("express");
const { z } = require("zod");
const { requireAuth } = require("../middleware/auth");
const {
  SHIFT_ACTION,
  requireShiftAction,
  actorUserIdFromReq,
  getShiftCapabilities,
} = require("../services/machineShiftPermissions");
const ops = require("../services/machineShiftSessionOperations");
const {
  getShiftSessionDetail,
  getOpenShiftSessionForMachine,
  listReopenRequestsForSession,
  listAdjustmentsForVersion,
  getAdjustmentRequestDetail,
  mapReportVersion,
  getMappedAdjustmentRequest,
  getMappedReopenRequest,
} = require("../services/machineShiftSessionReadService");
const {
  START_OUTSIDE_WINDOW_REASONS,
} = require("../services/shiftSessionTimeWindowService");
const { listEligibleRunsForMachine } = require("../services/machineShiftEligibleRunsService");
const { getOpenDowntimeForMachine } = require("../services/machineShiftOpenDowntimeService");

const machineShiftSessionsRouter = express.Router();

const positiveInt = z.coerce.number().int().positive();
const optionalPositiveInt = z.coerce.number().int().positive().optional().nullable();
const nonNegQty = z.coerce.number().finite().nonnegative();
const { zodStrictIsoDateString } = require("../services/strictIsoDate");
const dateOnly = zodStrictIsoDateString(z, { required: true });

const handoverStateEnum = z.enum(["RETAINED", "CLEARED", "UNKNOWN"]);
const outsideWindowReasonEnum = z.enum([
  START_OUTSIDE_WINDOW_REASONS.EARLY_START,
  START_OUTSIDE_WINDOW_REASONS.LATE_ARRIVAL,
  START_OUTSIDE_WINDOW_REASONS.PREVIOUS_SHIFT_DELAY,
  START_OUTSIDE_WINDOW_REASONS.EMERGENCY,
  START_OUTSIDE_WINDOW_REASONS.OTHER,
]);
const downtimeReasonEnum = z.enum([
  "MACHINE_BREAKDOWN",
  "WAITING_FOR_RM",
  "TOOL_MOULD_MAINTENANCE",
  "QUALITY_CONCERN",
  "EMERGENCY_PRIORITY_PRODUCTION",
  "POWER_UTILITY_FAILURE",
  "MANAGEMENT_HOLD",
  "OTHER",
]);

/** Client scrap (+ remarks) only; qtySentToQc / gross are server-calculated (optional overrides must match). */
const reportLineSchema = z
  .object({
    runSegmentId: positiveInt,
    itemId: positiveInt,
    productionScrapQty: nonNegQty.default(0),
    remarks: z.string().max(2000).optional().nullable(),
    /** Rejected unless equal to server calc — prefer omitting. */
    grossOutputQty: nonNegQty.optional(),
    qtySentToQc: nonNegQty.optional(),
  })
  .strict();

function parseId(param, label = "id") {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error(`${label} is not valid.`);
    err.statusCode = 400;
    err.code = "VALIDATION";
    err.expose = true;
    throw err;
  }
  return id;
}

/** Strip spoofable actor fields from client body. */
function stripActorFields(body) {
  if (!body || typeof body !== "object") return {};
  const {
    actorUserId,
    startedByUserId,
    endedByUserId,
    changedByUserId,
    declaredByUserId,
    submittedByUserId,
    returnedByUserId,
    verifiedByUserId,
    requestedByUserId,
    decidedByUserId,
    appliedByUserId,
    segmentStartedByUserId,
    segmentEndedByUserId,
    closedByUserId,
    overtimeApprovedByUserId,
    liveProductionStoppedAt,
    timeEndDetectedAt,
    scheduledStartAt,
    scheduledEndAt,
    graceMinutesSnapshot,
    ...rest
  } = body;
  void actorUserId;
  void startedByUserId;
  void endedByUserId;
  void changedByUserId;
  void declaredByUserId;
  void submittedByUserId;
  void returnedByUserId;
  void verifiedByUserId;
  void requestedByUserId;
  void decidedByUserId;
  void appliedByUserId;
  void segmentStartedByUserId;
  void segmentEndedByUserId;
  void closedByUserId;
  void overtimeApprovedByUserId;
  void liveProductionStoppedAt;
  void timeEndDetectedAt;
  void scheduledStartAt;
  void scheduledEndAt;
  void graceMinutesSnapshot;
  return rest;
}

// ——— Session reads ———
// GET /open may return unresolved HANDOVER_PENDING for continuity.
// status stays HANDOVER_PENDING; isLiveProductionAllowed is false.
// Consumers must not treat it as an OPEN live session.
// Normal Start Shift still blocks via SHIFT_HANDOVER_PENDING.

machineShiftSessionsRouter.get(
  "/open",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.VIEW),
  async (req, res, next) => {
    try {
      const machineId = positiveInt.parse(req.query.machineId);
      const detail = await getOpenShiftSessionForMachine(machineId);
      return res.json({ session: detail });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.get(
  "/capabilities",
  requireAuth,
  async (req, res, next) => {
    try {
      const capabilities = await getShiftCapabilities(req.user);
      if (!capabilities.canView) {
        const err = new Error("You are not allowed to view shift production.");
        err.statusCode = 403;
        err.code = "SHIFT_ACTION_FORBIDDEN";
        err.expose = true;
        throw err;
      }
      return res.json(capabilities);
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.get(
  "/busy-operators",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.VIEW),
  async (req, res, next) => {
    try {
      const operators = await ops.listBusyOperatorsAcrossOpenSessions();
      return res.json({ operators });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.get(
  "/eligible-runs",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.VIEW),
  async (req, res, next) => {
    try {
      const machineId = positiveInt.parse(req.query.machineId);
      const result = await listEligibleRunsForMachine(machineId);
      return res.json(result);
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.get(
  "/open-downtime",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.VIEW),
  async (req, res, next) => {
    try {
      const machineId = positiveInt.parse(req.query.machineId);
      const incident = await getOpenDowntimeForMachine(machineId);
      return res.json({ incident });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.get(
  "/:sessionId",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.VIEW),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const detail = await getShiftSessionDetail(sessionId);
      return res.json({ session: detail });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.START_SESSION),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          machineId: positiveInt,
          shiftId: positiveInt,
          sessionDate: dateOnly,
          operators: z
            .array(
              z
                .object({
                  operatorId: positiveInt,
                  isPrimary: z.boolean().optional(),
                })
                .strict(),
            )
            .min(1),
          handoverState: handoverStateEnum.optional(),
          startedOutsideWindowReason: outsideWindowReasonEnum.optional(),
          startedOutsideWindowRemarks: z.string().max(2000).optional().nullable(),
        })
        .strict()
        .parse(stripActorFields(req.body));
      const actorUserId = actorUserIdFromReq(req);
      const session = await ops.startShiftSession({
        ...body,
        startedByUserId: actorUserId,
        actorRole: req.user?.role,
      });
      const detail = await getShiftSessionDetail(session.id);
      return res.status(201).json({ session: detail });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/:sessionId/end-shift",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.MANAGER_TIME_CONTROLS),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          actualOperationalEndAt: z.string().min(1),
        })
        .strict()
        .parse(stripActorFields(req.body));
      await ops.endShiftForHandover({
        sessionId,
        actualOperationalEndAt: body.actualOperationalEndAt,
        actorUserId: actorUserIdFromReq(req),
        actorRole: req.user?.role,
      });
      const detail = await getShiftSessionDetail(sessionId);
      return res.json({ session: detail });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/:sessionId/overtime",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.MANAGER_TIME_CONTROLS),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          approvedUntil: z.string().min(1),
          reason: z.string().min(1).max(2000),
        })
        .strict()
        .parse(stripActorFields(req.body));
      await ops.continueShiftOvertime({
        sessionId,
        approvedUntil: body.approvedUntil,
        reason: body.reason,
        actorUserId: actorUserIdFromReq(req),
        actorRole: req.user?.role,
      });
      const detail = await getShiftSessionDetail(sessionId);
      return res.json({ session: detail });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/:sessionId/confirm-actual-end",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.MANAGER_TIME_CONTROLS),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          actualOperationalEndAt: z.string().min(1),
        })
        .strict()
        .parse(stripActorFields(req.body));
      await ops.confirmShiftActualEnd({
        sessionId,
        actualOperationalEndAt: body.actualOperationalEndAt,
        actorUserId: actorUserIdFromReq(req),
        actorRole: req.user?.role,
      });
      const detail = await getShiftSessionDetail(sessionId);
      return res.json({ session: detail });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/:sessionId/shift-over",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.SHIFT_OVER),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          handoverState: handoverStateEnum,
          handoverRemarks: z.string().max(2000).optional().nullable(),
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.completeShiftOver({
        sessionId,
        ...body,
        actorUserId: actorUserIdFromReq(req),
      });
      const detail = await getShiftSessionDetail(sessionId);
      return res.json({
        session: detail,
        completed: result.completed,
        alreadyShiftOver: result.alreadyShiftOver,
      });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/:sessionId/cancel",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.CANCEL_SESSION),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          reason: z.string().min(1).max(2000),
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.cancelShiftSession({
        sessionId,
        reason: body.reason,
        actorUserId: actorUserIdFromReq(req),
      });
      const detail = await getShiftSessionDetail(sessionId);
      return res.json({
        session: detail,
        cancelled: result.cancelled,
        alreadyCancelled: result.alreadyCancelled,
      });
    } catch (e) {
      return next(e);
    }
  },
);

// ——— Operators ———

machineShiftSessionsRouter.post(
  "/:sessionId/operators/join",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.MANAGE_OPERATORS),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          operatorId: positiveInt,
          changeReason: z.string().max(2000).optional().nullable(),
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.joinSessionOperator({
        sessionId,
        ...body,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.json({
        created: result.created,
        participation: {
          id: result.participation.id,
          operatorId: result.participation.operatorId,
          isPrimary: result.participation.isPrimarySnapshot,
          joinedAt: result.participation.joinedAt,
          leftAt: result.participation.leftAt,
        },
      });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/:sessionId/operators/leave",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.MANAGE_OPERATORS),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          operatorId: positiveInt,
          changeReason: z.string().min(1).max(2000),
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.leaveSessionOperator({
        sessionId,
        ...body,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.json({
        left: result.left,
        alreadyLeft: result.alreadyLeft,
        participation: result.participation
          ? {
              id: result.participation.id,
              operatorId: result.participation.operatorId,
              leftAt: result.participation.leftAt,
            }
          : null,
      });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/:sessionId/operators/change-primary",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.MANAGE_OPERATORS),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          newPrimaryOperatorId: positiveInt,
          changeReason: z.string().min(1).max(2000),
          keepPreviousPrimary: z.boolean().optional(),
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.changePrimaryOperator({
        sessionId,
        ...body,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.json({
        changed: result.changed,
        primaryOperatorId: result.primaryOperatorId,
        previousPrimaryOperatorId: result.previousPrimaryOperatorId,
      });
    } catch (e) {
      return next(e);
    }
  },
);

// ——— Run segments ———

machineShiftSessionsRouter.post(
  "/:sessionId/run-segments",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.RUN_SEGMENT),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          runAllocationId: optionalPositiveInt,
          workOrderId: optionalPositiveInt,
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.startRunSegment({
        sessionId,
        ...body,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.status(result.created ? 201 : 200).json({
        created: result.created,
        segment: {
          id: result.segment.id,
          status: result.segment.status,
          workOrderId: result.segment.workOrderId,
          runAllocationId: result.segment.runAllocationId,
          segmentNo: result.segment.segmentNo,
          startedAt: result.segment.segmentStartedAt,
        },
      });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/:sessionId/run-segments/close",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.RUN_SEGMENT),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          segmentId: optionalPositiveInt,
          closeReason: z.string().min(1).max(2000),
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.closeRunSegment({
        sessionId,
        segmentId: body.segmentId,
        closeReason: body.closeReason,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.json({
        closed: result.closed,
        alreadyClosed: result.alreadyClosed,
        segment: {
          id: result.segment.id,
          status: result.segment.status,
          closedAt: result.segment.closedAt,
          closeReason: result.segment.closeReason,
          closedByUserId: result.segment.closedByUserId,
        },
      });
    } catch (e) {
      return next(e);
    }
  },
);

// ——— Downtime ———

machineShiftSessionsRouter.post(
  "/:sessionId/downtime/pause",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.DOWNTIME),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          reason: downtimeReasonEnum,
          remarks: z.string().max(2000).optional().nullable(),
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.pauseForDowntime({
        sessionId,
        ...body,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.status(result.created ? 201 : 200).json({
        created: result.created,
        incident: {
          id: result.incident.id,
          reason: result.incident.reason,
          startedAt: result.incident.startedAt,
          endedAt: result.incident.endedAt,
        },
        downtimeSegment: {
          id: result.downtimeSegment.id,
          segmentStartAt: result.downtimeSegment.segmentStartAt,
          segmentEndAt: result.downtimeSegment.segmentEndAt,
        },
      });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/:sessionId/downtime/resume",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.DOWNTIME),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          incidentId: optionalPositiveInt,
          remarks: z.string().max(2000).optional().nullable(),
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.resumeFromDowntime({
        sessionId,
        ...body,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.json({
        resumed: result.resumed,
        alreadyResumed: result.alreadyResumed,
        durationMinutes: result.durationMinutes,
        incident: result.incident
          ? { id: result.incident.id, endedAt: result.incident.endedAt }
          : null,
      });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/:sessionId/downtime/continue",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.DOWNTIME),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          incidentId: positiveInt,
          remarks: z.string().max(2000).optional().nullable(),
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.continueDowntimeIntoSession({
        sessionId,
        ...body,
      });
      return res.status(result.created ? 201 : 200).json({
        created: result.created,
        continued: result.continued,
        incident: { id: result.incident.id, endedAt: result.incident.endedAt },
        downtimeSegment: {
          id: result.downtimeSegment.id,
          segmentStartAt: result.downtimeSegment.segmentStartAt,
          segmentEndAt: result.downtimeSegment.segmentEndAt,
        },
      });
    } catch (e) {
      return next(e);
    }
  },
);

// ——— Report ———

machineShiftSessionsRouter.get(
  "/:sessionId/report",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.VIEW),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const detail = await getShiftSessionDetail(sessionId);
      return res.json({
        report: detail.report,
        pendingDraftCount: detail.pendingDraftCount ?? 0,
        pendingDraftQty: detail.pendingDraftQty ?? 0,
      });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/:sessionId/report/draft",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.SAVE_SUBMIT_REPORT),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          lines: z.array(reportLineSchema).default([]),
          remarks: z.string().max(2000).optional().nullable(),
          /** Optional header scrap total check only — calculated QC/gross ignored from client. */
          productionScrapQty: nonNegQty.optional(),
          zeroProductionReason: z
            .enum([
              "NO_WORK_ORDER",
              "MACHINE_BREAKDOWN",
              "MATERIAL_UNAVAILABLE",
              "POWER_FAILURE",
              "PLANNED_MAINTENANCE",
              "OTHER",
            ])
            .optional()
            .nullable(),
          zeroProductionRemarks: z.string().max(2000).optional().nullable(),
          zeroProduction: z.boolean().optional(),
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.saveShiftReportDraft({ sessionId, ...body });
      return res.json({
        declared: false,
        zeroProduction: Boolean(result.zeroProduction),
        pendingDraftCount: result.pendingDraftCount ?? 0,
        pendingDraftQty: result.pendingDraftQty ?? 0,
        version: mapReportVersion(result.version),
      });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/:sessionId/report/submit",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.SAVE_SUBMIT_REPORT),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          versionId: optionalPositiveInt,
          declaredOperatorId: positiveInt,
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.submitShiftReport({
        sessionId,
        versionId: body.versionId,
        declaredOperatorId: body.declaredOperatorId,
        declaredByUserId: actorUserIdFromReq(req),
      });
      return res.json({
        submitted: result.submitted,
        alreadySubmitted: result.alreadySubmitted,
        version: mapReportVersion(result.version),
      });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/report-versions/:versionId/return",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.RETURN_VERIFY_REPORT),
  async (req, res, next) => {
    try {
      const versionId = parseId(req.params.versionId, "versionId");
      const body = z
        .object({
          returnReason: z.string().min(1).max(2000),
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.returnShiftReport({
        versionId,
        returnReason: body.returnReason,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.json({
        returned: result.returned,
        alreadyReturned: result.alreadyReturned,
        version: mapReportVersion(result.version),
      });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/report-versions/:versionId/verify",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.RETURN_VERIFY_REPORT),
  async (req, res, next) => {
    try {
      const versionId = parseId(req.params.versionId, "versionId");
      z.object({}).strict().parse(stripActorFields(req.body ?? {}));
      const result = await ops.verifyShiftReport({
        versionId,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.json({
        verified: result.verified,
        alreadyVerified: result.alreadyVerified,
        version: mapReportVersion(result.version),
      });
    } catch (e) {
      return next(e);
    }
  },
);

// ——— Reopen ———

machineShiftSessionsRouter.get(
  "/:sessionId/reopen-requests",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.VIEW),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const requests = await listReopenRequestsForSession(sessionId);
      return res.json({ requests });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/:sessionId/reopen-requests",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.REQUEST_REOPEN),
  async (req, res, next) => {
    try {
      const sessionId = parseId(req.params.sessionId, "sessionId");
      const body = z
        .object({
          reopenReason: z.string().min(1).max(2000),
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.requestShiftSessionReopen({
        sessionId,
        reopenReason: body.reopenReason,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.status(result.created ? 201 : 200).json({
        created: result.created,
        request: await getMappedReopenRequest(result.request),
      });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/reopen-requests/:requestId/approve",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.DECIDE_REOPEN),
  async (req, res, next) => {
    try {
      const requestId = parseId(req.params.requestId, "requestId");
      const body = z
        .object({
          decisionNote: z.string().max(2000).optional().nullable(),
        })
        .strict()
        .parse(stripActorFields(req.body ?? {}));
      const result = await ops.approveShiftSessionReopen({
        requestId,
        decisionNote: body.decisionNote,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.json({
        approved: result.approved,
        alreadyApproved: result.alreadyApproved,
        request: await getMappedReopenRequest(result.request),
        sessionId: result.session?.id,
        draftVersionId: result.draftVersion?.id ?? null,
      });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/reopen-requests/:requestId/deny",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.DECIDE_REOPEN),
  async (req, res, next) => {
    try {
      const requestId = parseId(req.params.requestId, "requestId");
      const body = z
        .object({
          decisionNote: z.string().max(2000).optional().nullable(),
        })
        .strict()
        .parse(stripActorFields(req.body ?? {}));
      const result = await ops.denyShiftSessionReopen({
        requestId,
        decisionNote: body.decisionNote,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.json({
        denied: result.denied,
        alreadyDenied: result.alreadyDenied,
        request: await getMappedReopenRequest(result.request),
      });
    } catch (e) {
      return next(e);
    }
  },
);

// ——— Historical adjustments ———

machineShiftSessionsRouter.get(
  "/report-versions/:versionId/adjustments",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.VIEW),
  async (req, res, next) => {
    try {
      const versionId = parseId(req.params.versionId, "versionId");
      const requests = await listAdjustmentsForVersion(versionId);
      return res.json({ requests });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/report-versions/:versionId/adjustments",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.REQUEST_ADJUSTMENT),
  async (req, res, next) => {
    try {
      const versionId = parseId(req.params.versionId, "versionId");
      const body = z
        .object({
          adjustReason: z.string().min(1).max(2000),
          remarks: z.string().max(2000).optional().nullable(),
          lines: z.array(reportLineSchema).min(1),
          proposedGrossOutputQty: nonNegQty.optional(),
          proposedProductionScrapQty: nonNegQty.optional(),
          proposedQtySentToQc: nonNegQty.optional(),
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.requestShiftReportAdjustment({
        reportVersionId: versionId,
        ...body,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.status(201).json({
        created: result.created,
        request: await getMappedAdjustmentRequest(result.request),
      });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.get(
  "/adjustments/:requestId",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.VIEW),
  async (req, res, next) => {
    try {
      const requestId = parseId(req.params.requestId, "requestId");
      const request = await getAdjustmentRequestDetail(requestId);
      return res.json({ request });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/adjustments/:requestId/approve",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.DECIDE_APPLY_ADJUSTMENT),
  async (req, res, next) => {
    try {
      const requestId = parseId(req.params.requestId, "requestId");
      const body = z
        .object({
          decisionNote: z.string().max(2000).optional().nullable(),
        })
        .strict()
        .parse(stripActorFields(req.body ?? {}));
      const result = await ops.approveShiftReportAdjustment({
        requestId,
        decisionNote: body.decisionNote,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.json({
        approved: result.approved,
        alreadyApproved: result.alreadyApproved,
        request: await getMappedAdjustmentRequest(result.request),
      });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/adjustments/:requestId/deny",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.DECIDE_APPLY_ADJUSTMENT),
  async (req, res, next) => {
    try {
      const requestId = parseId(req.params.requestId, "requestId");
      const body = z
        .object({
          decisionNote: z.string().min(1).max(2000),
        })
        .strict()
        .parse(stripActorFields(req.body));
      const result = await ops.denyShiftReportAdjustment({
        requestId,
        decisionNote: body.decisionNote,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.json({
        denied: result.denied,
        alreadyDenied: result.alreadyDenied,
        request: await getMappedAdjustmentRequest(result.request),
      });
    } catch (e) {
      return next(e);
    }
  },
);

machineShiftSessionsRouter.post(
  "/adjustments/:requestId/apply",
  requireAuth,
  requireShiftAction(SHIFT_ACTION.DECIDE_APPLY_ADJUSTMENT),
  async (req, res, next) => {
    try {
      const requestId = parseId(req.params.requestId, "requestId");
      z.object({}).strict().parse(stripActorFields(req.body ?? {}));
      const result = await ops.applyShiftReportAdjustment({
        requestId,
        actorUserId: actorUserIdFromReq(req),
      });
      return res.json({
        applied: result.applied,
        alreadyApplied: result.alreadyApplied,
        request: await getMappedAdjustmentRequest(result.request),
        correctedVersion: result.correctedVersion ? mapReportVersion(result.correctedVersion) : null,
        sessionRemainsShiftOver: result.sessionRemainsShiftOver ?? true,
      });
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = { machineShiftSessionsRouter, stripActorFields, parseId };
