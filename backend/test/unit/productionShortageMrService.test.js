const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  bulkAddProductionShortageMrLines,
  createOrReuseProductionShortageMr,
  loadWoRmShortageCandidates,
  isShortRmLine,
} = require("../../src/services/productionShortageMrService");

function availabilityLine(itemId, overrides = {}) {
  const requiredQty = overrides.requiredQty ?? 100;
  const physicalUsableStockQty = overrides.physicalUsableStockQty ?? 0;
  const legacyReservedQty = overrides.legacyReservedQty ?? 0;
  const freeStockQty = overrides.freeStockQty ?? Math.max(0, physicalUsableStockQty - legacyReservedQty);
  const incomingQty = overrides.incomingQty ?? 0;
  const shortageAfterReservationQty =
    overrides.shortageAfterReservationQty ?? Math.max(0, requiredQty - freeStockQty);
  const coveredByIncomingQty = overrides.coveredByIncomingQty ?? Math.min(shortageAfterReservationQty, incomingQty);
  const netShortageAfterIncomingQty =
    overrides.netShortageAfterIncomingQty ?? Math.max(0, shortageAfterReservationQty - incomingQty);
  return {
    itemId,
    requiredQty,
    physicalUsableStockQty,
    legacyReservedQty,
    freeStockQty,
    incomingQty,
    shortageAfterReservationQty,
    netShortageAfterIncomingQty,
  };
}

function createBulkMockDb() {
  const state = {
    nextMrId: 900,
    nextLineId: 9000,
    mrByWo: new Map(),
    terminalMrByWo: new Map(),
    linesByMr: new Map(),
  };

  const workOrder = {
    id: 1,
    docNo: "WO-1",
    salesOrderId: 10,
    lines: [{ fgItemId: 100, qty: 10, plannedQty: 10 }],
  };

  const items = new Map([
    [10, { id: 10, itemName: "RM 10", itemType: "RM", unit: "KG" }],
    [20, { id: 20, itemName: "RM 20", itemType: "RM", unit: "KG" }],
  ]);

  const db = {
    workOrder: {
      findUnique: async ({ where }) => (where.id === workOrder.id ? workOrder : null),
    },
    item: {
      findUnique: async ({ where }) => items.get(where.id) || null,
      findMany: async ({ where }) => (where.id.in || []).map((id) => items.get(id)).filter(Boolean),
    },
    materialRequirement: {
      findFirst: async ({ where }) => {
        const statuses = where?.status?.in ?? null;
        const wantsTerminal = Array.isArray(statuses) && statuses.some((s) => ["CLOSED", "CANCELLED"].includes(String(s)));
        const wantsActive = Array.isArray(statuses) && statuses.some((s) => ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_PURCHASE"].includes(String(s)));
        if (wantsTerminal) {
          return state.terminalMrByWo.get(where.workOrderId) || null;
        }
        if (wantsActive) {
          const mr = state.mrByWo.get(where.workOrderId);
          if (!mr) return null;
          return { ...mr, lines: state.linesByMr.get(mr.id) || [] };
        }
        const mr = state.mrByWo.get(where.workOrderId);
        if (!mr) return null;
        return { ...mr, lines: state.linesByMr.get(mr.id) || [] };
      },
      findUnique: async ({ where }) => {
        for (const mr of state.mrByWo.values()) {
          if (mr.id === where.id) {
            return { ...mr, lines: state.linesByMr.get(mr.id) || [] };
          }
        }
        return null;
      },
      create: async ({ data }) => {
        const id = state.nextMrId++;
        const mr = {
          id,
          docNo: data.docNo || `MR-${id}`,
          status: data.status,
          sourceType: data.sourceType,
          workOrderId: data.workOrderId,
          salesOrderId: data.salesOrderId,
        };
        state.mrByWo.set(data.workOrderId, mr);
        const lines = (data.lines?.create || []).map((ln) => {
          const lineId = state.nextLineId++;
          return {
            id: lineId,
            materialRequirementId: id,
            rmItemId: ln.rmItemId,
            requiredQty: ln.requiredQty,
            shortageQty: ln.shortageQty,
          };
        });
        state.linesByMr.set(id, lines);
        return { ...mr, lines };
      },
    },
    materialRequirementLine: {
      create: async ({ data }) => {
        const lineId = state.nextLineId++;
        const line = {
          id: lineId,
          materialRequirementId: data.materialRequirementId,
          rmItemId: data.rmItemId,
          requiredQty: data.requiredQty,
          shortageQty: data.shortageQty,
        };
        const lines = state.linesByMr.get(data.materialRequirementId) || [];
        lines.push(line);
        state.linesByMr.set(data.materialRequirementId, lines);
        return line;
      },
    },
    docSequence: {
      upsert: async () => ({ nextNumber: 2, year2: 26, docType: "MATERIAL_REQUIREMENT" }),
    },
    $transaction: async (fn) => fn(db),
  };

  return { db, state, workOrder };
}

function mockAvailabilityDeps() {
  return {
    aggregateRmDemandForFgLines: async () => ({
      rmNeeded: new Map([
        [10, 100],
        [20, 50],
      ]),
      missingChildBoms: [],
    }),
    getMaterialAvailabilityByItems: async ({ itemIds }) =>
      itemIds.flatMap((id) => {
        if (id === 10) return [availabilityLine(10, { physicalUsableStockQty: 0 })];
        if (id === 20) return [availabilityLine(20, { physicalUsableStockQty: 0 })];
        return [];
      }),
  };
}

describe("productionShortageMrService", () => {
  it("isShortRmLine detects shortage from availability quantities", () => {
    assert.equal(isShortRmLine({ netShortageAfterIncomingQty: 5, shortageAfterReservationQty: 0 }), true);
    assert.equal(isShortRmLine({ netShortageAfterIncomingQty: 0, shortageAfterReservationQty: 0 }), false);
  });

  it("loadWoRmShortageCandidates returns short RM lines for a work order", async () => {
    const { db } = createBulkMockDb();
    const candidates = await loadWoRmShortageCandidates(db, 1, mockAvailabilityDeps());
    assert.equal(candidates.length, 2);
    assert.deepEqual(
      candidates.map((c) => c.rmItemId).sort((a, b) => a - b),
      [10, 20],
    );
  });

  it("bulkAddProductionShortageMrLines creates MR with all missing shortage lines", async () => {
    const { db, state } = createBulkMockDb();
    const out = await bulkAddProductionShortageMrLines(
      {
        workOrderId: 1,
        deps: mockAvailabilityDeps(),
      },
      { userId: 1 },
      db,
    );

    assert.equal(out.created, true);
    assert.equal(out.linesAdded, 2);
    assert.equal(out.caseSummary.detectedShortLineCount, 2);
    assert.equal(out.caseSummary.linesOnCaseAfter, 2);
    const mr = state.mrByWo.get(1);
    assert.ok(mr);
    assert.equal((state.linesByMr.get(mr.id) || []).length, 2);
  });

  it("bulkAddProductionShortageMrLines skips duplicate RM lines already on case", async () => {
    const { db, state } = createBulkMockDb();
    const deps = mockAvailabilityDeps();

    await bulkAddProductionShortageMrLines({ workOrderId: 1, deps }, { userId: 1 }, db);
    const second = await bulkAddProductionShortageMrLines({ workOrderId: 1, deps }, { userId: 1 }, db);

    assert.equal(second.status, "ALREADY_UP_TO_DATE");
    assert.equal(second.message, "All shortage lines already on WO case");
    assert.equal(second.linesAdded, 0);
    assert.equal((state.linesByMr.get(state.mrByWo.get(1).id) || []).length, 2);
  });

  it("bulkAddProductionShortageMrLines adds only missing lines when case is partial", async () => {
    const { db, state } = createBulkMockDb();
    const deps = mockAvailabilityDeps();

    await createOrReuseProductionShortageMr(
      { workOrderId: 1, rmItemId: 10, shortageQty: 100, freeStockQty: 0 },
      { userId: 1 },
      db,
    );

    const out = await bulkAddProductionShortageMrLines({ workOrderId: 1, deps }, { userId: 1 }, db);
    assert.equal(out.linesAdded, 1);
    assert.equal(out.caseSummary.linesSkippedDuplicate, 1);
    assert.equal(out.caseSummary.linesOnCaseAfter, 2);
    assert.equal((state.linesByMr.get(state.mrByWo.get(1).id) || []).map((l) => l.rmItemId).sort()[1], 20);
  });

  it("createOrReuseProductionShortageMr remains backward compatible for single line", async () => {
    const { db } = createBulkMockDb();
    const out = await createOrReuseProductionShortageMr(
      { workOrderId: 1, rmItemId: 10, shortageQty: 80, freeStockQty: 0 },
      { userId: 1 },
      db,
    );
    assert.equal(out.created, true);
    assert.equal(out.lineCreated, true);
    assert.equal(out.line?.rmItemId, 10);
    assert.equal(out.materialRequirement.lineCount, 1);
  });

  it("requires explicit confirmation to re-raise after terminal close", async () => {
    const { db, state } = createBulkMockDb();
    state.terminalMrByWo.set(1, { id: 111, docNo: "MR-26-0001", status: "CLOSED", closedAt: new Date() });
    await assert.rejects(
      () =>
        bulkAddProductionShortageMrLines(
          {
            workOrderId: 1,
            deps: mockAvailabilityDeps(),
          },
          { userId: 1 },
          db,
        ),
      (e) => e && e.code === "REOPEN_CONFIRM_REQUIRED",
    );

    const ok = await bulkAddProductionShortageMrLines(
      { workOrderId: 1, confirmReopenClosed: true, deps: mockAvailabilityDeps() },
      { userId: 1 },
      db,
    );
    assert.equal(ok.created, true);
    assert.ok(ok.materialRequirement);
  });
});
