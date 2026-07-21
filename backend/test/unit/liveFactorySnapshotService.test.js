const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyLiveFactoryBucket,
  buildLiveFactorySnapshot,
  isAuthoritativeRmShortageRiskRow,
  pickLiveFactoryHighlights,
} = require("../../src/services/liveFactorySnapshotService");

function row(partial = {}) {
  return {
    workOrderId: 1,
    workOrderNo: "WO-26-0006",
    producedQty: 0,
    balanceQty: 100,
    nextAction: "PRODUCTION_PENDING",
    productionWorkState: "READY_TO_START",
    productionExecutionStatus: "NOT_STARTED",
    rmReadyForProduction: true,
    rmReadinessGate: "READY_FOR_PRODUCTION",
    canAcceptProductionEntry: true,
    hasPendingQc: false,
    ...partial,
  };
}

describe("liveFactorySnapshotService", () => {
  it("Ready WO is not Blocked and not Running", () => {
    const ready = row({ workOrderId: 6, workOrderNo: "WO-26-0006" });
    assert.equal(classifyLiveFactoryBucket(ready), "READY_TO_START");
    const snap = buildLiveFactorySnapshot([
      ready,
      row({ workOrderId: 7, workOrderNo: "WO-26-0007" }),
      row({ workOrderId: 8, workOrderNo: "WO-26-0008" }),
      row({ workOrderId: 9, workOrderNo: "WO-26-0009" }),
    ]);
    assert.equal(snap.counts.readyToStart, 4);
    assert.equal(snap.counts.running, 0);
    assert.equal(snap.counts.blocked, 0);
  });

  it("READY_TO_RELEASE rm-risk with zero shortage is not authoritative shortage", () => {
    assert.equal(
      isAuthoritativeRmShortageRiskRow({
        queueType: "READY_TO_RELEASE_WO",
        status: "LOW_BUFFER",
        shortageQty: 0,
        blockerReason: "RM issued — awaiting Store release to production",
      }),
      false,
    );
  });

  it("RM gate false with never-started WO classifies as Blocked", () => {
    assert.equal(
      classifyLiveFactoryBucket(
        row({
          rmReadyForProduction: false,
          rmReadinessGate: "WAITING_STORE_ISSUE",
          canAcceptProductionEntry: false,
        }),
      ),
      "BLOCKED",
    );
  });

  it("Running WO is not Ready", () => {
    assert.equal(
      classifyLiveFactoryBucket(
        row({
          producedQty: 40,
          balanceQty: 60,
          productionWorkState: "CONTINUE_PRODUCTION",
        }),
      ),
      "RUNNING",
    );
  });

  it("highlights prefer Running over Ready and cap at 5", () => {
    const rows = [
      row({ workOrderId: 1, productionWorkState: "READY_TO_START" }),
      row({
        workOrderId: 2,
        producedQty: 10,
        balanceQty: 90,
        productionWorkState: "CONTINUE_PRODUCTION",
      }),
      row({ workOrderId: 3, productionWorkState: "READY_TO_START" }),
      row({ workOrderId: 4, productionWorkState: "READY_TO_START" }),
      row({ workOrderId: 5, productionWorkState: "READY_TO_START" }),
      row({ workOrderId: 6, productionWorkState: "READY_TO_START" }),
    ].map((r) => ({ ...r, liveFactoryBucket: classifyLiveFactoryBucket(r) }));
    const highlights = pickLiveFactoryHighlights(rows, 5);
    assert.equal(highlights.length, 5);
    assert.equal(highlights[0].liveFactoryBucket, "RUNNING");
  });

  it("Pending QC on finished balance does not mark Ready as Blocked", () => {
    assert.equal(
      classifyLiveFactoryBucket(
        row({
          producedQty: 100,
          balanceQty: 0,
          hasPendingQc: true,
          nextAction: "QC_PENDING",
          productionWorkState: null,
          canAcceptProductionEntry: false,
        }),
      ),
      "PENDING_QC",
    );
  });
});
