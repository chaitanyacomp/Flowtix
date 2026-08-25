/**
 * Step 2C — Historical shift report adjustment (in-memory tx).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  startShiftSession,
  startRunSegment,
  saveShiftReportDraft,
  submitShiftReport,
  verifyShiftReport,
  completeShiftOver,
  requestShiftReportAdjustment,
  approveShiftReportAdjustment,
  denyShiftReportAdjustment,
  applyShiftReportAdjustment,
  REPORT_VERSION_STATUS,
  ADJUSTMENT_STATUS,
  mapShiftSessionPersistenceError,
} = require("../../src/services/machineShiftSessionOperations");

function seq(start = 1) {
  let n = start;
  return () => {
    const v = n;
    n += 1;
    return v;
  };
}

function createMemoryDb() {
  const nextSessionId = seq(1);
  const nextOpPartId = seq(1);
  const nextSegId = seq(1);
  const nextReportId = seq(1);
  const nextVersionId = seq(1);
  const nextLineId = seq(1);
  const nextAdjId = seq(1);
  const nextAdjLineId = seq(1);
  const nextPeId = seq(1);

  const machines = new Map([[1, { id: 1, isActive: true, machineCode: "M1", machineName: "Press 1" }]]);
  const operators = new Map([[100, { id: 100, isActive: true, operatorCode: "OP1", operatorName: "Alice" }]]);
  const workOrders = new Map([[50, { id: 50, status: "IN_PROGRESS", docNo: "WO-R-26-0001" }]]);
  const runAllocations = new Map([
    [200, { id: 200, workOrderId: 50, machineId: 1, isActive: true, runSequence: 1 }],
  ]);
  const items = new Map([[66, { id: 66, itemName: "FG Widget" }]]);

  const sessions = [];
  const sessionOperators = [];
  const runSegments = [];
  const reports = [];
  const versions = [];
  const lines = [];
  const adjustments = [];
  const adjustmentLines = [];
  const productionEntries = [];

  function attachVersion(row, include) {
    if (!row) return null;
    const out = { ...row };
    if (include?.lines) out.lines = lines.filter((l) => l.reportVersionId === row.id).sort((a, b) => a.id - b.id);
    if (include?.report) {
      const report = reports.find((r) => r.id === row.reportId);
      out.report = report
        ? {
            ...report,
            ...(include.report.include?.session
              ? { session: sessions.find((s) => s.id === report.sessionId) }
              : {}),
          }
        : null;
    }
    return out;
  }

  const tx = {
    machine: { findUnique: async ({ where }) => machines.get(where.id) || null },
    shift: { findUnique: async () => ({ id: 10, isActive: true }) },
    operator: {
      findMany: async ({ where }) => (where?.id?.in || []).map((id) => operators.get(id)).filter(Boolean),
    },
    workOrder: { findUnique: async ({ where }) => workOrders.get(where.id) || null },
    workOrderProductionRunAllocation: {
      findUnique: async ({ where }) => runAllocations.get(where.id) || null,
    },
    machineShiftSession: {
      findFirst: async ({ where } = {}) => {
        let rows = sessions.slice();
        if (where?.machineId != null) rows = rows.filter((s) => s.machineId === where.machineId);
        if (where?.status != null) rows = rows.filter((s) => s.status === where.status);
        if (where?.shiftSessionNo?.startsWith) {
          rows = rows.filter((s) => String(s.shiftSessionNo).startsWith(where.shiftSessionNo.startsWith));
        }
        return rows.sort((a, b) => b.id - a.id)[0] || null;
      },
      findUnique: async ({ where }) => sessions.find((s) => s.id === where.id) || null,
      create: async ({ data, include }) => {
        if (data.status === "OPEN" && sessions.some((s) => s.machineId === data.machineId && s.status === "OPEN")) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          err.meta = { target: ["openMachId"] };
          throw err;
        }
        const id = nextSessionId();
        const row = {
          id,
          machineId: data.machineId,
          shiftId: data.shiftId ?? null,
          sessionDate: data.sessionDate,
          shiftSessionNo: data.shiftSessionNo,
          status: data.status,
          handoverState: data.handoverState,
          handoverRemarks: null,
          primaryOperatorId: data.primaryOperatorId,
          startedAt: data.startedAt,
          startedByUserId: data.startedByUserId ?? null,
          endedAt: null,
          endedByUserId: null,
          reopenCount: 0,
        };
        sessions.push(row);
        const createdOps = [];
        for (const op of data.sessionOperators?.create || []) {
          const part = { id: nextOpPartId(), sessionId: id, ...op };
          sessionOperators.push(part);
          createdOps.push(part);
        }
        if (!include) return row;
        return { ...row, sessionOperators: createdOps, primaryOperator: operators.get(row.primaryOperatorId) };
      },
      update: async ({ where, data }) => {
        const row = sessions.find((s) => s.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    machineShiftSessionOperator: {
      findFirst: async ({ where } = {}) => {
        let rows = sessionOperators.filter((r) => r.sessionId === where.sessionId);
        if (where.operatorId != null) rows = rows.filter((r) => r.operatorId === where.operatorId);
        return rows[0] || null;
      },
      findMany: async ({ where } = {}) => sessionOperators.filter((r) => r.sessionId === where.sessionId),
      create: async ({ data }) => {
        const row = { id: nextOpPartId(), ...data };
        sessionOperators.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = sessionOperators.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    machineShiftSessionRunSegment: {
      findFirst: async ({ where, orderBy } = {}) => {
        let rows = runSegments.slice();
        if (where.machineId != null) rows = rows.filter((r) => r.machineId === where.machineId);
        if (where.sessionId != null) rows = rows.filter((r) => r.sessionId === where.sessionId);
        if (where.status != null) rows = rows.filter((r) => r.status === where.status);
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        return rows[0] || null;
      },
      findMany: async ({ where, select } = {}) => {
        let rows = runSegments.filter((r) => r.sessionId === where.sessionId);
        if (select) {
          return rows.map((r) => {
            const out = {};
            for (const k of Object.keys(select)) if (select[k]) out[k] = r[k];
            return out;
          });
        }
        return rows;
      },
      findUnique: async ({ where }) => runSegments.find((r) => r.id === where.id) || null,
      count: async ({ where }) => runSegments.filter((r) => r.sessionId === where.sessionId).length,
      create: async ({ data }) => {
        const row = { id: nextSegId(), closedAt: null, closedByUserId: null, closeReason: null, ...data };
        runSegments.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = runSegments.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    machineShiftDowntimeSegment: {
      findMany: async () => [],
      findFirst: async () => null,
      create: async () => null,
      update: async () => null,
    },
    machineShiftDowntimeIncident: {
      findFirst: async () => null,
      findUnique: async () => null,
      create: async () => null,
      update: async () => null,
    },
    shiftProductionReport: {
      findUnique: async ({ where, include } = {}) => {
        let row = null;
        if (where.sessionId != null) row = reports.find((r) => r.sessionId === where.sessionId) || null;
        if (where.id != null) row = reports.find((r) => r.id === where.id) || null;
        if (!row) return null;
        if (include?.session) return { ...row, session: sessions.find((s) => s.id === row.sessionId) };
        return row;
      },
      create: async ({ data }) => {
        const row = { id: nextReportId(), latestVersionNo: 0, ...data };
        reports.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = reports.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    shiftProductionReportVersion: {
      findFirst: async ({ where, include } = {}) => {
        let rows = versions.filter((v) => v.reportId === where.reportId);
        if (where.versionNo != null) rows = rows.filter((v) => v.versionNo === where.versionNo);
        return attachVersion(rows[0] || null, include);
      },
      findUnique: async ({ where, include } = {}) =>
        attachVersion(versions.find((v) => v.id === where.id) || null, include),
      create: async ({ data, include }) => {
        const id = nextVersionId();
        const { lines: lineCreate, ...rest } = data;
        const row = {
          id,
          declaredOperatorId: null,
          declaredByUserId: null,
          declaredAt: null,
          submittedAt: null,
          submittedByUserId: null,
          verifiedAt: null,
          verifiedByUserId: null,
          returnedAt: null,
          returnedByUserId: null,
          returnReason: null,
          ...rest,
        };
        versions.push(row);
        const createdLines = [];
        for (const l of lineCreate?.create || []) {
          const line = { id: nextLineId(), reportVersionId: id, ...l };
          lines.push(line);
          createdLines.push(line);
        }
        if (include?.lines) return { ...row, lines: createdLines };
        return row;
      },
      update: async ({ where, data, include } = {}) => {
        const row = versions.find((v) => v.id === where.id);
        Object.assign(row, data);
        return attachVersion(row, include);
      },
    },
    shiftProductionReportVersionLine: {
      count: async ({ where } = {}) => {
        let rows = lines.slice();
        if (where?.reportVersionId != null) {
          rows = rows.filter((l) => l.reportVersionId === where.reportVersionId);
        }
        return rows.length;
      },
      deleteMany: async ({ where }) => {
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          if (lines[i].reportVersionId === where.reportVersionId) lines.splice(i, 1);
        }
        return { count: 0 };
      },
      createMany: async ({ data }) => {
        for (const l of data) lines.push({ id: nextLineId(), ...l });
        return { count: data.length };
      },
    },
    shiftProductionReportAdjustmentRequest: {
      findFirst: async ({ where, orderBy } = {}) => {
        let rows = adjustments.filter((r) => r.reportVersionId === where.reportVersionId);
        if (where.status?.in) rows = rows.filter((r) => where.status.in.includes(r.status));
        else if (where.status != null) rows = rows.filter((r) => r.status === where.status);
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        return rows[0] || null;
      },
      findUnique: async ({ where, include } = {}) => {
        const row = adjustments.find((r) => r.id === where.id) || null;
        if (!row) return null;
        const out = { ...row };
        if (include?.proposedLines) {
          out.proposedLines = adjustmentLines
            .filter((l) => l.adjustmentRequestId === row.id)
            .sort((a, b) => a.id - b.id);
        }
        if (include?.reportVersion) {
          out.reportVersion = attachVersion(versions.find((v) => v.id === row.reportVersionId), {
            lines: true,
            report: { include: { session: true } },
          });
        }
        if (include?.appliedReportVersion) {
          out.appliedReportVersion = row.appliedReportVersionId
            ? attachVersion(versions.find((v) => v.id === row.appliedReportVersionId), {
                lines: include.appliedReportVersion?.include?.lines ? true : undefined,
              })
            : null;
        }
        return out;
      },
      create: async ({ data, include }) => {
        // Simulate unresVerId uniqueness
        if (
          data.status === "REQUESTED" ||
          data.status === "APPROVED"
        ) {
          const conflict = adjustments.find(
            (a) =>
              a.reportVersionId === data.reportVersionId &&
              (a.status === "REQUESTED" || a.status === "APPROVED"),
          );
          if (conflict) {
            const err = new Error("Unique constraint failed");
            err.code = "P2002";
            err.meta = { target: ["unresVerId"] };
            throw err;
          }
        }
        const id = nextAdjId();
        const { proposedLines: lineCreate, ...rest } = data;
        const row = {
          id,
          decidedByUserId: null,
          decidedAt: null,
          decisionNote: null,
          appliedAt: null,
          appliedByUserId: null,
          appliedReportVersionId: null,
          ...rest,
        };
        adjustments.push(row);
        const createdLines = [];
        for (const l of lineCreate?.create || []) {
          const line = { id: nextAdjLineId(), adjustmentRequestId: id, ...l };
          adjustmentLines.push(line);
          createdLines.push(line);
        }
        if (include?.proposedLines) return { ...row, proposedLines: createdLines };
        return row;
      },
      update: async ({ where, data, include } = {}) => {
        const row = adjustments.find((r) => r.id === where.id);
        Object.assign(row, data);
        return tx.shiftProductionReportAdjustmentRequest.findUnique({ where: { id: row.id }, include });
      },
    },
    productionEntry: {
      findMany: async ({ where, select } = {}) => {
        let rows = productionEntries.slice();
        if (where?.shiftSessionId != null) {
          rows = rows.filter((r) => r.shiftSessionId === where.shiftSessionId);
        }
        return rows.map((r) => {
          if (!select) return { ...r };
          const out = {};
          for (const k of Object.keys(select)) {
            if (!select[k]) continue;
            if (k === "workOrderLine" && typeof select[k] === "object") {
              out.workOrderLine = {
                fgItemId: r.fgItemId,
                workOrderId: r.workOrderId,
                workOrder: { docNo: workOrders.get(r.workOrderId)?.docNo ?? null },
                fgItem: items.get(r.fgItemId) || { id: r.fgItemId, itemName: null },
              };
            } else {
              out[k] = r[k];
            }
          }
          return out;
        });
      },
      create: async ({ data }) => {
        const row = { id: nextPeId(), ...data };
        productionEntries.push(row);
        return row;
      },
    },
    _state: { sessions, versions, lines, adjustments, adjustmentLines, reports, runSegments, productionEntries },
  };

  return tx;
}

function seedApprovedPe(db, { sessionId, segmentId, itemId = 66, qty, workOrderId = 50 }) {
  return db.productionEntry.create({
    data: {
      producedQty: qty,
      workflowStatus: "APPROVED",
      shiftSessionId: sessionId,
      shiftRunSegmentId: segmentId,
      fgItemId: itemId,
      workOrderId,
    },
  });
}

async function closedVerifiedSession(db) {
  const session = await startShiftSession(
    {
      machineId: 1,
      sessionDate: "2026-08-24",
      startedByUserId: 7,
      operators: [{ operatorId: 100, isPrimary: true }],
    },
    db,
  );
  const run = await startRunSegment({ sessionId: session.id, runAllocationId: 200, actorUserId: 7 }, db);
  await seedApprovedPe(db, { sessionId: session.id, segmentId: run.segment.id, qty: 95 });
  await saveShiftReportDraft(
    {
      sessionId: session.id,
      lines: [
        {
          runSegmentId: run.segment.id,
          itemId: 66,
          productionScrapQty: 5,
        },
      ],
    },
    db,
  );
  const submitted = await submitShiftReport(
    { sessionId: session.id, declaredOperatorId: 100, declaredByUserId: 7 },
    db,
  );
  await verifyShiftReport({ versionId: submitted.version.id, actorUserId: 9 }, db);
  await completeShiftOver({ sessionId: session.id, handoverState: "CLEARED", actorUserId: 7 }, db);
  return { session, runSegment: run.segment, verifiedVersion: submitted.version };
}

describe("Step 2C historical adjustment", () => {
  it("stores proposed lines/totals; approve does not mutate verified; apply creates new VERIFIED", async () => {
    const db = createMemoryDb();
    const { session, runSegment, verifiedVersion } = await closedVerifiedSession(db);
    const originalGross = Number(verifiedVersion.grossOutputQty);

    const requested = await requestShiftReportAdjustment(
      {
        reportVersionId: verifiedVersion.id,
        adjustReason: "Scrap was overstated",
        actorUserId: 7,
        lines: [
          {
            runSegmentId: runSegment.id,
            itemId: 66,
            grossOutputQty: 100,
            productionScrapQty: 2,
            qtySentToQc: 98,
          },
        ],
      },
      db,
    );
    assert.equal(requested.created, true);
    assert.equal(Number(requested.request.proposedGrossOutputQty), 100);
    assert.equal(requested.request.proposedLines.length, 1);
    assert.equal(Number(requested.request.proposedLines[0].qtySentToQc), 98);

    const approved = await approveShiftReportAdjustment(
      { requestId: requested.request.id, actorUserId: 9, decisionNote: "OK" },
      db,
    );
    assert.equal(approved.approved, true);
    assert.equal(approved.request.status, ADJUSTMENT_STATUS.APPROVED);

    const targetStill = db._state.versions.find((v) => v.id === verifiedVersion.id);
    assert.equal(targetStill.status, REPORT_VERSION_STATUS.VERIFIED);
    assert.equal(Number(targetStill.grossOutputQty), originalGross);

    const applied = await applyShiftReportAdjustment(
      { requestId: requested.request.id, actorUserId: 9 },
      db,
    );
    assert.equal(applied.applied, true);
    assert.equal(applied.correctedVersion.status, REPORT_VERSION_STATUS.VERIFIED);
    assert.equal(applied.correctedVersion.previousVersionId, verifiedVersion.id);
    assert.equal(Number(applied.correctedVersion.qtySentToQc), 98);
    assert.equal(applied.request.appliedReportVersionId, applied.correctedVersion.id);
    assert.equal(applied.session.status, "SHIFT_OVER");
    assert.equal(applied.sessionRemainsShiftOver, true);

    const originalAfter = db._state.versions.find((v) => v.id === verifiedVersion.id);
    assert.equal(Number(originalAfter.grossOutputQty), originalGross);
    assert.equal(originalAfter.status, REPORT_VERSION_STATUS.VERIFIED);

    const report = db._state.reports.find((r) => r.sessionId === session.id);
    assert.equal(report.latestVersionNo, applied.correctedVersion.versionNo);

    const idem = await applyShiftReportAdjustment(
      { requestId: requested.request.id, actorUserId: 99 },
      db,
    );
    assert.equal(idem.alreadyApplied, true);
    assert.equal(db._state.versions.filter((v) => v.status === "VERIFIED").length, 2);
  });

  it("denies with required note; blocks second unresolved request; maps uniqueness", async () => {
    const db = createMemoryDb();
    const { runSegment, verifiedVersion } = await closedVerifiedSession(db);

    const req = await requestShiftReportAdjustment(
      {
        reportVersionId: verifiedVersion.id,
        adjustReason: "Fix QC qty",
        actorUserId: 7,
        lines: [
          {
            runSegmentId: runSegment.id,
            itemId: 66,
            grossOutputQty: 90,
            productionScrapQty: 0,
            qtySentToQc: 90,
          },
        ],
      },
      db,
    );

    await assert.rejects(
      () => denyShiftReportAdjustment({ requestId: req.request.id, actorUserId: 9 }, db),
      /decision note/i,
    );

    const denied = await denyShiftReportAdjustment(
      { requestId: req.request.id, actorUserId: 9, decisionNote: "Insufficient evidence" },
      db,
    );
    assert.equal(denied.denied, true);
    assert.equal(denied.request.decisionNote, "Insufficient evidence");

    // After deny, a new request is allowed
    const req2 = await requestShiftReportAdjustment(
      {
        reportVersionId: verifiedVersion.id,
        adjustReason: "Retry with evidence",
        actorUserId: 7,
        lines: [
          {
            runSegmentId: runSegment.id,
            itemId: 66,
            grossOutputQty: 90,
            productionScrapQty: 0,
            qtySentToQc: 90,
          },
        ],
      },
      db,
    );
    assert.equal(req2.created, true);

    await assert.rejects(
      () =>
        requestShiftReportAdjustment(
          {
            reportVersionId: verifiedVersion.id,
            adjustReason: "Duplicate",
            actorUserId: 7,
            lines: [
              {
                runSegmentId: runSegment.id,
                itemId: 66,
                grossOutputQty: 80,
                productionScrapQty: 0,
                qtySentToQc: 80,
              },
            ],
          },
          db,
        ),
      (e) => e.code === "ADJUSTMENT_ALREADY_OPEN",
    );

    const mapped = mapShiftSessionPersistenceError(
      { code: "P2002", meta: { target: ["unresVerId"] } },
      { action: "requestAdjustment" },
    );
    assert.equal(mapped.code, "ADJUSTMENT_ALREADY_OPEN");
  });

  it("rejects adjustment when session is still open", async () => {
    const db = createMemoryDb();
    const session = await startShiftSession(
      {
        machineId: 1,
        sessionDate: "2026-08-24",
        operators: [{ operatorId: 100, isPrimary: true }],
        startedByUserId: 7,
      },
      db,
    );
    const run = await startRunSegment({ sessionId: session.id, runAllocationId: 200, actorUserId: 7 }, db);
    await seedApprovedPe(db, { sessionId: session.id, segmentId: run.segment.id, qty: 10 });
    await saveShiftReportDraft(
      {
        sessionId: session.id,
        lines: [
          {
            runSegmentId: run.segment.id,
            itemId: 66,
            productionScrapQty: 0,
          },
        ],
      },
      db,
    );
    const submitted = await submitShiftReport(
      { sessionId: session.id, declaredOperatorId: 100, declaredByUserId: 7 },
      db,
    );
    await verifyShiftReport({ versionId: submitted.version.id, actorUserId: 9 }, db);

    await assert.rejects(
      () =>
        requestShiftReportAdjustment(
          {
            reportVersionId: submitted.version.id,
            adjustReason: "Too early",
            actorUserId: 7,
            lines: [
              {
                runSegmentId: run.segment.id,
                itemId: 66,
                grossOutputQty: 10,
                productionScrapQty: 0,
                qtySentToQc: 10,
              },
            ],
          },
          db,
        ),
      /shift over/i,
    );
  });
});
