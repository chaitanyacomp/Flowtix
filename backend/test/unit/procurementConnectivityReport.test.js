const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  assembleRmPoProcurementTrace,
} = require("../../src/services/procurementTraceService");
const {
  applyRowFilters,
  buildProcurementConnectivityReport,
  deriveReceiptStatus,
  flattenTraceToReportRows,
  RECEIPT_STATUSES,
  BILL_STATUSES,
} = require("../../src/services/procurementConnectivityReportService");

function mrRequirement(overrides = {}) {
  return {
    id: overrides.id ?? 2,
    docNo: overrides.docNo ?? "MR-26-0002",
    sourceType: overrides.sourceType ?? "MONTHLY_PLAN",
    sourceRevision: overrides.sourceRevision ?? 3,
    quotation: null,
    salesOrder: null,
    workOrder: null,
    monthlyProductionPlan: overrides.monthlyProductionPlan ?? {
      id: 50,
      docNo: "MPP-2026-05",
      periodKey: "2026-05",
      currentRevision: 3,
    },
  };
}

function poLine(id, overrides = {}) {
  return {
    id,
    qty: overrides.qty ?? 100,
    rate: 50,
    item: overrides.item ?? { id: 1, itemName: "HDPE", unit: "KG", itemType: "RM", hsnCode: "3901" },
    procurementLinks: overrides.procurementLinks ?? [],
  };
}

function mprsLink() {
  const mrLine = { id: 201, materialRequirement: mrRequirement() };
  return [
    {
      id: 1,
      allocatedQty: 100,
      purchaseRequestLine: {
        id: 301,
        purchaseRequest: { id: 30, docNo: "PR-26-0002", status: "PENDING_PURCHASE" },
        sourceLinks: [{ id: 401, allocatedQty: 100, materialRequirementLine: mrLine }],
      },
      materialRequirementLine: null,
    },
  ];
}

function woLink(docNo = "MR-26-0004", prDoc = "PR-26-0003") {
  const mrLine = {
    id: 202,
    materialRequirement: mrRequirement({
      id: 4,
      docNo,
      sourceType: "WORK_ORDER_PLANNING",
      sourceRevision: null,
      monthlyProductionPlan: null,
      workOrder: { id: 7, docNo: "WO-7" },
    }),
  };
  return [
    {
      id: 2,
      allocatedQty: 50,
      purchaseRequestLine: {
        id: 302,
        purchaseRequest: { id: 31, docNo: prDoc, status: "PENDING_PURCHASE" },
        sourceLinks: [{ id: 402, allocatedQty: 50, materialRequirementLine: mrLine }],
      },
      materialRequirementLine: null,
    },
  ];
}

function po101Trace() {
  return assembleRmPoProcurementTrace(
    {
      id: 101,
      status: "COMPLETED",
      supplierId: 13,
      supplierLocationId: null,
      remarks: null,
      createdAt: new Date("2026-06-10"),
      updatedAt: new Date("2026-06-10"),
      supplier: {
        id: 13,
        name: "Arihant",
        gst: "27AKSLK1412A1Z5",
        address: null,
        stateRef: { stateName: "Maharashtra", stateCode: "27" },
      },
      supplierLocation: null,
      lines: [
        poLine(142, { procurementLinks: mprsLink(), qty: 122.31 }),
        poLine(143, { item: { id: 2, itemName: "Powder", unit: "KG", itemType: "RM", hsnCode: "3902" }, procurementLinks: mprsLink(), qty: 3.365 }),
        poLine(144, { procurementLinks: woLink(), qty: 123.533 }),
        poLine(145, { item: { id: 2, itemName: "Powder", unit: "KG", itemType: "RM", hsnCode: "3902" }, procurementLinks: woLink(), qty: 4.409 }),
      ],
      grns: [
        {
          id: 101,
          supplierInvoiceNo: "INV-101",
          date: new Date("2026-06-10"),
          reversedAt: null,
          billingStatus: "PENDING",
          lines: [
            { id: 501, grnId: 101, rmPoLineId: 142, receivedQty: 122.31, rateSnapshot: 50, location: { id: 3, locationName: "RM Store", locationCode: "LOC-RM-STORE" } },
            { id: 502, grnId: 101, rmPoLineId: 143, receivedQty: 3.365, rateSnapshot: 50, location: { id: 3, locationName: "RM Store", locationCode: "LOC-RM-STORE" } },
            { id: 503, grnId: 101, rmPoLineId: 144, receivedQty: 123.533, rateSnapshot: 50, location: { id: 3, locationName: "RM Store", locationCode: "LOC-RM-STORE" } },
            { id: 504, grnId: 101, rmPoLineId: 145, receivedQty: 4.409, rateSnapshot: 50, location: { id: 3, locationName: "RM Store", locationCode: "LOC-RM-STORE" } },
          ],
        },
      ],
    },
    [
      { id: 9001, itemId: 1, locationId: 3, transactionType: "GRN", refId: 501, stockBucket: "USABLE", qtyIn: 122.31, qtyOut: 0, date: new Date(), reversedAt: null },
      { id: 9002, itemId: 2, locationId: 3, transactionType: "GRN", refId: 502, stockBucket: "USABLE", qtyIn: 3.365, qtyOut: 0, date: new Date(), reversedAt: null },
    ],
    [],
  );
}

describe("procurementConnectivityReportService", () => {
  it("report returns PO 101 MPRS lines", () => {
    const rows = flattenTraceToReportRows(po101Trace());
    const mprsRows = rows.filter((r) => r.demandSourceType === "MONTHLY_PLAN");
    assert.equal(mprsRows.length, 2);
    assert.equal(mprsRows[0].mr.docNo, "MR-26-0002");
    assert.equal(mprsRows[0].pr.docNo, "PR-26-0002");
    assert.ok(mprsRows[0].traceChain.includes("Monthly Plan Rev 3"));
    assert.equal(mprsRows[0].rmPoDisplayNo, "RMPO-101");
  });

  it("report supports mixed demand sources on one PO", () => {
    const rows = flattenTraceToReportRows(po101Trace());
    const types = [...new Set(rows.map((r) => r.demandSourceType))].sort();
    assert.deepEqual(types, ["MONTHLY_PLAN", "WORK_ORDER_PLANNING"]);
    assert.equal(rows.length, 4);
  });

  it("report handles no bill", () => {
    const rows = flattenTraceToReportRows(po101Trace());
    assert.ok(rows.every((r) => r.billStatus === BILL_STATUSES.NOT_BILLED));
    assert.ok(rows.every((r) => r.billStatusLabel === "Not billed"));
  });

  it("report handles no GRN", () => {
    const trace = assembleRmPoProcurementTrace(
      {
        id: 200,
        status: "PENDING",
        supplierId: 1,
        supplierLocationId: null,
        remarks: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        supplier: { id: 1, name: "S", gst: null, address: null, stateRef: null },
        supplierLocation: null,
        lines: [poLine(10, { procurementLinks: mprsLink(), qty: 50 })],
        grns: [],
      },
      [],
      [],
    );
    const rows = flattenTraceToReportRows(trace);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].receiptStatus, RECEIPT_STATUSES.PENDING_RECEIPT);
    assert.equal(rows[0].receiptStatusLabel, "Pending receipt");
    assert.equal(rows[0].grnSummary.label, "Pending receipt");
    assert.equal(rows[0].stockPosted.posted, false);
  });

  it("report excludes reversed GRN qty from receivedQty", () => {
    const trace = assembleRmPoProcurementTrace(
      {
        id: 300,
        status: "PARTIAL",
        supplierId: 1,
        supplierLocationId: null,
        remarks: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        supplier: { id: 1, name: "S", gst: null, address: null, stateRef: null },
        supplierLocation: null,
        lines: [poLine(20, { procurementLinks: mprsLink(), qty: 100 })],
        grns: [
          {
            id: 10,
            supplierInvoiceNo: "INV-A",
            date: new Date(),
            reversedAt: new Date(),
            billingStatus: "PENDING",
            lines: [{ id: 601, grnId: 10, rmPoLineId: 20, receivedQty: 80, rateSnapshot: 50, location: null }],
          },
          {
            id: 11,
            supplierInvoiceNo: "INV-B",
            date: new Date(),
            reversedAt: null,
            billingStatus: "PENDING",
            lines: [{ id: 602, grnId: 11, rmPoLineId: 20, receivedQty: 30, rateSnapshot: 50, location: null }],
          },
        ],
      },
      [],
      [],
    );
    const rows = flattenTraceToReportRows(trace);
    assert.equal(rows[0].receivedQty, 30);
    assert.equal(rows[0].pendingQty, 70);
    assert.equal(rows[0].receiptStatus, RECEIPT_STATUSES.PARTIALLY_RECEIVED);
    assert.ok(rows[0].grnSummary.reversedGrnNos.includes("GRN-10"));
    assert.ok(rows[0].grnSummary.activeGrnNos.includes("GRN-11"));
  });

  it("buildProcurementConnectivityReport performs no DB writes", async () => {
    const writes = [];
    const po = {
      id: 101,
      status: "COMPLETED",
      supplierId: 13,
      supplierLocationId: null,
      remarks: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      supplier: { id: 13, name: "Arihant", gst: null, address: null, stateRef: null },
      supplierLocation: null,
      lines: [poLine(142, { procurementLinks: mprsLink() })],
      grns: [],
    };
    const mockDb = {
      rmPurchaseOrder: {
        findMany: async () => [po],
        update: async () => {
          writes.push("update");
          return po;
        },
      },
      stockTransaction: { findMany: async () => [] },
      purchaseBillLine: { findMany: async () => [] },
      $transaction: async () => {
        writes.push("tx");
      },
    };
    const report = await buildProcurementConnectivityReport(mockDb, { rmPoId: 101 });
    assert.equal(report.rows.length, 1);
    assert.deepEqual(writes, []);
  });

  it("applyRowFilters supports sourceType filter", () => {
    const rows = flattenTraceToReportRows(po101Trace());
    const filtered = applyRowFilters(rows, { sourceType: "MONTHLY_PLAN" });
    assert.equal(filtered.length, 2);
    assert.ok(filtered.every((r) => r.demandSourceType === "MONTHLY_PLAN"));
  });

  it("deriveReceiptStatus boundaries", () => {
    assert.equal(deriveReceiptStatus(100, 0, 100), RECEIPT_STATUSES.PENDING_RECEIPT);
    assert.equal(deriveReceiptStatus(100, 40, 60), RECEIPT_STATUSES.PARTIALLY_RECEIVED);
    assert.equal(deriveReceiptStatus(100, 100, 0), RECEIPT_STATUSES.RECEIVED);
  });
});
