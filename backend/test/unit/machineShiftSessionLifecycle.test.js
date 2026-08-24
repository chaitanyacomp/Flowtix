/**
 * Step 2B — Shift report, verify, Shift Over, controlled reopen (in-memory tx).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  startShiftSession,
  startRunSegment,
  pauseForDowntime,
  saveShiftReportDraft,
  submitShiftReport,
  returnShiftReport,
  verifyShiftReport,
  completeShiftOver,
  requestShiftSessionReopen,
  approveShiftSessionReopen,
  denyShiftSessionReopen,
  SYSTEM_CLOSE_REASON,
  REPORT_VERSION_STATUS,
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
  const nextIncidentId = seq(1);
  const nextDtSegId = seq(1);
  const nextReportId = seq(1);
  const nextVersionId = seq(1);
  const nextLineId = seq(1);
  const nextReopenId = seq(1);
  const nextPeId = seq(1);

  const machines = new Map([[1, { id: 1, isActive: true, machineCode: "M1", machineName: "Press 1" }]]);
  const shifts = new Map([[10, { id: 10, isActive: true, shiftCode: "NIGHT", shiftName: "Night" }]]);
  const operators = new Map([
    [100, { id: 100, isActive: true, operatorCode: "OP1", operatorName: "Alice" }],
    [101, { id: 101, isActive: true, operatorCode: "OP2", operatorName: "Bob" }],
  ]);
  const workOrders = new Map([[50, { id: 50, status: "IN_PROGRESS", docNo: "WO-R-26-0001" }]]);
  const runAllocations = new Map([
    [200, { id: 200, workOrderId: 50, machineId: 1, isActive: true, runSequence: 1 }],
  ]);
  const items = new Map([[66, { id: 66, itemName: "FG Widget" }]]);

  const sessions = [];
  const sessionOperators = [];
  const runSegments = [];
  const downtimeIncidents = [];
  const downtimeSegments = [];
  const reports = [];
  const versions = [];
  const lines = [];
  const reopenRequests = [];
  const productionEntries = [];

  const tx = {
    machine: {
      findUnique: async ({ where }) => machines.get(where.id) || null,
    },
    shift: {
      findUnique: async ({ where }) => shifts.get(where.id) || null,
    },
    operator: {
      findMany: async ({ where }) => (where?.id?.in || []).map((id) => operators.get(id)).filter(Boolean),
    },
    workOrder: {
      findUnique: async ({ where }) => workOrders.get(where.id) || null,
    },
    workOrderProductionRunAllocation: {
      findUnique: async ({ where }) => runAllocations.get(where.id) || null,
    },
    machineShiftSession: {
      findFirst: async ({ where, orderBy } = {}) => {
        let rows = sessions.slice();
        if (where?.machineId != null) rows = rows.filter((s) => s.machineId === where.machineId);
        if (where?.status != null) rows = rows.filter((s) => s.status === where.status);
        if (where?.id?.not != null) rows = rows.filter((s) => s.id !== where.id.not);
        if (where?.id?.gt != null) rows = rows.filter((s) => s.id > where.id.gt);
        if (where?.shiftSessionNo?.startsWith) {
          const p = where.shiftSessionNo.startsWith;
          rows = rows.filter((s) => String(s.shiftSessionNo).startsWith(p));
        }
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        if (orderBy?.id === "asc") rows.sort((a, b) => a.id - b.id);
        if (orderBy?.shiftSessionNo === "desc") {
          rows.sort((a, b) => String(b.shiftSessionNo).localeCompare(String(a.shiftSessionNo)));
        }
        return rows[0] || null;
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
          handoverRemarks: data.handoverRemarks ?? null,
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
        return {
          ...row,
          sessionOperators: createdOps,
          machine: machines.get(row.machineId),
          shift: row.shiftId != null ? shifts.get(row.shiftId) : null,
          primaryOperator: operators.get(row.primaryOperatorId),
        };
      },
      update: async ({ where, data }) => {
        const row = sessions.find((s) => s.id === where.id);
        const next = { ...data };
        if (data.reopenCount?.increment != null) {
          next.reopenCount = (row.reopenCount || 0) + data.reopenCount.increment;
        }
        // Simulate MySQL openMachId uniqueness when restoring OPEN
        if (next.status === "OPEN" && row.status !== "OPEN") {
          if (sessions.some((s) => s.id !== row.id && s.machineId === row.machineId && s.status === "OPEN")) {
            const err = new Error("Unique constraint failed");
            err.code = "P2002";
            err.meta = { target: ["openMachId"] };
            throw err;
          }
        }
        Object.assign(row, next);
        return row;
      },
    },
    machineShiftSessionOperator: {
      findMany: async ({ where } = {}) => {
        let rows = sessionOperators.filter((r) => r.sessionId === where.sessionId);
        if (where.leftAt === null) rows = rows.filter((r) => r.leftAt == null);
        return rows;
      },
      findFirst: async ({ where, orderBy } = {}) => {
        let rows = sessionOperators.filter((r) => r.sessionId === where.sessionId);
        if (where.operatorId != null) rows = rows.filter((r) => r.operatorId === where.operatorId);
        if (where.leftAt === null) rows = rows.filter((r) => r.leftAt == null);
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        return rows[0] || null;
      },
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
        let rows = runSegments.slice();
        if (where?.sessionId != null) rows = rows.filter((r) => r.sessionId === where.sessionId);
        if (where?.workOrderId != null) rows = rows.filter((r) => r.workOrderId === where.workOrderId);
        if (where?.status != null) rows = rows.filter((r) => r.status === where.status);
        if (where?.machineId != null) rows = rows.filter((r) => r.machineId === where.machineId);
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
        if (data.status === "ACTIVE" && runSegments.some((r) => r.machineId === data.machineId && r.status === "ACTIVE")) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          err.meta = { target: ["actMachId"] };
          throw err;
        }
        const row = {
          id: nextSegId(),
          closedAt: null,
          closedByUserId: null,
          closeReason: null,
          ...data,
        };
        runSegments.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = runSegments.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    machineShiftDowntimeIncident: {
      findFirst: async ({ where, orderBy } = {}) => {
        let rows = downtimeIncidents.slice();
        if (where.machineId != null) rows = rows.filter((r) => r.machineId === where.machineId);
        if (where.endedAt === null) rows = rows.filter((r) => r.endedAt == null);
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        return rows[0] || null;
      },
      findUnique: async ({ where }) => downtimeIncidents.find((r) => r.id === where.id) || null,
      create: async ({ data }) => {
        const row = { id: nextIncidentId(), ...data };
        downtimeIncidents.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = downtimeIncidents.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    machineShiftDowntimeSegment: {
      findFirst: async ({ where, include, orderBy } = {}) => {
        let rows = downtimeSegments.slice();
        if (where.sessionId != null) rows = rows.filter((r) => r.sessionId === where.sessionId);
        if (where.incidentId != null) rows = rows.filter((r) => r.incidentId === where.incidentId);
        if (where.segmentEndAt === null) rows = rows.filter((r) => r.segmentEndAt == null);
        if (where.incident?.machineId != null) {
          rows = rows.filter((r) => {
            const inc = downtimeIncidents.find((i) => i.id === r.incidentId);
            return inc && inc.machineId === where.incident.machineId;
          });
        }
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        const row = rows[0] || null;
        if (!row) return null;
        if (include?.incident) return { ...row, incident: downtimeIncidents.find((i) => i.id === row.incidentId) };
        return row;
      },
      findMany: async ({ where } = {}) => {
        let rows = downtimeSegments.slice();
        if (where.sessionId != null) rows = rows.filter((r) => r.sessionId === where.sessionId);
        if (where.incidentId != null) rows = rows.filter((r) => r.incidentId === where.incidentId);
        if (where.segmentEndAt === null) rows = rows.filter((r) => r.segmentEndAt == null);
        if (where.sessionId?.not != null) rows = rows.filter((r) => r.sessionId !== where.sessionId.not);
        return rows;
      },
      create: async ({ data }) => {
        const row = { id: nextDtSegId(), ...data };
        downtimeSegments.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = downtimeSegments.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    shiftProductionReport: {
      findUnique: async ({ where }) => {
        if (where.sessionId != null) return reports.find((r) => r.sessionId === where.sessionId) || null;
        if (where.id != null) return reports.find((r) => r.id === where.id) || null;
        return null;
      },
      create: async ({ data }) => {
        if (reports.some((r) => r.sessionId === data.sessionId)) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          err.meta = { target: ["sessionId"] };
          throw err;
        }
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
        const row = rows[0] || null;
        if (!row) return null;
        if (include?.lines) {
          return { ...row, lines: lines.filter((l) => l.reportVersionId === row.id).sort((a, b) => a.id - b.id) };
        }
        return row;
      },
      findUnique: async ({ where, include } = {}) => {
        const row = versions.find((v) => v.id === where.id) || null;
        if (!row) return null;
        const out = { ...row };
        if (include?.lines) out.lines = lines.filter((l) => l.reportVersionId === row.id).sort((a, b) => a.id - b.id);
        if (include?.report) out.report = reports.find((r) => r.id === row.reportId);
        return out;
      },
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
        if (include?.lines) {
          return { ...row, lines: lines.filter((l) => l.reportVersionId === row.id).sort((a, b) => a.id - b.id) };
        }
        return row;
      },
    },
    shiftProductionReportVersionLine: {
      deleteMany: async ({ where }) => {
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          if (lines[i].reportVersionId === where.reportVersionId) lines.splice(i, 1);
        }
        return { count: 0 };
      },
      createMany: async ({ data }) => {
        for (const l of data) {
          lines.push({ id: nextLineId(), ...l });
        }
        return { count: data.length };
      },
    },
    shiftSessionReopenRequest: {
      findFirst: async ({ where, orderBy } = {}) => {
        let rows = reopenRequests.filter((r) => r.sessionId === where.sessionId);
        if (where.status != null) rows = rows.filter((r) => r.status === where.status);
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        return rows[0] || null;
      },
      findUnique: async ({ where }) => reopenRequests.find((r) => r.id === where.id) || null,
      create: async ({ data }) => {
        const row = {
          id: nextReopenId(),
          decidedByUserId: null,
          decidedAt: null,
          decisionNote: null,
          ...data,
        };
        reopenRequests.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = reopenRequests.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
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
      update: async ({ where, data }) => {
        const row = productionEntries.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    _state: {
      sessions,
      sessionOperators,
      runSegments,
      downtimeIncidents,
      downtimeSegments,
      reports,
      versions,
      lines,
      reopenRequests,
      productionEntries,
    },
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

async function openSessionWithRun(db) {
  const session = await startShiftSession(
    {
      machineId: 1,
      shiftId: 10,
      sessionDate: "2026-08-24",
      startedByUserId: 7,
      operators: [{ operatorId: 100, isPrimary: true }],
    },
    db,
  );
  const run = await startRunSegment({ sessionId: session.id, runAllocationId: 200, actorUserId: 7 }, db);
  return { session, runSegment: run.segment };
}

async function verifiedReportFlow(db, session, runSegmentId) {
  await seedApprovedPe(db, { sessionId: session.id, segmentId: runSegmentId, qty: 95 });
  await saveShiftReportDraft(
    {
      sessionId: session.id,
      lines: [
        {
          runSegmentId,
          itemId: 66,
          productionScrapQty: 5,
        },
      ],
    },
    db,
  );
  const submitted = await submitShiftReport(
    {
      sessionId: session.id,
      declaredOperatorId: 100,
      declaredByUserId: 7,
    },
    db,
  );
  const verified = await verifyShiftReport({ versionId: submitted.version.id, actorUserId: 9 }, db);
  return verified.version;
}

describe("Step 2B report draft / submit / return / verify", () => {
  it("saves draft without declaration; submit sets declaration together; calculates qty from PE + scrap", async () => {
    const db = createMemoryDb();
    const { session, runSegment } = await openSessionWithRun(db);
    await seedApprovedPe(db, { sessionId: session.id, segmentId: runSegment.id, qty: 95 });

    await assert.rejects(
      () =>
        saveShiftReportDraft(
          {
            sessionId: session.id,
            lines: [
              {
                runSegmentId: runSegment.id,
                itemId: 66,
                productionScrapQty: 2,
                qtySentToQc: 7,
              },
            ],
          },
          db,
        ),
      /calculated from approved production entries/i,
    );

    const draft = await saveShiftReportDraft(
      {
        sessionId: session.id,
        lines: [
          {
            runSegmentId: runSegment.id,
            itemId: 66,
            productionScrapQty: 5,
          },
        ],
      },
      db,
    );
    assert.equal(draft.version.status, REPORT_VERSION_STATUS.DRAFT);
    assert.equal(draft.version.declaredOperatorId, null);
    assert.equal(draft.version.declaredAt, null);
    assert.equal(Number(draft.version.qtySentToQc), 95);
    assert.equal(Number(draft.version.productionScrapQty), 5);
    assert.equal(Number(draft.version.grossOutputQty), 100);

    await assert.rejects(
      () => submitShiftReport({ sessionId: session.id, declaredByUserId: 7 }, db),
      /declare the operator/i,
    );

    const submitted = await submitShiftReport(
      { sessionId: session.id, declaredOperatorId: 100, declaredByUserId: 7 },
      db,
    );
    assert.equal(submitted.submitted, true);
    assert.equal(submitted.version.status, REPORT_VERSION_STATUS.SUBMITTED);
    assert.equal(submitted.version.declaredOperatorId, 100);
    assert.ok(submitted.version.declaredAt);
    assert.equal(submitted.version.submittedByUserId, 7);

    const again = await submitShiftReport(
      { sessionId: session.id, declaredOperatorId: 100, declaredByUserId: 99 },
      db,
    );
    assert.equal(again.alreadySubmitted, true);
    assert.equal(again.version.submittedByUserId, 7);
  });

  it("blocks submit while linked DRAFT production entries remain", async () => {
    const db = createMemoryDb();
    const { session, runSegment } = await openSessionWithRun(db);
    await seedApprovedPe(db, { sessionId: session.id, segmentId: runSegment.id, qty: 10 });
    await db.productionEntry.create({
      data: {
        producedQty: 3,
        workflowStatus: "DRAFT",
        shiftSessionId: session.id,
        shiftRunSegmentId: runSegment.id,
        fgItemId: 66,
        workOrderId: 50,
      },
    });
    await saveShiftReportDraft(
      {
        sessionId: session.id,
        lines: [{ runSegmentId: runSegment.id, itemId: 66, productionScrapQty: 0 }],
      },
      db,
    );
    await assert.rejects(
      () => submitShiftReport({ sessionId: session.id, declaredOperatorId: 100, declaredByUserId: 7 }, db),
      (err) => {
        assert.equal(err.code, "SHIFT_REPORT_HAS_UNAPPROVED_ENTRIES");
        assert.match(String(err.message), /Approve or remove the pending production entries/i);
        return true;
      },
    );
  });

  it("return requires reason; editing after return creates new DRAFT; returned cannot verify", async () => {
    const db = createMemoryDb();
    const { session, runSegment } = await openSessionWithRun(db);
    await seedApprovedPe(db, { sessionId: session.id, segmentId: runSegment.id, qty: 50 });
    await saveShiftReportDraft(
      {
        sessionId: session.id,
        lines: [
          {
            runSegmentId: runSegment.id,
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

    await assert.rejects(
      () => returnShiftReport({ versionId: submitted.version.id, actorUserId: 9 }, db),
      /return reason/i,
    );

    const returned = await returnShiftReport(
      { versionId: submitted.version.id, actorUserId: 9, returnReason: "Scrap looks high" },
      db,
    );
    assert.equal(returned.returned, true);
    assert.equal(returned.version.status, REPORT_VERSION_STATUS.RETURNED);

    await assert.rejects(
      () => verifyShiftReport({ versionId: returned.version.id, actorUserId: 9 }, db),
      /returned/i,
    );

    // Recalculate from current APPROVED PE (still 50) + new scrap.
    const redraft = await saveShiftReportDraft(
      {
        sessionId: session.id,
        lines: [
          {
            runSegmentId: runSegment.id,
            itemId: 66,
            productionScrapQty: 2,
          },
        ],
      },
      db,
    );
    assert.equal(redraft.version.status, REPORT_VERSION_STATUS.DRAFT);
    assert.notEqual(redraft.version.id, returned.version.id);
    assert.equal(redraft.version.previousVersionId, returned.version.id);
    assert.equal(redraft.version.declaredAt, null);
    assert.equal(Number(redraft.version.qtySentToQc), 50);
    assert.equal(Number(redraft.version.grossOutputQty), 52);
    assert.equal(returned.version.status, REPORT_VERSION_STATUS.RETURNED);

    const idemReturn = await returnShiftReport(
      { versionId: returned.version.id, actorUserId: 99, returnReason: "retry" },
      db,
    );
    assert.equal(idemReturn.alreadyReturned, true);
    assert.equal(idemReturn.version.returnReason, "Scrap looks high");
  });

  it("never mutates verified version quantities on verify retry", async () => {
    const db = createMemoryDb();
    const { session, runSegment } = await openSessionWithRun(db);
    const version = await verifiedReportFlow(db, session, runSegment.id);
    const idem = await verifyShiftReport({ versionId: version.id, actorUserId: 99 }, db);
    assert.equal(idem.alreadyVerified, true);
    assert.equal(idem.version.verifiedByUserId, 9);
    assert.equal(Number(idem.version.grossOutputQty), 100);
  });
});

describe("Step 2B Shift Over + reopen", () => {
  it("Shift Over requires verified report, persists handover remarks for UNKNOWN, closes run and downtime segment", async () => {
    const db = createMemoryDb();
    const { session, runSegment } = await openSessionWithRun(db);

    await assert.rejects(
      () => completeShiftOver({ sessionId: session.id, handoverState: "CLEARED", actorUserId: 7 }, db),
      /verified/i,
    );

    await verifiedReportFlow(db, session, runSegment.id);
    await pauseForDowntime({ sessionId: session.id, reason: "WAITING_FOR_RM", actorUserId: 7 }, db);

    await assert.rejects(
      () => completeShiftOver({ sessionId: session.id, handoverState: "UNKNOWN", actorUserId: 7 }, db),
      /handover remarks/i,
    );

    const over = await completeShiftOver(
      {
        sessionId: session.id,
        handoverState: "UNKNOWN",
        handoverRemarks: "Barrel state unclear at handover",
        actorUserId: 7,
      },
      db,
    );
    assert.equal(over.completed, true);
    assert.equal(over.session.status, "SHIFT_OVER");
    assert.ok(over.session.endedAt);
    assert.equal(over.session.endedByUserId, 7);
    assert.equal(over.session.handoverRemarks, "Barrel state unclear at handover");

    const seg = db._state.runSegments.find((r) => r.id === runSegment.id);
    assert.equal(seg.status, "CLOSED");
    assert.equal(seg.closeReason, SYSTEM_CLOSE_REASON.SHIFT_OVER);
    assert.ok(seg.closedAt);

    const dt = db._state.downtimeSegments[0];
    assert.ok(dt.segmentEndAt);
    assert.equal(db._state.downtimeIncidents[0].endedAt, null);

    const idem = await completeShiftOver(
      { sessionId: session.id, handoverState: "CLEARED", actorUserId: 99 },
      db,
    );
    assert.equal(idem.alreadyShiftOver, true);
    assert.equal(idem.session.endedByUserId, 7);
  });

  it("approve reopen restores OPEN, increments reopenCount, copies VERIFIED to new DRAFT; deny keeps closed", async () => {
    const db = createMemoryDb();
    const { session, runSegment } = await openSessionWithRun(db);
    const verified = await verifiedReportFlow(db, session, runSegment.id);
    await completeShiftOver({
      sessionId: session.id,
      handoverState: "CLEARED",
      actorUserId: 7,
    }, db);

    const req = await requestShiftSessionReopen(
      { sessionId: session.id, reopenReason: "Missed scrap line", actorUserId: 7 },
      db,
    );
    assert.equal(req.created, true);

    const denied = await denyShiftSessionReopen(
      { requestId: req.request.id, actorUserId: 9, decisionNote: "Not enough evidence" },
      db,
    );
    assert.equal(denied.denied, true);
    assert.equal(denied.request.decisionNote, "Not enough evidence");
    assert.equal(denied.session.status, "SHIFT_OVER");

    const req2 = await requestShiftSessionReopen(
      { sessionId: session.id, reopenReason: "Manager approved correction", actorUserId: 7 },
      db,
    );
    const approved = await approveShiftSessionReopen(
      { requestId: req2.request.id, actorUserId: 9, decisionNote: "OK to correct" },
      db,
    );
    assert.equal(approved.approved, true);
    assert.equal(approved.session.status, "OPEN");
    assert.equal(approved.session.endedAt, null);
    assert.equal(approved.session.reopenCount, 1);
    assert.equal(approved.draftVersion.status, REPORT_VERSION_STATUS.DRAFT);
    assert.equal(approved.draftVersion.previousVersionId, verified.id);
    assert.equal(approved.draftVersion.declaredAt, null);
    assert.equal(Number(approved.draftVersion.grossOutputQty), 100);

    const verifiedRow = db._state.versions.find((v) => v.id === verified.id);
    assert.equal(verifiedRow.status, REPORT_VERSION_STATUS.VERIFIED);

    const idem = await approveShiftSessionReopen(
      { requestId: req2.request.id, actorUserId: 99, decisionNote: "retry" },
      db,
    );
    assert.equal(idem.alreadyApproved, true);
    assert.equal(idem.request.decisionNote, "OK to correct");
  });

  it("blocks reopen after a later session exists on the machine", async () => {
    const db = createMemoryDb();
    const { session, runSegment } = await openSessionWithRun(db);
    await verifiedReportFlow(db, session, runSegment.id);
    await completeShiftOver({ sessionId: session.id, handoverState: "RETAINED", actorUserId: 7 }, db);

    await startShiftSession(
      {
        machineId: 1,
        sessionDate: "2026-08-25",
        operators: [{ operatorId: 100, isPrimary: true }],
        startedByUserId: 7,
      },
      db,
    );

    await assert.rejects(
      () =>
        requestShiftSessionReopen(
          { sessionId: session.id, reopenReason: "Too late", actorUserId: 7 },
          db,
        ),
      (e) => e.code === "REOPEN_BLOCKED_NEXT_SESSION",
    );
  });
});
