const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildWorkOrderProductionReport,
  confirmProductionWorkOrderReport,
  sumQcForProduction,
} = require("../../src/services/productionWorkOrderReportService");

describe("productionWorkOrderReportService", () => {
  it("sumQcForProduction computes accepted, rejected, and pending", () => {
    const qc = sumQcForProduction({
      producedQty: 100,
      qcEntries: [
        { acceptedQty: 60, rejectedQty: 10 },
        { acceptedQty: 20, rejectedQty: 0 },
      ],
    });
    assert.equal(qc.acceptedQty, 80);
    assert.equal(qc.rejectedQty, 10);
    assert.equal(qc.pendingQcQty, 10);
  });

  it("buildWorkOrderProductionReport returns issued vs consumed RM values", async () => {
    const returnPath = require.resolve("../../src/services/materialReturnService");
    const reportPath = require.resolve("../../src/services/productionWorkOrderReportService");
    const origReturn = require(returnPath).buildReturnableLinesForWorkOrder;
    require(returnPath).buildReturnableLinesForWorkOrder = async () => ({
      lines: [
        {
          itemId: 7,
          itemName: "PP",
          unit: "Kg",
          grossIssuedQty: 12,
          consumedQty: 10.5,
          returnedQty: 0,
          returnableQty: 1.5,
          unusedQty: 1.5,
        },
      ],
    });
    delete require.cache[reportPath];
    const { buildWorkOrderProductionReport: buildReport } = require(reportPath);

    const db = {
      workOrder: {
        findUnique: async () => ({
          id: 10,
          docNo: "WO-10",
          status: "IN_PROGRESS",
          lines: [
            {
              id: 100,
              fgItemId: 5,
              qty: 50,
              plannedQty: 50,
              fgItem: { id: 5, itemName: "Widget", unit: "Nos" },
            },
          ],
          salesOrder: {
            id: 1,
            docNo: "SO-1",
            orderType: "NORMAL",
            customer: { name: "Acme" },
          },
          requirementSheet: null,
          cycle: null,
          productionExecution: null,
        }),
      },
      productionEntry: {
        findMany: async () => [
          {
            id: 200,
            docNo: "PE-200",
            date: new Date("2026-05-01"),
            producedQty: 50,
            workOrderLine: {
              id: 100,
              fgItemId: 5,
              fgItem: { id: 5, itemName: "Widget", unit: "Nos" },
            },
            qcEntries: [{ acceptedQty: 50, rejectedQty: 0 }],
            rmConsumptions: [
              {
                itemId: 7,
                standardQty: 10,
                actualQty: 10.5,
                varianceQty: 0.5,
                variancePercent: 5,
                consumptionType: "NORMAL",
                remarks: null,
                item: { id: 7, itemName: "PP", unit: "Kg" },
              },
            ],
          },
        ],
        groupBy: async () => [{ workOrderLineId: 100, _sum: { producedQty: 50 } }],
      },
      auditLog: { findMany: async () => [{ entityId: "200", actor: { name: "Operator" } }] },
    };

    try {
      const report = await buildReport(db, 10);
      assert.equal(report.hasApprovedProduction, true);
      assert.equal(report.batches.length, 1);
      assert.equal(report.batches[0].approvedByName, "Operator");
      assert.equal(report.rmLines.length, 1);
      assert.equal(report.rmLines[0].issuedQty, 12);
      assert.equal(report.rmLines[0].reportedConsumedQty, 10.5);
      assert.equal(report.rmLines[0].varianceQty, 0.5);
    } finally {
      require(returnPath).buildReturnableLinesForWorkOrder = origReturn;
      delete require.cache[reportPath];
    }
  });

  it("completed production still exposes report after QA handoff", async () => {
    const db = {
      workOrder: {
        findUnique: async () => ({
          id: 11,
          docNo: "WO-11",
          status: "COMPLETED",
          lines: [
            {
              id: 101,
              fgItemId: 5,
              qty: 20,
              plannedQty: 20,
              fgItem: { id: 5, itemName: "Widget", unit: "Nos" },
            },
          ],
          salesOrder: { id: 2, docNo: "SO-2", orderType: "NORMAL", customer: { name: "Beta" } },
          requirementSheet: null,
          cycle: null,
          productionExecution: {
            executionStatus: "COMPLETED",
            blockReason: null,
            blockRemarks: null,
            blockedAt: null,
            blockedBy: null,
            completedAt: new Date("2026-05-02"),
            completedBy: { name: "Lead" },
            createdAt: new Date("2026-05-01"),
            updatedAt: new Date("2026-05-02"),
          },
        }),
      },
      productionEntry: {
        findMany: async () => [
          {
            id: 201,
            docNo: "PE-201",
            date: new Date("2026-05-01"),
            producedQty: 20,
            workOrderLine: {
              id: 101,
              fgItemId: 5,
              fgItem: { id: 5, itemName: "Widget", unit: "Nos" },
            },
            qcEntries: [{ acceptedQty: 20, rejectedQty: 0 }],
            rmConsumptions: [],
          },
        ],
        groupBy: async () => [{ workOrderLineId: 101, _sum: { producedQty: 20 } }],
      },
      auditLog: { findMany: async () => [] },
    };

    const orig = require("../../src/services/materialReturnService").buildReturnableLinesForWorkOrder;
    require("../../src/services/materialReturnService").buildReturnableLinesForWorkOrder = async () => ({
      lines: [],
    });

    try {
      const report = await buildWorkOrderProductionReport(db, 11);
      assert.equal(report.workOrderStatus, "COMPLETED");
      assert.equal(report.batches[0].acceptedQty, 20);
      assert.equal(report.batches[0].pendingQcQty, 0);
      assert.equal(report.summary.producedQty, 20);
    } finally {
      require("../../src/services/materialReturnService").buildReturnableLinesForWorkOrder = orig;
    }
  });

  it("does not duplicate batch rows for the same production entry", async () => {
    const db = {
      workOrder: {
        findUnique: async () => ({
          id: 12,
          docNo: "WO-12",
          status: "IN_PROGRESS",
          lines: [{ id: 102, fgItemId: 5, qty: 10, plannedQty: 10, fgItem: { id: 5, itemName: "W", unit: "Nos" } }],
          salesOrder: { id: 3, docNo: "SO-3", orderType: "NORMAL", customer: null },
          requirementSheet: null,
          cycle: null,
          productionExecution: null,
        }),
      },
      productionEntry: {
        findMany: async () => [
          {
            id: 300,
            docNo: "PE-300",
            date: new Date(),
            producedQty: 10,
            workOrderLine: { id: 102, fgItemId: 5, fgItem: { id: 5, itemName: "W", unit: "Nos" } },
            qcEntries: [],
            rmConsumptions: [],
          },
        ],
        groupBy: async () => [{ workOrderLineId: 102, _sum: { producedQty: 10 } }],
      },
      auditLog: { findMany: async () => [] },
    };

    const orig = require("../../src/services/materialReturnService").buildReturnableLinesForWorkOrder;
    require("../../src/services/materialReturnService").buildReturnableLinesForWorkOrder = async () => ({
      lines: [],
    });

    try {
      const report = await buildWorkOrderProductionReport(db, 12);
      assert.equal(report.batches.length, 1);
      assert.equal(new Set(report.batches.map((b) => b.productionEntryId)).size, 1);
    } finally {
      require("../../src/services/materialReturnService").buildReturnableLinesForWorkOrder = orig;
    }
  });

  it("confirmProductionWorkOrderReport creates Store pending return without posting stock", async () => {
    const returnPath = require.resolve("../../src/services/materialReturnService");
    const reportPath = require.resolve("../../src/services/productionWorkOrderReportService");
    const origReturn = require(returnPath).buildReturnableLinesForWorkOrder;
    require(returnPath).buildReturnableLinesForWorkOrder = async () => ({
      lines: [
        {
          itemId: 7,
          itemName: "PP",
          unit: "Kg",
          grossIssuedQty: 12,
          consumedQty: 8,
          returnedQty: 0,
          returnableQty: 4,
          unusedQty: 4,
        },
      ],
    });
    delete require.cache[reportPath];
    const { confirmProductionWorkOrderReport: confirmReport } = require(reportPath);

    const createdReports = [];
    const pendingReturns = [];
    const stockTransactions = [];
    const db = {
      workOrder: {
        findUnique: async () => ({
          id: 15,
          docNo: "WO-26-0001",
          status: "IN_PROGRESS",
          lines: [{ id: 150, fgItemId: 5, qty: 10, plannedQty: 10, fgItem: { id: 5, itemName: "FG", unit: "Nos" } }],
          salesOrder: { id: 1, docNo: "SO-1", orderType: "NORMAL", customer: { name: "Acme" } },
          requirementSheet: null,
          cycle: null,
          productionExecution: null,
        }),
        update: async ({ data }) => ({ id: 15, ...data }),
      },
      productionEntry: {
        findMany: async () => [
          {
            id: 501,
            docNo: "PE-501",
            date: new Date("2026-06-01"),
            producedQty: 10,
            workOrderLine: { id: 150, fgItemId: 5, fgItem: { id: 5, itemName: "FG", unit: "Nos" } },
            qcEntries: [],
            rmConsumptions: [
              {
                itemId: 7,
                standardQty: 8,
                actualQty: 8,
                varianceQty: 0,
                variancePercent: 0,
                consumptionType: "NORMAL",
                remarks: null,
                item: { id: 7, itemName: "PP", unit: "Kg" },
              },
            ],
          },
        ],
        groupBy: async () => [{ workOrderLineId: 150, _sum: { producedQty: 10 } }],
      },
      productionWorkOrderReport: {
        findUnique: async () => null,
        create: async ({ data }) => {
          const row = { id: 701, ...data };
          createdReports.push(row);
          return row;
        },
      },
      productionRmReturnPending: {
        create: async ({ data }) => {
          const row = { id: pendingReturns.length + 1, ...data };
          pendingReturns.push(row);
          return row;
        },
      },
      stockTransaction: {
        create: async ({ data }) => {
          stockTransactions.push(data);
          return data;
        },
      },
      auditLog: { findMany: async () => [], create: async () => ({ id: 1 }) },
    };

    try {
      const result = await confirmReport(
        db,
        15,
        { lines: [{ itemId: 7, rmConsumedQty: 8, rmReturnQty: 4, scrapWasteQty: 0 }] },
        { userId: 9, role: "PRODUCTION" },
      );
      assert.equal(createdReports.length, 1);
      assert.equal(createdReports[0].workOrderId, 15);
      assert.equal(pendingReturns.length, 1);
      assert.equal(Number(pendingReturns[0].requestedQty), 4);
      assert.equal(pendingReturns[0].status, "PENDING");
      assert.equal(stockTransactions.length, 0);
      assert.equal(result.returnPendingCount, 1);
    } finally {
      require(returnPath).buildReturnableLinesForWorkOrder = origReturn;
      delete require.cache[reportPath];
    }
  });
});
