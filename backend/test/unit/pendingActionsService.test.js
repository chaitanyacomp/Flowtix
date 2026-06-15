const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  friendlyActionForNormalizedRow,
  mapNormalizedRowToPendingAction,
  resolveHrefForNormalizedRow,
  sortPendingActions,
  dedupePendingActionsByWorkOrder,
  dedupePendingActionsByProcurementCase,
  fetchPurchaseProcurementPendingActions,
  fetchStoreGrnPendingActions,
  PENDING_PRIORITY,
} = require("../../src/services/pendingActionsService");
const { PREPARE_RM_PO } = require("../../src/services/rmProcurementStageSignals");
const { normalizeNoQtyPlanningRow, normalizeRmRiskRow, VISIBLE_OWNERS } = require("../../src/services/controlTowerRowNormalizer");

describe("pendingActionsService", () => {
  it("maps NO_QTY planning row to Create RS Cycle action for Store", () => {
    const row = normalizeNoQtyPlanningRow({
      salesOrderId: 1,
      salesOrderDocNo: "SO-26-0001",
      cycleNo: 1,
      latestRequirementSheetStatus: null,
    });
    assert.equal(row.currentOwner, VISIBLE_OWNERS.STORE);
    const action = mapNormalizedRowToPendingAction(row);
    assert.equal(action.action, "Create RS Cycle 1");
    assert.equal(action.documentNo, "SO-26-0001");
    assert.equal(action.ownerRole, "STORE");
    assert.equal(action.href, "/sales-orders/1/requirement-sheets");
    assert.equal(action.priority, PENDING_PRIORITY.HIGH);
  });

  it("maps draft RS to Lock RS Cycle action", () => {
    const row = normalizeNoQtyPlanningRow({
      salesOrderId: 2,
      salesOrderDocNo: "SO-26-0002",
      cycleNo: 1,
      latestRequirementSheetDocNo: "RS-26-0001",
      latestRequirementSheetStatus: "DRAFT",
    });
    const action = mapNormalizedRowToPendingAction(row);
    assert.equal(action.action, "Lock RS Cycle 1");
    assert.equal(action.documentNo, "SO-26-0002");
  });

  it("sorts by priority then age descending", () => {
    const sorted = sortPendingActions([
      { priority: "LOW", ageHours: 10, documentNo: "B" },
      { priority: "HIGH", ageHours: 1, documentNo: "A" },
      { priority: "HIGH", ageHours: 5, documentNo: "C" },
    ]);
    assert.equal(sorted[0].documentNo, "C");
    assert.equal(sorted[1].documentNo, "A");
    assert.equal(sorted[2].documentNo, "B");
  });

  it("resolveHref uses metadata href when present", () => {
    const href = resolveHrefForNormalizedRow({
      rowType: "CONTINUE_WORKING",
      metadata: { href: "/dispatch?salesOrderId=5", salesOrderId: 5 },
    });
    assert.equal(href, "/dispatch?salesOrderId=5");
  });

  it("friendlyAction maps dispatch backlog to Dispatch Ready", () => {
    const label = friendlyActionForNormalizedRow({
      rowType: "DISPATCH_BACKLOG",
      currentStatus: "DISPATCH_PENDING",
      nextAction: "Dispatch FG",
    });
    assert.equal(label, "Dispatch Ready");
  });

  it("MPRS shortage with zero stock and no PR maps to Create Purchase Request", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 1,
      workOrderNo: "WO-26-0001",
      itemId: 10,
      queueType: "WAITING_PURCHASE_ACTION",
      freeStockQty: 0,
      netShortageAfterIncomingQty: 50,
      materialRequirementId: 99,
      sourceType: "MONTHLY_PLAN",
      prLineCount: 0,
      poLineCount: 0,
      operationalKey: "PROCUREMENT_PENDING",
      nextActionKey: "CREATE_PR",
      procurementDemandPool: "MPRS",
      hasOpenMr: true,
    });
    const action = mapNormalizedRowToPendingAction(row);
    assert.equal(action.action, "Create Purchase Request");
    assert.match(action.href, /demandPool=MPRS/);
    assert.match(action.href, /materialRequirementId=99/);
  });

  it("MPRS after PR with zero stock maps to waiting for Purchase for Store", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 1,
      workOrderNo: "WO-26-0001",
      itemId: 10,
      queueType: "WAITING_PURCHASE_ACTION",
      freeStockQty: 0,
      netShortageAfterIncomingQty: 50,
      materialRequirementId: 99,
      sourceType: "MONTHLY_PLAN",
      prLineCount: 1,
      poLineCount: 0,
      operationalKey: "PR_PENDING_PO",
      nextActionKey: "CREATE_PO",
      procurementDemandPool: "MPRS",
    });
    const action = mapNormalizedRowToPendingAction(row, "STORE");
    assert.equal(action.action, "Waiting for Purchase to prepare RM PO.");
    assert.match(action.href, /procurement-planning/);
    assert.match(action.href, /demandPool=MPRS/);
    assert.match(action.href, /materialRequirementId=99/);
    assert.doesNotMatch(action.href, /reports\/rm-shortage/);
  });

  it("MPRS after PR maps to Prepare RM PO for Purchase with correct href", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 1,
      workOrderNo: "WO-26-0001",
      itemId: 10,
      queueType: "WAITING_PURCHASE_ACTION",
      freeStockQty: 0,
      netShortageAfterIncomingQty: 50,
      materialRequirementId: 99,
      sourceType: "MONTHLY_PLAN",
      prLineCount: 1,
      poLineCount: 0,
      operationalKey: "PR_PENDING_PO",
      nextActionKey: "CREATE_PO",
      procurementDemandPool: "MPRS",
    });
    const action = mapNormalizedRowToPendingAction(row, "PURCHASE");
    assert.equal(action.action, PREPARE_RM_PO);
    assert.match(action.href, /demandPool=MPRS/);
    assert.match(action.href, /materialRequirementId=99/);
    assert.match(action.href, /returnTo=pending-actions/);
  });

  it("Regular SO after PR maps to Prepare RM PO with REGULAR_SO pool for Purchase", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 2,
      workOrderNo: "WO-26-0002",
      itemId: 11,
      queueType: "WAITING_PURCHASE_ACTION",
      materialRequirementId: 55,
      sourceType: "SALES_ORDER",
      prLineCount: 1,
      poLineCount: 0,
      operationalKey: "PR_PENDING_PO",
      nextActionKey: "CREATE_PO",
    });
    const action = mapNormalizedRowToPendingAction(row, "PURCHASE");
    assert.equal(action.action, PREPARE_RM_PO);
    assert.match(action.href, /demandPool=REGULAR_SO/);
    assert.match(action.href, /materialRequirementId=55/);
  });

  it("dedupes Purchase pending actions by MR + PR_PENDING_PO, preferring supplemental MR row", () => {
    const deduped = dedupePendingActionsByProcurementCase([
      {
        id: "rm-risk:wo:1:rm:10",
        priority: PENDING_PRIORITY.MEDIUM,
        action: "Waiting for Purchase to prepare RM PO.",
        documentNo: "WO-26-0001",
        ownerRole: "PURCHASE",
        ageHours: 2,
        href: "/procurement-planning?returnTo=pending-actions&demandPool=MPRS&materialRequirementId=99&workOrderId=1",
        currentStatus: "PR_PENDING_PO",
      },
      {
        id: "procurement:create-po:mr:99",
        priority: PENDING_PRIORITY.MEDIUM,
        action: PREPARE_RM_PO,
        documentNo: "MR-26-0001",
        ownerRole: "PURCHASE",
        ageHours: 1,
        href: "/procurement-planning?returnTo=pending-actions&demandPool=MPRS&materialRequirementId=99",
        currentStatus: "PR_PENDING_PO",
      },
    ]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].action, PREPARE_RM_PO);
    assert.equal(deduped[0].documentNo, "MR-26-0001");
    assert.equal(deduped[0].id, "procurement:create-po:mr:99");
  });

  it("RM ready queue maps to Material Issue Pending with material-issue href", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 2,
      workOrderNo: "WO-26-0002",
      itemId: 20,
      queueType: "RM_READY_FOR_ISSUE",
      freeStockQty: 100,
      materialRequirementId: 88,
      sourceType: "SALES_ORDER",
    });
    const action = mapNormalizedRowToPendingAction(row);
    assert.equal(action.action, "Material Issue Pending");
    assert.match(action.href, /^\/material-issue\?/);
  });

  it("dedupes Store pending actions by work order, preferring waiting-for-PO over Create PR", () => {
    const deduped = dedupePendingActionsByWorkOrder([
      {
        id: "store-issue:wo:1",
        priority: PENDING_PRIORITY.MEDIUM,
        action: "Material Issue Pending",
        documentNo: "WO-1",
        ownerRole: "STORE",
        ageHours: null,
        href: "/material-issue?workOrderId=1&returnTo=pending-actions",
      },
      {
        id: "rm-risk:wo:1:rm:10",
        priority: PENDING_PRIORITY.HIGH,
        action: "Waiting for Purchase to prepare RM PO.",
        documentNo: "WO-1",
        ownerRole: "STORE",
        ageHours: 2,
        href: "/procurement-planning?demandPool=MPRS&materialRequirementId=99&workOrderId=1",
      },
      {
        id: "rm-risk:wo:1:rm:11",
        priority: PENDING_PRIORITY.HIGH,
        action: "Create Purchase Request",
        documentNo: "WO-1",
        ownerRole: "STORE",
        ageHours: 1,
        href: "/procurement-planning?demandPool=MPRS&materialRequirementId=99&workOrderId=1",
      },
    ]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].action, "Waiting for Purchase to prepare RM PO.");
  });

  it("Regular SO NO_QTY planning row remains unchanged", () => {
    const row = normalizeNoQtyPlanningRow({
      salesOrderId: 1,
      salesOrderDocNo: "SO-26-0001",
      cycleNo: 1,
      latestRequirementSheetStatus: null,
    });
    const action = mapNormalizedRowToPendingAction(row);
    assert.equal(action.action, "Create RS Cycle 1");
    assert.equal(action.href, "/sales-orders/1/requirement-sheets");
  });

  it("fetchStoreGrnPendingActions collapses multiple PO lines to one Store action per PO", async () => {
    const mockDb = {
      rmPurchaseOrder: {
        findMany: async () => [
          {
            id: 112,
            docNo: "RMPO-112",
            status: "PENDING",
            grns: [],
            supplier: { name: "Supplier A" },
            lines: [
              { id: 1, itemId: 10, qty: 100, item: { itemName: "RM-A" } },
              { id: 2, itemId: 20, qty: 50, item: { itemName: "RM-B" } },
            ],
          },
        ],
      },
    };
    const actions = await fetchStoreGrnPendingActions(mockDb);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "GRN Pending");
    assert.equal(actions[0].documentNo, "RMPO-112");
    assert.equal(actions[0].ownerRole, "STORE");
    assert.equal(actions[0].id, "procurement:grn:po:112");
    assert.match(actions[0].href, /poId=112/);
    assert.match(actions[0].href, /from=pending-actions/);
  });

  it("fetchPurchaseProcurementPendingActions does not emit GRN Pending actions", async () => {
    const actions = await fetchPurchaseProcurementPendingActions({
      materialRequirement: { findMany: async () => [] },
      purchaseRequest: { findMany: async () => [] },
      rmPurchaseOrder: { findMany: async () => [] },
      purchaseRequestLineSourceLink: { findMany: async () => [] },
    });
    assert.equal(actions.filter((a) => a.action === "GRN Pending").length, 0);
  });

  it("dedupes Store GRN pending actions by PO, preferring supplemental PO doc over RM_RISK WO doc", () => {
    const deduped = dedupePendingActionsByProcurementCase([
      {
        id: "rm-risk:wo:1:rm:10",
        priority: PENDING_PRIORITY.LOW,
        action: "GRN Pending",
        documentNo: "WO-26-0001",
        ownerRole: "STORE",
        ageHours: null,
        href: "/rm-po-grn/112?from=pending-actions",
        currentStatus: "GRN_PENDING",
        purchaseOrderId: 112,
        materialRequirementId: 99,
      },
      {
        id: "procurement:grn:po:112",
        priority: PENDING_PRIORITY.LOW,
        action: "GRN Pending",
        documentNo: "RMPO-112",
        ownerRole: "STORE",
        ageHours: null,
        href: "/rm-po-grn?poId=112&from=pending-actions",
        currentStatus: "GRN_PENDING",
        purchaseOrderId: 112,
      },
    ]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].documentNo, "RMPO-112");
    assert.equal(deduped[0].id, "procurement:grn:po:112");
  });

  it("Store GRN pending maps from normalized RM_RISK row with PO doc href", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 1,
      workOrderNo: "WO-26-0001",
      itemId: 10,
      queueType: "PO_WAITING_GRN",
      materialRequirementId: 99,
      sourceType: "MONTHLY_PLAN",
      prLineCount: 1,
      poLineCount: 1,
      pendingGrnQty: 25,
      operationalKey: "GRN_PENDING",
      nextActionKey: "OPEN_GRN",
      primaryPoId: 112,
    });
    assert.equal(row.currentOwner, VISIBLE_OWNERS.STORE);
    const action = mapNormalizedRowToPendingAction(row, "STORE");
    assert.equal(action.action, "GRN Pending");
    assert.equal(action.ownerRole, "STORE");
    assert.equal(action.currentStatus, "GRN_PENDING");
    assert.match(action.href, /\/rm-po-grn\/112/);
  });
});
