const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  assembleRmPoProcurementTrace,
  buildRmPoProcurementTrace,
  buildDemandSourcesForPoLine,
} = require("../../src/services/procurementTraceService");

function mrRequirement(overrides = {}) {
  return {
    id: overrides.id ?? 2,
    docNo: overrides.docNo ?? "MR-26-0002",
    sourceType: overrides.sourceType ?? "MONTHLY_PLAN",
    sourceRevision: overrides.sourceRevision ?? 3,
    quotation: overrides.quotation ?? null,
    salesOrder: overrides.salesOrder ?? null,
    workOrder: overrides.workOrder ?? null,
    monthlyProductionPlan: overrides.monthlyProductionPlan ?? {
      id: 50,
      docNo: "MPP-2026-05",
      periodKey: "2026-05",
      currentRevision: 3,
    },
  };
}

function poLineBase(overrides = {}) {
  return {
    id: overrides.id ?? 10,
    qty: overrides.qty ?? 100,
    rate: overrides.rate ?? 50,
    item: overrides.item ?? { id: 1, itemName: "RM Steel", unit: "KG", itemType: "RM", hsn: "7208" },
    procurementLinks: overrides.procurementLinks ?? [],
  };
}

function poRowBase(overrides = {}) {
  return {
    id: overrides.id ?? 101,
    status: overrides.status ?? "PENDING",
    supplierId: 5,
    supplierLocationId: null,
    remarks: null,
    createdAt: new Date("2026-05-01"),
    updatedAt: new Date("2026-05-02"),
    supplier: {
      id: 5,
      name: "Acme Metals",
      gstin: "29AAAAA0000A1Z5",
      address: "Industrial Area",
      stateRef: { stateName: "Karnataka", stateCode: "29" },
    },
    supplierLocation: null,
    lines: overrides.lines ?? [poLineBase()],
    grns: overrides.grns ?? [],
  };
}

function singleMrPrLink() {
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

describe("procurementTraceService — demand source assembly", () => {
  it("PO with one MR/PR source", () => {
    const poLine = poLineBase({ procurementLinks: singleMrPrLink() });
    const { demandSources, mrSources, prSources } = buildDemandSourcesForPoLine(poLine);

    assert.equal(demandSources.length, 1);
    assert.equal(demandSources[0].demandSourceType, "MONTHLY_PLAN");
    assert.equal(demandSources[0].monthlyPlanRevision, 3);
    assert.equal(demandSources[0].mr.docNo, "MR-26-0002");
    assert.equal(demandSources[0].pr.docNo, "PR-26-0002");
    assert.equal(mrSources.length, 1);
    assert.equal(prSources.length, 1);
  });

  it("PO line with multiple MR sources via one PR line", () => {
    const mrLineA = { id: 201, materialRequirement: mrRequirement({ id: 2, docNo: "MR-26-0002" }) };
    const mrLineB = {
      id: 202,
      materialRequirement: mrRequirement({
        id: 3,
        docNo: "MR-26-0003",
        sourceType: "WORK_ORDER_PLANNING",
        sourceRevision: null,
        workOrder: { id: 7, docNo: "WO-7" },
        salesOrder: { id: 8, docNo: "SO-8" },
        monthlyProductionPlan: null,
      }),
    };
    const poLine = poLineBase({
      procurementLinks: [
        {
          id: 1,
          allocatedQty: 60,
          purchaseRequestLine: {
            id: 301,
            purchaseRequest: { id: 30, docNo: "PR-26-0002", status: "PENDING_PURCHASE" },
            sourceLinks: [
              { id: 401, allocatedQty: 40, materialRequirementLine: mrLineA },
              { id: 402, allocatedQty: 20, materialRequirementLine: mrLineB },
            ],
          },
          materialRequirementLine: null,
        },
      ],
    });

    const { demandSources, mrSources } = buildDemandSourcesForPoLine(poLine);
    assert.equal(demandSources.length, 2);
    assert.equal(mrSources.length, 2);
    assert.deepEqual(
      mrSources.map((m) => m.docNo).sort(),
      ["MR-26-0002", "MR-26-0003"],
    );
    const woSource = demandSources.find((d) => d.workOrder?.docNo === "WO-7");
    assert.ok(woSource);
    assert.equal(woSource.salesOrder.docNo, "SO-8");
  });
});

describe("procurementTraceService — line trace assembly", () => {
  it("partial GRN leaves pending qty", () => {
    const trace = assembleRmPoProcurementTrace(
      poRowBase({
        lines: [poLineBase({ procurementLinks: singleMrPrLink(), qty: 100 })],
        grns: [
          {
            id: 5,
            supplierInvoiceNo: "INV-1",
            date: new Date("2026-05-10"),
            reversedAt: null,
            billingStatus: "PENDING",
            lines: [{ id: 501, grnId: 5, rmPoLineId: 10, receivedQty: 40, rateSnapshot: 50, location: null }],
          },
        ],
      }),
      [],
      [],
    );

    assert.equal(trace.lines[0].orderedQty, 100);
    assert.equal(trace.lines[0].receivedQty, 40);
    assert.equal(trace.lines[0].pendingQty, 60);
    assert.equal(trace.lines[0].grnLines.length, 1);
    assert.equal(trace.lines[0].grnLines[0].receivedQty, 40);
  });

  it("multiple GRNs aggregate received qty per PO line", () => {
    const trace = assembleRmPoProcurementTrace(
      poRowBase({
        lines: [poLineBase({ procurementLinks: singleMrPrLink(), qty: 100 })],
        grns: [
          {
            id: 5,
            supplierInvoiceNo: "INV-1",
            date: new Date("2026-05-10"),
            reversedAt: null,
            billingStatus: "PENDING",
            lines: [{ id: 501, grnId: 5, rmPoLineId: 10, receivedQty: 30, rateSnapshot: 50, location: null }],
          },
          {
            id: 6,
            supplierInvoiceNo: "INV-2",
            date: new Date("2026-05-12"),
            reversedAt: null,
            billingStatus: "PENDING",
            lines: [{ id: 601, grnId: 6, rmPoLineId: 10, receivedQty: 20, rateSnapshot: 50, location: null }],
          },
        ],
      }),
      [],
      [],
    );

    assert.equal(trace.lines[0].receivedQty, 50);
    assert.equal(trace.lines[0].pendingQty, 50);
    assert.equal(trace.lines[0].grnLines.length, 2);
    assert.equal(trace.grns.length, 2);
  });

  it("GRN stock transaction linkage", () => {
    const trace = assembleRmPoProcurementTrace(
      poRowBase({
        lines: [poLineBase({ procurementLinks: singleMrPrLink() })],
        grns: [
          {
            id: 5,
            supplierInvoiceNo: "INV-1",
            date: new Date("2026-05-10"),
            reversedAt: null,
            billingStatus: "PENDING",
            lines: [{ id: 501, grnId: 5, rmPoLineId: 10, receivedQty: 40, rateSnapshot: 50, location: null }],
          },
        ],
      }),
      [
        {
          id: 9001,
          itemId: 1,
          locationId: 3,
          transactionType: "GRN",
          refId: 501,
          stockBucket: "USABLE",
          qtyIn: 40,
          qtyOut: 0,
          date: new Date("2026-05-10"),
          reversedAt: null,
        },
      ],
      [],
    );

    assert.equal(trace.lines[0].stockTransactions.length, 1);
    assert.equal(trace.lines[0].grnLines[0].stockTransactions[0].id, 9001);
    assert.equal(trace.lines[0].grnLines[0].stockTransactions[0].qtyIn, 40);
    assert.ok(trace.lines[0].traceChain.includes("StockTransaction IN"));
  });

  it("purchase bill linkage at GRN line level", () => {
    const trace = assembleRmPoProcurementTrace(
      poRowBase({
        lines: [poLineBase({ procurementLinks: singleMrPrLink() })],
        grns: [
          {
            id: 5,
            supplierInvoiceNo: "INV-1",
            date: new Date("2026-05-10"),
            reversedAt: null,
            billingStatus: "PARTIAL",
            lines: [{ id: 501, grnId: 5, rmPoLineId: 10, receivedQty: 40, rateSnapshot: 50, location: null }],
          },
        ],
      }),
      [],
      [
        {
          id: 7001,
          purchaseBillId: 70,
          grnId: 5,
          grnLineId: 501,
          rmPoId: 101,
          rmPoLineId: 10,
          itemId: 1,
          qty: 40,
          rate: 50,
          lineTotal: 2000,
          purchaseBill: { id: 70, billNo: "PB-70", status: "FINALIZED", billDate: new Date("2026-05-11") },
        },
      ],
    );

    assert.equal(trace.lines[0].purchaseBillLines.length, 1);
    assert.equal(trace.lines[0].grnLines[0].purchaseBillLines[0].purchaseBill.billNo, "PB-70");
    assert.ok(trace.lines[0].traceChain.some((l) => l.includes("Purchase Bill")));
  });

  it("missing bill returns empty bill arrays", () => {
    const trace = assembleRmPoProcurementTrace(
      poRowBase({
        lines: [poLineBase({ procurementLinks: singleMrPrLink() })],
        grns: [
          {
            id: 5,
            supplierInvoiceNo: "INV-1",
            date: new Date("2026-05-10"),
            reversedAt: null,
            billingStatus: "PENDING",
            lines: [{ id: 501, grnId: 5, rmPoLineId: 10, receivedQty: 40, rateSnapshot: 50, location: null }],
          },
        ],
      }),
      [],
      [],
    );

    assert.deepEqual(trace.lines[0].purchaseBillLines, []);
    assert.deepEqual(trace.lines[0].grnLines[0].purchaseBillLines, []);
  });

  it("missing stock transaction returns empty stock arrays", () => {
    const trace = assembleRmPoProcurementTrace(
      poRowBase({
        lines: [poLineBase({ procurementLinks: singleMrPrLink() })],
        grns: [
          {
            id: 5,
            supplierInvoiceNo: "INV-1",
            date: new Date("2026-05-10"),
            reversedAt: null,
            billingStatus: "PENDING",
            lines: [{ id: 501, grnId: 5, rmPoLineId: 10, receivedQty: 40, rateSnapshot: 50, location: null }],
          },
        ],
      }),
      [],
      [],
    );

    assert.deepEqual(trace.lines[0].stockTransactions, []);
    assert.deepEqual(trace.lines[0].grnLines[0].stockTransactions, []);
  });
});

describe("procurementTraceService — buildRmPoProcurementTrace read-only", () => {
  it("does not write to database (findMany/findUnique only)", async () => {
    const writes = [];
    const po = poRowBase({
      lines: [poLineBase({ procurementLinks: singleMrPrLink() })],
      grns: [
        {
          id: 5,
          supplierInvoiceNo: "INV-1",
          date: new Date("2026-05-10"),
          reversedAt: null,
          billingStatus: "PENDING",
          lines: [{ id: 501, grnId: 5, rmPoLineId: 10, receivedQty: 40, rateSnapshot: 50, location: null }],
        },
      ],
    });

    const mockDb = {
      rmPurchaseOrder: {
        findUnique: async () => po,
        update: async () => {
          writes.push("update");
          return po;
        },
        create: async () => {
          writes.push("create");
          return po;
        },
      },
      stockTransaction: {
        findMany: async () => [],
        create: async () => {
          writes.push("stock-create");
          return {};
        },
      },
      purchaseBillLine: {
        findMany: async () => [],
        create: async () => {
          writes.push("bill-create");
          return {};
        },
      },
      $transaction: async (fn) => {
        writes.push("transaction");
        return fn(mockDb);
      },
    };

    const trace = await buildRmPoProcurementTrace(mockDb, 101);
    assert.ok(trace);
    assert.equal(trace.rmPo.displayNo, "RMPO-101");
    assert.deepEqual(writes, []);
  });
});
