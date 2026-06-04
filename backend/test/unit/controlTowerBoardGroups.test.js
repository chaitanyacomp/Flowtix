const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  BOARD_GROUP_KEYS,
  CONTROL_TOWER_BOARD_GROUPS,
  groupControlTowerRows,
} = require("../../src/services/controlTowerBoardGroups");
const {
  normalizeRmRiskRow,
  normalizeProductionRow,
  normalizeQaRow,
  normalizeDispatchRow,
  normalizeContinueWorkingRow,
  buildNormalizedRow,
  CONTROL_TOWER_STATUSES,
} = require("../../src/services/controlTowerRowNormalizer");

function rowWithStatus(currentStatus, extra = {}) {
  return buildNormalizedRow({
    rowType: "TEST",
    documentType: "WORK_ORDER",
    documentNo: "WO-1",
    currentStatus,
    currentOwner: "STORE",
    nextAction: "—",
    sourceModule: "TEST",
    sourceId: `test:${currentStatus}`,
    metadata: {},
    ...extra,
  });
}

function findGroup(result, groupKey) {
  return result.groups.find((g) => g.groupKey === groupKey);
}

describe("CONTROL_TOWER_BOARD_GROUPS", () => {
  it("defines every approved group with stable order 1..7", () => {
    const keys = [
      BOARD_GROUP_KEYS.RM_READINESS,
      BOARD_GROUP_KEYS.PROCUREMENT_HANDOFF,
      BOARD_GROUP_KEYS.PRODUCTION,
      BOARD_GROUP_KEYS.QUALITY,
      BOARD_GROUP_KEYS.DISPATCH,
      BOARD_GROUP_KEYS.COMMERCIAL_CLOSURE,
      BOARD_GROUP_KEYS.PLANNING,
    ];
    assert.equal(CONTROL_TOWER_BOARD_GROUPS.length, 7);
    assert.deepEqual(
      CONTROL_TOWER_BOARD_GROUPS.map((g) => g.groupKey),
      keys,
    );
    assert.deepEqual(
      CONTROL_TOWER_BOARD_GROUPS.map((g) => g.order),
      [1, 2, 3, 4, 5, 6, 7],
    );
  });
});

describe("groupControlTowerRows", () => {
  it("includes every approved group even when empty", () => {
    const result = groupControlTowerRows([]);
    assert.equal(result.groups.length, 7);
    for (const g of result.groups) {
      assert.equal(g.count, 0);
      assert.deepEqual(g.rows, []);
    }
    assert.deepEqual(result.ungrouped, []);
  });

  it("places WAITING_RM in RM_READINESS", () => {
    const row = normalizeRmRiskRow({ workOrderId: 10, itemId: 3, status: "CRITICAL" });
    const result = groupControlTowerRows([row]);
    const group = findGroup(result, BOARD_GROUP_KEYS.RM_READINESS);
    assert.equal(group.count, 1);
    assert.equal(group.rows[0].currentStatus, CONTROL_TOWER_STATUSES.WAITING_RM);
  });

  it("places PROCUREMENT_IN_PROGRESS in PROCUREMENT_HANDOFF", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 10,
      itemId: 3,
      status: "CRITICAL",
      queueType: "WAITING_PURCHASE_ACTION",
    });
    const result = groupControlTowerRows([row]);
    const group = findGroup(result, BOARD_GROUP_KEYS.PROCUREMENT_HANDOFF);
    assert.equal(group.count, 1);
    assert.equal(group.rows[0].currentStatus, CONTROL_TOWER_STATUSES.PROCUREMENT_IN_PROGRESS);
  });

  it("places PRODUCTION_PENDING and PRODUCTION_ON_HOLD in PRODUCTION", () => {
    const pending = normalizeProductionRow({
      workOrderId: 1,
      workOrderLineId: 1,
      nextAction: "PRODUCTION_PENDING",
    });
    const hold = normalizeProductionRow({
      workOrderId: 2,
      workOrderLineId: 1,
      nextAction: "ON_HOLD",
    });
    const result = groupControlTowerRows([pending, hold]);
    const group = findGroup(result, BOARD_GROUP_KEYS.PRODUCTION);
    assert.equal(group.count, 2);
    assert.equal(group.rows[0].currentStatus, CONTROL_TOWER_STATUSES.PRODUCTION_PENDING);
    assert.equal(group.rows[1].currentStatus, CONTROL_TOWER_STATUSES.PRODUCTION_ON_HOLD);
  });

  it("places QA_PENDING in QUALITY", () => {
    const row = normalizeQaRow({ qcRef: "PE-1", workOrderId: 7, status: "PENDING_QC" });
    const result = groupControlTowerRows([row]);
    const group = findGroup(result, BOARD_GROUP_KEYS.QUALITY);
    assert.equal(group.count, 1);
    assert.equal(group.rows[0].currentStatus, CONTROL_TOWER_STATUSES.QA_PENDING);
  });

  it("places DISPATCH_PENDING in DISPATCH", () => {
    const row = normalizeDispatchRow({ salesOrderId: 12, itemId: 4, orderType: "NORMAL" });
    const result = groupControlTowerRows([row]);
    const group = findGroup(result, BOARD_GROUP_KEYS.DISPATCH);
    assert.equal(group.count, 1);
    assert.equal(group.rows[0].currentStatus, CONTROL_TOWER_STATUSES.DISPATCH_PENDING);
  });

  it("places BILLING_PENDING and NEXT_RS_READY in COMMERCIAL_CLOSURE", () => {
    const bill = normalizeContinueWorkingRow({
      salesOrderId: 3,
      stageKey: "SALES_BILL",
      nextStep: "Create Sales Bill",
    });
    const nextRs = normalizeContinueWorkingRow({
      salesOrderId: 4,
      stageKey: "NEXT_RS",
      nextAction: "NEXT_RS_REQUIRED",
    });
    const result = groupControlTowerRows([bill, nextRs]);
    const group = findGroup(result, BOARD_GROUP_KEYS.COMMERCIAL_CLOSURE);
    assert.equal(group.count, 2);
    const statuses = group.rows.map((r) => r.currentStatus);
    assert.ok(statuses.includes(CONTROL_TOWER_STATUSES.BILLING_PENDING));
    assert.ok(statuses.includes(CONTROL_TOWER_STATUSES.NEXT_RS_READY));
  });

  it("places PLANNING_PENDING in PLANNING", () => {
    const row = rowWithStatus(CONTROL_TOWER_STATUSES.PLANNING_PENDING);
    const result = groupControlTowerRows([row]);
    const group = findGroup(result, BOARD_GROUP_KEYS.PLANNING);
    assert.equal(group.count, 1);
  });

  it("places UNKNOWN in ungrouped", () => {
    const row = rowWithStatus(CONTROL_TOWER_STATUSES.UNKNOWN);
    const result = groupControlTowerRows([row]);
    assert.equal(result.ungrouped.length, 1);
    assert.equal(result.ungrouped[0].currentStatus, CONTROL_TOWER_STATUSES.UNKNOWN);
    assert.equal(
      result.groups.reduce((s, g) => s + g.count, 0),
      0,
    );
  });

  it("keeps stable group order matching CONTROL_TOWER_BOARD_GROUPS", () => {
    const result = groupControlTowerRows([
      normalizeDispatchRow({ salesOrderId: 1, itemId: 1 }),
      normalizeRmRiskRow({ workOrderId: 2, itemId: 1, status: "LOW_BUFFER" }),
    ]);
    assert.deepEqual(
      result.groups.map((g) => g.order),
      [1, 2, 3, 4, 5, 6, 7],
    );
    assert.deepEqual(
      result.groups.map((g) => g.groupKey),
      CONTROL_TOWER_BOARD_GROUPS.map((d) => d.groupKey),
    );
  });

  it("does not mutate input rows", () => {
    const row = normalizeProductionRow({
      workOrderId: 99,
      workOrderLineId: 1,
      nextAction: "PRODUCTION_PENDING",
    });
    const snapshot = JSON.stringify(row);
    const result = groupControlTowerRows([row]);
    assert.equal(JSON.stringify(row), snapshot);
    const group = findGroup(result, BOARD_GROUP_KEYS.PRODUCTION);
    assert.equal(group.rows[0], row);
  });
});
