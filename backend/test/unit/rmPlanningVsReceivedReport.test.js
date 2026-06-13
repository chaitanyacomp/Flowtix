const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  ROW_STATUSES,
  deriveRowStatus,
  variancePercent,
  finalizeRow,
  applyStatusFilter,
  buildSummary,
  deriveEmptyState,
  rowsToCsv,
  parsePeriodKey,
  grnQtyForPoLine,
} = require("../../src/services/rmPlanningVsReceivedReportService");

describe("rmPlanningVsReceivedReportService", () => {
  it("parsePeriodKey accepts YYYY-MM", () => {
    const p = parsePeriodKey("2026-05");
    assert.ok(p);
    assert.equal(p.periodKey, "2026-05");
    assert.equal(p.month, 5);
  });

  it("deriveRowStatus marks over-received when GRN exceeds planned", () => {
    assert.equal(
      deriveRowStatus({ plannedQty: 185.61, poQty: 200, grnQty: 200, releasedQty: 185.61 }),
      ROW_STATUSES.OVER_RECEIVED,
    );
    assert.equal(
      deriveRowStatus({ plannedQty: 5.75, poQty: 10, grnQty: 10, releasedQty: 5.75 }),
      ROW_STATUSES.OVER_RECEIVED,
    );
  });

  it("finalizeRow computes variance qty and percent", () => {
    const row = finalizeRow({
      rmItemId: 1,
      itemName: "PP",
      unit: "Kg",
      plannedQty: 185.61,
      releasedQty: 185.61,
      poQty: 200,
      grnQty: 200,
      planningSources: [],
      procurementDetails: [],
    });
    assert.equal(row.varianceQty, 14.39);
    assert.equal(row.status, ROW_STATUSES.OVER_RECEIVED);
    assert.ok(Math.abs(row.variancePercent - 7.753) < 0.01);
  });

  it("variancePercent returns null when planned is zero", () => {
    assert.equal(variancePercent(0, 10), null);
  });

  it("deriveRowStatus returns NO_PO when planned but no PO", () => {
    assert.equal(
      deriveRowStatus({ plannedQty: 100, poQty: 0, grnQty: 0, releasedQty: 0 }),
      ROW_STATUSES.NO_PO,
    );
  });

  it("deriveRowStatus returns NO_GRN when PO exists but no GRN", () => {
    assert.equal(
      deriveRowStatus({ plannedQty: 100, poQty: 200, grnQty: 0, releasedQty: 100 }),
      ROW_STATUSES.NO_GRN,
    );
  });

  it("deriveRowStatus returns SHORT_RECEIVED when GRN below planned", () => {
    assert.equal(
      deriveRowStatus({ plannedQty: 100, poQty: 80, grnQty: 80, releasedQty: 100 }),
      ROW_STATUSES.SHORT_RECEIVED,
    );
  });

  it("grnQtyForPoLine excludes reversed GRNs", () => {
    const qty = grnQtyForPoLine({
      grnLines: [
        { receivedQty: 100, grn: { reversedAt: null } },
        { receivedQty: 50, grn: { reversedAt: new Date() } },
      ],
    });
    assert.equal(qty, 100);
  });

  it("applyStatusFilter keeps only matching status", () => {
    const rows = [
      finalizeRow({
        rmItemId: 1,
        itemName: "A",
        unit: "Kg",
        plannedQty: 10,
        releasedQty: 10,
        poQty: 10,
        grnQty: 12,
        planningSources: [],
        procurementDetails: [],
      }),
      finalizeRow({
        rmItemId: 2,
        itemName: "B",
        unit: "Kg",
        plannedQty: 10,
        releasedQty: 10,
        poQty: 10,
        grnQty: 10,
        planningSources: [],
        procurementDetails: [],
      }),
    ];
    const filtered = applyStatusFilter(rows, ROW_STATUSES.OVER_RECEIVED);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].rmItemName, "A");
  });

  it("buildSummary aggregates totals", () => {
    const rows = [
      finalizeRow({
        rmItemId: 1,
        itemName: "PP",
        unit: "Kg",
        plannedQty: 185.61,
        releasedQty: 185.61,
        poQty: 200,
        grnQty: 200,
        planningSources: [],
        procurementDetails: [],
      }),
      finalizeRow({
        rmItemId: 2,
        itemName: "Powder",
        unit: "Kg",
        plannedQty: 5.75,
        releasedQty: 5.75,
        poQty: 10,
        grnQty: 10,
        planningSources: [],
        procurementDetails: [],
      }),
    ];
    const summary = buildSummary(rows);
    assert.equal(summary.totalPlannedRmQty, 191.36);
    assert.equal(summary.totalPoQty, 210);
    assert.equal(summary.totalReceivedQty, 210);
    assert.equal(summary.overReceivedItems, 2);
    assert.equal(summary.shortReceivedItems, 0);
  });

  it("deriveEmptyState messages", () => {
    assert.deepEqual(
      deriveEmptyState({
        plannedByItem: new Map(),
        rows: [],
        mrLineCount: 0,
        filters: { procurementSource: "ALL" },
      }),
      { code: "NO_PLANNING", message: "No RM planning records found for this period." },
    );

    const plannedRow = finalizeRow({
      rmItemId: 1,
      itemName: "PP",
      unit: "Kg",
      plannedQty: 100,
      releasedQty: 0,
      poQty: 0,
      grnQty: 0,
      planningSources: [],
      procurementDetails: [],
    });
    assert.deepEqual(
      deriveEmptyState({
        plannedByItem: new Map([[1, { plannedQty: 100 }]]),
        rows: [plannedRow],
        mrLineCount: 0,
        filters: { procurementSource: "MONTHLY_PLAN" },
      }),
      { code: "PLANNED_NO_PROCUREMENT", message: "RM planned but procurement not released." },
    );
  });

  it("rowsToCsv includes header and values", () => {
    const csv = rowsToCsv([
      finalizeRow({
        rmItemId: 1,
        itemName: "PP",
        unit: "Kg",
        plannedQty: 185.61,
        releasedQty: 185.61,
        poQty: 200,
        grnQty: 200,
        planningSources: [],
        procurementDetails: [],
      }),
    ]);
    assert.match(csv, /^RM Item,Unit,Planned RM Qty/);
    assert.match(csv, /PP,Kg,185\.61/);
    assert.match(csv, /Over Received/);
  });
});
