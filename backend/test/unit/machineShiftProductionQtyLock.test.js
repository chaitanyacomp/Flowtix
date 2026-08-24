/**
 * Shift Report production-quantity lock (SUBMITTED / VERIFIED).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  productionQtyLockFromLatestStatus,
  getShiftSessionProductionQtyLock,
  assertShiftSessionProductionQtyUnlocked,
  assertProductionEntryMutationAllowedForShiftLock,
  SHIFT_REPORT_PRODUCTION_LOCKED_MESSAGE,
} = require("../../src/services/machineShiftProductionQtyLockService");
const {
  startShiftSession,
  startRunSegment,
  closeRunSegment,
  pauseForDowntime,
  resumeFromDowntime,
  saveShiftReportDraft,
  submitShiftReport,
  returnShiftReport,
  verifyShiftReport,
  completeShiftOver,
  requestShiftSessionReopen,
  approveShiftSessionReopen,
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
  const operators = new Map([[100, { id: 100, isActive: true, operatorCode: "OP1", operatorName: "Alice" }]]);
  const workOrders = new Map([[50, { id: 50, status: "IN_PROGRESS", docNo: "WO-R-26-0001" }]]);
  const runAllocations = new Map([
    [200, { id: 200, workOrderId: 50, machineId: 1, isActive: true, runSequence: 1 }],
    [201, { id: 201, workOrderId: 50, machineId: 1, isActive: true, runSequence: 2 }],
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
    machine: { findUnique: async ({ where }) => machines.get(where.id) || null },
    shift: { findUnique: async ({ where }) => shifts.get(where.id) || null },
    operator: {
      findMany: async ({ where }) => (where?.id?.in || []).map((id) => operators.get(id)).filter(Boolean),
    },
    workOrder: { findUnique: async ({ where }) => workOrders.get(where.id) || null },
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
          rows = rows.filter((s) => String(s.shiftSessionNo).startsWith(where.shiftSessionNo.startsWith));
        }
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        if (orderBy?.shiftSessionNo === "desc") {
          rows.sort((a, b) => String(b.shiftSessionNo).localeCompare(String(a.shiftSessionNo)));
        }
        return rows[0] || null;
      },
      findUnique: async ({ where }) => sessions.find((s) => s.id === where.id) || null,
      create: async ({ data, include }) => {
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
        Object.assign(row, next);
        return row;
      },
    },
    machineShiftSessionOperator: {
      findMany: async ({ where } = {}) => sessionOperators.filter((r) => r.sessionId === where.sessionId),
      findFirst: async ({ where } = {}) => {
        let rows = sessionOperators.filter((r) => r.sessionId === where.sessionId);
        if (where.operatorId != null) rows = rows.filter((r) => r.operatorId === where.operatorId);
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
        if (where.segmentEndAt === null) rows = rows.filter((r) => r.segmentEndAt == null);
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
        for (const l of data) lines.push({ id: nextLineId(), ...l });
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
    },
    _state: { sessions, runSegments, versions, reports, productionEntries, reopenRequests },
  };
  return tx;
}

async function openWithRun(db) {
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

async function seedPe(db, { sessionId, segmentId, qty = 10 }) {
  return db.productionEntry.create({
    data: {
      producedQty: qty,
      workflowStatus: "APPROVED",
      shiftSessionId: sessionId,
      shiftRunSegmentId: segmentId,
      fgItemId: 66,
      workOrderId: 50,
    },
  });
}

async function submitReport(db, session, runSegmentId) {
  await seedPe(db, { sessionId: session.id, segmentId: runSegmentId, qty: 10 });
  await saveShiftReportDraft(
    {
      sessionId: session.id,
      lines: [{ runSegmentId, itemId: 66, productionScrapQty: 0 }],
    },
    db,
  );
  return submitShiftReport(
    { sessionId: session.id, declaredOperatorId: 100, declaredByUserId: 7 },
    db,
  );
}

describe("productionQtyLockFromLatestStatus", () => {
  it("locks SUBMITTED and VERIFIED; unlocks DRAFT/RETURNED/absent", () => {
    assert.equal(productionQtyLockFromLatestStatus("SUBMITTED").productionQtyLocked, true);
    assert.equal(productionQtyLockFromLatestStatus("VERIFIED").productionQtyLocked, true);
    assert.equal(productionQtyLockFromLatestStatus("DRAFT").productionQtyLocked, false);
    assert.equal(productionQtyLockFromLatestStatus("RETURNED").productionQtyLocked, false);
    assert.equal(productionQtyLockFromLatestStatus(null).productionQtyLocked, false);
  });
});

describe("Shift production qty lock lifecycle", () => {
  it("blocks PE mutation when create would link to SUBMITTED session; allows unlinked transitional", async () => {
    const db = createMemoryDb();
    const { session, runSegment } = await openWithRun(db);
    await submitReport(db, session, runSegment.id);

    const lock = await getShiftSessionProductionQtyLock(db, session.id);
    assert.equal(lock.productionQtyLocked, true);

    await assert.rejects(
      () =>
        assertProductionEntryMutationAllowedForShiftLock(db, {
          workOrderId: 50,
          runAllocationId: 200,
        }),
      (err) => {
        assert.equal(err.code, "SHIFT_REPORT_PRODUCTION_LOCKED");
        assert.equal(err.statusCode, 409);
        assert.equal(err.message, SHIFT_REPORT_PRODUCTION_LOCKED_MESSAGE);
        return true;
      },
    );

    // No safe match (wrong WO) — transitional allow
    await assertProductionEntryMutationAllowedForShiftLock(db, {
      workOrderId: 999,
      runAllocationId: null,
    });
  });

  it("blocks approve/reverse style checks for linked PE; ignores spoofed body IDs via resolver-only path", async () => {
    const db = createMemoryDb();
    const { session, runSegment } = await openWithRun(db);
    await submitReport(db, session, runSegment.id);

    await assert.rejects(
      () =>
        assertProductionEntryMutationAllowedForShiftLock(db, {
          workOrderId: 50,
          runAllocationId: 200,
          shiftSessionId: session.id,
        }),
      /SHIFT_REPORT_PRODUCTION_LOCKED|already been submitted/i,
    );
  });

  it("blocks new run start when locked; allows close of existing run; downtime remains operational", async () => {
    const db = createMemoryDb();
    const { session, runSegment } = await openWithRun(db);
    await submitReport(db, session, runSegment.id);

    // Idempotent continue of same active run still ok while locked
    const same = await startRunSegment(
      { sessionId: session.id, runAllocationId: 200, actorUserId: 7 },
      db,
    );
    assert.equal(same.created, false);

    const closed = await closeRunSegment(
      { sessionId: session.id, segmentId: runSegment.id, closeReason: "End of product", actorUserId: 7 },
      db,
    );
    assert.equal(closed.segment.status, "CLOSED");

    // After close, starting another run is blocked while SUBMITTED
    await assert.rejects(
      () => startRunSegment({ sessionId: session.id, runAllocationId: 201, actorUserId: 7 }, db),
      (err) => err.code === "SHIFT_REPORT_PRODUCTION_LOCKED",
    );
  });

  it("downtime pause/resume works while report is SUBMITTED with active run", async () => {
    const db = createMemoryDb();
    const { session, runSegment } = await openWithRun(db);
    await submitReport(db, session, runSegment.id);

    const paused = await pauseForDowntime(
      { sessionId: session.id, reason: "MACHINE_BREAKDOWN", actorUserId: 7 },
      db,
    );
    assert.ok(paused.incident);
    assert.equal(paused.created, true);

    const resumed = await resumeFromDowntime({ sessionId: session.id, actorUserId: 7 }, db);
    assert.ok(resumed.incident.endedAt);
  });

  it("RETURN unlocks; VERIFIED stays locked; reopen unlocks with new DRAFT", async () => {
    const db = createMemoryDb();
    const { session, runSegment } = await openWithRun(db);
    const submitted = await submitReport(db, session, runSegment.id);

    await assert.rejects(() => assertShiftSessionProductionQtyUnlocked(db, session.id));

    const returned = await returnShiftReport(
      { versionId: submitted.version.id, actorUserId: 9, returnReason: "Fix scrap" },
      db,
    );
    assert.equal(returned.version.status, REPORT_VERSION_STATUS.RETURNED);
    const afterReturn = await getShiftSessionProductionQtyLock(db, session.id);
    assert.equal(afterReturn.productionQtyLocked, false);

    // New draft from save after return
    const draft = await saveShiftReportDraft(
      {
        sessionId: session.id,
        lines: [{ runSegmentId: runSegment.id, itemId: 66, productionScrapQty: 1 }],
      },
      db,
    );
    assert.equal(draft.version.status, REPORT_VERSION_STATUS.DRAFT);
    assert.notEqual(draft.version.id, returned.version.id);

    const submitted2 = await submitShiftReport(
      { sessionId: session.id, declaredOperatorId: 100, declaredByUserId: 7 },
      db,
    );
    const verified = await verifyShiftReport({ versionId: submitted2.version.id, actorUserId: 9 }, db);
    assert.equal(verified.version.status, REPORT_VERSION_STATUS.VERIFIED);
    assert.equal((await getShiftSessionProductionQtyLock(db, session.id)).productionQtyLocked, true);

    await completeShiftOver({ sessionId: session.id, handoverState: "CLEARED", actorUserId: 7 }, db);
    const reopenReq = await requestShiftSessionReopen(
      { sessionId: session.id, reopenReason: "Forgot scrap line", actorUserId: 7 },
      db,
    );
    const approved = await approveShiftSessionReopen(
      { requestId: reopenReq.request.id, actorUserId: 9, decisionNote: "OK" },
      db,
    );
    assert.equal(approved.draftVersion.status, REPORT_VERSION_STATUS.DRAFT);
    assert.equal((await getShiftSessionProductionQtyLock(db, session.id)).productionQtyLocked, false);
    assert.equal(verified.version.status, REPORT_VERSION_STATUS.VERIFIED);
  });
});
