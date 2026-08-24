/**
 * RM Wastage Report — service wiring / filter parse (no calculation changes).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildRmWastageReport, parseFilters } = require("../../src/services/rmWastageReportService");

describe("rmWastageReportService", () => {
  it("exports buildRmWastageReport as a function", () => {
    assert.equal(typeof buildRmWastageReport, "function");
  });

  it("parseFilters defaults page and pageSize", () => {
    const f = parseFilters({});
    assert.equal(f.page, 1);
    assert.equal(f.pageSize, 50);
    assert.equal(f.reason, null);
    assert.equal(f.exportMode, "");
  });

  it("buildRmWastageReport returns empty payload when no notes", async () => {
    const db = {
      materialWastageNote: {
        count: async () => 0,
        findMany: async () => [],
      },
    };
    const data = await buildRmWastageReport({}, db);
    assert.equal(data.meta.total, 0);
    assert.deepEqual(data.rows, []);
    assert.equal(data.kpis.totalNotes, 0);
    assert.equal(data.kpis.totalWastageQty, 0);
    assert.equal(data.kpis.totalWastageValue, 0);
    assert.equal(data.kpis.processWastageQty, 0);
    assert.equal(data.kpis.purgingConsumptionQty, 0);
  });

  it("separates PURGING_CONSUMPTION from process wastage KPIs", async () => {
    const db = {
      materialWastageNote: {
        count: async () => 2,
        findMany: async () => [
          {
            id: 1,
            createdAt: new Date(),
            docNo: "MWN-1",
            workOrderId: 1,
            workOrder: { docNo: "WO-1" },
            itemId: 10,
            item: { itemName: "RM-A", unit: "kg" },
            qty: 2,
            reason: "PROCESS_LOSS",
            remarks: null,
            createdBy: { name: "A" },
          },
          {
            id: 2,
            createdAt: new Date(),
            docNo: "MWN-2",
            workOrderId: 1,
            workOrder: { docNo: "WO-1" },
            itemId: 11,
            item: { itemName: "RM-B", unit: "kg" },
            qty: 4,
            reason: "PURGING",
            remarks: "[PURGING_CONSUMPTION] startConfirmationId=9",
            createdBy: { name: "A" },
          },
        ],
      },
      grnLine: {
        findFirst: async () => null,
      },
    };
    const data = await buildRmWastageReport({}, db);
    assert.equal(data.kpis.processWastageQty, 2);
    assert.equal(data.kpis.purgingConsumptionQty, 4);
    assert.equal(data.kpis.totalWastageQty, 6);
    assert.equal(data.rows.find((r) => r.id === 2).category, "PURGING_CONSUMPTION");
    assert.equal(data.rows.find((r) => r.id === 1).category, "PROCESS_WASTAGE");
  });
});
