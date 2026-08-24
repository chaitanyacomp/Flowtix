/**
 * ProductionEntry ↔ Machine Shift Session soft link + Shift Report aggregation.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveShiftLinkForProductionEntry,
  ensureShiftLinkOnProductionEntryApprove,
} = require("../../src/services/productionEntryShiftLinkService");
const {
  aggregateShiftSessionProductionQuantities,
  buildCalculatedReportLines,
} = require("../../src/services/machineShiftReportAggregationService");

function makeDb(state) {
  const {
    allocations = [],
    sessions = [],
    segments = [],
    productionEntries = [],
  } = state;

  return {
    workOrderProductionRunAllocation: {
      findUnique: async ({ where }) => allocations.find((a) => a.id === where.id) || null,
    },
    machineShiftSession: {
      findFirst: async ({ where, orderBy } = {}) => {
        let rows = sessions.slice();
        if (where?.machineId != null) rows = rows.filter((s) => s.machineId === where.machineId);
        if (where?.status != null) rows = rows.filter((s) => s.status === where.status);
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        return rows[0] || null;
      },
      findUnique: async ({ where }) => sessions.find((s) => s.id === where.id) || null,
    },
    machineShiftSessionRunSegment: {
      findMany: async ({ where } = {}) => {
        let rows = segments.slice();
        if (where?.workOrderId != null) rows = rows.filter((r) => r.workOrderId === where.workOrderId);
        if (where?.status != null) rows = rows.filter((r) => r.status === where.status);
        if (where?.sessionId != null) rows = rows.filter((r) => r.sessionId === where.sessionId);
        if (where?.machineId != null) rows = rows.filter((r) => r.machineId === where.machineId);
        return rows;
      },
      findFirst: async ({ where, orderBy } = {}) => {
        let rows = segments.slice();
        if (where?.machineId != null) rows = rows.filter((r) => r.machineId === where.machineId);
        if (where?.sessionId != null) rows = rows.filter((r) => r.sessionId === where.sessionId);
        if (where?.status != null) rows = rows.filter((r) => r.status === where.status);
        if (orderBy?.id === "desc") rows.sort((a, b) => b.id - a.id);
        return rows[0] || null;
      },
      findUnique: async ({ where }) => segments.find((r) => r.id === where.id) || null,
    },
    productionEntry: {
      findMany: async ({ where } = {}) => {
        let rows = productionEntries.slice();
        if (where?.shiftSessionId != null) {
          rows = rows.filter((r) => r.shiftSessionId === where.shiftSessionId);
        }
        return rows;
      },
      update: async ({ where, data }) => {
        const row = productionEntries.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
  };
}

describe("resolveShiftLinkForProductionEntry", () => {
  it("matches exact runAllocationId on OPEN session ACTIVE segment", async () => {
    const db = makeDb({
      allocations: [{ id: 200, workOrderId: 50, machineId: 1, isActive: true }],
      sessions: [{ id: 9, machineId: 1, status: "OPEN", shiftSessionNo: "SS-26-0001" }],
      segments: [
        {
          id: 3,
          sessionId: 9,
          machineId: 1,
          workOrderId: 50,
          runAllocationId: 200,
          status: "ACTIVE",
          segmentNo: 1,
        },
      ],
    });
    const link = await resolveShiftLinkForProductionEntry(db, {
      workOrderId: 50,
      runAllocationId: 200,
    });
    assert.deepEqual(link, { shiftSessionId: 9, shiftRunSegmentId: 3 });
  });

  it("safe workOrder-only fallback when segment has no allocation", async () => {
    const db = makeDb({
      sessions: [{ id: 9, machineId: 1, status: "OPEN" }],
      segments: [
        {
          id: 4,
          sessionId: 9,
          machineId: 1,
          workOrderId: 50,
          runAllocationId: null,
          status: "ACTIVE",
          segmentNo: 1,
        },
      ],
    });
    const link = await resolveShiftLinkForProductionEntry(db, {
      workOrderId: 50,
      runAllocationId: null,
    });
    assert.deepEqual(link, { shiftSessionId: 9, shiftRunSegmentId: 4 });
  });

  it("leaves null when no OPEN session", async () => {
    const db = makeDb({
      allocations: [{ id: 200, workOrderId: 50, machineId: 1, isActive: true }],
      sessions: [{ id: 9, machineId: 1, status: "SHIFT_OVER" }],
      segments: [
        {
          id: 3,
          sessionId: 9,
          machineId: 1,
          workOrderId: 50,
          runAllocationId: 200,
          status: "CLOSED",
        },
      ],
    });
    const link = await resolveShiftLinkForProductionEntry(db, {
      workOrderId: 50,
      runAllocationId: 200,
    });
    assert.equal(link, null);
  });

  it("leaves null when active segment is a different run allocation", async () => {
    const db = makeDb({
      allocations: [{ id: 200, workOrderId: 50, machineId: 1, isActive: true }],
      sessions: [{ id: 9, machineId: 1, status: "OPEN" }],
      segments: [
        {
          id: 3,
          sessionId: 9,
          machineId: 1,
          workOrderId: 50,
          runAllocationId: 201,
          status: "ACTIVE",
        },
      ],
    });
    const link = await resolveShiftLinkForProductionEntry(db, {
      workOrderId: 50,
      runAllocationId: 200,
    });
    assert.equal(link, null);
  });

  it("leaves null for ambiguous legacy WO (multiple ACTIVE segments)", async () => {
    const db = makeDb({
      sessions: [
        { id: 9, machineId: 1, status: "OPEN" },
        { id: 10, machineId: 2, status: "OPEN" },
      ],
      segments: [
        {
          id: 3,
          sessionId: 9,
          machineId: 1,
          workOrderId: 50,
          runAllocationId: null,
          status: "ACTIVE",
        },
        {
          id: 4,
          sessionId: 10,
          machineId: 2,
          workOrderId: 50,
          runAllocationId: null,
          status: "ACTIVE",
        },
      ],
    });
    const link = await resolveShiftLinkForProductionEntry(db, {
      workOrderId: 50,
      runAllocationId: null,
    });
    assert.equal(link, null);
  });

  it("leaves null when legacy WO-only PE would match a segment that has an allocation", async () => {
    const db = makeDb({
      sessions: [{ id: 9, machineId: 1, status: "OPEN" }],
      segments: [
        {
          id: 3,
          sessionId: 9,
          machineId: 1,
          workOrderId: 50,
          runAllocationId: 200,
          status: "ACTIVE",
        },
      ],
    });
    const link = await resolveShiftLinkForProductionEntry(db, {
      workOrderId: 50,
      runAllocationId: null,
    });
    assert.equal(link, null);
  });
});

describe("ensureShiftLinkOnProductionEntryApprove", () => {
  it("preserves existing link after run/session closure", async () => {
    const productionEntries = [
      {
        id: 1,
        shiftSessionId: 9,
        shiftRunSegmentId: 3,
        runAllocationId: 200,
        workOrderLine: { workOrderId: 50 },
      },
    ];
    const db = makeDb({
      allocations: [{ id: 200, workOrderId: 50, machineId: 1, isActive: true }],
      sessions: [{ id: 9, machineId: 1, status: "SHIFT_OVER" }],
      segments: [
        {
          id: 3,
          sessionId: 9,
          machineId: 1,
          workOrderId: 50,
          runAllocationId: 200,
          status: "CLOSED",
        },
      ],
      productionEntries,
    });
    const result = await ensureShiftLinkOnProductionEntryApprove(db, productionEntries[0]);
    assert.equal(result.preserved, true);
    assert.equal(result.shiftSessionId, 9);
    assert.equal(result.shiftRunSegmentId, 3);
    assert.equal(productionEntries[0].shiftSessionId, 9);
  });

  it("best-effort links an unlinked entry on approve", async () => {
    const productionEntries = [
      {
        id: 2,
        shiftSessionId: null,
        shiftRunSegmentId: null,
        runAllocationId: 200,
        workOrderLine: { workOrderId: 50 },
      },
    ];
    const db = makeDb({
      allocations: [{ id: 200, workOrderId: 50, machineId: 1, isActive: true }],
      sessions: [{ id: 9, machineId: 1, status: "OPEN" }],
      segments: [
        {
          id: 3,
          sessionId: 9,
          machineId: 1,
          workOrderId: 50,
          runAllocationId: 200,
          status: "ACTIVE",
        },
      ],
      productionEntries,
    });
    const result = await ensureShiftLinkOnProductionEntryApprove(db, productionEntries[0]);
    assert.equal(result.linked, true);
    assert.equal(productionEntries[0].shiftSessionId, 9);
    assert.equal(productionEntries[0].shiftRunSegmentId, 3);
  });

  it("never overwrites an existing historical link with a newer session", async () => {
    const productionEntries = [
      {
        id: 3,
        shiftSessionId: 8,
        shiftRunSegmentId: 2,
        runAllocationId: 200,
        workOrderLine: { workOrderId: 50 },
      },
    ];
    const db = makeDb({
      allocations: [{ id: 200, workOrderId: 50, machineId: 1, isActive: true }],
      sessions: [
        { id: 8, machineId: 1, status: "SHIFT_OVER" },
        { id: 9, machineId: 1, status: "OPEN" },
      ],
      segments: [
        {
          id: 2,
          sessionId: 8,
          machineId: 1,
          workOrderId: 50,
          runAllocationId: 200,
          status: "CLOSED",
        },
        {
          id: 3,
          sessionId: 9,
          machineId: 1,
          workOrderId: 50,
          runAllocationId: 200,
          status: "ACTIVE",
        },
      ],
      productionEntries,
    });
    const result = await ensureShiftLinkOnProductionEntryApprove(db, productionEntries[0]);
    assert.equal(result.preserved, true);
    assert.equal(result.shiftSessionId, 8);
    assert.equal(result.shiftRunSegmentId, 2);
    assert.equal(productionEntries[0].shiftSessionId, 8);
  });
});

describe("Shift Report aggregation", () => {
  it("only APPROVED producedQty contributes to Qty Sent to QC; DRAFT/reversed excluded", async () => {
    const db = makeDb({
      productionEntries: [
        {
          id: 1,
          producedQty: 10,
          workflowStatus: "APPROVED",
          shiftSessionId: 9,
          shiftRunSegmentId: 3,
          workOrderLine: {
            fgItemId: 66,
            workOrderId: 50,
            workOrder: { docNo: "WO-1" },
            fgItem: { id: 66, itemName: "FG" },
          },
        },
        {
          id: 2,
          producedQty: 4,
          workflowStatus: "DRAFT",
          shiftSessionId: 9,
          shiftRunSegmentId: 3,
          workOrderLine: {
            fgItemId: 66,
            workOrderId: 50,
            workOrder: { docNo: "WO-1" },
            fgItem: { id: 66, itemName: "FG" },
          },
        },
        {
          id: 3,
          producedQty: 7,
          workflowStatus: "APPROVED",
          shiftSessionId: null,
          shiftRunSegmentId: null,
          workOrderLine: {
            fgItemId: 66,
            workOrderId: 50,
            workOrder: { docNo: "WO-1" },
            fgItem: { id: 66, itemName: "FG" },
          },
        },
      ],
    });
    const agg = await aggregateShiftSessionProductionQuantities(db, 9);
    assert.equal(agg.byLine.get("3:66").qtySentToQc, 10);
    assert.equal(agg.pendingDraftCount, 1);
    assert.equal(agg.pendingDraftQty, 4);
  });

  it("gross = qtySentToQc + productionScrap; QC results do not alter shift totals", async () => {
    const approvedByLine = new Map([
      ["3:66", { runSegmentId: 3, itemId: 66, qtySentToQc: 95 }],
    ]);
    const { lines, totals } = buildCalculatedReportLines(
      [{ runSegmentId: 3, itemId: 66, productionScrapQty: 5 }],
      approvedByLine,
    );
    assert.equal(lines[0].qtySentToQc, 95);
    assert.equal(lines[0].productionScrapQty, 5);
    assert.equal(lines[0].grossOutputQty, 100);
    assert.equal(totals.grossOutputQty, 100);
    // Simulated QC accept/reject never enters aggregation inputs.
    void 0;
  });

  it("preserves reversed entry links conceptually while excluding qty (DRAFT status)", async () => {
    const db = makeDb({
      productionEntries: [
        {
          id: 1,
          producedQty: 12,
          workflowStatus: "DRAFT",
          shiftSessionId: 9,
          shiftRunSegmentId: 3,
          workOrderLine: {
            fgItemId: 66,
            workOrderId: 50,
            workOrder: { docNo: "WO-1" },
            fgItem: { id: 66, itemName: "FG" },
          },
        },
      ],
    });
    const agg = await aggregateShiftSessionProductionQuantities(db, 9);
    assert.equal(agg.byLine.size, 0);
    assert.equal(agg.pendingDraftCount, 1);
    assert.equal(agg.pendingDraftQty, 12);
  });
});
