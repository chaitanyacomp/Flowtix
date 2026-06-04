const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  CONTROL_TOWER_SOURCE_PRIORITY,
  buildControlTowerRowKey,
  attachRowIdentity,
  dedupeNormalizedRows,
  getSourcePriorityForRowType,
} = require("../../src/services/controlTowerRowIdentity");
const {
  normalizeProductionRow,
  normalizeRmRiskRow,
  normalizeContinueWorkingRow,
  CONTROL_TOWER_STATUSES,
} = require("../../src/services/controlTowerRowNormalizer");

function productionRow(woId, lineId = 1) {
  return normalizeProductionRow({
    workOrderId: woId,
    workOrderLineId: lineId,
    workOrderNo: `WO-${woId}`,
    nextAction: "PRODUCTION_PENDING",
    actionLabel: "Go to Production",
    orderType: "NORMAL",
    status: "OPEN",
  });
}

function rmRiskRowForWo(woId) {
  return normalizeRmRiskRow({
    workOrderId: woId,
    itemId: 9,
    workOrderNo: `WO-${woId}`,
    status: "CRITICAL",
    recommendedAction: "Review shortage",
  });
}

function continueRowForSo(soId, stageKey = "PRODUCTION") {
  return normalizeContinueWorkingRow({
    key: `so-${soId}-${stageKey}`,
    salesOrderId: soId,
    salesOrderDocNo: `SO-${soId}`,
    stageKey,
    nextAction: "PRODUCTION_PENDING",
    orderType: "NORMAL",
  });
}

describe("buildControlTowerRowKey", () => {
  it("is stable for the same normalized production row", () => {
    const row = productionRow(125);
    const a = buildControlTowerRowKey(row);
    const b = buildControlTowerRowKey(row);
    assert.equal(a, b);
    assert.equal(a, "WORK_ORDER:125");
  });

  it("uses different keys for different work orders", () => {
    assert.equal(buildControlTowerRowKey(productionRow(1)), "WORK_ORDER:1");
    assert.equal(buildControlTowerRowKey(productionRow(2)), "WORK_ORDER:2");
  });

  it("maps NO_QTY dispatch and continue rows to cycle key", () => {
    const row = normalizeContinueWorkingRow({
      salesOrderId: 45,
      stageKey: "DISPATCH",
      orderType: "NO_QTY",
      cycleId: 3,
      cycleNo: 3,
    });
    assert.equal(buildControlTowerRowKey(row), "NO_QTY:45:CYCLE:3");
  });
});

describe("dedupeNormalizedRows", () => {
  it("keeps highest priority row for the same rowKey", () => {
    const rm = attachRowIdentity(rmRiskRowForWo(125));
    const prod = attachRowIdentity(productionRow(125));
    const deduped = dedupeNormalizedRows([prod, rm]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].rowKey, "WORK_ORDER:125");
    assert.equal(deduped[0].rowType, "RM_RISK");
    assert.equal(deduped[0].sourcePriority, CONTROL_TOWER_SOURCE_PRIORITY.RM_RISK);
  });

  it("production queue wins over continue working for same work order context", () => {
    const prod = productionRow(125);
    const cont = normalizeContinueWorkingRow({
      key: "so-88-production",
      salesOrderId: 88,
      salesOrderDocNo: "SO-88",
      stageKey: "PRODUCTION",
      nextAction: "PRODUCTION_PENDING",
      orderType: "NORMAL",
    });
    const contWithWo = {
      ...cont,
      metadata: { ...cont.metadata, workOrderId: 125 },
    };
    assert.equal(buildControlTowerRowKey(prod), "WORK_ORDER:125");
    assert.equal(buildControlTowerRowKey(contWithWo), "WORK_ORDER:125");

    const deduped = dedupeNormalizedRows([contWithWo, prod]);
    assert.equal(deduped[0].rowType, "PRODUCTION_QUEUE");
    assert.equal(deduped[0].currentStatus, CONTROL_TOWER_STATUSES.PRODUCTION_PENDING);
    assert.deepEqual(deduped[0].metadata.duplicateSources, ["PRODUCTION_QUEUE", "CONTINUE_WORKING"]);
  });

  it("preserves duplicateSources for all contributing row types", () => {
    const rm = rmRiskRowForWo(125);
    const prod = productionRow(125);
    const cont = normalizeContinueWorkingRow({
      key: "so-10-cont",
      salesOrderId: 10,
      stageKey: "PRODUCTION",
      orderType: "NORMAL",
    });
    cont.metadata = { ...cont.metadata, workOrderId: 125 };
    const deduped = dedupeNormalizedRows([cont, prod, rm]);
    assert.equal(deduped.length, 1);
    assert.deepEqual(deduped[0].metadata.duplicateSources, [
      "RM_RISK",
      "PRODUCTION_QUEUE",
      "CONTINUE_WORKING",
    ]);
  });

  it("does not merge rows with different rowKeys", () => {
    const deduped = dedupeNormalizedRows([productionRow(1), productionRow(2)]);
    assert.equal(deduped.length, 2);
    assert.equal(deduped[0].metadata.duplicateSources.length, 1);
    assert.equal(deduped[1].metadata.duplicateSources.length, 1);
  });

  it("retains metadata lineage on the winning row", () => {
    const prod = productionRow(125, 7);
    const rm = rmRiskRowForWo(125);
    const deduped = dedupeNormalizedRows([prod, rm]);
    assert.equal(deduped[0].rowType, "RM_RISK");
    assert.equal(deduped[0].metadata.sourceStatus, "CRITICAL");
    assert.equal(deduped[0].metadata.sourceNextAction, "Review shortage");
    assert.equal(deduped[0].metadata.sourceNextAction != null, true);
  });

  it("assigns sourcePriority from rowType", () => {
    assert.equal(getSourcePriorityForRowType("CONTINUE_WORKING"), 50);
    assert.equal(getSourcePriorityForRowType("PRODUCTION_QUEUE"), 90);
    assert.equal(getSourcePriorityForRowType("RM_RISK"), 100);
  });
});
