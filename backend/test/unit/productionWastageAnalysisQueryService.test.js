const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProductionWastageAnalysis,
  buildWoDetailRows,
  buildTypeSummaryRows,
  buildReconciliation,
  pct,
  FORMULA_METADATA,
} = require("../../src/services/reports/productionWastageAnalysisQueryService");

function reportFixture({
  id = 1,
  status = "CONFIRMED",
  workOrderId = 10,
  workOrderNo = "WO-26-0001",
  confirmedAt = new Date("2026-07-01T10:00:00Z"),
  producedQty = 100,
  lines = [],
  wastageDetails = [],
  customerName = "Acme",
} = {}) {
  return {
    id,
    status,
    workOrderId,
    confirmedAt,
    producedQty,
    lines,
    wastageDetails,
    workOrder: {
      id: workOrderId,
      docNo: workOrderNo,
      salesOrderId: 5,
      salesOrder: {
        id: 5,
        docNo: "SO-1",
        customerId: 2,
        customer: { id: 2, name: customerName },
      },
      lines: [{ fgItemId: 90, fgItem: { id: 90, itemName: "FG-A", unit: "Nos" } }],
    },
    confirmedBy: { id: 1, name: "Admin" },
  };
}

function line({ itemId = 20, itemName = "HDPE", unit = "Kg", issued = 10, returned = 1, consumed = 8, scrap = 1 } = {}) {
  return {
    id: itemId,
    itemId,
    rmIssuedQty: issued,
    rmReturnQty: returned,
    rmConsumedQty: consumed,
    scrapWasteQty: scrap,
    remarks: null,
    item: { id: itemId, itemName, unit },
  };
}

function detail({ wastageTypeId = 1, name = "Purging", category = "PROCESS", qty = 1, isActive = true } = {}) {
  return {
    id: wastageTypeId * 10,
    wastageTypeId,
    qty,
    remarks: "note",
    sortOrder: 0,
    wastageType: { id: wastageTypeId, code: null, name, category, isActive },
  };
}

function makeDb(reports, peConsumptions = [], capture = {}) {
  return {
    productionWorkOrderReport: {
      findMany: async ({ where } = {}) => {
        capture.reportWhere = where;
        let rows = reports.filter((r) => {
          if (where?.status && r.status !== where.status) return false;
          if (where?.workOrderId && r.workOrderId !== where.workOrderId) return false;
          if (where?.wastageDetails?.some?.wastageTypeId) {
            const tid = where.wastageDetails.some.wastageTypeId;
            if (!(r.wastageDetails || []).some((d) => d.wastageTypeId === tid)) return false;
          }
          if (where?.wastageDetails?.some?.wastageType?.category) {
            const cat = where.wastageDetails.some.wastageType.category;
            if (!(r.wastageDetails || []).some((d) => d.wastageType?.category === cat)) return false;
          }
          return true;
        });
        return rows;
      },
    },
    productionEntryRmConsumption: {
      findMany: async ({ where, select } = {}) => {
        capture.peWhere = where;
        capture.peSelect = select;
        const status = where?.productionEntry?.workflowStatus;
        return peConsumptions.filter((row) => {
          if (status && row._workflowStatus && row._workflowStatus !== status) return false;
          const woFilter = where?.productionEntry?.workOrderLine?.workOrderId?.in;
          if (Array.isArray(woFilter)) {
            const woId = row.productionEntry?.workOrderLine?.workOrderId;
            if (!woFilter.includes(woId)) return false;
          }
          return true;
        });
      },
    },
  };
}

describe("productionWastageAnalysisQueryService", () => {
  it("documents formulas", () => {
    assert.match(FORMULA_METADATA.wastagePct, /issuedQty/);
    assert.match(FORMULA_METADATA.yieldPct, /actualConsumedQty/);
    assert.equal(FORMULA_METADATA.lanes.A.includes("MaterialWastageNote"), true);
  });

  it("computes wastage% and yield% consistently; returns are not wastage", () => {
    assert.equal(pct(1, 10), 10);
    assert.equal(pct(8, 10), 80);
    // issued 10, returned 1, consumed 8, scrap 1 — wastage is scrap, not return
    const rows = buildWoDetailRows(
      [
        reportFixture({
          lines: [line({ issued: 10, returned: 1, consumed: 8, scrap: 1 })],
          wastageDetails: [detail({ qty: 1 })],
        }),
      ],
      new Map(),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].returnedQty, 1);
    assert.equal(rows[0].wastageQty, 1);
    assert.equal(rows[0].wastagePct, 10);
    assert.equal(rows[0].yieldPct, 80);
  });

  it("excludes DRAFT reports", async () => {
    const db = makeDb([
      reportFixture({ id: 1, status: "CONFIRMED", lines: [line()], wastageDetails: [detail()] }),
      reportFixture({ id: 2, status: "DRAFT", workOrderId: 11, lines: [line({ scrap: 9 })], wastageDetails: [detail({ qty: 9 })] }),
    ]);
    const result = await buildProductionWastageAnalysis({ mode: "wo-detail", filters: {} }, db);
    assert.equal(result.kpis.reportCount, 1);
    assert.ok(result.rows.every((r) => r.status === "CONFIRMED"));
  });

  it("does not multiply wastage details across multiple RM lines", () => {
    const report = reportFixture({
      lines: [
        line({ itemId: 20, scrap: 2, issued: 10, consumed: 8, returned: 0 }),
        line({ itemId: 21, itemName: "PP", scrap: 1, issued: 5, consumed: 4, returned: 0 }),
      ],
      wastageDetails: [detail({ qty: 3 })],
    });
    const rows = buildWoDetailRows([report], new Map());
    assert.equal(rows.length, 2);
    assert.equal(rows[0].wastageQty + rows[1].wastageQty, 3);
    // classification qty is NOT added per line
    assert.equal(rows[0].classifications[0].qty, 3);
    assert.equal(rows[1].classifications[0].qty, 3);
  });

  it("aggregates multiple wastage details on one report for type summary", () => {
    const report = reportFixture({
      lines: [line({ scrap: 3 })],
      wastageDetails: [
        detail({ wastageTypeId: 1, name: "Purging", qty: 2 }),
        detail({ wastageTypeId: 2, name: "Spillage", category: "PROCESS", qty: 1 }),
      ],
    });
    const typeRows = buildTypeSummaryRows([report]);
    assert.equal(typeRows.length, 2);
    assert.equal(typeRows.reduce((s, r) => s + r.totalWastageQty, 0), 3);
  });

  it("WO classification total equals type-summary total for identical filters", async () => {
    const reports = [
      reportFixture({
        id: 1,
        lines: [line({ scrap: 2 }), line({ itemId: 21, scrap: 1 })],
        wastageDetails: [
          detail({ wastageTypeId: 1, qty: 2 }),
          detail({ wastageTypeId: 2, name: "Spillage", qty: 1 }),
        ],
      }),
      reportFixture({
        id: 2,
        workOrderId: 11,
        workOrderNo: "WO-26-0002",
        lines: [line({ scrap: 4 })],
        wastageDetails: [detail({ wastageTypeId: 1, qty: 4 })],
      }),
    ];
    const db = makeDb(reports);
    const wo = await buildProductionWastageAnalysis({ mode: "wo-detail", filters: { pageSize: 100 } }, db);
    const type = await buildProductionWastageAnalysis({ mode: "type-summary", filters: { pageSize: 100 } }, db);
    assert.equal(wo.reconciliation.classificationDetailTotal, type.kpis.totalWastageQty);
    assert.equal(wo.reconciliation.classificationDetailTotal, 7);
  });

  it("type drill-down filter matches grouped summary qty", async () => {
    const reports = [
      reportFixture({
        lines: [line({ scrap: 5 })],
        wastageDetails: [
          detail({ wastageTypeId: 1, qty: 3 }),
          detail({ wastageTypeId: 2, name: "Spillage", qty: 2 }),
        ],
      }),
    ];
    const db = makeDb(reports);
    const type = await buildProductionWastageAnalysis({ mode: "type-summary" }, db);
    const purge = type.rows.find((r) => r.wastageTypeId === 1);
    assert.equal(purge.totalWastageQty, 3);
    const filtered = await buildProductionWastageAnalysis(
      { mode: "type-summary", filters: { wastageTypeId: 1 } },
      db,
    );
    assert.equal(filtered.rows.length, 1);
    assert.equal(filtered.rows[0].totalWastageQty, 3);
  });

  it("keeps inactive wastage types visible historically", () => {
    const typeRows = buildTypeSummaryRows([
      reportFixture({
        lines: [line({ scrap: 1 })],
        wastageDetails: [detail({ wastageTypeId: 7, name: "QC Rejection", category: "QUALITY", qty: 1, isActive: false })],
      }),
    ]);
    assert.equal(typeRows[0].isActiveType, false);
    assert.equal(typeRows[0].wastageTypeName, "QC Rejection");
  });

  it("reconciliation warns when line wastage and classification diverge; does not include MWN/Scrap lanes", () => {
    const reports = [
      reportFixture({
        lines: [line({ scrap: 5 })],
        wastageDetails: [detail({ qty: 4 })],
      }),
    ];
    const rec = buildReconciliation(reports);
    assert.equal(rec.lineWastageTotal, 5);
    assert.equal(rec.classificationDetailTotal, 4);
    assert.ok(rec.warnings.some((w) => w.code === "CLASSIFICATION_QTY_MISMATCH"));
    assert.ok(rec.warnings.some((w) => w.code === "LANE_BOUNDARY"));
  });

  it("legacy mode remains available without mode param", async () => {
    const db = makeDb([
      reportFixture({
        lines: [line({ scrap: 1 })],
        wastageDetails: [detail({ qty: 1 })],
      }),
    ]);
    const legacy = await buildProductionWastageAnalysis({ mode: "legacy" }, db);
    assert.equal(legacy.mode, "legacy");
    assert.ok(Array.isArray(legacy.pareto));
    assert.ok(Array.isArray(legacy.rows));
    assert.equal(legacy.summary.totalQty, 1);
  });

  it("marks material cost loss deferred", async () => {
    const db = makeDb([reportFixture({ lines: [line()], wastageDetails: [detail()] })]);
    const result = await buildProductionWastageAnalysis({ mode: "wo-detail" }, db);
    assert.equal(result.kpis.materialCostLoss, null);
    assert.equal(result.kpis.materialCostLossStatus, "DEFERRED_PENDING_VALUATION_POLICY");
  });

  it("filters planned RM consumption via ProductionEntry.workflowStatus APPROVED (not status)", async () => {
    const capture = {};
    const peRows = [
      {
        itemId: 20,
        standardQty: 7,
        _workflowStatus: "APPROVED",
        productionEntry: { workOrderLine: { workOrderId: 10 } },
      },
      {
        itemId: 20,
        standardQty: 99,
        _workflowStatus: "DRAFT",
        productionEntry: { workOrderLine: { workOrderId: 10 } },
      },
    ];
    const db = makeDb(
      [reportFixture({ lines: [line({ itemId: 20, scrap: 1 })], wastageDetails: [detail({ qty: 1 })] })],
      peRows,
      capture,
    );
    const wo = await buildProductionWastageAnalysis({ mode: "wo-detail", filters: { pageSize: 100 } }, db);
    assert.equal(capture.reportWhere?.status, "CONFIRMED");
    assert.equal(capture.peWhere?.productionEntry?.workflowStatus, "APPROVED");
    assert.equal(capture.peSelect?.itemId, true);
    assert.equal(capture.peSelect?.rmItemId, undefined);
    const planned = wo.rows.find((r) => r.rmItemId === 20);
    // planned consumption adjunct must ignore DRAFT PE rows
    assert.ok(planned);
    assert.equal(planned.plannedConsumption, 7);
  });

  it("maps RM consumption planned qty to the correct WO", async () => {
    const peRows = [
      {
        itemId: 20,
        standardQty: 3,
        _workflowStatus: "APPROVED",
        productionEntry: { workOrderLine: { workOrderId: 10 } },
      },
      {
        itemId: 20,
        standardQty: 8,
        _workflowStatus: "APPROVED",
        productionEntry: { workOrderLine: { workOrderId: 11 } },
      },
    ];
    const db = makeDb(
      [
        reportFixture({
          id: 1,
          workOrderId: 10,
          lines: [line({ itemId: 20, scrap: 1 })],
          wastageDetails: [detail({ qty: 1 })],
        }),
        reportFixture({
          id: 2,
          workOrderId: 11,
          workOrderNo: "WO-26-0002",
          lines: [line({ itemId: 20, scrap: 1 })],
          wastageDetails: [detail({ qty: 1 })],
        }),
      ],
      peRows,
    );
    const wo = await buildProductionWastageAnalysis({ mode: "wo-detail", filters: { pageSize: 100 } }, db);
    const r10 = wo.rows.find((r) => r.workOrderId === 10);
    const r11 = wo.rows.find((r) => r.workOrderId === 11);
    assert.equal(r10.plannedConsumption, 3);
    assert.equal(r11.plannedConsumption, 8);
  });

  it("type-summary and wo-detail succeed for current fixture dataset", async () => {
    const db = makeDb([
      reportFixture({ lines: [line()], wastageDetails: [detail()] }),
      reportFixture({
        id: 2,
        status: "DRAFT",
        workOrderId: 11,
        lines: [line({ scrap: 9 })],
        wastageDetails: [detail({ qty: 9 })],
      }),
    ]);
    const type = await buildProductionWastageAnalysis({ mode: "type-summary" }, db);
    const wo = await buildProductionWastageAnalysis({ mode: "wo-detail" }, db);
    assert.equal(type.kpis.reportCount, 1);
    assert.equal(wo.kpis.reportCount, 1);
    assert.ok(Array.isArray(type.rows));
    assert.ok(Array.isArray(wo.rows));
  });
});
