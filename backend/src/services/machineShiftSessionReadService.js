/**
 * Read helpers + UI DTOs for Machine Shift Session APIs (Step 3).
 */

const { prisma } = require("../utils/prisma");
const { domainError } = require("./machineShiftSessionErrors");
const {
  aggregateShiftSessionProductionQuantities,
  pendingDraftSummaryFromAggregate,
  roundQty,
} = require("./machineShiftReportAggregationService");

function qtyNum(v) {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dateOnly(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function mapOperatorBrief(op) {
  if (!op) return null;
  return {
    id: op.id,
    operatorCode: op.operatorCode,
    operatorName: op.operatorName,
  };
}

function mapMachineBrief(m) {
  if (!m) return null;
  return {
    id: m.id,
    machineCode: m.machineCode,
    machineName: m.machineName,
  };
}

function mapShiftBrief(s) {
  if (!s) return null;
  return {
    id: s.id,
    shiftCode: s.shiftCode,
    shiftName: s.shiftName,
  };
}

function mapUserBrief(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name ?? null,
    email: u.email ?? null,
  };
}

/** Safe display name for audit actors — never returns raw IDs. */
function userDisplayName(user, userId, { missingLabel = "Unknown user" } = {}) {
  const name = typeof user?.name === "string" ? user.name.trim() : "";
  if (name) return name;
  if (userId != null && userId !== "") return missingLabel;
  return null;
}

const REOPEN_ACTOR_INCLUDE = Object.freeze({
  requestedByUser: { select: { id: true, name: true, email: true } },
  decidedByUser: { select: { id: true, name: true, email: true } },
});

function mapReopenRequest(r) {
  const requestedByUser = r.requestedByUser ?? r.requestedBy ?? null;
  const decidedByUser = r.decidedByUser ?? r.decidedBy ?? null;
  const decidedByUserId = r.decidedByUserId ?? null;
  const hasDecision = decidedByUserId != null || r.decidedAt != null;
  return {
    id: r.id,
    status: r.status,
    reopenReason: r.reopenReason,
    requestedAt: r.requestedAt,
    requestedByUserId: r.requestedByUserId,
    requestedByName: userDisplayName(requestedByUser, r.requestedByUserId) || "Unknown user",
    decidedAt: r.decidedAt,
    decidedByUserId,
    decidedByName: hasDecision
      ? userDisplayName(decidedByUser, decidedByUserId) || "Unknown user"
      : null,
    decisionNote: r.decisionNote ?? null,
  };
}

function mapParticipation(row) {
  return {
    id: row.id,
    operator: mapOperatorBrief(row.operator),
    isPrimary: Boolean(row.isPrimarySnapshot),
    joinedAt: row.joinedAt,
    leftAt: row.leftAt,
    changeReason: row.joinedLeaveReason ?? null,
  };
}

function mapRunSegment(row) {
  return {
    id: row.id,
    segmentNo: row.segmentNo,
    status: row.status,
    workOrderId: row.workOrderId,
    workOrderDocNo: row.workOrder?.docNo ?? null,
    runAllocationId: row.runAllocationId,
    startedAt: row.segmentStartedAt,
    closedAt: row.closedAt,
    closeReason: row.closeReason ?? null,
    closedByUserId: row.closedByUserId ?? null,
  };
}

function mapDowntimeIncident(row) {
  return {
    id: row.id,
    reason: row.reason,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    remarks: row.remarks ?? null,
    runSegmentId: row.runSegmentId,
    segments: (row.segments || []).map((s) => ({
      id: s.id,
      sessionId: s.sessionId,
      segmentStartAt: s.segmentStartAt,
      segmentEndAt: s.segmentEndAt,
      remarks: s.remarks ?? null,
    })),
  };
}

function mapAggregationQtyLines(aggregation, segmentsById) {
  if (!aggregation?.byLine) return [];
  const lines = [];
  for (const row of aggregation.byLine.values()) {
    const runSegmentId = Number(row.runSegmentId);
    const itemId = Number(row.itemId);
    const seg = segmentsById?.get(runSegmentId);
    const pending = pendingDraftSummaryFromAggregate(aggregation, runSegmentId, itemId);
    const qtySentToQc = roundQty(row.qtySentToQc ?? 0);
    const woNo = row.workOrderNo ?? seg?.workOrderDocNo ?? null;
    const itemName = row.itemName ?? null;
    const segmentLabel = seg
      ? woNo
        ? `Run ${seg.segmentNo} · ${woNo}`
        : `Run ${seg.segmentNo}`
      : woNo
        ? `Run · ${woNo}`
        : null;
    lines.push({
      runSegmentId,
      itemId,
      itemName,
      itemLabel: itemName,
      workOrderId: row.workOrderId ?? seg?.workOrderId ?? null,
      workOrderNo: woNo,
      runSegmentLabel: segmentLabel,
      runSegmentNo: seg?.segmentNo ?? null,
      qtySentToQc,
      productionScrapQty: 0,
      grossOutputQty: qtySentToQc,
      remarks: null,
      pendingDraftCount: pending.pendingDraftCount,
      pendingDraftQty: pending.pendingDraftQty,
    });
  }
  return lines;
}

function mapReportLine(line, ctx = null) {
  const runSegmentId = Number(line.runSegmentId);
  const itemId = Number(line.itemId);
  const seg = ctx?.segmentsById?.get(runSegmentId);
  const pending = ctx?.aggregation
    ? pendingDraftSummaryFromAggregate(ctx.aggregation, runSegmentId, itemId)
    : { pendingDraftCount: 0, pendingDraftQty: 0 };
  const approvedLive = ctx?.aggregation?.byLine?.get(`${runSegmentId}:${itemId}`);
  const productionScrapQty = qtyNum(line.productionScrapQty);
  const snapshotQc = qtyNum(line.qtySentToQc);
  const liveQc = approvedLive != null ? roundQty(approvedLive.qtySentToQc) : null;
  // DRAFT reads prefer live Qty Sent to QC; immutable versions keep the snapshot.
  const qtySentToQc =
    ctx?.overlayLiveQty && liveQc != null ? liveQc : snapshotQc;
  const grossOutputQty =
    ctx?.overlayLiveQty && liveQc != null
      ? roundQty(productionScrapQty + liveQc)
      : qtyNum(line.grossOutputQty);
  const woNo = seg?.workOrderDocNo ?? approvedLive?.workOrderNo ?? null;
  const itemName = line.item?.itemName ?? approvedLive?.itemName ?? null;
  const segmentLabel = seg
    ? woNo
      ? `Run ${seg.segmentNo} · ${woNo}`
      : `Run ${seg.segmentNo}`
    : null;

  return {
    id: line.id,
    runSegmentId,
    itemId,
    itemName,
    itemLabel: itemName,
    workOrderId: seg?.workOrderId ?? approvedLive?.workOrderId ?? null,
    workOrderNo: woNo,
    runSegmentLabel: segmentLabel,
    runSegmentNo: seg?.segmentNo ?? null,
    grossOutputQty,
    productionScrapQty,
    qtySentToQc,
    remarks: line.remarks ?? null,
    pendingDraftCount: pending.pendingDraftCount,
    pendingDraftQty: pending.pendingDraftQty,
  };
}

function mapReportVersion(v, ctx = null) {
  const overlayLiveQty = Boolean(ctx?.overlayLiveQty && v.status === "DRAFT");
  const lineCtx = ctx ? { ...ctx, overlayLiveQty } : null;
  const lines = (v.lines || []).map((l) => mapReportLine(l, lineCtx));
  let grossOutputQty = qtyNum(v.grossOutputQty);
  let productionScrapQty = qtyNum(v.productionScrapQty);
  let qtySentToQc = qtyNum(v.qtySentToQc);
  if (overlayLiveQty && lines.length) {
    productionScrapQty = roundQty(lines.reduce((s, l) => s + Number(l.productionScrapQty || 0), 0));
    qtySentToQc = roundQty(lines.reduce((s, l) => s + Number(l.qtySentToQc || 0), 0));
    grossOutputQty = roundQty(productionScrapQty + qtySentToQc);
  }
  return {
    id: v.id,
    versionNo: v.versionNo,
    status: v.status,
    previousVersionId: v.previousVersionId,
    declaredOperator: mapOperatorBrief(v.declaredOperator),
    declaredByUserId: v.declaredByUserId,
    declaredAt: v.declaredAt,
    submittedAt: v.submittedAt,
    submittedByUserId: v.submittedByUserId,
    returnedAt: v.returnedAt,
    returnedByUserId: v.returnedByUserId,
    returnReason: v.returnReason ?? null,
    verifiedAt: v.verifiedAt,
    verifiedByUserId: v.verifiedByUserId,
    grossOutputQty,
    productionScrapQty,
    qtySentToQc,
    remarks: v.remarks ?? null,
    pendingDraftCount: ctx?.aggregation?.pendingDraftCount ?? 0,
    pendingDraftQty: roundQty(ctx?.aggregation?.pendingDraftQty ?? 0),
    lines,
  };
}

function mapAdjustmentRequest(r) {
  const requestedByUser = r.requestedByUser ?? r.requestedBy ?? null;
  const decidedByUser = r.decidedByUser ?? r.decidedBy ?? null;
  const appliedByUser = r.appliedByUser ?? r.appliedBy ?? null;
  const decidedByUserId = r.decidedByUserId ?? null;
  const appliedByUserId = r.appliedByUserId ?? null;
  const hasDecision = decidedByUserId != null || r.decidedAt != null;
  const hasApplied = appliedByUserId != null || r.appliedAt != null;
  return {
    id: r.id,
    reportVersionId: r.reportVersionId,
    status: r.status,
    adjustReason: r.adjustReason,
    remarks: r.remarks ?? null,
    proposedGrossOutputQty: qtyNum(r.proposedGrossOutputQty),
    proposedProductionScrapQty: qtyNum(r.proposedProductionScrapQty),
    proposedQtySentToQc: qtyNum(r.proposedQtySentToQc),
    proposedLines: (r.proposedLines || []).map((l) => ({
      id: l.id,
      runSegmentId: l.runSegmentId,
      itemId: l.itemId,
      itemName: l.item?.itemName ?? null,
      grossOutputQty: qtyNum(l.grossOutputQty),
      productionScrapQty: qtyNum(l.productionScrapQty),
      qtySentToQc: qtyNum(l.qtySentToQc),
      remarks: l.remarks ?? null,
    })),
    requestedAt: r.requestedAt,
    requestedByUserId: r.requestedByUserId,
    requestedByName: userDisplayName(requestedByUser, r.requestedByUserId) || "Unknown user",
    decidedAt: r.decidedAt,
    decidedByUserId,
    decidedByName: hasDecision
      ? userDisplayName(decidedByUser, decidedByUserId) || "Unknown user"
      : null,
    decisionNote: r.decisionNote ?? null,
    appliedAt: r.appliedAt,
    appliedByUserId,
    appliedByName: hasApplied
      ? userDisplayName(appliedByUser, appliedByUserId) || "Unknown user"
      : null,
    appliedReportVersionId: r.appliedReportVersionId,
  };
}

const ADJUSTMENT_ACTOR_INCLUDE = Object.freeze({
  requestedByUser: { select: { id: true, name: true, email: true } },
  decidedByUser: { select: { id: true, name: true, email: true } },
  appliedByUser: { select: { id: true, name: true, email: true } },
});

const ADJUSTMENT_DETAIL_INCLUDE = Object.freeze({
  ...ADJUSTMENT_ACTOR_INCLUDE,
  proposedLines: {
    orderBy: { id: "asc" },
    include: { item: { select: { id: true, itemName: true } } },
  },
});

function mapSessionDetail(session, reportCtx = null) {
  const report = session.shiftReport;
  const versions = report?.versions || [];
  const latest = versions.length
    ? versions.reduce((a, b) => (a.versionNo >= b.versionNo ? a : b))
    : null;

  const segmentsById = new Map(
    (session.runSegments || []).map((r) => [
      r.id,
      {
        id: r.id,
        segmentNo: r.segmentNo,
        workOrderId: r.workOrderId,
        workOrderDocNo: r.workOrder?.docNo ?? null,
        status: r.status,
      },
    ]),
  );
  const ctx = {
    segmentsById,
    aggregation: reportCtx?.aggregation ?? null,
    overlayLiveQty: true,
  };
  const qtyLines = mapAggregationQtyLines(reportCtx?.aggregation, segmentsById);

  return {
    id: session.id,
    shiftSessionNo: session.shiftSessionNo,
    status: session.status,
    sessionDate: dateOnly(session.sessionDate),
    machine: mapMachineBrief(session.machine),
    shift: mapShiftBrief(session.shift),
    primaryOperator: mapOperatorBrief(session.primaryOperator),
    handoverState: session.handoverState,
    handoverRemarks: session.handoverRemarks ?? null,
    cancellationReason: session.cancellationReason ?? null,
    startedAt: session.startedAt,
    startedByUserId: session.startedByUserId,
    endedAt: session.endedAt,
    endedByUserId: session.endedByUserId,
    reopenCount: session.reopenCount,
    canCancel: Boolean(reportCtx?.canCancel),
    operators: (session.sessionOperators || []).map(mapParticipation),
    runSegments: (session.runSegments || []).map(mapRunSegment),
    downtimeIncidents: (session.downtimeSegments || [])
      .map((s) => s.incident)
      .filter(Boolean)
      .reduce((acc, inc) => {
        if (!acc.some((x) => x.id === inc.id)) acc.push(inc);
        return acc;
      }, [])
      .map((inc) =>
        mapDowntimeIncident({
          ...inc,
          segments: (session.downtimeSegments || []).filter((s) => s.incidentId === inc.id),
        }),
      ),
    report: report
      ? {
          id: report.id,
          latestVersionNo: report.latestVersionNo,
          pendingDraftCount: ctx.aggregation?.pendingDraftCount ?? 0,
          pendingDraftQty: roundQty(ctx.aggregation?.pendingDraftQty ?? 0),
          productionQtyLocked: Boolean(reportCtx?.productionQtyLocked),
          productionQtyLockReason: reportCtx?.productionQtyLockReason ?? null,
          latestVersion: latest ? mapReportVersion(latest, ctx) : null,
          versions: versions.map((v) => mapReportVersion(v, ctx)),
        }
      : null,
    /** Live APPROVED PE totals by run-segment/item — used to seed Shift Report lines before first draft. */
    qtyLines,
    pendingDraftCount: ctx.aggregation?.pendingDraftCount ?? 0,
    pendingDraftQty: roundQty(ctx.aggregation?.pendingDraftQty ?? 0),
    productionQtyLocked: Boolean(reportCtx?.productionQtyLocked),
    productionQtyLockReason: reportCtx?.productionQtyLockReason ?? null,
    reopenRequests: (session.reopenRequests || []).map(mapReopenRequest),
  };
}

const SESSION_DETAIL_INCLUDE = Object.freeze({
  machine: { select: { id: true, machineCode: true, machineName: true } },
  shift: { select: { id: true, shiftCode: true, shiftName: true } },
  primaryOperator: { select: { id: true, operatorCode: true, operatorName: true } },
  sessionOperators: {
    orderBy: { id: "asc" },
    include: { operator: { select: { id: true, operatorCode: true, operatorName: true } } },
  },
  runSegments: {
    orderBy: { id: "asc" },
    include: { workOrder: { select: { id: true, docNo: true } } },
  },
  downtimeSegments: {
    orderBy: { id: "asc" },
    include: { incident: true },
  },
  shiftReport: {
    include: {
      versions: {
        orderBy: { versionNo: "asc" },
        include: {
          declaredOperator: { select: { id: true, operatorCode: true, operatorName: true } },
          lines: {
            orderBy: { id: "asc" },
            include: { item: { select: { id: true, itemName: true } } },
          },
        },
      },
    },
  },
  reopenRequests: {
    orderBy: { id: "asc" },
    include: REOPEN_ACTOR_INCLUDE,
  },
});

async function getShiftSessionDetail(sessionId, db = prisma) {
  const id = Number(sessionId);
  if (!Number.isInteger(id) || id <= 0) {
    throw domainError(400, "SESSION_ID_INVALID", "Shift session is required.");
  }
  const session = await db.machineShiftSession.findUnique({
    where: { id },
    include: SESSION_DETAIL_INCLUDE,
  });
  if (!session) {
    throw domainError(404, "SHIFT_SESSION_NOT_FOUND", "Shift session was not found.");
  }
  const aggregation = await aggregateShiftSessionProductionQuantities(db, id);
  const {
    getShiftSessionProductionQtyLock,
  } = require("./machineShiftProductionQtyLockService");
  const qtyLock = await getShiftSessionProductionQtyLock(db, id);
  let canCancel = false;
  if (session.status === "OPEN") {
    const { assessShiftSessionCancelEligibility } = require("./machineShiftSessionLifecycleService");
    const eligibility = await assessShiftSessionCancelEligibility(db, id);
    canCancel = eligibility.eligible;
  }
  return mapSessionDetail(session, {
    aggregation,
    productionQtyLocked: qtyLock.productionQtyLocked,
    productionQtyLockReason: qtyLock.productionQtyLockReason,
    canCancel,
  });
}

async function getOpenShiftSessionForMachine(machineId, db = prisma) {
  const mid = Number(machineId);
  if (!Number.isInteger(mid) || mid <= 0) {
    throw domainError(400, "MACHINE_ID_INVALID", "Machine is required.");
  }
  const session = await db.machineShiftSession.findFirst({
    where: { machineId: mid, status: "OPEN" },
    orderBy: { id: "desc" },
    include: SESSION_DETAIL_INCLUDE,
  });
  if (!session) return null;
  const aggregation = await aggregateShiftSessionProductionQuantities(db, session.id);
  const {
    getShiftSessionProductionQtyLock,
  } = require("./machineShiftProductionQtyLockService");
  const qtyLock = await getShiftSessionProductionQtyLock(db, session.id);
  let canCancel = false;
  if (session.status === "OPEN") {
    const { assessShiftSessionCancelEligibility } = require("./machineShiftSessionLifecycleService");
    const eligibility = await assessShiftSessionCancelEligibility(db, session.id);
    canCancel = eligibility.eligible;
  }
  return mapSessionDetail(session, {
    aggregation,
    productionQtyLocked: qtyLock.productionQtyLocked,
    productionQtyLockReason: qtyLock.productionQtyLockReason,
    canCancel,
  });
}

async function listReopenRequestsForSession(sessionId, db = prisma) {
  const id = Number(sessionId);
  const rows = await db.shiftSessionReopenRequest.findMany({
    where: { sessionId: id },
    orderBy: { id: "asc" },
    include: REOPEN_ACTOR_INCLUDE,
  });
  return rows.map(mapReopenRequest);
}

/** Map a reopen row (or id) to the client DTO with actor display names. */
async function getMappedReopenRequest(requestOrId, db = prisma) {
  const id =
    requestOrId && typeof requestOrId === "object"
      ? Number(requestOrId.id)
      : Number(requestOrId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await db.shiftSessionReopenRequest.findUnique({
    where: { id },
    include: REOPEN_ACTOR_INCLUDE,
  });
  if (!row) {
    if (requestOrId && typeof requestOrId === "object") return mapReopenRequest(requestOrId);
    return null;
  }
  return mapReopenRequest(row);
}

async function listAdjustmentsForVersion(reportVersionId, db = prisma) {
  const id = Number(reportVersionId);
  const rows = await db.shiftProductionReportAdjustmentRequest.findMany({
    where: { reportVersionId: id },
    orderBy: { id: "asc" },
    include: ADJUSTMENT_DETAIL_INCLUDE,
  });
  return rows.map(mapAdjustmentRequest);
}

async function getAdjustmentRequestDetail(requestId, db = prisma) {
  const id = Number(requestId);
  const row = await db.shiftProductionReportAdjustmentRequest.findUnique({
    where: { id },
    include: ADJUSTMENT_DETAIL_INCLUDE,
  });
  if (!row) {
    throw domainError(404, "ADJUSTMENT_NOT_FOUND", "Historical adjustment request was not found.");
  }
  return mapAdjustmentRequest(row);
}

/** Map an adjustment row (or id) to the client DTO with actor display names. */
async function getMappedAdjustmentRequest(requestOrId, db = prisma) {
  const id =
    requestOrId && typeof requestOrId === "object"
      ? Number(requestOrId.id)
      : Number(requestOrId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await db.shiftProductionReportAdjustmentRequest.findUnique({
    where: { id },
    include: ADJUSTMENT_DETAIL_INCLUDE,
  });
  if (!row) {
    if (requestOrId && typeof requestOrId === "object") return mapAdjustmentRequest(requestOrId);
    return null;
  }
  return mapAdjustmentRequest(row);
}

module.exports = {
  qtyNum,
  dateOnly,
  mapSessionDetail,
  mapReportVersion,
  mapAdjustmentRequest,
  getMappedAdjustmentRequest,
  mapReopenRequest,
  getMappedReopenRequest,
  getShiftSessionDetail,
  getOpenShiftSessionForMachine,
  listReopenRequestsForSession,
  listAdjustmentsForVersion,
  getAdjustmentRequestDetail,
  mapUserBrief,
  userDisplayName,
  REOPEN_ACTOR_INCLUDE,
  ADJUSTMENT_ACTOR_INCLUDE,
};
