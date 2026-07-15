const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  isPeriodReleasedForExecution,
  filterNoQtyExecutionReleasedWorkOrders,
  assertNoQtyWorkOrderExecutionReleased,
} = require("../../src/services/noQtyExecutionBoundaryService");
const { createNoQtyWorkOrderFromLockedSheet } = require("../../src/services/noQtyExecutionReleaseService");

function createBoundaryDb({ releasedPeriods = [], sheets = [] } = {}) {
  const db = {
    monthlyProductionPlan: {
      findFirst: async ({ where }) => {
        const pk = where?.periodKey;
        const needsRelease = where?.releasedAt?.not === null;
        if (pk && needsRelease && releasedPeriods.includes(pk)) {
          return { id: 1, periodKey: pk };
        }
        return null;
      },
      findMany: async ({ where }) => {
        const keys = where?.periodKey?.in || [];
        return keys.filter((k) => releasedPeriods.includes(k)).map((k) => ({ periodKey: k }));
      },
    },
    requirementSheet: {
      findMany: async ({ where }) => {
        if (where?.id?.in) {
          return sheets.filter((s) => where.id.in.includes(s.id));
        }
        if (where?.status === "LOCKED" && where?.OR) {
          return sheets.filter((s) =>
            where.OR.some((o) => o.salesOrderId === s.salesOrderId && o.cycleId === s.cycleId),
          );
        }
        return sheets;
      },
      findUnique: async ({ where }) => sheets.find((s) => s.id === where.id) ?? null,
      findFirst: async ({ where }) => {
        let rows = sheets.filter((s) => s.status === (where.status ?? s.status));
        if (where.salesOrderId) rows = rows.filter((s) => s.salesOrderId === where.salesOrderId);
        if (where.cycleId) rows = rows.filter((s) => s.cycleId === where.cycleId);
        return rows[0] ?? null;
      },
    },
    workOrder: {
      findUnique: async ({ where }) => {
        const all = db.__workOrders || [];
        return all.find((w) => w.id === where.id) ?? null;
      },
    },
    __workOrders: [],
  };
  return db;
}

/**
 * Execution-ready NO_QTY fixtures.
 *
 * Authoritative rule (PLN-17 / GRD_PLN_BOM_APPROVED): an approved BOM is mandatory
 * before NO_QTY WO creation. These fixtures therefore model a valid upstream flow —
 * an approved active BOM plus sufficient RM availability — so the create path
 * exercises the REAL BOM explosion and RM feasibility engine rather than bypassing it.
 */
const FG_ITEM = { id: 65, itemType: "FG", unit: "Nos", itemName: "FG Widget" };
const RM_ITEM = { id: 70, itemType: "RM", unit: "kg", itemName: "RM Steel Coil" };

// 2 kg RM per 1 FG unit (outputQty 1, no process/QC loss, per-piece normalization).
const RM_PER_FG = 2;

function buildApprovedBom(overrides = {}) {
  return {
    id: 500,
    fgItemId: FG_ITEM.id,
    docNo: "BOM-26-0500",
    status: "APPROVED",
    revisionNo: 1,
    outputQty: 1,
    processLossPercent: 0,
    qcLossPercent: 0,
    normalizationMode: "PER_PIECE",
    lines: [
      {
        id: 900,
        rmItemId: RM_ITEM.id,
        baseQty: RM_PER_FG,
        rmItem: {
          id: RM_ITEM.id,
          itemName: RM_ITEM.itemName,
          itemType: RM_ITEM.itemType,
          unit: RM_ITEM.unit,
        },
      },
    ],
    ...overrides,
  };
}

/**
 * Prisma transaction-client mock that drives the real placement engine end-to-end.
 *
 * @param {{
 *   boms?: Array<object>,
 *   itemMaster?: Array<object>,
 *   rmFreeStock?: Map<number, number>,
 *   initialWorkOrders?: Array<{ id:number, cycleId:number, status:string, lines:Array<object> }>,
 *   serialize?: boolean,
 *   requirementSheetId?: number,
 * }} [opts]
 */
function createExecutionReadyTx(opts = {}) {
  const {
    boms = [buildApprovedBom()],
    itemMaster = [FG_ITEM, RM_ITEM],
    rmFreeStock = new Map([[RM_ITEM.id, 1_000_000]]),
    initialWorkOrders = [],
    serialize = false,
    requirementSheetId = 1,
  } = opts;

  const state = {
    workOrders: initialWorkOrders.map((wo) => ({
      ...wo,
      lines: (wo.lines ?? []).map((line) => ({ ...line })),
    })),
    createdWorkOrders: [],
    createCallCount: 0,
    pmrCreateCount: 0,
    stockTxnCreateCount: 0,
    bomFgLookups: [],
    seq: serialize ? 199 : 0,
    lockAcquisitions: 0,
  };

  // Simple in-process advisory lock to prove SELECT ... FOR UPDATE serialization.
  let lockTail = Promise.resolve();
  let unlockCurrent = null;

  const itemById = new Map(itemMaster.map((it) => [Number(it.id), it]));

  const tx = {
    docSequence: {
      upsert: async () => {
        state.seq += 1;
        return { nextNumber: state.seq, year2: 26, docType: "WORK_ORDER" };
      },
    },
    location: {
      // Default RM Store resolution for availability location scope.
      findFirst: async () => ({ id: 1 }),
    },
    item: {
      findMany: async ({ where }) => {
        const ids = (where?.id?.in ?? []).map(Number);
        return ids
          .filter((id) => itemById.has(id))
          .map((id) => {
            const it = itemById.get(id);
            return { id: it.id, itemType: it.itemType, unit: it.unit, itemName: it.itemName };
          });
      },
    },
    bom: {
      // Approved-recipe lookup only: filters by FG item + APPROVED status (asserts correct FG).
      findFirst: async ({ where }) => {
        state.bomFgLookups.push(Number(where?.fgItemId));
        const matches = boms.filter(
          (b) => Number(b.fgItemId) === Number(where?.fgItemId) && b.status === where?.status,
        );
        if (!matches.length) return null;
        matches.sort((a, b) => (b.revisionNo ?? 0) - (a.revisionNo ?? 0));
        const bom = matches[0];
        return { ...bom, lines: bom.lines.map((line) => ({ ...line, rmItem: { ...line.rmItem } })) };
      },
    },
    stockTransaction: {
      groupBy: async ({ where }) => {
        const ids = (where?.itemId?.in ?? []).map(Number);
        // Legacy null-location usable rows: none.
        if (where?.locationId === null) return [];
        // Non-usable buckets (QC hold / scrap / …): none.
        if (where?.stockBucket && typeof where.stockBucket === "object") return [];
        // Issued-to-production location rows (includeIssued=false in placement path): none.
        if (where?.locationId && typeof where.locationId === "object") return [];
        // Physical usable free stock per RM item.
        if (where?.stockBucket === "USABLE") {
          return ids
            .filter((id) => rmFreeStock.has(id))
            .map((id) => ({ itemId: id, _sum: { qtyIn: rmFreeStock.get(id), qtyOut: 0 } }));
        }
        return [];
      },
      create: async () => {
        state.stockTxnCreateCount += 1;
        return { id: 1 };
      },
      createMany: async () => {
        state.stockTxnCreateCount += 1;
        return { count: 0 };
      },
    },
    // No legacy PMR reservations and no incoming POs in the execution-ready fixture.
    productionMaterialRequestLine: {
      findMany: async () => [],
    },
    rmPurchaseOrder: {
      findMany: async () => [],
    },
    // Spies to prove BOM-blocked placement creates no downstream PMR / stock movement.
    productionMaterialRequest: {
      create: async () => {
        state.pmrCreateCount += 1;
        return { id: 1 };
      },
    },
    salesOrderLine: {
      findMany: async () => [{ itemId: FG_ITEM.id, item: { itemType: "FG" } }],
    },
    workOrder: {
      findMany: async () =>
        state.workOrders.map((wo) => ({
          id: wo.id,
          cycleId: wo.cycleId,
          status: wo.status,
          lines: (wo.lines ?? []).map((line) => ({ ...line })),
        })),
      create: async ({ data }) => {
        state.createCallCount += 1;
        if (serialize) {
          // Force interleave so the RS lock is the only thing preventing over-allocation.
          await new Promise((resolve) => setImmediate(resolve));
        }
        const id = ++state.seq + 1000;
        const docNo = `WO-26-${String(id).padStart(4, "0")}`;
        const record = {
          id,
          cycleId: data.cycleId,
          status: data.status,
          lines: data.lines.create.map((line) => ({
            fgItemId: line.fgItemId,
            qty: line.qty,
            plannedQty: line.plannedQty,
          })),
        };
        state.workOrders.push(record);
        state.createdWorkOrders.push(data);
        return { id, docNo };
      },
      update: async () => ({}),
      findUnique: async ({ where }) => state.workOrders.find((w) => w.id === where.id) ?? null,
    },
  };

  if (serialize) {
    tx.$queryRaw = async (_strings, sheetId) => {
      state.lockAcquisitions += 1;
      let unlock;
      const previous = lockTail;
      lockTail = new Promise((resolve) => {
        unlock = resolve;
      });
      await previous;
      unlockCurrent = unlock;
      return [{ id: sheetId ?? requirementSheetId }];
    };
  }

  return {
    tx,
    state,
    releaseLock() {
      const unlock = unlockCurrent;
      unlockCurrent = null;
      if (unlock) unlock();
    },
  };
}

function buildLockedSheet(overrides = {}) {
  return {
    id: 1,
    salesOrderId: 10,
    cycleId: 3,
    salesOrder: { orderType: "NO_QTY", customerReturnId: null },
    lines: [{ itemId: FG_ITEM.id, requirementQty: "5000", suggestedWoQtySnapshot: "5000" }],
    ...overrides,
  };
}

describe("noQtyExecutionBoundaryService", () => {
  it("isPeriodReleasedForExecution is false until plan released", async () => {
    const db = createBoundaryDb({ releasedPeriods: [] });
    assert.equal(await isPeriodReleasedForExecution(db, "2026-06"), false);
    db.monthlyProductionPlan.findFirst = async () => ({ id: 9, periodKey: "2026-06" });
    assert.equal(await isPeriodReleasedForExecution(db, "2026-06"), true);
  });

  it("filterNoQtyExecutionReleasedWorkOrders keeps existing NO_QTY WOs (stock-ready path may create before period release)", async () => {
    const db = createBoundaryDb({
      releasedPeriods: [],
      sheets: [{ id: 10, salesOrderId: 1, cycleId: 2, periodKey: "2026-06", status: "LOCKED" }],
    });
    const rows = [
      { id: 1, salesOrderId: 1, cycleId: 2, requirementSheetId: 10, salesOrder: { orderType: "NO_QTY" } },
      { id: 2, salesOrderId: 2, cycleId: 1, requirementSheetId: null, salesOrder: { orderType: "NORMAL" } },
    ];
    const out = await filterNoQtyExecutionReleasedWorkOrders(db, rows);
    assert.equal(out.length, 2);
  });

  it("assertNoQtyWorkOrderExecutionReleased allows existing WO before period release", async () => {
    const db = createBoundaryDb({
      releasedPeriods: [],
      sheets: [{ id: 10, salesOrderId: 1, cycleId: 2, periodKey: "2026-06", status: "LOCKED" }],
    });
    db.workOrder.findUnique = async () => ({
      id: 5,
      salesOrderId: 1,
      cycleId: 2,
      requirementSheetId: 10,
      salesOrder: { orderType: "NO_QTY" },
    });
    const wo = await assertNoQtyWorkOrderExecutionReleased(db, 5);
    assert.equal(wo.id, 5);
  });
});

describe("noQtyExecutionReleaseService.createNoQtyWorkOrderFromLockedSheet", () => {
  it("creates WO from locked RS lines when approved BOM and RM-supported capacity are available", async () => {
    const { tx, state } = createExecutionReadyTx({
      // Full RS balance (5000) needs 5000 * 2 = 10000 kg RM; provide comfortably more.
      rmFreeStock: new Map([[RM_ITEM.id, 20000]]),
    });
    const sheet = buildLockedSheet({
      lines: [{ itemId: FG_ITEM.id, requirementQty: "5000", suggestedWoQtySnapshot: "5000" }],
    });

    const res = await createNoQtyWorkOrderFromLockedSheet(tx, sheet);

    assert.equal(res.created, true);
    assert.ok(res.workOrderId > 0);
    // Qty comes from the requested valid RS line (full remaining balance).
    assert.equal(state.createdWorkOrders.length, 1);
    const created = state.createdWorkOrders[0];
    assert.equal(Number(created.lines.create[0].qty), 5000);
    assert.equal(Number(created.lines.create[0].plannedQty), 5000);
    assert.equal(created.lines.create[0].fgItemId, FG_ITEM.id);
    assert.equal(created.requirementSheetId, sheet.id);
    // BOM lookup used the correct FG item (and only APPROVED recipes are consulted).
    assert.ok(state.bomFgLookups.length > 0);
    assert.ok(state.bomFgLookups.every((fgId) => fgId === FG_ITEM.id));
  });

  it("creates only remaining RS balance when linked WOs already exist", async () => {
    const { tx, state } = createExecutionReadyTx({
      // Only the PENDING WO (4000) counts toward placed qty; REJECTED (2000) does not.
      // Remaining balance = 10000 - 4000 = 6000 → needs 12000 kg RM; provide more.
      rmFreeStock: new Map([[RM_ITEM.id, 50000]]),
      initialWorkOrders: [
        {
          id: 90,
          cycleId: 3,
          status: "PENDING",
          lines: [{ fgItemId: FG_ITEM.id, qty: "4000", plannedQty: "4000" }],
        },
        {
          id: 91,
          cycleId: 3,
          status: "REJECTED",
          lines: [{ fgItemId: FG_ITEM.id, qty: "2000", plannedQty: "2000" }],
        },
      ],
    });
    const sheet = buildLockedSheet({
      lines: [{ itemId: FG_ITEM.id, requirementQty: "10000", suggestedWoQtySnapshot: "10000" }],
    });

    const res = await createNoQtyWorkOrderFromLockedSheet(tx, sheet);

    assert.equal(res.created, true);
    assert.ok(res.workOrderId > 0);
    // RS Balance = RS Requirement (10000) − participating WO planned qty (4000) = 6000.
    const created = state.createdWorkOrders[0];
    assert.equal(Number(created.lines.create[0].qty), 6000);
    assert.equal(Number(created.lines.create[0].plannedQty), 6000);
  });

  it("skips creation when counted linked WOs already cover RS demand", async () => {
    const tx = {
      workOrder: {
        findMany: async () => [
          {
            id: 90,
            cycleId: 3,
            status: "PENDING",
            lines: [{ fgItemId: 65, qty: "5000", plannedQty: "5000" }],
          },
        ],
        update: async () => ({}),
      },
      salesOrderLine: {
        findMany: async () => [{ itemId: 65, item: { itemType: "FG" } }],
      },
    };
    const sheet = {
      id: 1,
      salesOrderId: 10,
      cycleId: 3,
      salesOrder: { orderType: "NO_QTY", customerReturnId: null },
      lines: [{ itemId: 65, requirementQty: "5000", suggestedWoQtySnapshot: "5000" }],
    };

    const res = await createNoQtyWorkOrderFromLockedSheet(tx, sheet);

    assert.equal(res.created, false);
    assert.equal(res.workOrderId, null);
    assert.equal(res.skippedReason, "ZERO_EXECUTABLE_QTY");
  });

  it("serializes concurrent placements so total WO qty never exceeds RS demand", async () => {
    // RS demand 10000 → needs 20000 kg RM. Provide ample RM so the concurrency guard
    // (SELECT ... FOR UPDATE serialization) — not RM shortage — is the tested constraint.
    const { tx, state, releaseLock } = createExecutionReadyTx({
      rmFreeStock: new Map([[RM_ITEM.id, 100000]]),
      serialize: true,
    });
    const sheet = buildLockedSheet({
      lines: [{ itemId: FG_ITEM.id, requirementQty: "10000", suggestedWoQtySnapshot: "10000" }],
    });

    async function placeWithCommit() {
      try {
        return await createNoQtyWorkOrderFromLockedSheet(tx, sheet);
      } finally {
        releaseLock();
      }
    }

    const [a, b] = await Promise.all([placeWithCommit(), placeWithCommit()]);
    const totalPlaced = state.workOrders.reduce(
      (sum, wo) => sum + wo.lines.reduce((lineSum, line) => lineSum + Number(line.plannedQty), 0),
      0,
    );

    // Total created WO planned qty ≤ RS requirement; no duplicate or over-allocation.
    assert.equal(totalPlaced, 10000);
    assert.equal(state.workOrders.length, 1);
    assert.ok(totalPlaced <= 10000);
    assert.deepEqual([a.created, b.created].sort(), [false, true]);
  });
});

describe("assertNoQtyRequirementSheetPeriodReleased — FG-level stock gate", () => {
  const {
    assertNoQtyRequirementSheetPeriodReleased,
  } = require("../../src/services/noQtyExecutionBoundaryService");

  it("allows WO create without period release when requested FG is stock-executable", async () => {
    const { tx } = createExecutionReadyTx({
      rmFreeStock: new Map([[RM_ITEM.id, 20000]]),
    });
    const sheet = buildLockedSheet({
      periodKey: "2026-06",
      lines: [{ itemId: FG_ITEM.id, requirementQty: "5000", suggestedWoQtySnapshot: "5000" }],
    });
    // Period not released — createExecutionReadyTx has no monthlyProductionPlan release rows.
    tx.monthlyProductionPlan = {
      findFirst: async () => null,
    };
    await assert.doesNotReject(() =>
      assertNoQtyRequirementSheetPeriodReleased(tx, sheet, {
        requestedLines: [{ itemId: FG_ITEM.id, qty: 5000 }],
      }),
    );
  });

  it("blocks WO create for shortage FG when period is not released", async () => {
    const { tx } = createExecutionReadyTx({
      rmFreeStock: new Map([[RM_ITEM.id, 0]]),
    });
    const sheet = buildLockedSheet({
      periodKey: "2026-06",
      lines: [{ itemId: FG_ITEM.id, requirementQty: "5000", suggestedWoQtySnapshot: "5000" }],
    });
    tx.monthlyProductionPlan = {
      findFirst: async () => null,
    };
    await assert.rejects(
      () =>
        assertNoQtyRequirementSheetPeriodReleased(tx, sheet, {
          requestedLines: [{ itemId: FG_ITEM.id, qty: 5000 }],
        }),
      (e) => e.code === "NO_QTY_FG_PROCUREMENT_REQUIRED" || e.code === "NO_QTY_EXECUTION_NOT_RELEASED",
    );
  });
});

describe("createNoQtyWorkOrderFromLockedSheet — approved BOM guard (GRD_PLN_BOM_APPROVED / PLN-17)", () => {
  it("throws NO_QTY_MISSING_BOM and creates no WO/PMR/stock movement when FG has no approved BOM", async () => {
    // Locked RS with a valid FG demand, but NO approved BOM exists for the FG line.
    const { tx, state } = createExecutionReadyTx({
      boms: [],
      rmFreeStock: new Map([[RM_ITEM.id, 100000]]),
    });
    const sheet = buildLockedSheet({
      lines: [{ itemId: FG_ITEM.id, requirementQty: "5000", suggestedWoQtySnapshot: "5000" }],
    });

    await assert.rejects(
      () => createNoQtyWorkOrderFromLockedSheet(tx, sheet),
      (err) =>
        err.code === "NO_QTY_MISSING_BOM" &&
        err.statusCode === 409 &&
        /Approved BOM is missing/i.test(err.message),
    );

    // No WO, no PMR, no stock/material transaction may occur under a blocked placement.
    assert.equal(state.createCallCount, 0);
    assert.equal(state.createdWorkOrders.length, 0);
    assert.equal(state.workOrders.length, 0);
    assert.equal(state.pmrCreateCount, 0);
    assert.equal(state.stockTxnCreateCount, 0);
    // The guard actually consulted the FG's approved recipe (not a broad stub).
    assert.ok(state.bomFgLookups.includes(FG_ITEM.id));
  });

  it("does not accept a DRAFT BOM as satisfying the approved-BOM guard", async () => {
    const { tx, state } = createExecutionReadyTx({
      // Only a DRAFT revision exists — approved lookup must return nothing.
      boms: [buildApprovedBom({ status: "DRAFT" })],
      rmFreeStock: new Map([[RM_ITEM.id, 100000]]),
    });
    const sheet = buildLockedSheet();

    await assert.rejects(
      () => createNoQtyWorkOrderFromLockedSheet(tx, sheet),
      (err) => err.code === "NO_QTY_MISSING_BOM",
    );
    assert.equal(state.createCallCount, 0);
  });

  it("does not accept an INACTIVE BOM as satisfying the approved-BOM guard", async () => {
    const { tx, state } = createExecutionReadyTx({
      boms: [buildApprovedBom({ status: "INACTIVE" })],
      rmFreeStock: new Map([[RM_ITEM.id, 100000]]),
    });
    const sheet = buildLockedSheet();

    await assert.rejects(
      () => createNoQtyWorkOrderFromLockedSheet(tx, sheet),
      (err) => err.code === "NO_QTY_MISSING_BOM",
    );
    assert.equal(state.createCallCount, 0);
  });
});
