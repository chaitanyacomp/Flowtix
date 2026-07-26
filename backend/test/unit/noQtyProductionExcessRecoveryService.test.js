/**
 * NO_QTY WO-level produced excess vs production-shortage recovery.
 * Example: shortages 15+52=67, excess 5+5=10 pending QC → provisional net 57.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeWoLineProducedExcessSplit,
  splitTerminalScrapAgainstWoPlan,
  computeProductionShortageRecoveryOffset,
  composeNoQtyRecoveryExcessView,
  loadNoQtyProducedExcessByItemForPriorCycles,
  assertNoProducedExcessPendingQcForRecoveryOrThrow,
  effectiveRecoveryAfterAcceptedWoExcessOffset,
} = require("../../src/services/noQtyProductionExcessRecoveryService");

describe("computeWoLineProducedExcessSplit", () => {
  it("attributes only WO surplus into pending/accepted/rejected excess (plan-first)", () => {
    const pending = computeWoLineProducedExcessSplit({
      plannedQty: 2000,
      producedQty: 2005,
      acceptedQty: 0,
      rejectedQty: 0,
    });
    assert.equal(pending.surplusProducedQty, 5);
    assert.equal(pending.producedExcessPendingQcQty, 5);
    assert.equal(pending.acceptedWoExcessQty, 0);

    const partial = computeWoLineProducedExcessSplit({
      plannedQty: 2000,
      producedQty: 2005,
      acceptedQty: 2003,
      rejectedQty: 2,
    });
    assert.equal(partial.acceptedWoExcessQty, 3);
    assert.equal(partial.rejectedWoExcessQty, 2);
    assert.equal(partial.producedExcessPendingQcQty, 0);

    const fullAccept = computeWoLineProducedExcessSplit({
      plannedQty: 2000,
      producedQty: 2005,
      acceptedQty: 2005,
      rejectedQty: 0,
    });
    assert.equal(fullAccept.acceptedWoExcessQty, 5);
    assert.equal(fullAccept.producedExcessPendingQcQty, 0);

    const fullReject = computeWoLineProducedExcessSplit({
      plannedQty: 2000,
      producedQty: 2005,
      acceptedQty: 2000,
      rejectedQty: 5,
    });
    assert.equal(fullReject.acceptedWoExcessQty, 0);
    assert.equal(fullReject.producedExcessPendingQcQty, 0);
    assert.equal(fullReject.rejectedWoExcessQty, 5);
  });

  it("short WO lines contribute zero excess", () => {
    const short = computeWoLineProducedExcessSplit({
      plannedQty: 3000,
      producedQty: 2985,
      acceptedQty: 2985,
      rejectedQty: 0,
    });
    assert.equal(short.surplusProducedQty, 0);
    assert.equal(short.producedExcessPendingQcQty, 0);
    assert.equal(short.acceptedWoExcessQty, 0);
    assert.equal(short.rejectedWoExcessQty, 0);
  });
});

describe("splitTerminalScrapAgainstWoPlan — surplus scrap is not demand-backed", () => {
  it("scraps after plan is accepted are surplus-only", () => {
    const split = splitTerminalScrapAgainstWoPlan({
      plannedQty: 2000,
      producedQty: 2005,
      acceptedQty: 2000,
      rejectedQtyBeforeScrap: 0,
      scrapQty: 5,
    });
    assert.equal(split.demandBackedScrapQty, 0);
    assert.equal(split.surplusScrapQty, 5);
  });

  it("scraps before plan is filled remain demand-backed", () => {
    const split = splitTerminalScrapAgainstWoPlan({
      plannedQty: 2000,
      producedQty: 2005,
      acceptedQty: 0,
      rejectedQtyBeforeScrap: 0,
      scrapQty: 10,
    });
    assert.equal(split.demandBackedScrapQty, 10);
    assert.equal(split.surplusScrapQty, 0);
  });
});

describe("final recovery 57 / 61 / 67 — no surplus-reject double count", () => {
  it("10 excess accepted → final recovery exactly 57", () => {
    const r = computeProductionShortageRecoveryOffset({
      grossProductionShortageQty: 67,
      producedExcessPendingQcQty: 0,
      acceptedWoExcessQty: 10,
      rejectedWoExcessQty: 0,
      keptFinalQcRejectionQty: 0,
    });
    assert.equal(r.confirmedNetRecoveryQty, 57);
    assert.equal(r.provisionalNetRecoveryQty, 57);
    assert.equal(r.finalizeBlocked, false);
  });

  it("6 accepted / 4 rejected → final recovery exactly 61", () => {
    const r = computeProductionShortageRecoveryOffset({
      grossProductionShortageQty: 67,
      producedExcessPendingQcQty: 0,
      acceptedWoExcessQty: 6,
      rejectedWoExcessQty: 4,
      // Even if surplus scrap incorrectly leaked into kept QC rejection pool:
      keptFinalQcRejectionQty: 4,
    });
    assert.equal(r.demandBackedQcRejectionQty, 0);
    assert.equal(r.confirmedNetRecoveryQty, 61);
    assert.equal(r.finalizeBlocked, false);
  });

  it("0 accepted / 10 rejected → final recovery exactly 67 (not 77)", () => {
    const r = computeProductionShortageRecoveryOffset({
      grossProductionShortageQty: 67,
      producedExcessPendingQcQty: 0,
      acceptedWoExcessQty: 0,
      rejectedWoExcessQty: 10,
      // Leaked surplus scrap in kept QC pool must not create 67+10=77.
      keptFinalQcRejectionQty: 10,
    });
    assert.equal(r.demandBackedQcRejectionQty, 0);
    assert.equal(r.confirmedNetRecoveryQty, 67);
    assert.equal(r.provisionalNetRecoveryQty, 67);
    assert.notEqual(r.confirmedNetRecoveryQty, 77);
  });

  it("pending QC: provisional net 57 and finalize blocked", () => {
    const r = computeProductionShortageRecoveryOffset({
      grossProductionShortageQty: 67,
      producedExcessPendingQcQty: 10,
      acceptedWoExcessQty: 0,
    });
    assert.equal(r.grossProductionShortageQty, 67);
    assert.equal(r.producedExcessPendingQcQty, 10);
    assert.equal(r.provisionalNetRecoveryQty, 57);
    assert.equal(r.confirmedNetRecoveryQty, 67);
    assert.equal(r.finalizeBlocked, true);
    assert.match(r.finalizeBlockMessage, /Final recovery cannot be confirmed until QC decides 10 Nos excess production/);
  });

  it("includes only demand-backed kept QC rejection in gross recovery", () => {
    const r = computeProductionShortageRecoveryOffset({
      grossProductionShortageQty: 67,
      keptFinalQcRejectionQty: 3,
      rejectedWoExcessQty: 0,
      producedExcessPendingQcQty: 0,
      acceptedWoExcessQty: 10,
    });
    assert.equal(r.demandBackedQcRejectionQty, 3);
    assert.equal(r.confirmedNetRecoveryQty, 60);
  });

  it("never goes below zero; leftover accepted excess retained", () => {
    const r = computeProductionShortageRecoveryOffset({
      grossProductionShortageQty: 20,
      keptFinalQcRejectionQty: 5,
      producedExcessPendingQcQty: 0,
      acceptedWoExcessQty: 100,
    });
    assert.equal(r.confirmedNetRecoveryQty, 0);
    assert.equal(r.acceptedExcessOffsetQty, 25);
    assert.equal(r.remainingAcceptedExcessQty, 75);
  });

  it("idempotent repeated recalculation for all three QC outcomes", () => {
    const cases = [
      { acceptedWoExcessQty: 10, rejectedWoExcessQty: 0, keptFinalQcRejectionQty: 0, expected: 57 },
      { acceptedWoExcessQty: 6, rejectedWoExcessQty: 4, keptFinalQcRejectionQty: 4, expected: 61 },
      { acceptedWoExcessQty: 0, rejectedWoExcessQty: 10, keptFinalQcRejectionQty: 10, expected: 67 },
    ];
    for (const c of cases) {
      const input = {
        grossProductionShortageQty: 67,
        producedExcessPendingQcQty: 0,
        acceptedWoExcessQty: c.acceptedWoExcessQty,
        rejectedWoExcessQty: c.rejectedWoExcessQty,
        keptFinalQcRejectionQty: c.keptFinalQcRejectionQty,
      };
      const a = computeProductionShortageRecoveryOffset(input);
      const b = computeProductionShortageRecoveryOffset(input);
      assert.equal(a.confirmedNetRecoveryQty, c.expected);
      assert.deepEqual(a, b);
    }
  });
});

describe("composeNoQtyRecoveryExcessView", () => {
  it("uses item unit in finalize message", () => {
    const view = composeNoQtyRecoveryExcessView({
      grossProductionShortageQty: 67,
      producedExcessPendingQcQty: 10,
      unit: "Nos",
    });
    assert.equal(
      view.finalizeBlockMessage,
      "Final recovery cannot be confirmed until QC decides 10 Nos excess production.",
    );
    assert.match(view.provisionalNetRecoveryExplanation, /subject to QC/i);
  });
});

describe("effectiveRecoveryAfterAcceptedWoExcessOffset", () => {
  it("reduces kept recovery by accepted WO excess only (not pending)", () => {
    const r = effectiveRecoveryAfterAcceptedWoExcessOffset({
      productionShortfallQty: 67,
      qcRejectionRecoveryQty: 0,
      acceptedWoExcessQty: 10,
    });
    assert.equal(r.effectiveRecoveryQty, 57);
    assert.equal(r.acceptedExcessOffsetQty, 10);
  });
});

describe("loadNoQtyProducedExcessByItemForPriorCycles + finalize assert", () => {
  function mockDb(productionsByLine) {
    return {
      salesOrder: { findUnique: async () => ({ orderType: "NO_QTY" }) },
      salesOrderCycle: {
        findFirst: async () => ({ id: 2, cycleNo: 2 }),
        findMany: async () => [{ id: 1 }],
      },
      workOrderLine: {
        findMany: async () => productionsByLine,
      },
    };
  }

  it("aggregates multi-WO excess pending QC (5+5=10)", async () => {
    const lines = [
      {
        id: 1,
        fgItemId: 10,
        qty: 2000,
        plannedQty: 2000,
        productions: [{ producedQty: 2005, qcEntries: [] }],
      },
      {
        id: 2,
        fgItemId: 10,
        qty: 3000,
        plannedQty: 3000,
        productions: [{ producedQty: 2985, qcEntries: [{ acceptedQty: 2985, rejectedQty: 0 }] }],
      },
      {
        id: 3,
        fgItemId: 10,
        qty: 3000,
        plannedQty: 3000,
        productions: [{ producedQty: 2948, qcEntries: [{ acceptedQty: 2948, rejectedQty: 0 }] }],
      },
      {
        id: 4,
        fgItemId: 10,
        qty: 2000,
        plannedQty: 2000,
        productions: [{ producedQty: 2005, qcEntries: [] }],
      },
    ];
    const map = await loadNoQtyProducedExcessByItemForPriorCycles(mockDb(lines), {
      salesOrderId: 1,
      targetCycleId: 2,
    });
    assert.equal(map.get(10).producedExcessPendingQcQty, 10);
    assert.equal(map.get(10).acceptedWoExcessQty, 0);
    assert.equal(map.get(10).surplusProducedQty, 10);
  });

  it("blocks finalize while excess relevant to recovery is pending QC", async () => {
    const lines = [
      {
        id: 1,
        fgItemId: 10,
        qty: 2000,
        plannedQty: 2000,
        productions: [{ producedQty: 2005, qcEntries: [] }],
      },
      {
        id: 2,
        fgItemId: 10,
        qty: 2000,
        plannedQty: 2000,
        productions: [{ producedQty: 2005, qcEntries: [] }],
      },
    ];
    await assert.rejects(
      () =>
        assertNoProducedExcessPendingQcForRecoveryOrThrow(mockDb(lines), {
          salesOrderId: 1,
          targetCycleId: 2,
          recoveryByItem: new Map([[10, { productionShortfallQty: 67, qcFinalRejectionQty: 0, unit: "Nos" }]]),
        }),
      (err) =>
        err.code === "PRODUCED_EXCESS_PENDING_QC" &&
        /Final recovery cannot be confirmed until QC decides 10 Nos excess production/.test(err.message),
    );
  });

  it("allows finalize after full QC acceptance of excess", async () => {
    const lines = [
      {
        id: 1,
        fgItemId: 10,
        qty: 2000,
        plannedQty: 2000,
        productions: [{ producedQty: 2005, qcEntries: [{ acceptedQty: 2005, rejectedQty: 0 }] }],
      },
      {
        id: 2,
        fgItemId: 10,
        qty: 2000,
        plannedQty: 2000,
        productions: [{ producedQty: 2005, qcEntries: [{ acceptedQty: 2005, rejectedQty: 0 }] }],
      },
    ];
    const result = await assertNoProducedExcessPendingQcForRecoveryOrThrow(mockDb(lines), {
      salesOrderId: 1,
      targetCycleId: 2,
      recoveryByItem: new Map([[10, { productionShortfallQty: 67, unit: "Nos" }]]),
    });
    assert.equal(result.ok, true);
  });

  it("REGULAR_SO isolation — loader returns empty outside NO_QTY", async () => {
    const db = {
      salesOrder: { findUnique: async () => ({ orderType: "NORMAL" }) },
      salesOrderCycle: {
        findFirst: async () => ({ id: 2, cycleNo: 2 }),
        findMany: async () => [{ id: 1 }],
      },
      workOrderLine: { findMany: async () => assert.fail("must not query WO lines for REGULAR") },
    };
    const map = await loadNoQtyProducedExcessByItemForPriorCycles(db, {
      salesOrderId: 1,
      targetCycleId: 2,
    });
    assert.equal(map.size, 0);
  });
});
