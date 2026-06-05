const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  CONTROL_TOWER_ROW_MODES,
  parseControlTowerRowMode,
  parseControlTowerPagination,
  paginateRows,
  selectRowsForMode,
  mergeNormalizedRowsFromSources,
} = require("../../src/services/controlTowerNormalizedRowsService");
const { attachRowIdentity } = require("../../src/services/controlTowerRowIdentity");
const { normalizeProductionRow, CONTROL_TOWER_STATUSES } = require("../../src/services/controlTowerRowNormalizer");

function productionRow(woId) {
  return normalizeProductionRow({
    workOrderId: woId,
    workOrderLineId: 1,
    nextAction: "PRODUCTION_PENDING",
    orderType: "NORMAL",
    status: "OPEN",
  });
}

function withKeys(rows) {
  return rows.map((row) => attachRowIdentity(row));
}

describe("parseControlTowerRowMode", () => {
  it("defaults to sample", () => {
    assert.equal(parseControlTowerRowMode(undefined), CONTROL_TOWER_ROW_MODES.SAMPLE);
    assert.equal(parseControlTowerRowMode("sample"), CONTROL_TOWER_ROW_MODES.SAMPLE);
  });

  it("accepts full mode", () => {
    assert.equal(parseControlTowerRowMode("full"), CONTROL_TOWER_ROW_MODES.FULL);
  });
});

describe("selectRowsForMode", () => {
  const source = [1, 2, 3, 4, 5];

  it("sample mode limits rows", () => {
    assert.deepEqual(selectRowsForMode(source, CONTROL_TOWER_ROW_MODES.SAMPLE, 2), [1, 2]);
  });

  it("full mode returns all rows", () => {
    assert.deepEqual(selectRowsForMode(source, CONTROL_TOWER_ROW_MODES.FULL, 2), source);
  });
});

describe("paginateRows", () => {
  const rows = withKeys([productionRow(1), productionRow(2), productionRow(3), productionRow(4), productionRow(5)]);

  it("paginates after dedupe-sized list", () => {
    const page1 = paginateRows(rows, 1, 2);
    const page2 = paginateRows(rows, 2, 2);
    const page3 = paginateRows(rows, 3, 2);
    assert.equal(page1.length, 2);
    assert.equal(page2.length, 2);
    assert.equal(page3.length, 1);
    assert.equal(page1[0].metadata.workOrderId, 1);
    assert.equal(page2[0].metadata.workOrderId, 3);
  });

  it("handles page beyond last page safely", () => {
    assert.deepEqual(paginateRows(rows, 99, 2), []);
  });

  it("uses defaults and max page size", () => {
    const { pageSize } = parseControlTowerPagination({});
    assert.equal(pageSize, 50);
    const capped = parseControlTowerPagination({ pageSize: 999 });
    assert.equal(capped.pageSize, 200);
  });
});

describe("mergeNormalizedRowsFromSources", () => {
  const rmRisk = Array.from({ length: 5 }, (_, i) => ({
    workOrderId: 100 + i,
    itemId: 1,
    status: "CRITICAL",
  }));
  const production = Array.from({ length: 4 }, (_, i) => ({
    workOrderId: 200 + i,
    workOrderLineId: 1,
    nextAction: "PRODUCTION_PENDING",
    status: "OPEN",
  }));

  it("sample mode limits each source before normalize", () => {
    const result = mergeNormalizedRowsFromSources({
      rmRisk,
      production,
      qa: [],
      dispatch: [],
      continueWorking: [],
      mode: CONTROL_TOWER_ROW_MODES.SAMPLE,
      limitPerSource: 2,
    });
    assert.equal(result.sources.rmRisk.selected, 2);
    assert.equal(result.sources.production.selected, 2);
    assert.equal(result.mode, CONTROL_TOWER_ROW_MODES.SAMPLE);
    assert.equal(result.merged.length, 4);
  });

  it("full mode uses complete source populations", () => {
    const result = mergeNormalizedRowsFromSources({
      rmRisk,
      production,
      qa: [],
      dispatch: [],
      continueWorking: [],
      mode: CONTROL_TOWER_ROW_MODES.FULL,
      limitPerSource: 2,
    });
    assert.equal(result.sources.rmRisk.selected, 5);
    assert.equal(result.sources.production.selected, 4);
    assert.equal(result.mode, CONTROL_TOWER_ROW_MODES.FULL);
    assert.equal(result.merged.length, 9);
  });

  it("dedupes before pagination consumer slices", () => {
    const deduped = mergeNormalizedRowsFromSources({
      rmRisk: [{ workOrderId: 125, itemId: 9, status: "CRITICAL" }],
      production: [{ workOrderId: 125, workOrderLineId: 1, nextAction: "PRODUCTION_PENDING", status: "OPEN" }],
      qa: [],
      dispatch: [],
      continueWorking: [],
      mode: CONTROL_TOWER_ROW_MODES.FULL,
    });
    assert.equal(deduped.merged.length, 2);
    assert.equal(deduped.rows.length, 1);
    assert.equal(deduped.rows[0].rowType, "RM_RISK");

    const page = paginateRows(deduped.rows, 1, 50);
    assert.equal(page.length, 1);
    assert.equal(page[0].rowKey, "WORK_ORDER:125");
  });
});

describe("mergeNormalizedRowsFromSources — high-priority sources", () => {
  it("includes noQtyPlanning, woPlanning, and qaRework in meta.sources", () => {
    const result = mergeNormalizedRowsFromSources({
      rmRisk: [],
      production: [],
      qa: [],
      dispatch: [],
      continueWorking: [],
      noQtyPlanning: [
        {
          salesOrderId: 1,
          salesOrderDocNo: "SO-NQ-1",
          latestRequirementSheetStatus: "DRAFT",
        },
      ],
      woPlanning: [
        {
          salesOrderId: 2,
          salesOrderDocNo: "SO-2",
          operationalKey: "READY_FOR_WO",
          nextActionKey: "CREATE_WO",
        },
      ],
      qaRework: [
        {
          dispositionId: 3,
          status: "REWORK_READY_FOR_QC",
          workOrderId: 8,
          pendingReworkQcQty: 2,
        },
      ],
      mode: CONTROL_TOWER_ROW_MODES.FULL,
    });
    assert.equal(result.sources.noQtyPlanning.selected, 1);
    assert.equal(result.sources.woPlanning.selected, 1);
    assert.equal(result.sources.qaRework.selected, 1);
    assert.equal(result.rows.length, 3);
    const statuses = result.rows.map((r) => r.currentStatus);
    assert.ok(statuses.includes(CONTROL_TOWER_STATUSES.PLANNING_PENDING));
    assert.ok(statuses.includes(CONTROL_TOWER_STATUSES.WO_PLANNING_PENDING));
    assert.ok(statuses.includes(CONTROL_TOWER_STATUSES.QA_REWORK_PENDING));
  });

  it("sample mode limits new sources", () => {
    const noQtyRows = Array.from({ length: 4 }, (_, i) => ({
      salesOrderId: i + 1,
      latestRequirementSheetStatus: "DRAFT",
    }));
    const result = mergeNormalizedRowsFromSources({
      rmRisk: [],
      production: [],
      qa: [],
      dispatch: [],
      continueWorking: [],
      noQtyPlanning: noQtyRows,
      woPlanning: [],
      qaRework: [],
      mode: CONTROL_TOWER_ROW_MODES.SAMPLE,
      limitPerSource: 2,
    });
    assert.equal(result.sources.noQtyPlanning.fetched, 4);
    assert.equal(result.sources.noQtyPlanning.selected, 2);
  });
});

describe("metadata semantics", () => {
  it("marks sampled only for sample mode", () => {
    const rawRm = (woId) => ({ workOrderId: woId, itemId: 1, status: "CRITICAL" });

    const sample = mergeNormalizedRowsFromSources({
      rmRisk: [rawRm(1)],
      production: [],
      qa: [],
      dispatch: [],
      continueWorking: [],
      mode: CONTROL_TOWER_ROW_MODES.SAMPLE,
      limitPerSource: 8,
    });
    assert.equal(sample.mode, CONTROL_TOWER_ROW_MODES.SAMPLE);

    const full = mergeNormalizedRowsFromSources({
      rmRisk: [rawRm(1), rawRm(2)],
      production: [],
      qa: [],
      dispatch: [],
      continueWorking: [],
      mode: CONTROL_TOWER_ROW_MODES.FULL,
      limitPerSource: 1,
    });
    assert.equal(full.mode, CONTROL_TOWER_ROW_MODES.FULL);
    assert.equal(full.rows.length, 2);
  });
});
