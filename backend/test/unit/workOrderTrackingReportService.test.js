const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  FLOW,
  parseWorkOrderTrackingQuery,
  computeNoQtyActiveProductionPending,
  computeNoQtyActiveDispatchPending,
  computeNoQtyCycleFgDispatchPendingByItem,
  deriveNoQtyTrackingStatus,
  formatRecoveryCarryForwardOutcome,
  resolveNoQtyCustomerDemand,
  buildRegularTrackingRows,
  buildNoQtyTrackingRows,
  filterLinesForFlow,
  filterActiveOnly,
} = require("../../src/services/workOrderTrackingReportService");

function pe(produced, accepted, rejected) {
  return {
    workflowStatus: "APPROVED",
    producedQty: produced,
    qcEntries: [
      { acceptedQty: accepted, rejectedQty: rejected, reversedAt: null },
    ],
  };
}

function regularLine({
  id = 1,
  woId = 10,
  soId = 100,
  fgItemId = 5,
  qty = 100,
  plannedQty = 100,
  produced = 40,
  accepted = 30,
  rejected = 0,
  woStatus = "IN_PROGRESS",
  soLines = [{ itemId: 5, qty: 100 }],
  dispatch = [{ itemId: 5, dispatchedQty: 10, workflowStatus: "LOCKED", reversalOfId: null }],
} = {}) {
  return {
    id,
    fgItemId,
    qty,
    plannedQty,
    fgItem: { itemName: "FG-A" },
    productions: [pe(produced, accepted, rejected)],
    workOrder: {
      id: woId,
      docNo: `WO-${woId}`,
      status: woStatus,
      createdAt: new Date("2026-07-01"),
      salesOrderId: soId,
      salesOrder: {
        id: soId,
        docNo: `SO-${soId}`,
        orderType: "NORMAL",
        createdAt: new Date("2026-06-01"),
        customer: { name: "Acme" },
        lines: soLines,
        dispatch,
      },
    },
  };
}

function noQtyLine({
  id = 1,
  woId = 20,
  soId = 242,
  fgItemId = 5,
  qty = 100,
  plannedQty = 100,
  produced = 60,
  accepted = 60,
  rejected = 0,
  woStatus = "IN_PROGRESS",
  execStatus = "IN_PROGRESS",
  soInternal = "IN_PROCESS",
  cycleStatus = "ACTIVE",
  cycleNo = 1,
  cycleId = 50,
  baseDemand = 80,
  rsStatus = "LOCKED",
  dispatch = [],
  suggestedCap = 100,
} = {}) {
  return {
    id,
    fgItemId,
    qty,
    plannedQty,
    fgItem: { itemName: "FG-NQ" },
    productions: [pe(produced, accepted, rejected)],
    workOrder: {
      id: woId,
      docNo: `WO-${woId}`,
      status: woStatus,
      createdAt: new Date("2026-07-01"),
      salesOrderId: soId,
      cycleId,
      productionExecution: { executionStatus: execStatus },
      cycle: { id: cycleId, cycleNo, status: cycleStatus },
      requirementSheet: {
        id: 9,
        docNo: "RS-9",
        status: rsStatus,
        lines: [
          {
            itemId: fgItemId,
            baseDemandQty: baseDemand,
            requirementQty: baseDemand,
            suggestedWoQtySnapshot: suggestedCap,
          },
        ],
      },
      salesOrder: {
        id: soId,
        docNo: `SO-${soId}`,
        orderType: "NO_QTY",
        internalStatus: soInternal,
        createdAt: new Date("2026-06-01"),
        customer: { name: "NoQty Co" },
        lines: [{ itemId: fgItemId, qty: 0 }],
        dispatch,
      },
    },
  };
}

describe("workOrderTrackingReportService — query & flow", () => {
  it("requires flow REGULAR or NO_QTY", () => {
    assert.throws(() => parseWorkOrderTrackingQuery({}), /flow/);
    assert.deepEqual(parseWorkOrderTrackingQuery({ flow: "REGULAR" }), { flow: "REGULAR", includeClosed: false });
    assert.equal(parseWorkOrderTrackingQuery({ flow: "NO_QTY", includeClosed: "true" }).includeClosed, true);
  });

  it("never mixes flows in filterLinesForFlow", () => {
    const mixed = [regularLine(), noQtyLine()];
    assert.equal(filterLinesForFlow(mixed, FLOW.REGULAR).length, 1);
    assert.equal(filterLinesForFlow(mixed, FLOW.NO_QTY).length, 1);
  });
});

describe("REGULAR flow", () => {
  it("open Regular WO shows production pending from required − produced", () => {
    const rows = buildRegularTrackingRows([regularLine({ produced: 40, accepted: 30 })]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].orderedQty, 100);
    assert.equal(rows[0].productionPendingQty, 60);
    assert.equal(rows[0].status, "IN_PRODUCTION");
  });

  it("completed Regular WO has zero pending and COMPLETED status", () => {
    const rows = buildRegularTrackingRows([
      regularLine({
        qty: 50,
        plannedQty: 50,
        produced: 50,
        accepted: 50,
        rejected: 0,
        woStatus: "COMPLETED",
        dispatch: [{ itemId: 5, dispatchedQty: 50, workflowStatus: "LOCKED", reversalOfId: null }],
      }),
    ]);
    assert.equal(rows[0].productionPendingQty, 0);
    assert.equal(rows[0].qcPendingQty, 0);
    assert.equal(rows[0].dispatchPendingQty, 0);
    assert.equal(rows[0].status, "COMPLETED");
  });

  it("Active Only hides operationally closed Regular WOs", () => {
    const lines = [
      regularLine({ id: 1, woStatus: "IN_PROGRESS" }),
      regularLine({ id: 2, woId: 11, woStatus: "COMPLETED", produced: 100, accepted: 100 }),
    ];
    const active = filterActiveOnly(lines, FLOW.REGULAR, false);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, 1);
    assert.equal(filterActiveOnly(lines, FLOW.REGULAR, true).length, 2);
  });
});

describe("NO_QTY flow — pending & status", () => {
  it("Customer Demand uses locked RS baseDemandQty, not WO/planned/recovery", () => {
    const demand = resolveNoQtyCustomerDemand(
      {
        status: "LOCKED",
        lines: [
          {
            itemId: 5,
            baseDemandQty: 80,
            requirementQty: 80,
            totalRsQty: 120,
            qcRejectionRecoveryQty: 40,
            suggestedWoQtySnapshot: 100,
          },
        ],
      },
      5,
    );
    assert.equal(demand, 80);
  });

  it("active NO_QTY WO keeps Active Production Pending when execution open", () => {
    const pending = computeNoQtyActiveProductionPending({
      soClosed: false,
      cycleClosed: false,
      workOrderStatus: "IN_PROGRESS",
      executionStatus: "IN_PROGRESS",
      plannedQty: 100,
      producedQty: 60,
    });
    assert.equal(pending, 40);
  });

  it("carried-forward shortage / execution COMPLETED zeros Active Production Pending", () => {
    assert.equal(
      computeNoQtyActiveProductionPending({
        soClosed: false,
        cycleClosed: false,
        workOrderStatus: "IN_PROGRESS",
        executionStatus: "COMPLETED",
        plannedQty: 100,
        producedQty: 60,
      }),
      0,
    );
    assert.equal(
      computeNoQtyActiveProductionPending({
        soClosed: false,
        cycleClosed: false,
        workOrderStatus: "CLOSED_WITH_SHORTFALL",
        executionStatus: "COMPLETED",
        plannedQty: 100,
        producedQty: 60,
      }),
      0,
    );
  });

  it("SHORTFALL_PENDING does not reopen production pending", () => {
    assert.equal(
      computeNoQtyActiveProductionPending({
        soClosed: false,
        cycleClosed: false,
        workOrderStatus: "IN_PROGRESS",
        executionStatus: "SHORTFALL_PENDING",
        plannedQty: 100,
        producedQty: 40,
      }),
      0,
    );
  });

  it("closed RS cycle and closed NO_QTY SO zero active pendings and COMPLETED status", () => {
    assert.equal(
      computeNoQtyActiveProductionPending({
        soClosed: true,
        cycleClosed: false,
        workOrderStatus: "IN_PROGRESS",
        executionStatus: "IN_PROGRESS",
        plannedQty: 100,
        producedQty: 40,
      }),
      0,
    );
    assert.equal(
      computeNoQtyActiveDispatchPending({ soClosed: false, cycleClosed: true, cycleFgDispatchPendingQty: 25 }),
      0,
    );
    assert.equal(
      deriveNoQtyTrackingStatus({
        soClosed: true,
        cycleClosed: false,
        workOrderStatus: "IN_PROGRESS",
        executionStatus: "IN_PROGRESS",
        activeProductionPending: 0,
        qcPendingQty: 0,
        activeDispatchPending: 0,
        producedQty: 40,
        acceptedQty: 40,
        rejectedQty: 0,
        dispatchedQty: 0,
      }),
      "COMPLETED",
    );
  });

  it("Recovery Keep / Waive outcome labels", () => {
    const keep = formatRecoveryCarryForwardOutcome(
      {
        recoverySummary: {
          sources: [
            {
              itemId: 5,
              recoveryType: "PRODUCTION_SHORTFALL",
              recoveryStatus: "ALLOCATED",
              activeAllocatedQty: 12,
              waivedQty: 0,
            },
          ],
        },
      },
      5,
    );
    assert.match(keep, /KEEP|carry-forward/i);

    const waive = formatRecoveryCarryForwardOutcome(
      {
        recoverySummary: {
          sources: [
            {
              itemId: 5,
              recoveryType: "PRODUCTION_SHORTFALL",
              recoveryStatus: "WAIVED",
              activeAllocatedQty: 0,
              waivedQty: 20,
            },
          ],
        },
      },
      5,
    );
    assert.match(waive, /WAIVE/i);
  });

  it("dispatch at SO+item does not invent WO FIFO pending — uses cycle FG remaining", () => {
    const caps = new Map([[5, 100]]);
    const pendingByItem = computeNoQtyCycleFgDispatchPendingByItem(caps, [
      { itemId: 5, dispatchedQty: 70, workflowStatus: "LOCKED", reversalOfId: null },
    ]);
    assert.equal(pendingByItem.get(5), 30);

    const rows = buildNoQtyTrackingRows([noQtyLine({ produced: 100, accepted: 100, plannedQty: 100, qty: 100 })], {
      cycleFgPendingByKey: new Map([["242:50:5", 30]]),
      cycleFgDispatchedByKey: new Map([["242:50:5", 70]]),
    });
    assert.equal(rows[0].activeDispatchPendingQty, 30);
    // Accepted 100 with only 70 dispatched would be 30 via false WO FIFO — same number here by coincidence;
    // prove FIFO is not used by setting accepted lower than cycle remaining would imply:
    const rows2 = buildNoQtyTrackingRows(
      [noQtyLine({ produced: 40, accepted: 40, plannedQty: 100, qty: 100, execStatus: "COMPLETED" })],
      {
        cycleFgPendingByKey: new Map([["242:50:5", 30]]),
        cycleFgDispatchedByKey: new Map([["242:50:5", 70]]),
      },
    );
    // Active production 0 (execution COMPLETED); dispatch pending remains SO+FG 30, not max(0,40-70)=0 from WO math
    assert.equal(rows2[0].activeProductionPendingQty, 0);
    assert.equal(rows2[0].activeDispatchPendingQty, 30);
  });

  it("multiple WOs same FG share Customer Demand and SO+FG Active Dispatch Pending", () => {
    const a = noQtyLine({ id: 1, woId: 20, produced: 50, accepted: 50 });
    const b = noQtyLine({ id: 2, woId: 21, produced: 30, accepted: 30 });
    const rows = buildNoQtyTrackingRows([a, b], {
      cycleFgPendingByKey: new Map([
        ["242:50:5", 20],
      ]),
      cycleFgDispatchedByKey: new Map([
        ["242:50:5", 80],
      ]),
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].customerDemandQty, 80);
    assert.equal(rows[1].customerDemandQty, 80);
    assert.equal(rows[0].activeDispatchPendingQty, 20);
    assert.equal(rows[1].activeDispatchPendingQty, 20);
  });

  it("Active Only excludes closed SO / closed cycle; Include Closed keeps them", () => {
    const active = noQtyLine({ soInternal: "IN_PROCESS", cycleStatus: "ACTIVE", execStatus: "IN_PROGRESS" });
    const closedSo = noQtyLine({
      id: 2,
      woId: 21,
      soId: 243,
      cycleId: 51,
      soInternal: "CLOSED_WITH_WAIVER",
      cycleStatus: "CLOSED",
      execStatus: "COMPLETED",
    });
    const closedCycle = noQtyLine({
      id: 3,
      woId: 22,
      soId: 244,
      cycleId: 52,
      soInternal: "IN_PROCESS",
      cycleStatus: "CLOSED",
      execStatus: "COMPLETED",
    });
    const lines = [active, closedSo, closedCycle];
    assert.equal(filterActiveOnly(lines, FLOW.NO_QTY, false).length, 1);
    assert.equal(filterActiveOnly(lines, FLOW.NO_QTY, true).length, 3);
  });

  it("closed NO_QTY SO row builder zeros active pending even if Planned > Produced", () => {
    const rows = buildNoQtyTrackingRows(
      [
        noQtyLine({
          soInternal: "COMPLETED",
          cycleStatus: "CLOSED",
          execStatus: "COMPLETED",
          plannedQty: 100,
          produced: 55,
          accepted: 55,
        }),
      ],
      {
        cycleFgPendingByKey: new Map([["242:50:5", 99]]),
        cycleFgDispatchedByKey: new Map([["242:50:5", 1]]),
      },
    );
    assert.equal(rows[0].activeProductionPendingQty, 0);
    assert.equal(rows[0].activeDispatchPendingQty, 0);
    assert.equal(rows[0].status, "COMPLETED");
    assert.equal(rows[0].orderedQty, null);
    assert.equal(rows[0].customerDemandQty, 80);
  });
});
