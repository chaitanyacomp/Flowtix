const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateRegularSoProcurementDemandState,
  reconcileRegularSoResidualMaterialRequirements,
} = require("../../src/services/regularSoProcurementDemandService");

function regularSo({ ordered = 10000, accepted = 0, woStatus = "COMPLETED", woQty = 10050 } = {}) {
  return {
    id: 1,
    orderType: "NORMAL",
    lines: [{ id: 10, itemId: 20, customerPoQty: ordered, item: { itemType: "FG" } }],
    dispatch: [],
    workOrders: [{
      id: 30,
      status: woStatus,
      lines: [{
        fgItemId: 20,
        qty: woQty,
        productions: [{
          workflowStatus: "APPROVED",
          qcEntries: accepted ? [{ acceptedQty: accepted, reversedAt: null }] : [],
        }],
      }],
    }],
  };
}

function reconciliationDb(so, materialRequirements) {
  const updates = [];
  return {
    updates,
    salesOrder: { findUnique: async () => so },
    materialRequirement: {
      findMany: async () => materialRequirements,
      update: async (args) => {
        updates.push(args);
        return args;
      },
    },
  };
}

test("customer demand fulfilled before PR creation closes unconverted residual MR", async () => {
  const db = reconciliationDb(regularSo({ accepted: 10005 }), [{
    id: 41,
    lines: [{ procurementLinks: [], purchaseRequestSourceLinks: [] }],
  }]);
  const out = await reconcileRegularSoResidualMaterialRequirements(db, 1);
  assert.deepEqual(out.closedMaterialRequirementIds, [41]);
  assert.equal(db.updates[0].data.status, "CLOSED");
  assert.match(db.updates[0].data.approvalRemarks, /customer quantity is covered/i);
});

test("production above customer demand does not retain buffered procurement", () => {
  const state = calculateRegularSoProcurementDemandState(regularSo({ accepted: 10005, woQty: 10050 }));
  assert.equal(state.hasGenuineDemand, false);
  assert.equal(state.lines[0].outstandingCustomerQty, 0);
});

test("genuine unfulfilled customer demand retains procurement", () => {
  const state = calculateRegularSoProcurementDemandState(regularSo({ accepted: 6000 }));
  assert.equal(state.hasGenuineDemand, true);
  assert.equal(state.lines[0].genuineProductionDemandQty, 4000);
});

test("existing PR or PO is not silently cancelled and is marked for review", async () => {
  const db = reconciliationDb(regularSo({ accepted: 10000 }), [{
    id: 42,
    lines: [{
      procurementLinks: [],
      purchaseRequestSourceLinks: [{
        purchaseRequestLine: {
          purchaseRequest: { status: "PENDING_PURCHASE" },
          poLinks: [],
        },
      }],
    }],
  }]);
  const out = await reconcileRegularSoResidualMaterialRequirements(db, 1);
  assert.deepEqual(out.reviewRequiredMaterialRequirementIds, [42]);
  assert.equal(db.updates.length, 0);
});

test("another active WO preserves procurement while genuine customer demand remains", () => {
  const so = regularSo({ accepted: 7000, woStatus: "IN_PROGRESS", woQty: 3000 });
  const state = calculateRegularSoProcurementDemandState(so);
  assert.equal(state.hasGenuineDemand, true);
  assert.equal(state.lines[0].activeWoPlannedQty, 3000);
  assert.equal(state.lines[0].genuineProductionDemandQty, 3000);
});

test("NO_QTY procurement behavior is unchanged", () => {
  const so = regularSo({ accepted: 10000 });
  so.orderType = "NO_QTY";
  const state = calculateRegularSoProcurementDemandState(so);
  assert.equal(state.applies, false);
  assert.equal(state.hasGenuineDemand, true);
});
