const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  friendlyActionForNormalizedRow,
  mapNormalizedRowToPendingAction,
  resolveHrefForNormalizedRow,
  sortPendingActions,
  dedupePendingActionsByWorkOrder,
  dedupePendingActionsByProcurementCase,
  dedupeProductionPendingActions,
  filterExecutableProductionPendingActions,
  dedupeLifecyclePendingActions,
  filterNormalizedRowsByOwner,
  fetchPurchaseProcurementPendingActions,
  mapProcurementQueueRowToPurchasePendingAction,
  fetchStoreGrnPendingActions,
  fetchStoreProductionRmReturnPendingActions,
  fetchStoreDispatchPendingActions,
  fetchProductionRmReturnWaitingActions,
  fetchProductionRmReturnInformationalStatuses,
  fetchStoreNoQtyMonthlyPlanningPendingActions,
  fetchStoreNoQtyCreateNextRsPendingActions,
  filterNoQtyStoreHandoffSupersededByLaterRs,
  buildStoreDispatchPendingActionLabel,
  buildNoQtyCreateNextRsPlanningHubHref,
  PENDING_PRIORITY,
  productionExecutionPendingActionLabel,
  PRODUCTION_EXECUTION_PENDING_LABELS,
} = require("../../src/services/pendingActionsService");
const { PREPARE_RM_PO, READY_TO_START_PRODUCTION } = require("../../src/services/rmProcurementStageSignals");
const {
  normalizeNoQtyPlanningRow,
  normalizeRmRiskRow,
  normalizeProductionRow,
  normalizeQaRow,
  normalizeContinueWorkingRow,
  VISIBLE_OWNERS,
} = require("../../src/services/controlTowerRowNormalizer");

/** Toggle FEATURE_MONTHLY_PLANNING for PA emitter tests (authoritative reader is featureFlags.js). */
async function withMonthlyPlanningEnabled(enabled, fn) {
  const prev = process.env.FEATURE_MONTHLY_PLANNING;
  if (enabled) process.env.FEATURE_MONTHLY_PLANNING = "ON";
  else delete process.env.FEATURE_MONTHLY_PLANNING;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.FEATURE_MONTHLY_PLANNING;
    else process.env.FEATURE_MONTHLY_PLANNING = prev;
  }
}

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
    assert.match(action.href, /\/sales-orders\/1\/requirement-sheets\?/);
    assert.match(action.href, /intent=add/);
    assert.match(action.href, /source=no_qty_so/);
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

  it("friendlyAction maps dispatch backlog to Dispatch Pending", () => {
    const label = friendlyActionForNormalizedRow({
      rowType: "DISPATCH_BACKLOG",
      currentStatus: "DISPATCH_PENDING",
      nextAction: "Dispatch FG",
    });
    assert.equal(label, "Dispatch Pending");
  });

  it("friendlyAction maps production queue QC_PENDING to QC Pending", () => {
    const label = friendlyActionForNormalizedRow({
      rowType: "PRODUCTION_QUEUE",
      currentStatus: "QA_PENDING",
      nextAction: "Complete QA",
      metadata: {
        productionExecutionStatus: "RUNNING",
        sourceNextAction: "QC_PENDING",
        workOrderId: 3,
      },
    });
    assert.equal(label, "QC Pending");
  });

  it("resolveHref routes production queue QC_PENDING to qc-entry with productionId", () => {
    const href = resolveHrefForNormalizedRow({
      rowType: "PRODUCTION_QUEUE",
      currentStatus: "QA_PENDING",
      metadata: {
        workOrderId: 3,
        salesOrderId: 9,
        productionId: 44,
        sourceNextAction: "QC_PENDING",
      },
    });
    assert.match(href, /\/qc-entry\?/);
    assert.match(href, /workOrderId=3/);
    assert.match(href, /productionId=44/);
    assert.match(href, /#qc-production-pending/);
  });

  it("resolveHref uses actionHref for production queue when present", () => {
    const href = resolveHrefForNormalizedRow({
      rowType: "PRODUCTION_QUEUE",
      metadata: {
        workOrderId: 375,
        actionHref: "/production?from=dashboard&flow=GREEN_LEVEL&workOrderId=375&workOrderLineId=384",
      },
    });
    assert.equal(
      href,
      "/production?from=dashboard&flow=GREEN_LEVEL&workOrderId=375&workOrderLineId=384",
    );
  });

  it("resolveHref builds GREEN_LEVEL production workspace from queue metadata", () => {
    const { buildProductionWorkspaceHrefFromPendingMeta } = require("../../src/services/pendingActionsService");
    const href = buildProductionWorkspaceHrefFromPendingMeta(
      {
        workOrderId: 375,
        workOrderLineId: 384,
        sourceType: "GREEN_LEVEL_REPLENISHMENT",
        orderType: "GREEN_LEVEL",
      },
      "pending-actions",
    );
    assert.match(href, /flow=GREEN_LEVEL/);
    assert.match(href, /workOrderId=375/);
    assert.match(href, /workOrderLineId=384/);
    assert.match(href, /from=pending-actions/);

    const fromRow = resolveHrefForNormalizedRow({
      rowType: "PRODUCTION_QUEUE",
      metadata: {
        workOrderId: 375,
        workOrderLineId: 384,
        orderType: "GREEN_LEVEL",
        sourceType: "GREEN_LEVEL_REPLENISHMENT",
      },
    });
    assert.equal(fromRow, href);
  });

  it("resolveHref keeps REGULAR_SO production queue links unchanged", () => {
    const href = resolveHrefForNormalizedRow({
      rowType: "PRODUCTION_QUEUE",
      metadata: {
        workOrderId: 12,
        workOrderLineId: 34,
        salesOrderId: 9,
        orderType: "NORMAL",
      },
    });
    assert.match(href, /flow=REGULAR_SO/);
    assert.match(href, /salesOrderId=9/);
    assert.doesNotMatch(href, /flow=GREEN_LEVEL/);
  });

  it("filterNormalizedRowsByOwner suppresses per-item dispatch backlog for Store", () => {
    const rows = [
      {
        rowType: "DISPATCH_BACKLOG",
        currentOwner: "STORE",
        currentStatus: "DISPATCH_PENDING",
        metadata: { salesOrderId: 1, itemId: 10 },
      },
      {
        rowType: "CONTINUE_WORKING",
        currentOwner: "STORE",
        currentStatus: "NEXT_RS_READY",
        metadata: { salesOrderId: 1 },
      },
    ];
    const filtered = filterNormalizedRowsByOwner(rows, "STORE");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].rowType, "CONTINUE_WORKING");
  });

  it("buildStoreDispatchPendingActionLabel formats delivery-due and draft dispatch labels", () => {
    assert.equal(
      buildStoreDispatchPendingActionLabel("SO-26-0001", 9593, "DELIVERY_DUE"),
      "Delivery Due — Dispatch — SO-26-0001 — Qty 9593",
    );
    assert.equal(
      buildStoreDispatchPendingActionLabel("SO-26-0001", 40, "DRAFT"),
      "Finalize Dispatch Draft — SO-26-0001 — Qty 40",
    );
  });

  it("filterNormalizedRowsByOwner suppresses production mirror when QA queue row exists", () => {
    const qa = normalizeQaRow({
      workOrderId: 5,
      qcRef: "PE-1",
      status: "PENDING_QC",
      orderType: "NORMAL",
    });
    const prod = normalizeProductionRow({
      workOrderId: 5,
      workOrderLineId: 1,
      nextAction: "QC_PENDING",
      orderType: "NORMAL",
    });
    const cont = normalizeContinueWorkingRow({
      key: "so-1-qc",
      salesOrderId: 1,
      workOrderId: 5,
      stageKey: "QC",
      nextAction: "QC_PENDING",
      orderType: "NORMAL",
    });
    const filtered = filterNormalizedRowsByOwner([qa, prod, cont], "QA");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].rowType, "QA_QUEUE");
  });

  it("dedupeLifecyclePendingActions collapses billing duplicates for same dispatch", () => {
    const merged = dedupeLifecyclePendingActions([
      {
        id: "BILLING:DISPATCH:55",
        action: "Create Sales Bill",
        href: "/sales-bills/new?dispatchId=55&from=dashboard",
        priority: PENDING_PRIORITY.MEDIUM,
        ownerRole: "ADMIN",
      },
      {
        id: "admin:sales-bill:dispatch:55",
        action: "Create Sales Bill",
        href: "/sales-bills/new?dispatchId=55&from=pending-actions",
        priority: PENDING_PRIORITY.MEDIUM,
        ownerRole: "ADMIN",
      },
    ]);
    assert.equal(merged.length, 1);
    assert.match(merged[0].href, /dispatchId=55/);
  });

  it("fetchStoreProductionHandoffPendingActions maps awaiting release to Release to Production", async () => {
    const { fetchStoreProductionHandoffPendingActions } = require("../../src/services/pendingActionsService");
    const rows = await fetchStoreProductionHandoffPendingActions();
    if (rows.length > 0) {
      assert.equal(rows[0].action, "Release to Production");
      assert.match(rows[0].href, /^\/production-release\?/);
    }
  });

  it("buildReleaseToProductionHref uses GREEN_LEVEL flow without SO context", () => {
    const { buildReleaseToProductionHref } = require("../../src/services/pendingActionsService");
    const href = buildReleaseToProductionHref({
      workOrderId: 375,
      workOrderLineId: 384,
      pmrId: 88,
      sourceType: "GREEN_LEVEL_REPLENISHMENT",
      orderType: "GREEN_LEVEL",
    });
    assert.match(href, /workOrderId=375/);
    assert.match(href, /pmrId=88/);
    assert.match(href, /flow=GREEN_LEVEL/);
    assert.doesNotMatch(href, /salesOrderId=/);
    assert.doesNotMatch(href, /flow=REGULAR_SO/);
  });

  it("fetchAdminSalesBillPendingActions maps eligible dispatch to Create Sales Bill", async () => {
    const { fetchAdminSalesBillPendingActions } = require("../../src/services/pendingActionsService");
    const actions = await fetchAdminSalesBillPendingActions({
      dispatch: {
        findMany: async () => [
          {
            id: 55,
            docNo: "D-55",
            date: new Date("2026-05-01"),
            soId: 10,
            dispatchedQty: 100,
            salesOrder: {
              docNo: "SO-10",
              orderType: "NO_QTY",
              customer: { name: "Acme" },
              po: null,
              lines: [],
            },
            item: { itemName: "Widget" },
          },
        ],
      },
      salesBill: {
        findMany: async () => [],
      },
    });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "Create Sales Bill");
    assert.match(actions[0].href, /dispatchId=55/);
    assert.equal(actions[0].ownerRole, "ADMIN");
  });

  it("fetchAdminTallyExportPendingActions maps finalized unexported bills", async () => {
    const { fetchAdminTallyExportPendingActions } = require("../../src/services/pendingActionsService");
    const actions = await fetchAdminTallyExportPendingActions({
      salesBill: {
        findMany: async () => [
          {
            id: 77,
            docNo: "SB-77",
            billNo: "INV-77",
            billDate: new Date("2026-05-02"),
            customerNameSnapshot: "Acme",
          },
        ],
      },
    });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "Export to Tally");
    assert.equal(actions[0].href, "/sales-bills/77?from=pending-actions");
  });

  it("friendlyAction maps blocked production execution to Production Paused", () => {
    const label = friendlyActionForNormalizedRow({
      rowType: "PRODUCTION_QUEUE",
      currentStatus: "PRODUCTION_ON_HOLD",
      nextAction: "PRODUCTION_EXECUTION_BLOCKED",
      metadata: { productionExecutionStatus: "BLOCKED", workOrderId: 4 },
    });
    assert.equal(label, PRODUCTION_EXECUTION_PENDING_LABELS.BLOCKED);
  });

  it("friendlyAction maps production queue rows from execution status", () => {
    const cases = [
      ["NOT_STARTED", PRODUCTION_EXECUTION_PENDING_LABELS.NOT_STARTED],
      ["RUNNING", PRODUCTION_EXECUTION_PENDING_LABELS.RUNNING],
      ["SHORTFALL_PENDING", PRODUCTION_EXECUTION_PENDING_LABELS.SHORTFALL_PENDING],
      ["BLOCKED", PRODUCTION_EXECUTION_PENDING_LABELS.BLOCKED],
    ];
    for (const [executionStatus, expected] of cases) {
      const label = friendlyActionForNormalizedRow({
        rowType: "PRODUCTION_QUEUE",
        nextAction: "PRODUCTION_PENDING",
        metadata: { productionExecutionStatus: executionStatus, workOrderId: 1 },
      });
      assert.equal(label, expected, `executionStatus=${executionStatus}`);
    }
  });

  it("productionExecutionPendingActionLabel returns null for COMPLETED", () => {
    assert.equal(productionExecutionPendingActionLabel("COMPLETED"), null);
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
    assert.doesNotMatch(action.action, /Regular SO/);
  });

  it("Regular SO Create PR pending action shows business SO identity (not SO #id)", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 9,
      workOrderNo: "WO-26-0009",
      salesOrderId: 258,
      salesOrderNo: "SO-26-0001",
      itemId: 96,
      itemName: "PP",
      unit: "Kg",
      fgItemName: "Nozzle",
      shortageAfterReservationQty: 140,
      queueType: "WAITING_PURCHASE_ACTION",
      freeStockQty: 0,
      netShortageAfterIncomingQty: 140,
      materialRequirementId: 77,
      sourceType: "SALES_ORDER",
      prLineCount: 0,
      poLineCount: 0,
      operationalKey: "PROCUREMENT_PENDING",
      nextActionKey: "CREATE_PR",
      procurementDemandPool: "REGULAR_SO",
      hasOpenMr: true,
    });
    const action = mapNormalizedRowToPendingAction(row, "STORE");
    assert.equal(action.action, "Create Purchase Request — Regular SO");
    assert.match(String(action.documentNo), /SO-26-0001/);
    assert.match(String(action.documentNo), /Nozzle/);
    assert.match(String(action.documentNo), /PP shortage:\s*140\s*Kg/);
    assert.doesNotMatch(String(action.documentNo), /SO #258/);
    assert.doesNotMatch(String(action.action), /SO #/);
    assert.match(action.href, /salesOrderId=258/);
    assert.match(action.href, /salesOrderDocNo=SO-26-0001/);
    assert.match(action.href, /demandPool=REGULAR_SO/);
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

  it("RM ready queue maps to Issue Material with material-issue href", () => {
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
    assert.equal(action.action, "Issue Material");
    assert.match(action.href, /^\/material-issue\?/);
  });

  it("dedupes Store pending actions by work order, preferring waiting-for-PO over Create PR", () => {
    const deduped = dedupePendingActionsByWorkOrder([
      {
        id: "store-issue:wo:1",
        priority: PENDING_PRIORITY.MEDIUM,
        action: "Issue Material",
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

  it("dedupes Store pending actions by work order, preferring RM Return Approval Pending over Issue Material", () => {
    const deduped = dedupePendingActionsByWorkOrder([
      {
        id: "store-issue:wo:1",
        priority: PENDING_PRIORITY.MEDIUM,
        action: "Issue Material",
        documentNo: "WO-1",
        ownerRole: "STORE",
        ageHours: null,
        href: "/material-issue?workOrderId=1&returnTo=pending-actions",
        workOrderId: 1,
      },
      {
        id: "production-rm-return-pending:77",
        priority: PENDING_PRIORITY.MEDIUM,
        action: "RM Return Approval Pending",
        documentNo: "WO-1",
        ownerRole: "STORE",
        ageHours: 1,
        href: "/production/rm-returns?pendingId=77&workOrderId=1",
        workOrderId: 1,
      },
    ]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].action, "RM Return Approval Pending");
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
    assert.match(action.href, /intent=add/);
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
              { id: 1, itemId: 10, qty: 100, item: { itemName: "RM-A", unit: "KG" } },
              { id: 2, itemId: 20, qty: 50, item: { itemName: "RM-B", unit: "KG" } },
            ],
          },
        ],
      },
    };
    const actions = await fetchStoreGrnPendingActions(mockDb);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "Create GRN");
    assert.equal(actions[0].documentNo, "RMPO-112");
    assert.equal(actions[0].itemName, "Supplier A");
    assert.equal(actions[0].qty, 150);
    assert.equal(actions[0].uom, "KG");
    assert.equal(actions[0].ownerRole, "STORE");
    assert.equal(actions[0].id, "procurement:grn:po:112");
    assert.match(actions[0].href, /\/rm-po-grn\/112\?/);
    assert.match(actions[0].href, /openGrn=1/);
    assert.match(actions[0].href, /from=pending-actions/);
    assert.doesNotMatch(actions[0].href, /\/dashboard/);
    assert.doesNotMatch(actions[0].href, /material-availability|rm-control/i);
  });

  it("fetchStoreGrnPendingActions omits fully received and cancelled POs", async () => {
    const mockDb = {
      rmPurchaseOrder: {
        findMany: async () => [
          {
            id: 1,
            docNo: "RMPO-FULL",
            status: "PENDING",
            supplier: { name: "S1" },
            lines: [{ id: 10, itemId: 1, qty: 10, shortClosedQty: 0, item: { itemName: "A", unit: "KG" } }],
            grns: [{ reversedAt: null, lines: [{ rmPoLineId: 10, receivedQty: 10 }] }],
          },
          {
            id: 2,
            docNo: "RMPO-PARTIAL",
            status: "PARTIAL",
            supplier: { name: "S2" },
            lines: [{ id: 20, itemId: 2, qty: 100, shortClosedQty: 0, item: { itemName: "B", unit: "KG" } }],
            grns: [{ reversedAt: null, lines: [{ rmPoLineId: 20, receivedQty: 40 }] }],
          },
        ],
      },
    };
    // buildGrnPendingSection only queries OPEN_PO_STATUSES — cancelled never returned.
    const actions = await fetchStoreGrnPendingActions(mockDb);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].documentNo, "RMPO-PARTIAL");
    assert.equal(actions[0].qty, 60);
    assert.match(actions[0].href, /\/rm-po-grn\/2\?/);
  });

  it("fetchStoreProductionRmReturnPendingActions maps pending return to Store action with WO number", async () => {
    const mockDb = {
      productionRmReturnPending: {
        findMany: async () => [
          {
            id: 77,
            productionReportId: 12,
            workOrderId: 307,
            itemId: 9,
            requestedQty: 4,
            status: "PENDING",
            materialReturnNoteId: null,
            remarks: null,
            createdAt: new Date("2026-06-01T00:00:00Z"),
            receivedAt: null,
            productionReport: { id: 12, confirmedAt: new Date("2026-06-01T00:00:00Z") },
            workOrder: { id: 307, docNo: "WO-26-0001" },
            item: { id: 9, itemName: "PP", unit: "Kg" },
            materialReturnNote: null,
            receivedBy: null,
          },
        ],
      },
    };
    const actions = await fetchStoreProductionRmReturnPendingActions(mockDb);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "RM Return Approval Pending");
    assert.equal(actions[0].type, "RM_RETURN_APPROVAL_PENDING");
    assert.equal(actions[0].documentNo, "WO-26-0001");
    assert.equal(actions[0].ownerRole, "STORE");
    assert.match(actions[0].href, /\/production\/rm-returns\?/);
    assert.match(actions[0].href, /pendingId=77/);
    assert.match(actions[0].href, /workOrderId=307/);
  });

  function mockDispatchTriggerDb(overrides = {}) {
    const { drafts = [], salesOrders = [] } = overrides;
    return {
      dispatch: {
        findMany: async () => drafts,
      },
      salesOrder: {
        findMany: async ({ where }) => {
          const ids = where?.id?.in ?? [];
          return salesOrders.filter((so) => ids.includes(so.id));
        },
      },
    };
  }

  function normalSoMeta(id, docNo, { requiredDate = null, orderType = "NORMAL" } = {}) {
    return {
      id,
      internalStatus: "APPROVED",
      orderType,
      docNo,
      createdAt: new Date("2026-05-20T00:00:00Z"),
      po: { requiredDate },
      customer: { name: "Acme" },
    };
  }

  it("fetchStoreDispatchPendingActions omits inventory-only backlog without draft or delivery due", async () => {
    const dashPath = require.resolve("../../src/services/dashboardQueueSnapshots");
    const paPath = require.resolve("../../src/services/pendingActionsService");
    const orig = require(dashPath).getDispatchBacklogRows;
    require(dashPath).getDispatchBacklogRows = async () => [
      {
        salesOrderId: 42,
        salesOrderNo: "SO-42",
        salesOrderDocNo: "SO-26-0042",
        customerName: "Acme",
        itemId: 9,
        itemName: "Widget",
        salesOrderLineId: 101,
        dispatchableNow: 25,
        salesOrderDate: new Date("2026-06-01T00:00:00Z"),
      },
    ];
    delete require.cache[paPath];
    const { fetchStoreDispatchPendingActions: fetchStoreDispatch } = require(paPath);
    try {
      const actions = await fetchStoreDispatch(
        mockDispatchTriggerDb({ salesOrders: [normalSoMeta(42, "SO-26-0042")] }),
      );
      assert.equal(actions.length, 0);
    } finally {
      require(dashPath).getDispatchBacklogRows = orig;
      delete require.cache[paPath];
    }
  });

  it("fetchStoreDispatchPendingActions maps unlocked draft to Finalize Dispatch Draft row", async () => {
    const dashPath = require.resolve("../../src/services/dashboardQueueSnapshots");
    const paPath = require.resolve("../../src/services/pendingActionsService");
    const orig = require(dashPath).getDispatchBacklogRows;
    require(dashPath).getDispatchBacklogRows = async () => [
      {
        salesOrderId: 42,
        salesOrderNo: "SO-42",
        salesOrderDocNo: "SO-26-0042",
        customerName: "Acme",
        dispatchableNow: 25,
        salesOrderDate: new Date("2026-06-01T00:00:00Z"),
      },
    ];
    delete require.cache[paPath];
    const { fetchStoreDispatchPendingActions: fetchStoreDispatch } = require(paPath);
    try {
      const actions = await fetchStoreDispatch(
        mockDispatchTriggerDb({
          drafts: [{ soId: 42, dispatchedQty: 25, reversalOfId: null, workflowStatus: "UNLOCKED" }],
          salesOrders: [normalSoMeta(42, "SO-26-0042")],
        }),
      );
      assert.equal(actions.length, 1);
      assert.equal(actions[0].action, "Finalize Dispatch Draft — SO-26-0042 — Qty 25");
      assert.equal(actions[0].documentNo, "SO-26-0042");
      assert.equal(actions[0].ownerRole, "STORE");
      assert.match(actions[0].href, /\/dispatch\?/);
      assert.match(actions[0].href, /salesOrderId=42/);
      assert.match(actions[0].href, /source=pending-actions/);
      assert.doesNotMatch(actions[0].href, /itemId=/);
    } finally {
      require(dashPath).getDispatchBacklogRows = orig;
      delete require.cache[paPath];
    }
  });

  it("fetchStoreDispatchPendingActions groups delivery-due backlog into one SO dispatch row", async () => {
    const dashPath = require.resolve("../../src/services/dashboardQueueSnapshots");
    const paPath = require.resolve("../../src/services/pendingActionsService");
    const orig = require(dashPath).getDispatchBacklogRows;
    require(dashPath).getDispatchBacklogRows = async () => [
      {
        salesOrderId: 1,
        salesOrderDocNo: "SO-26-0001",
        itemId: 10,
        itemName: "Dummy Plug",
        dispatchableNow: 2000,
        salesOrderDate: new Date("2026-05-20T00:00:00Z"),
      },
      {
        salesOrderId: 1,
        salesOrderDocNo: "SO-26-0001",
        itemId: 11,
        itemName: "PVC Angle",
        dispatchableNow: 2448,
        salesOrderDate: new Date("2026-05-20T00:00:00Z"),
      },
      {
        salesOrderId: 1,
        salesOrderDocNo: "SO-26-0001",
        itemId: 12,
        itemName: "Round Plate",
        dispatchableNow: 2658,
        salesOrderDate: new Date("2026-05-20T00:00:00Z"),
      },
      {
        salesOrderId: 1,
        salesOrderDocNo: "SO-26-0001",
        itemId: 13,
        itemName: "Square Box",
        dispatchableNow: 4487,
        salesOrderDate: new Date("2026-05-20T00:00:00Z"),
      },
    ];
    delete require.cache[paPath];
    const { fetchStoreDispatchPendingActions: fetchStoreDispatch } = require(paPath);
    try {
      const actions = await fetchStoreDispatch(
        mockDispatchTriggerDb({
          salesOrders: [
            normalSoMeta(1, "SO-26-0001", { requiredDate: new Date("2026-05-01T00:00:00Z") }),
          ],
        }),
      );
      assert.equal(actions.length, 1);
      assert.equal(actions[0].id, "store:dispatch:so:1");
      assert.equal(actions[0].action, "Delivery Due — Dispatch — SO-26-0001 — Qty 11593");
    } finally {
      require(dashPath).getDispatchBacklogRows = orig;
      delete require.cache[paPath];
    }
  });

  it("fetchStoreDispatchPendingActions emits NO_QTY dispatch only when draft exists", async () => {
    const dashPath = require.resolve("../../src/services/dashboardQueueSnapshots");
    const paPath = require.resolve("../../src/services/pendingActionsService");
    const orig = require(dashPath).getDispatchBacklogRows;
    require(dashPath).getDispatchBacklogRows = async () => [
      {
        salesOrderId: 1,
        salesOrderNo: "SO-1",
        customerName: "Cycle Customer",
        itemId: 501,
        itemName: "FG Drum",
        salesOrderLineId: 11,
        orderType: "NO_QTY",
        cycleId: 3,
        cycleNo: 1,
        pendingQty: 0,
        dispatchableNow: 120,
        salesOrderDate: new Date("2026-05-20T00:00:00Z"),
      },
    ];
    delete require.cache[paPath];
    const { fetchStoreDispatchPendingActions: fetchStoreDispatch } = require(paPath);
    try {
      const actions = await fetchStoreDispatch(
        mockDispatchTriggerDb({
          drafts: [{ soId: 1, dispatchedQty: 120, reversalOfId: null, workflowStatus: "UNLOCKED" }],
          salesOrders: [normalSoMeta(1, "SO-1", { orderType: "NO_QTY" })],
        }),
      );
      assert.equal(actions.length, 1);
      assert.equal(actions[0].action, "Finalize Dispatch Draft — SO-1 — Qty 120");
      assert.match(actions[0].href, /salesOrderId=1/);
      assert.doesNotMatch(actions[0].href, /cycleId=/);
      assert.doesNotMatch(actions[0].href, /itemId=/);
    } finally {
      require(dashPath).getDispatchBacklogRows = orig;
      delete require.cache[paPath];
    }
  });

  it("dedupeLifecyclePendingActions keeps NO_QTY next RS and dispatch draft on the same SO", () => {
    const actions = dedupeLifecyclePendingActions([
      {
        id: "no-qty-create-next-rs:1",
        action: "Create Cycle 2 Requirement Sheet",
        ownerRole: "STORE",
        href: "/sales-orders/1/requirement-sheets?intent=add",
      },
      {
        id: "store:dispatch:so:1",
        action: "Finalize Dispatch Draft — SO-26-0001 — Qty 9593",
        ownerRole: "STORE",
        href: "/dispatch?salesOrderId=1&source=pending-actions",
        salesOrderId: 1,
      },
    ]);
    assert.equal(actions.length, 2);
    assert.ok(actions.some((a) => a.action === "Create Cycle 2 Requirement Sheet"));
    assert.ok(actions.some((a) => a.action.startsWith("Finalize Dispatch Draft")));
  });

  it("fetchStoreDispatchPendingActions reflects partial QA acceptance only when delivery is due", async () => {
    const dashPath = require.resolve("../../src/services/dashboardQueueSnapshots");
    const paPath = require.resolve("../../src/services/pendingActionsService");
    const orig = require(dashPath).getDispatchBacklogRows;
    require(dashPath).getDispatchBacklogRows = async () => [
      {
        salesOrderId: 1,
        salesOrderNo: "SO-1",
        customerName: "Partial QA",
        itemId: 501,
        salesOrderLineId: 11,
        orderType: "NO_QTY",
        cycleId: 3,
        pendingQty: 0,
        dispatchableNow: 40,
        salesOrderDate: new Date("2026-05-21T00:00:00Z"),
      },
    ];
    delete require.cache[paPath];
    const { fetchStoreDispatchPendingActions: fetchStoreDispatch } = require(paPath);
    try {
      const actions = await fetchStoreDispatch(
        mockDispatchTriggerDb({
          salesOrders: [
            normalSoMeta(1, "SO-1", {
              orderType: "NO_QTY",
              requiredDate: new Date("2026-05-01T00:00:00Z"),
            }),
          ],
        }),
      );
      assert.equal(actions.length, 1);
      assert.equal(actions[0].action, "Delivery Due — Dispatch — SO-1 — Qty 40");
    } finally {
      require(dashPath).getDispatchBacklogRows = orig;
      delete require.cache[paPath];
    }
  });

  it("fetchStoreDispatchPendingActions omits SO when all FG dispatchable qty is zero", async () => {
    const dashPath = require.resolve("../../src/services/dashboardQueueSnapshots");
    const paPath = require.resolve("../../src/services/pendingActionsService");
    const orig = require(dashPath).getDispatchBacklogRows;
    require(dashPath).getDispatchBacklogRows = async () => [
      {
        salesOrderId: 1,
        salesOrderDocNo: "SO-26-0001",
        itemId: 10,
        dispatchableNow: 0,
        salesOrderDate: new Date("2026-05-20T00:00:00Z"),
      },
      {
        salesOrderId: 1,
        salesOrderDocNo: "SO-26-0001",
        itemId: 11,
        dispatchableNow: 0,
        salesOrderDate: new Date("2026-05-20T00:00:00Z"),
      },
    ];
    delete require.cache[paPath];
    const { fetchStoreDispatchPendingActions: fetchStoreDispatch } = require(paPath);
    try {
      const actions = await fetchStoreDispatch(
        mockDispatchTriggerDb({ salesOrders: [normalSoMeta(1, "SO-26-0001")] }),
      );
      assert.equal(actions.length, 0);
    } finally {
      require(dashPath).getDispatchBacklogRows = orig;
      delete require.cache[paPath];
    }
  });

  it("fetchStoreDispatchPendingActions does not create mandatory dispatch after partial FG dispatch", async () => {
    const dashPath = require.resolve("../../src/services/dashboardQueueSnapshots");
    const paPath = require.resolve("../../src/services/pendingActionsService");
    const orig = require(dashPath).getDispatchBacklogRows;
    require(dashPath).getDispatchBacklogRows = async () => [
      {
        salesOrderId: 1,
        salesOrderDocNo: "SO-26-0001",
        itemId: 13,
        itemName: "Square Box",
        dispatchableNow: 1483,
        salesOrderDate: new Date("2026-05-20T00:00:00Z"),
      },
      {
        salesOrderId: 1,
        salesOrderDocNo: "SO-26-0001",
        itemId: 10,
        itemName: "Dummy Plug",
        dispatchableNow: 1993,
        salesOrderDate: new Date("2026-05-20T00:00:00Z"),
      },
    ];
    delete require.cache[paPath];
    const { fetchStoreDispatchPendingActions: fetchStoreDispatch } = require(paPath);
    try {
      const actions = await fetchStoreDispatch(
        mockDispatchTriggerDb({ salesOrders: [normalSoMeta(1, "SO-26-0001")] }),
      );
      assert.equal(actions.length, 0);
    } finally {
      require(dashPath).getDispatchBacklogRows = orig;
      delete require.cache[paPath];
    }
  });

  it("fetchAdminSalesBillPendingActions surfaces billing after locked FG dispatch", async () => {
    const { fetchAdminSalesBillPendingActions } = require("../../src/services/pendingActionsService");
    const actions = await fetchAdminSalesBillPendingActions({
      dispatch: {
        findMany: async () => [
          {
            id: 901,
            docNo: "D-901",
            date: new Date("2026-05-29T00:00:00Z"),
            soId: 1,
            dispatchedQty: 3000,
            workflowStatus: "LOCKED",
            salesOrder: {
              docNo: "SO-26-0001",
              orderType: "NO_QTY",
              customer: { name: "Acme" },
              po: null,
              lines: [],
            },
            item: { itemName: "Square Box" },
          },
        ],
      },
      salesBill: {
        findMany: async () => [],
      },
    });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "Create Sales Bill");
    assert.equal(actions[0].ownerRole, "ADMIN");
    assert.match(actions[0].href, /dispatchId=901/);
    assert.match(actions[0].documentNo, /D-901/);
    assert.match(actions[0].documentNo, /SO-26-0001/);
  });

  it("fetchProductionRmReturnWaitingActions does not emit actionable Production approval rows", async () => {
    const mockDb = {
      productionRmReturnPending: {
        findMany: async () => [
          {
            id: 5,
            workOrderId: 88,
            workOrderNo: "WO-88",
            itemId: 3,
            itemName: "PP",
            unit: "Kg",
            requestedQty: 3,
            status: "PENDING",
            createdAt: new Date("2026-06-02T00:00:00Z"),
            productionReport: { id: 1, confirmedAt: new Date() },
            workOrder: { id: 88, docNo: "WO-88" },
            item: { id: 3, itemName: "PP", unit: "Kg" },
            materialReturnNote: null,
            receivedBy: null,
          },
        ],
      },
    };
    const actions = await fetchProductionRmReturnWaitingActions(mockDb);
    assert.equal(actions.length, 0);
  });

  it("fetchProductionRmReturnInformationalStatuses is read-only and non-actionable for Production", async () => {
    const mockDb = {
      productionRmReturnPending: {
        findMany: async () => [
          {
            id: 5,
            workOrderId: 88,
            workOrderNo: "WO-88",
            itemId: 3,
            itemName: "PP",
            unit: "Kg",
            requestedQty: 3,
            status: "PENDING",
            createdAt: new Date("2026-06-02T00:00:00Z"),
            productionReport: { id: 1, confirmedAt: new Date() },
            workOrder: { id: 88, docNo: "WO-88" },
            item: { id: 3, itemName: "PP", unit: "Kg" },
            materialReturnNote: null,
            receivedBy: null,
          },
        ],
      },
    };
    const statuses = await fetchProductionRmReturnInformationalStatuses(mockDb);
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].actionable, false);
    assert.equal(statuses[0].kind, "INFORMATIONAL");
    assert.equal(statuses[0].action, "RM Return Submitted — Awaiting Store Approval");
    assert.equal(statuses[0].ownerRole, "PRODUCTION");
    assert.equal(statuses[0].href, null);
  });

  it("fetchPurchaseProcurementPendingActions does not emit Create GRN actions", async () => {
    const actions = await fetchPurchaseProcurementPendingActions({
      materialRequirement: { findMany: async () => [] },
      purchaseRequest: { findMany: async () => [] },
      rmPurchaseOrder: { findMany: async () => [] },
      purchaseRequestLineSourceLink: { findMany: async () => [] },
    });
    assert.equal(actions.filter((a) => a.action === "Create GRN" || a.action === "GRN Pending").length, 0);
  });

  it("mapProcurementQueueRowToPurchasePendingAction maps Monthly Planning approved MR to Create Purchase Request", () => {
    const action = mapProcurementQueueRowToPurchasePendingAction({
      materialRequirementId: 201,
      docNo: "MR-26-0201",
      workOrderId: 10,
      salesOrderId: null,
      sourceType: "MONTHLY_PLAN",
      procurementDemandPool: "MPRS",
      operationalKey: "PROCUREMENT_PENDING",
      nextActionKey: "CREATE_PR",
      createdAt: "2026-05-01T10:00:00.000Z",
    });
    assert.ok(action);
    assert.equal(action.action, "Create Purchase Request");
    assert.equal(action.ownerRole, "PURCHASE");
    assert.equal(action.id, "procurement:create-pr:mr:201");
    assert.equal(action.currentStatus, "PROCUREMENT_PENDING");
    assert.match(action.href, /demandPool=MPRS/);
    assert.match(action.href, /materialRequirementId=201/);
    assert.match(action.href, /returnTo=pending-actions/);
  });

  it("NO_QTY SO/RS MR never maps to Create Purchase Request — Regular SO (flow isolation)", () => {
    const noQtySalesOrderMr = mapProcurementQueueRowToPurchasePendingAction({
      materialRequirementId: 501,
      docNo: "MR-26-0501",
      salesOrderId: 24,
      salesOrderDocNo: "SO-26-0002",
      sourceType: "SALES_ORDER",
      procurementDemandPool: "REGULAR_SO",
      orderType: "NO_QTY",
      salesOrderOrderType: "NO_QTY",
      operationalKey: "PROCUREMENT_PENDING",
      nextActionKey: "CREATE_PR",
      totalShortageQty: 9000,
      createdAt: "2026-06-01T10:00:00.000Z",
    });
    assert.equal(noQtySalesOrderMr, null);

    const noQtyWoPlanningMr = mapProcurementQueueRowToPurchasePendingAction({
      materialRequirementId: 502,
      docNo: "MR-26-0502",
      salesOrderId: 24,
      salesOrderDocNo: "SO-26-0002",
      sourceType: "WORK_ORDER_PLANNING",
      orderType: "NO_QTY",
      operationalKey: "PROCUREMENT_PENDING",
      nextActionKey: "CREATE_PR",
      createdAt: "2026-06-01T10:00:00.000Z",
    });
    assert.equal(noQtyWoPlanningMr, null);

    // MPRS Create PR remains valid for NO_QTY after Monthly Plan release — never Regular SO label.
    const noQtyMonthlyPlanMr = mapProcurementQueueRowToPurchasePendingAction({
      materialRequirementId: 503,
      docNo: "MR-26-0503",
      salesOrderId: 24,
      salesOrderDocNo: "SO-26-0002",
      sourceType: "MONTHLY_PLAN",
      procurementDemandPool: "MPRS",
      orderType: "NO_QTY",
      operationalKey: "PROCUREMENT_PENDING",
      nextActionKey: "CREATE_PR",
      createdAt: "2026-06-01T10:00:00.000Z",
    });
    assert.ok(noQtyMonthlyPlanMr);
    assert.equal(noQtyMonthlyPlanMr.action, "Create Purchase Request");
    assert.notEqual(noQtyMonthlyPlanMr.action, "Create Purchase Request — Regular SO");
    assert.match(noQtyMonthlyPlanMr.href, /demandPool=MPRS/);
  });

  it("Regular SO Create PR queue count ignores NO_QTY rows", () => {
    const queueRows = [
      {
        materialRequirementId: 601,
        docNo: "MR-REG",
        sourceType: "SALES_ORDER",
        procurementDemandPool: "REGULAR_SO",
        orderType: "NORMAL",
        operationalKey: "PROCUREMENT_PENDING",
        nextActionKey: "CREATE_PR",
        createdAt: "2026-06-01T10:00:00.000Z",
      },
      {
        materialRequirementId: 602,
        docNo: "MR-NQ",
        sourceType: "SALES_ORDER",
        procurementDemandPool: "REGULAR_SO",
        orderType: "NO_QTY",
        salesOrderOrderType: "NO_QTY",
        salesOrderId: 24,
        salesOrderDocNo: "SO-26-0002",
        operationalKey: "PROCUREMENT_PENDING",
        nextActionKey: "CREATE_PR",
        createdAt: "2026-06-01T11:00:00.000Z",
      },
    ];
    const purchaseActions = queueRows
      .map((row) => mapProcurementQueueRowToPurchasePendingAction(row))
      .filter(Boolean);
    assert.equal(purchaseActions.length, 1);
    assert.equal(purchaseActions[0].action, "Create Purchase Request — Regular SO");
    assert.equal(purchaseActions[0].id, "procurement:create-pr:mr:601");
  });

  it("mapProcurementQueueRowToPurchasePendingAction maps PR pending PO to Prepare RM PO", () => {
    const action = mapProcurementQueueRowToPurchasePendingAction({
      materialRequirementId: 99,
      docNo: "MR-26-0099",
      sourceType: "MONTHLY_PLAN",
      procurementDemandPool: "MPRS",
      operationalKey: "PR_PENDING_PO",
      nextActionKey: "CREATE_PO",
      createdAt: "2026-05-02T10:00:00.000Z",
    });
    assert.ok(action);
    assert.equal(action.action, PREPARE_RM_PO);
    assert.equal(action.id, "procurement:create-po:mr:99");
    assert.equal(action.currentStatus, "PR_PENDING_PO");
    assert.match(action.href, /demandPool=MPRS/);
  });

  it("mapProcurementQueueRowToPurchasePendingAction excludes GRN pending rows", () => {
    const action = mapProcurementQueueRowToPurchasePendingAction({
      materialRequirementId: 88,
      operationalKey: "GRN_PENDING",
      nextActionKey: "OPEN_GRN",
      primaryPoId: 112,
    });
    assert.equal(action, null);
  });

  it("procurement queue projection count matches actionable Purchase rows", () => {
    const queueRows = [
      {
        materialRequirementId: 201,
        docNo: "MR-26-0201",
        sourceType: "MONTHLY_PLAN",
        procurementDemandPool: "MPRS",
        operationalKey: "PROCUREMENT_PENDING",
        nextActionKey: "CREATE_PR",
        createdAt: "2026-05-01T10:00:00.000Z",
      },
      {
        materialRequirementId: 202,
        docNo: "MR-26-0202",
        sourceType: "SALES_ORDER",
        procurementDemandPool: "REGULAR_SO",
        operationalKey: "PROCUREMENT_PENDING",
        nextActionKey: "CREATE_PR",
        createdAt: "2026-05-01T11:00:00.000Z",
      },
      {
        materialRequirementId: 203,
        docNo: "MR-26-0203",
        sourceType: "MONTHLY_PLAN",
        procurementDemandPool: "MPRS",
        operationalKey: "PR_PENDING_PO",
        nextActionKey: "CREATE_PO",
        createdAt: "2026-05-01T12:00:00.000Z",
      },
      {
        materialRequirementId: 204,
        docNo: "MR-26-0204",
        operationalKey: "GRN_PENDING",
        nextActionKey: "OPEN_GRN",
        primaryPoId: 50,
      },
    ];
    const purchaseActions = queueRows
      .map((row) => mapProcurementQueueRowToPurchasePendingAction(row))
      .filter(Boolean);
    assert.equal(purchaseActions.length, 3);
    assert.equal(
      purchaseActions.filter((a) => String(a.action).startsWith("Create Purchase Request")).length,
      2,
    );
    assert.equal(
      purchaseActions.filter((a) => a.action === "Create Purchase Request — Regular SO").length,
      1,
    );
    assert.equal(
      purchaseActions.filter((a) => a.action === "Create Purchase Request").length,
      1,
    );
    assert.equal(
      purchaseActions.filter((a) => a.action === PREPARE_RM_PO).length,
      1,
    );
  });

  it("after PR creation projection shifts from Create Purchase Request to Prepare RM PO", () => {
    const beforePr = mapProcurementQueueRowToPurchasePendingAction({
      materialRequirementId: 301,
      docNo: "MR-26-0301",
      sourceType: "MONTHLY_PLAN",
      procurementDemandPool: "MPRS",
      operationalKey: "PROCUREMENT_PENDING",
      nextActionKey: "CREATE_PR",
    });
    const afterPr = mapProcurementQueueRowToPurchasePendingAction({
      materialRequirementId: 301,
      docNo: "MR-26-0301",
      sourceType: "MONTHLY_PLAN",
      procurementDemandPool: "MPRS",
      operationalKey: "PR_PENDING_PO",
      nextActionKey: "CREATE_PO",
    });
    assert.equal(beforePr.action, "Create Purchase Request");
    assert.equal(afterPr.action, PREPARE_RM_PO);
    assert.notEqual(beforePr.id, afterPr.id);
    assert.equal(beforePr.materialRequirementId, afterPr.materialRequirementId);
  });

  it("dedupes Purchase CREATE_PR supplemental with normalized RM_RISK row for same MR", () => {
    const deduped = dedupePendingActionsByProcurementCase([
      {
        id: "rm-risk:wo:1:rm:10",
        priority: PENDING_PRIORITY.LOW,
        action: "Create Purchase Request",
        documentNo: "WO-26-0001",
        ownerRole: "PURCHASE",
        ageHours: 2,
        href: "/procurement-planning?returnTo=pending-actions&demandPool=MPRS&materialRequirementId=401&workOrderId=1",
        currentStatus: "PROCUREMENT_PENDING",
        materialRequirementId: 401,
      },
      {
        id: "procurement:create-pr:mr:401",
        priority: PENDING_PRIORITY.LOW,
        action: "Create Purchase Request",
        documentNo: "MR-26-0401",
        ownerRole: "PURCHASE",
        ageHours: 1,
        href: "/procurement-planning?returnTo=pending-actions&demandPool=MPRS&materialRequirementId=401",
        currentStatus: "PROCUREMENT_PENDING",
        materialRequirementId: 401,
      },
    ]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].id, "procurement:create-pr:mr:401");
    assert.equal(deduped[0].documentNo, "MR-26-0401");
  });

  it("dedupes Store Create GRN actions by PO, preferring supplemental PO doc over RM_RISK WO doc", () => {
    const deduped = dedupePendingActionsByProcurementCase([
      {
        id: "rm-risk:wo:1:rm:10",
        priority: PENDING_PRIORITY.LOW,
        action: "Create GRN",
        documentNo: "WO-26-0001",
        ownerRole: "STORE",
        ageHours: null,
        href: "/rm-po-grn/112?openGrn=1&from=pending-actions",
        currentStatus: "GRN_PENDING",
        purchaseOrderId: 112,
        materialRequirementId: 99,
      },
      {
        id: "procurement:grn:po:112",
        priority: PENDING_PRIORITY.LOW,
        action: "Create GRN",
        documentNo: "RMPO-112",
        ownerRole: "STORE",
        ageHours: null,
        href: "/rm-po-grn/112?openGrn=1&from=pending-actions",
        currentStatus: "GRN_PENDING",
        purchaseOrderId: 112,
      },
    ]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].documentNo, "RMPO-112");
    assert.equal(deduped[0].id, "procurement:grn:po:112");
  });

  it("Store Create GRN maps from normalized RM_RISK row with PO detail openGrn href", () => {
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
    assert.equal(action.action, "Create GRN");
    assert.equal(action.ownerRole, "STORE");
    assert.equal(action.currentStatus, "GRN_PENDING");
    assert.match(action.href, /\/rm-po-grn\/112\?/);
    assert.match(action.href, /openGrn=1/);
    assert.doesNotMatch(action.href, /\/dashboard/);
  });

  it("dedupes Production pending actions by WO, preferring execution-state label over Ready to Start", () => {
    const deduped = dedupeProductionPendingActions([
      {
        id: "rm-risk:wo:1:rm:10",
        priority: PENDING_PRIORITY.LOW,
        action: READY_TO_START_PRODUCTION,
        documentNo: "WO-26-0001",
        ownerRole: "PRODUCTION",
        ageHours: 1,
        href: "/production?workOrderId=1&returnTo=pending-actions",
      },
      {
        id: "production:wo:1:line:10",
        priority: PENDING_PRIORITY.LOW,
        action: PRODUCTION_EXECUTION_PENDING_LABELS.BLOCKED,
        documentNo: "WO-26-0001",
        ownerRole: "PRODUCTION",
        ageHours: 5,
        href: "/production?workOrderId=1&from=pending-actions",
      },
    ]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].action, PRODUCTION_EXECUTION_PENDING_LABELS.BLOCKED);
    assert.equal(deduped[0].id, "production:wo:1:line:10");
  });

  it("dedupes Production pending actions by WO, preferring Ready to Start over legacy Production Pending", () => {
    const deduped = dedupeProductionPendingActions([
      {
        id: "production:wo:1:line:10",
        priority: PENDING_PRIORITY.LOW,
        action: "Production Pending",
        documentNo: "WO-26-0001",
        ownerRole: "PRODUCTION",
        ageHours: 5,
        href: "/production?workOrderId=1&from=pending-actions",
      },
      {
        id: "rm-risk:wo:1:rm:10",
        priority: PENDING_PRIORITY.LOW,
        action: READY_TO_START_PRODUCTION,
        documentNo: "WO-26-0001",
        ownerRole: "PRODUCTION",
        ageHours: 1,
        href: "/production?workOrderId=1&returnTo=pending-actions",
      },
    ]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].action, READY_TO_START_PRODUCTION);
    assert.equal(deduped[0].id, "rm-risk:wo:1:rm:10");
  });

  it("maps READY_TO_RELEASE_WO RM risk row to Ready to Start Production when released and execution not started", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 1,
      workOrderNo: "WO-26-0001",
      itemId: 10,
      queueType: "READY_TO_RELEASE_WO",
      workOrderReleased: true,
      procurementCompletedForCase: true,
      mrStatus: "FULLY_PROCURED",
      productionExecutionStatus: "NOT_STARTED",
    });
    assert.equal(row.currentOwner, VISIBLE_OWNERS.PRODUCTION);
    const action = mapNormalizedRowToPendingAction(row, "PRODUCTION");
    assert.equal(action.action, READY_TO_START_PRODUCTION);
    assert.match(action.href, /\/production/);
    assert.match(action.href, /productionBucket=readyToStart/);
    assert.match(action.href, /from=pending-actions/);
  });

  it("maps READY_TO_RELEASE_WO directly to Production without a separate Store release step", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 1,
      workOrderNo: "WO-26-0001",
      itemId: 10,
      queueType: "READY_TO_RELEASE_WO",
      workOrderReleased: false,
      procurementCompletedForCase: true,
      mrStatus: "FULLY_PROCURED",
    });
    assert.equal(row.currentOwner, VISIBLE_OWNERS.PRODUCTION);
    const action = mapNormalizedRowToPendingAction(row, "PRODUCTION");
    assert.equal(action.action, READY_TO_START_PRODUCTION);
    assert.match(action.href, /^\/production\?/);
  });

  it("does not map READY_TO_RELEASE_WO to Release to Production when production entries exist", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 1,
      workOrderNo: "WO-26-0001",
      itemId: 10,
      queueType: "READY_TO_RELEASE_WO",
      workOrderReleased: false,
      hasProductionEntry: true,
      procurementCompletedForCase: true,
      mrStatus: "FULLY_PROCURED",
      productionExecutionStatus: "RUNNING",
    });
    const action = mapNormalizedRowToPendingAction(row, "STORE");
    assert.notEqual(action.action, "Release to Production");
  });

  it("maps READY_TO_RELEASE_WO RM risk row to Production Paused when execution is blocked", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 1,
      workOrderNo: "WO-26-0001",
      itemId: 10,
      queueType: "READY_TO_RELEASE_WO",
      workOrderReleased: true,
      procurementCompletedForCase: true,
      mrStatus: "FULLY_PROCURED",
      productionExecutionStatus: "BLOCKED",
    });
    const action = mapNormalizedRowToPendingAction(row, "PRODUCTION");
    assert.equal(action.action, PRODUCTION_EXECUTION_PENDING_LABELS.BLOCKED);
  });

  it("maps production queue row to Continue Production when execution is RUNNING", () => {
    const row = normalizeProductionRow({
      workOrderId: 1,
      workOrderLineId: 10,
      workOrderNo: "WO-26-0001",
      salesOrderId: 5,
      nextAction: "PRODUCTION_PENDING",
      productionExecutionStatus: "RUNNING",
      status: "OPEN",
    });
    const action = mapNormalizedRowToPendingAction(row, "PRODUCTION");
    assert.equal(action.action, PRODUCTION_EXECUTION_PENDING_LABELS.RUNNING);
    assert.match(action.href, /workOrderId=1/);
  });

  it("production pending document label uses business WO number, not internal id", () => {
    const row = normalizeProductionRow({
      workOrderId: 307,
      workOrderLineId: 10,
      workOrderNo: "WO-26-0001",
      salesOrderId: 5,
      nextAction: "PRODUCTION_PENDING",
      productionExecutionStatus: "NOT_STARTED",
      status: "PENDING",
    });
    const action = mapNormalizedRowToPendingAction(row, "PRODUCTION");
    assert.equal(action.documentNo, "WO-26-0001");
    assert.notEqual(action.documentNo, "WO-307");
    assert.match(action.href, /workOrderId=307/);
  });

  it("Continue Production row displays business WO number and routes by internal id", () => {
    const row = normalizeContinueWorkingRow({
      key: "so-5",
      salesOrderId: 5,
      salesOrderDocNo: "SO-26-0001",
      workOrderId: 307,
      workOrderLineId: 410,
      workOrderNo: "WO-26-0001",
      stageKey: "PRODUCTION",
      nextAction: "PRODUCTION_PENDING",
      nextStep: "Continue Production",
      href: "/production?workOrderId=307&from=dashboard",
      orderType: "NO_QTY",
      cycleId: 12,
    });
    const action = mapNormalizedRowToPendingAction(row, "PRODUCTION");
    assert.equal(action.action, PRODUCTION_EXECUTION_PENDING_LABELS.RUNNING);
    assert.match(String(action.documentNo ?? ""), /WO-26-0001/);
    assert.match(action.href, /workOrderId=307/);
    assert.match(action.href, /workOrderLineId=410/);
    assert.match(action.href, /flow=NO_QTY/);
    assert.match(action.href, /salesOrderId=5/);
    assert.match(action.href, /from=pending-actions/);
    assert.match(action.href, /productionBucket=inProgress/);
  });

  it("filters terminal completed WOs from Production pending actions", async () => {
    const actions = [
      {
        id: "production:wo:307:line:10",
        priority: PENDING_PRIORITY.LOW,
        action: PRODUCTION_EXECUTION_PENDING_LABELS.RUNNING,
        documentNo: "WO-26-0001",
        ownerRole: "PRODUCTION",
        href: "/production?workOrderId=307&from=pending-actions",
      },
    ];
    const filtered = await filterExecutableProductionPendingActions({
      workOrder: {
        findMany: async () => [{ id: 307, status: "COMPLETED", productionExecution: { executionStatus: "COMPLETED" } }],
      },
      materialIssueNote: {
        findMany: async () => [{ workOrderId: 307 }],
      },
    }, actions);
    assert.equal(filtered.length, 0);
  });

  it("keeps only executable Production WOs with issued RM", async () => {
    const actions = [
      {
        id: "production:wo:307:line:10",
        priority: PENDING_PRIORITY.LOW,
        action: READY_TO_START_PRODUCTION,
        documentNo: "WO-26-0001",
        ownerRole: "PRODUCTION",
        href: "/production?workOrderId=307&returnTo=pending-actions",
      },
      {
        id: "production:wo:308:line:11",
        priority: PENDING_PRIORITY.LOW,
        action: READY_TO_START_PRODUCTION,
        documentNo: "WO-26-0002",
        ownerRole: "PRODUCTION",
        href: "/production?workOrderId=308&returnTo=pending-actions",
      },
    ];
    const filtered = await filterExecutableProductionPendingActions({
      workOrder: {
        findMany: async () => [
          { id: 307, status: "PENDING", productionExecution: { executionStatus: "NOT_STARTED" } },
          { id: 308, status: "PENDING", productionExecution: { executionStatus: "NOT_STARTED" } },
        ],
      },
      materialIssueNote: {
        findMany: async () => [{ workOrderId: 307 }],
      },
    }, actions);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].documentNo, "WO-26-0001");
  });
  it("filterNoQtyStoreHandoffSupersededByLaterRs drops Cycle 1 handoff when Cycle 2 RS exists", async () => {
    const db = {
      workOrder: {
        findMany: async () => [
          {
            id: 10,
            salesOrderId: 168,
            salesOrder: { orderType: "NO_QTY" },
            cycle: { cycleNo: 1 },
          },
        ],
      },
      requirementSheet: {
        findMany: async () => [{ salesOrderId: 168, cycle: { cycleNo: 2 } }],
      },
    };
    const filtered = await filterNoQtyStoreHandoffSupersededByLaterRs(db, [
      { workOrderId: 10, salesOrderId: 168 },
    ]);
    assert.equal(filtered.length, 0);
  });

  it("filterNoQtyStoreHandoffSupersededByLaterRs keeps handoff when no later-cycle RS exists", async () => {
    const db = {
      workOrder: {
        findMany: async () => [
          {
            id: 11,
            salesOrderId: 168,
            salesOrder: { orderType: "NO_QTY" },
            cycle: { cycleNo: 1 },
          },
        ],
      },
      requirementSheet: {
        findMany: async () => [{ salesOrderId: 168, cycle: { cycleNo: 1 } }],
      },
    };
    const filtered = await filterNoQtyStoreHandoffSupersededByLaterRs(db, [
      { workOrderId: 11, salesOrderId: 168 },
    ]);
    assert.equal(filtered.length, 1);
  });

  it("filterNoQtyStoreHandoffSupersededByLaterRs does not affect regular SO handoff rows", async () => {
    const db = {
      workOrder: {
        findMany: async () => [
          {
            id: 12,
            salesOrderId: 50,
            salesOrder: { orderType: "NORMAL" },
            cycle: { cycleNo: 1 },
          },
        ],
      },
      requirementSheet: { findMany: async () => [] },
    };
    const filtered = await filterNoQtyStoreHandoffSupersededByLaterRs(db, [
      { workOrderId: 12, salesOrderId: 50 },
    ]);
    assert.equal(filtered.length, 1);
  });

  it("maps CONTINUE_WORKING NEXT_RS to Create Cycle N Requirement Sheet for Store", () => {
    const row = normalizeContinueWorkingRow({
      key: "so-1-nqrs",
      salesOrderId: 1,
      salesOrderDocNo: "SO-26-0001",
      customerName: "Acme",
      orderType: "NO_QTY",
      cycleNo: 1,
      stageKey: "NEXT_RS",
      nextAction: "NEXT_RS_REQUIRED",
      href: "/sales-orders/1/requirement-sheets?intent=add&source=no_qty_so&salesOrderId=1&cycleId=3",
    });
    assert.equal(row.currentOwner, VISIBLE_OWNERS.STORE);
    const action = mapNormalizedRowToPendingAction(row, "STORE");
    assert.equal(action.action, "Create Cycle 2 Requirement Sheet");
    assert.equal(action.ownerRole, "STORE");
    assert.match(action.href, /^\/planning-dashboard\?/);
    assert.match(action.href, /salesOrderId=1/);
    assert.match(action.href, /nextCycleNo=2/);
    assert.match(action.href, /action=create-next-rs/);
    assert.match(action.href, /source=no_qty_planning/);
    assert.doesNotMatch(action.href, /requirement-sheets/);
    const storeFiltered = filterNormalizedRowsByOwner([row], "STORE");
    assert.equal(storeFiltered.length, 1);
    const adminFiltered = filterNormalizedRowsByOwner([row], "ADMIN");
    assert.equal(adminFiltered.length, 0);
  });

  it("buildNoQtyCreateNextRsPlanningHubHref targets Requirement and Cycle Planning with next cycle context", () => {
    const href = buildNoQtyCreateNextRsPlanningHubHref(10, {
      nextCycleNo: 2,
      from: "pending-actions",
    });
    assert.match(href, /^\/planning-dashboard\?/);
    assert.match(href, /salesOrderId=10/);
    assert.match(href, /nextCycleNo=2/);
    assert.match(href, /action=create-next-rs/);
    assert.match(href, /from=pending-actions/);
    assert.doesNotMatch(href, /requirement-sheets/);
  });

  it("fetchStoreNoQtyCreateNextRsPendingActions emits Cycle 2 RS when eligible (execution may continue)", async () => {
    const eligibilityPath = require.resolve("../../src/services/noQtyCreateNextRsEligibility");
    const pendingPath = require.resolve("../../src/services/pendingActionsService");
    const origEligibility = require(eligibilityPath);
    const origCompute = origEligibility.computeNoQtyCreateNextRsEligibilityResolved;
    const origResolve = origEligibility.resolveNoQtyEligibilityCycleId;

    require(eligibilityPath).computeNoQtyCreateNextRsEligibilityResolved = async () => ({
      eligible: true,
      reason: "OK",
    });
    require(eligibilityPath).resolveNoQtyEligibilityCycleId = async () => ({
      cycleId: 5,
      source: "ACTIVE",
    });

    delete require.cache[pendingPath];
    const { fetchStoreNoQtyCreateNextRsPendingActions: fetchNextRs } = require(pendingPath);

    // Fixture represents the real eligibility surface (assertPeriodWriteAllowed is not involved
    // here): active cycle 1 has a LOCKED RS and a WO, so execution may continue while the next
    // RS is eligible. salesOrder.findUnique is required by the eligibility resolver's fallback.
    const db = {
      salesOrder: {
        findMany: async () => [{ id: 10, docNo: "SO-26-0001", updatedAt: new Date() }],
        findUnique: async ({ where }) => ({
          id: Number(where.id),
          orderType: "NO_QTY",
          internalStatus: "IN_PROGRESS",
          currentCycleId: 3,
        }),
      },
      salesOrderCycle: {
        findFirst: async (args) => {
          const w = args?.where ?? {};
          if (w.status === "ACTIVE") return { id: 3, cycleNo: 1 };
          if (w.status === "CLOSED") return null;
          if (Number(w.id) === 3) return { id: 3, cycleNo: 1 };
          return null;
        },
      },
      requirementSheet: {
        findFirst: async (args) => {
          const w = args?.where ?? {};
          if (w.cycle?.cycleNo?.gt != null) return null; // no sheet/draft on a later cycle yet
          if (Number(w.cycleId) === 3) return { id: 71, status: "LOCKED", updatedAt: new Date() };
          return null;
        },
      },
      workOrder: {
        findFirst: async () => ({ id: 900 }),
      },
    };

    try {
      const actions = await fetchNextRs(db);
      assert.equal(actions.length, 1);
      assert.equal(actions[0].action, "Create Cycle 2 Requirement Sheet");
      assert.equal(actions[0].ownerRole, "STORE");
      assert.equal(actions[0].documentNo, "SO-26-0001");
      assert.match(actions[0].href, /^\/planning-dashboard\?/);
      assert.match(actions[0].href, /salesOrderId=10/);
      assert.match(actions[0].href, /nextCycleNo=2/);
      assert.match(actions[0].href, /action=create-next-rs/);
      assert.doesNotMatch(actions[0].href, /requirement-sheets/);
    } finally {
      require(eligibilityPath).computeNoQtyCreateNextRsEligibilityResolved = origCompute;
      require(eligibilityPath).resolveNoQtyEligibilityCycleId = origResolve;
      delete require.cache[pendingPath];
      require(pendingPath);
    }
  });

  it("fetchStoreNoQtyCreateNextRsPendingActions emits Cycle 2 RS when ACTIVE cycle is empty after advance", async () => {
    const eligibilityPath = require.resolve("../../src/services/noQtyCreateNextRsEligibility");
    const pendingPath = require.resolve("../../src/services/pendingActionsService");
    const origEligibility = require(eligibilityPath);
    const origCompute = origEligibility.computeNoQtyCreateNextRsEligibility;
    const origResolved = origEligibility.computeNoQtyCreateNextRsEligibilityResolved;

    require(eligibilityPath).computeNoQtyCreateNextRsEligibility = async (_db, input) => {
      if (Number(input?.cycleId) === 333) {
        return { eligible: true, reason: "OK", existingNextRsDocNo: null, existingNextRsId: null };
      }
      return { eligible: false, reason: "NO_LOCKED_RS", existingNextRsDocNo: null, existingNextRsId: null };
    };
    require(eligibilityPath).computeNoQtyCreateNextRsEligibilityResolved = async () => ({
      eligible: false,
      reason: "NO_LOCKED_RS",
    });

    delete require.cache[pendingPath];
    const { fetchStoreNoQtyCreateNextRsPendingActions: fetchNextRs } = require(pendingPath);

    // Active cycle 2 (334) is empty after advance; prior CLOSED cycle 1 (333) has a LOCKED RS + WO,
    // so it is eligible and the next-RS action must target Cycle 2. salesOrder.findUnique and the
    // id-scoped cycle/RS/WO lookups are required by the real eligibility path.
    const db = {
      salesOrder: {
        findMany: async () => [{ id: 199, docNo: "SO-26-0001", updatedAt: new Date() }],
        findUnique: async ({ where }) => ({
          id: Number(where.id),
          orderType: "NO_QTY",
          internalStatus: "IN_PROGRESS",
          currentCycleId: 334,
        }),
      },
      salesOrderCycle: {
        findFirst: async (args) => {
          const w = args?.where ?? {};
          if (w.status === "ACTIVE") return { id: 334, cycleNo: 2 };
          if (w.status === "CLOSED") return { id: 333, cycleNo: 1 };
          if (Number(w.id) === 333) return { id: 333, cycleNo: 1 };
          if (Number(w.id) === 334) return { id: 334, cycleNo: 2 };
          return null;
        },
      },
      requirementSheet: {
        findFirst: async (args) => {
          const w = args?.where ?? {};
          if (w.cycle?.cycleNo?.gt != null) return null; // no sheet/draft ahead of cycle 1
          if (Number(w.cycleId) === 334) return null; // active cycle 2 is empty
          if (Number(w.cycleId) === 333) return { id: 81, status: "LOCKED", updatedAt: new Date("2026-05-01") };
          return null;
        },
      },
      workOrder: {
        findFirst: async () => ({ id: 901 }),
      },
    };

    try {
      const actions = await fetchNextRs(db);
      assert.equal(actions.length, 1);
      assert.equal(actions[0].action, "Create Cycle 2 Requirement Sheet");
      assert.equal(actions[0].ownerRole, "STORE");
      assert.match(String(actions[0].href), /^\/planning-dashboard\?/);
      assert.match(String(actions[0].href), /salesOrderId=199/);
      assert.match(String(actions[0].href), /nextCycleNo=2/);
      assert.match(String(actions[0].href), /action=create-next-rs/);
      assert.doesNotMatch(String(actions[0].href), /requirement-sheets/);
    } finally {
      require(eligibilityPath).computeNoQtyCreateNextRsEligibility = origCompute;
      require(eligibilityPath).computeNoQtyCreateNextRsEligibilityResolved = origResolved;
      delete require.cache[pendingPath];
      require(pendingPath);
    }
  });

  it("fetchStoreNoQtyMonthlyPlanningPendingActions emits Prepare Monthly Planning — NO_QTY when no period plan exists", async () => {
    await withMonthlyPlanningEnabled(true, async () => {
      const executionPath = require.resolve("../../src/services/requirementSheetExecutionService");
      const gatePath = require.resolve("../../src/services/noQtyMonthlyPlanningGateService");
      const pendingPath = require.resolve("../../src/services/pendingActionsService");
      const origExecution = require(executionPath);
      const origGate = require(gatePath);
      const origAssess = origExecution.assessNoQtyPlacementStageForCycle;
      const origPlanningGate = origGate.assessNoQtyMonthlyPlanningGate;

      require(executionPath).assessNoQtyPlacementStageForCycle = async () => ({
        readyToPlaceWo: false,
        processStageKey: "NO_QTY_REQUIREMENT_READY",
        requirementSheetId: 18,
        requirementSheetDocNo: "RS-26-0001",
        rsBalanceQty: 15000,
        skipMonthlyPlanning: false,
        readinessStatus: "AWAITING_PROCUREMENT",
      });
      require(gatePath).assessNoQtyMonthlyPlanningGate = async () => ({
        gate: "INITIAL_PLAN_REQUIRED",
        action: "Prepare Monthly Planning — NO_QTY",
        plan: null,
      });

      delete require.cache[pendingPath];
      const { fetchStoreNoQtyMonthlyPlanningPendingActions: fetchMonthlyPlanning } = require(pendingPath);
      const db = {
        salesOrder: {
          findMany: async () => [{ id: 24, docNo: "SO-26-0002", updatedAt: new Date("2026-06-01T00:00:00Z") }],
        },
        requirementSheet: {
          findMany: async () => [
            {
              id: 18,
              docNo: "RS-26-0001",
              salesOrderId: 24,
              cycleId: 5,
              periodKey: "2026-06",
              createdAt: new Date("2026-06-01T00:00:00Z"),
              updatedAt: new Date("2026-06-01T00:00:00Z"),
              cycle: { cycleNo: 1 },
            },
          ],
        },
        requirementSheetLine: {
          findFirst: async () => ({ item: { itemName: "Cap", unit: "Nos" } }),
        },
        workOrder: { findMany: async () => [{ id: 99, salesOrderId: 24, cycleId: 5 }] },
      };

      try {
        const actions = await fetchMonthlyPlanning(db);
        assert.equal(actions.length, 1);
        assert.equal(actions[0].action, "Prepare Monthly Planning — NO_QTY");
        assert.equal(actions[0].currentStatus, "MONTHLY_PLANNING_PENDING");
        assert.match(String(actions[0].documentNo), /SO-26-0002/);
        assert.match(String(actions[0].documentNo), /RS-26-0001/);
        assert.match(String(actions[0].documentNo), /Cycle 1/);
        assert.match(String(actions[0].documentNo), /Cap/);
        assert.match(String(actions[0].documentNo), /15,000/);
        assert.match(actions[0].href, /\/monthly-planning\?/);
        assert.match(actions[0].href, /period=2026-06/);
        assert.match(actions[0].href, /salesOrderId=24/);
        assert.match(actions[0].href, /cycleId=5/);
        assert.match(actions[0].href, /requirementSheetId=18/);
        assert.match(actions[0].href, /from=pending-actions/);
        assert.equal(actions[0].metadata.orderType, "NO_QTY");
        assert.equal(actions[0].metadata.remainingRequirement, 15000);
      } finally {
        require(executionPath).assessNoQtyPlacementStageForCycle = origAssess;
        require(gatePath).assessNoQtyMonthlyPlanningGate = origPlanningGate;
        delete require.cache[pendingPath];
        require(pendingPath);
      }
    });
  });

  it("fetchStoreNoQtyMonthlyPlanningPendingActions still emits after stock-ready WO when remaining RS needs procurement", async () => {
    await withMonthlyPlanningEnabled(true, async () => {
      const executionPath = require.resolve("../../src/services/requirementSheetExecutionService");
      const gatePath = require.resolve("../../src/services/noQtyMonthlyPlanningGateService");
      const pendingPath = require.resolve("../../src/services/pendingActionsService");
      const origExecution = require(executionPath);
      const origGate = require(gatePath);
      const origAssess = origExecution.assessNoQtyPlacementStageForCycle;
      const origPlanningGate = origGate.assessNoQtyMonthlyPlanningGate;

      require(executionPath).assessNoQtyPlacementStageForCycle = async () => ({
        readyToPlaceWo: false,
        processStageKey: "NO_QTY_AWAITING_PROCUREMENT",
        requirementSheetId: 18,
        requirementSheetDocNo: "RS-26-0001",
        rsBalanceQty: 12000,
        skipMonthlyPlanning: false,
        readinessStatus: "AWAITING_PROCUREMENT",
        allowWoWithoutPlanRelease: true,
      });
      // Period already released for another SO — must not hide this SO's remaining demand.
      require(gatePath).assessNoQtyMonthlyPlanningGate = async () => ({
        gate: "READY_FOR_EXECUTION",
        action: null,
        plan: { id: 9 },
      });

      delete require.cache[pendingPath];
      const { fetchStoreNoQtyMonthlyPlanningPendingActions: fetchMonthlyPlanning } = require(pendingPath);
      const db = {
        salesOrder: {
          findMany: async () => [{ id: 24, docNo: "SO-26-0002", updatedAt: new Date("2026-06-01T00:00:00Z") }],
        },
        requirementSheet: {
          findMany: async () => [
            {
              id: 18,
              docNo: "RS-26-0001",
              salesOrderId: 24,
              cycleId: 5,
              periodKey: "2026-06",
              createdAt: new Date("2026-06-01T00:00:00Z"),
              updatedAt: new Date("2026-06-01T00:00:00Z"),
              cycle: { cycleNo: 1 },
            },
          ],
        },
        requirementSheetLine: {
          findFirst: async () => ({ item: { itemName: "Cap", unit: "Nos" } }),
        },
        workOrder: { findMany: async () => [{ id: 99, salesOrderId: 24, cycleId: 5 }] },
      };

      try {
        const actions = await fetchMonthlyPlanning(db);
        assert.equal(actions.length, 1);
        assert.equal(actions[0].action, "Prepare Monthly Planning — NO_QTY");
        assert.match(actions[0].href, /salesOrderId=24/);
        assert.match(actions[0].href, /cycleId=5/);
        assert.match(actions[0].href, /requirementSheetId=18/);
        assert.equal(actions[0].metadata.remainingRequirement, 12000);
        assert.notEqual(actions[0].action, "View Planning Status");
      } finally {
        require(executionPath).assessNoQtyPlacementStageForCycle = origAssess;
        require(gatePath).assessNoQtyMonthlyPlanningGate = origPlanningGate;
        delete require.cache[pendingPath];
        require(pendingPath);
      }
    });
  });

  it("NO_QTY RM shortage does not map to Create Purchase Request — Regular SO", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 91,
      workOrderNo: "WO-26-0091",
      salesOrderId: 262,
      salesOrderNo: "SO-26-0002",
      orderType: "NO_QTY",
      itemId: 96,
      itemName: "PP",
      unit: "Kg",
      fgItemName: "Cap",
      shortageAfterReservationQty: 9000,
      queueType: "WO_BLOCKED_RM_SHORTAGE",
      freeStockQty: 0,
      netShortageAfterIncomingQty: 9000,
      materialRequirementId: null,
      sourceType: "SALES_ORDER",
      prLineCount: 0,
      poLineCount: 0,
      operationalKey: "PROCUREMENT_PENDING",
      nextActionKey: "CREATE_PR",
      procurementDemandPool: "REGULAR_SO",
      hasOpenMr: false,
    });
    assert.equal(row.metadata.orderType, "NO_QTY");
    const action = mapNormalizedRowToPendingAction(row, "STORE");
    assert.equal(action, null);
  });

  it("fetchStoreNoQtyMonthlyPlanningPendingActions skips when Net RM = 0 unlocks Place WO", async () => {
    await withMonthlyPlanningEnabled(true, async () => {
      const executionPath = require.resolve("../../src/services/requirementSheetExecutionService");
      const pendingPath = require.resolve("../../src/services/pendingActionsService");
      const origExecution = require(executionPath);
      const origAssess = origExecution.assessNoQtyPlacementStageForCycle;

      require(executionPath).assessNoQtyPlacementStageForCycle = async () => ({
        readyToPlaceWo: true,
        processStageKey: "NO_QTY_READY_TO_PLACE_WO",
        readinessStatus: "READY_TO_PLACE_WO",
        requirementSheetId: 18,
        skipMonthlyPlanning: true,
      });

      delete require.cache[pendingPath];
      const { fetchStoreNoQtyMonthlyPlanningPendingActions: fetchMonthlyPlanning } = require(pendingPath);
      const db = {
        salesOrder: {
          findMany: async () => [{ id: 24, docNo: "SO-26-0000", updatedAt: new Date("2026-06-01T00:00:00Z") }],
        },
        requirementSheet: {
          findMany: async () => [
            {
              id: 18,
              salesOrderId: 24,
              cycleId: 5,
              periodKey: "2026-06",
              createdAt: new Date("2026-06-01T00:00:00Z"),
              updatedAt: new Date("2026-06-01T00:00:00Z"),
              cycle: { cycleNo: 1 },
            },
          ],
        },
        workOrder: { findMany: async () => [] },
      };

      try {
        const actions = await fetchMonthlyPlanning(db);
        assert.equal(actions.length, 0);
      } finally {
        require(executionPath).assessNoQtyPlacementStageForCycle = origAssess;
        delete require.cache[pendingPath];
        require(pendingPath);
      }
    });
  });

  it("fetchStoreNoQtyMonthlyPlanningPendingActions still emits when mixed FG readiness (some ready, some short)", async () => {
    await withMonthlyPlanningEnabled(true, async () => {
      const executionPath = require.resolve("../../src/services/requirementSheetExecutionService");
      const gatePath = require.resolve("../../src/services/noQtyMonthlyPlanningGateService");
      const pendingPath = require.resolve("../../src/services/pendingActionsService");
      const origExecution = require(executionPath);
      const origGate = require(gatePath);
      const origAssess = origExecution.assessNoQtyPlacementStageForCycle;
      const origPlanningGate = origGate.assessNoQtyMonthlyPlanningGate;

      require(executionPath).assessNoQtyPlacementStageForCycle = async () => ({
        readyToPlaceWo: true,
        processStageKey: "NO_QTY_READY_TO_PLACE_WO",
        readinessStatus: "PARTIALLY_READY",
        requirementSheetId: 19,
        rsBalanceQty: 8000,
        skipMonthlyPlanning: false,
        allowWoWithoutPlanRelease: true,
      });
      require(gatePath).assessNoQtyMonthlyPlanningGate = async () => ({
        gate: "INITIAL_PLAN_REQUIRED",
        action: "Prepare Monthly Planning — NO_QTY",
      });

      delete require.cache[pendingPath];
      const { fetchStoreNoQtyMonthlyPlanningPendingActions: fetchMonthlyPlanning } = require(pendingPath);
      const db = {
        salesOrder: {
          findMany: async () => [{ id: 25, docNo: "SO-26-0025", updatedAt: new Date("2026-06-01T00:00:00Z") }],
        },
        requirementSheet: {
          findMany: async () => [
            {
              id: 19,
              salesOrderId: 25,
              cycleId: 6,
              periodKey: "2026-06",
              createdAt: new Date("2026-06-01T00:00:00Z"),
              updatedAt: new Date("2026-06-01T00:00:00Z"),
              cycle: { cycleNo: 1 },
            },
          ],
        },
        workOrder: { findMany: async () => [] },
      };

      try {
        const actions = await fetchMonthlyPlanning(db);
        assert.equal(actions.length, 1);
        assert.equal(actions[0].action, "Prepare Monthly Planning — NO_QTY");
        assert.equal(actions[0].metadata.mixedFgReadiness, true);
        assert.match(actions[0].href, /salesOrderId=25/);
        assert.match(actions[0].href, /cycleId=6/);
      } finally {
        require(executionPath).assessNoQtyPlacementStageForCycle = origAssess;
        require(gatePath).assessNoQtyMonthlyPlanningGate = origPlanningGate;
        delete require.cache[pendingPath];
        require(pendingPath);
      }
    });
  });

  it("fetchStoreNoQtyMonthlyPlanningPendingActions emits nothing when FEATURE_MONTHLY_PLANNING is OFF", async () => {
    await withMonthlyPlanningEnabled(false, async () => {
      const pendingPath = require.resolve("../../src/services/pendingActionsService");
      delete require.cache[pendingPath];
      const { fetchStoreNoQtyMonthlyPlanningPendingActions: fetchMonthlyPlanning } = require(pendingPath);
      const db = {
        salesOrder: {
          findMany: async () => {
            assert.fail("should not query when monthly planning flag is OFF");
          },
        },
      };
      try {
        const actions = await fetchMonthlyPlanning(db);
        assert.deepEqual(actions, []);
      } finally {
        delete require.cache[pendingPath];
        require(pendingPath);
      }
    });
  });

  it("fetchStoreNoQtyMonthlyPlanningPendingActions does not emit Additional Plan (period-scoped emitter owns it)", async () => {
    await withMonthlyPlanningEnabled(true, async () => {
      const executionPath = require.resolve("../../src/services/requirementSheetExecutionService");
      const gatePath = require.resolve("../../src/services/noQtyMonthlyPlanningGateService");
      const pendingPath = require.resolve("../../src/services/pendingActionsService");
      const origExecution = require(executionPath);
      const origGate = require(gatePath);
      const origAssess = origExecution.assessNoQtyPlacementStageForCycle;
      const origPlanningGate = origGate.assessNoQtyMonthlyPlanningGate;

      require(executionPath).assessNoQtyPlacementStageForCycle = async () => ({
        readyToPlaceWo: false,
        processStageKey: "NO_QTY_REQUIREMENT_READY",
        requirementSheetId: 20,
      });
      require(gatePath).assessNoQtyMonthlyPlanningGate = async () => ({
        gate: "ADDITIONAL_PLAN_REQUIRED",
        action: "Create Additional Monthly Plan",
        plan: {
          releasedAt: new Date("2026-06-10T00:00:00Z"),
          approvedAt: new Date("2026-06-09T00:00:00Z"),
        },
      });

      delete require.cache[pendingPath];
      const { fetchStoreNoQtyMonthlyPlanningPendingActions: fetchMonthlyPlanning } = require(pendingPath);
      const db = {
        salesOrder: {
          findMany: async () => [{ id: 25, docNo: "SO-26-0001", updatedAt: new Date("2026-06-01T00:00:00Z") }],
        },
        requirementSheet: {
          findMany: async () => [
            {
              id: 20,
              salesOrderId: 25,
              cycleId: 6,
              periodKey: "2026-06",
              createdAt: new Date("2026-06-01T00:00:00Z"),
              updatedAt: new Date("2026-06-01T00:00:00Z"),
              cycle: { cycleNo: 1 },
            },
          ],
        },
        workOrder: { findMany: async () => [] },
      };

      try {
        const actions = await fetchMonthlyPlanning(db);
        assert.equal(actions.length, 0);
      } finally {
        require(executionPath).assessNoQtyPlacementStageForCycle = origAssess;
        require(gatePath).assessNoQtyMonthlyPlanningGate = origPlanningGate;
        delete require.cache[pendingPath];
        require(pendingPath);
      }
    });
  });

  it("fetchStoreAdditionalMonthlyPlanPendingActions emits one Create Additional Monthly Plan from preview totals", async () => {
    await withMonthlyPlanningEnabled(true, async () => {
    const gatePath = require.resolve("../../src/services/noQtyMonthlyPlanningGateService");
    const pendingPath = require.resolve("../../src/services/pendingActionsService");
    const origGate = require(gatePath);
    const origPlanningGate = origGate.assessNoQtyMonthlyPlanningGate;

    require(gatePath).assessNoQtyMonthlyPlanningGate = async (_db, periodKey) => ({
      gate: "ADDITIONAL_PLAN_REQUIRED",
      action: "Create Additional Monthly Plan",
      plan: {
        id: 73,
        periodKey,
        planSequenceNo: 2,
        status: "APPROVED",
        updatedAt: new Date("2026-07-10T14:54:08Z"),
      },
      preview: {
        canCreate: true,
        nextPlanSequenceNo: 3,
        nextPlanLabel: "July Plan 3",
        approvedPlanCount: 2,
        totals: {
          totalAdditionalRequirementQty: 16768,
          additionalItemCount: 1,
          componentBreakdown: {
            newUncoveredRsDemand: 12000,
            productionShortfallCarryForward: 4768,
            qcRejectionCarryForward: 0,
            greenLevelQty: 0,
          },
        },
        items: [
          {
            unit: "Nos",
            hasAdditionalRequirement: true,
            uncoveredComponents: [
              {
                sourceKey: "RS_LINE:437:RS_BASE_DEMAND",
                componentType: "RS_BASE_DEMAND",
                requirementSheetId: 335,
                requirementSheetDocNo: "RS-26-0002",
                requirementSheetLineId: 437,
                salesOrderId: 224,
                cycleId: 382,
                cycleNo: 2,
                uncoveredQty: 12000,
              },
              {
                sourceKey: "RS_LINE:437:PRODUCTION_SHORTFALL",
                componentType: "PRODUCTION_SHORTFALL",
                requirementSheetId: 335,
                requirementSheetDocNo: "RS-26-0002",
                requirementSheetLineId: 437,
                salesOrderId: 224,
                cycleId: 382,
                cycleNo: 2,
                uncoveredQty: 3000,
              },
              {
                sourceKey: "RS_LINE:438:PRODUCTION_SHORTFALL",
                componentType: "PRODUCTION_SHORTFALL",
                requirementSheetId: 336,
                requirementSheetDocNo: "RS-26-0003",
                requirementSheetLineId: 438,
                salesOrderId: 224,
                cycleId: 383,
                cycleNo: 3,
                uncoveredQty: 1768,
              },
            ],
          },
        ],
      },
    });

    delete require.cache[pendingPath];
    const { fetchStoreAdditionalMonthlyPlanPendingActions: fetchAdditional } = require(pendingPath);
    const db = {
      monthlyProductionPlan: {
        findMany: async () => [{ periodKey: "2026-07" }],
      },
    };

    try {
      const actions = await fetchAdditional(db);
      assert.equal(actions.length, 1);
      assert.equal(actions[0].type, "NO_QTY_ADDITIONAL_PLAN_REQUIRED");
      assert.equal(actions[0].action, "Create Additional Monthly Plan");
      assert.equal(actions[0].ownerRole, "STORE");
      assert.equal(actions[0].qty, 16768);
      assert.equal(actions[0].uom, "Nos");
      assert.match(actions[0].documentNo, /July 2026 · Plan 3 · 16,768 Nos/);
      assert.match(actions[0].href, /period=2026-07/);
      assert.match(actions[0].href, /openAdditionalPlan=1/);
      assert.match(actions[0].href, /from=pending-actions/);
      assert.match(actions[0].href, /planId=73/);
      assert.equal(actions[0].metadata.componentBreakdown.newUncoveredRsDemand, 12000);
      assert.equal(actions[0].metadata.componentBreakdown.productionShortfallCarryForward, 4768);
      assert.equal(actions[0].metadata.fgItemCount, 1);
      assert.equal(actions[0].metadata.sourceIdentities.length, 3);
    } finally {
      require(gatePath).assessNoQtyMonthlyPlanningGate = origPlanningGate;
      delete require.cache[pendingPath];
      require(pendingPath);
    }
    });
  });

  it("fetchStoreAdditionalMonthlyPlanPendingActions emits nothing when FEATURE_MONTHLY_PLANNING is OFF", async () => {
    await withMonthlyPlanningEnabled(false, async () => {
      const pendingPath = require.resolve("../../src/services/pendingActionsService");
      delete require.cache[pendingPath];
      const { fetchStoreAdditionalMonthlyPlanPendingActions: fetchAdditional } = require(pendingPath);
      try {
        const actions = await fetchAdditional({
          monthlyProductionPlan: {
            findMany: async () => {
              assert.fail("should not query when monthly planning flag is OFF");
            },
          },
        });
        assert.deepEqual(actions, []);
      } finally {
        delete require.cache[pendingPath];
        require(pendingPath);
      }
    });
  });

  it("fetchMonthlyPlanPendingActions emits nothing when FEATURE_MONTHLY_PLANNING is OFF", async () => {
    await withMonthlyPlanningEnabled(false, async () => {
      const pendingPath = require.resolve("../../src/services/pendingActionsService");
      delete require.cache[pendingPath];
      const { fetchMonthlyPlanPendingActions } = require(pendingPath);
      try {
        const actions = await fetchMonthlyPlanPendingActions(
          {
            monthlyProductionPlan: {
              findMany: async () => {
                assert.fail("should not query when monthly planning flag is OFF");
              },
            },
          },
          { role: "STORE" },
        );
        assert.deepEqual(actions, []);
      } finally {
        delete require.cache[pendingPath];
        require(pendingPath);
      }
    });
  });

  it("fetchStoreAdditionalMonthlyPlanPendingActions emits for RS entered qty 0 when uncovered components remain", async () => {
    await withMonthlyPlanningEnabled(true, async () => {
    const gatePath = require.resolve("../../src/services/noQtyMonthlyPlanningGateService");
    const pendingPath = require.resolve("../../src/services/pendingActionsService");
    const origGate = require(gatePath);
    const origPlanningGate = origGate.assessNoQtyMonthlyPlanningGate;

    require(gatePath).assessNoQtyMonthlyPlanningGate = async () => ({
      gate: "ADDITIONAL_PLAN_REQUIRED",
      action: "Create Additional Monthly Plan",
      plan: { id: 1, periodKey: "2026-07", planSequenceNo: 2, status: "APPROVED" },
      preview: {
        canCreate: true,
        nextPlanSequenceNo: 3,
        nextPlanLabel: "July Plan 3",
        approvedPlanCount: 2,
        totals: {
          totalAdditionalRequirementQty: 4768,
          additionalItemCount: 1,
          componentBreakdown: {
            newUncoveredRsDemand: 0,
            productionShortfallCarryForward: 4768,
            qcRejectionCarryForward: 0,
            greenLevelQty: 0,
          },
        },
        items: [{ unit: "Nos", hasAdditionalRequirement: true, uncoveredComponents: [] }],
      },
    });

    delete require.cache[pendingPath];
    const { fetchStoreAdditionalMonthlyPlanPendingActions: fetchAdditional } = require(pendingPath);

    try {
      const actions = await fetchAdditional({
        monthlyProductionPlan: { findMany: async () => [{ periodKey: "2026-07" }] },
      });
      assert.equal(actions.length, 1);
      assert.equal(actions[0].qty, 4768);
      assert.equal(actions[0].metadata.componentBreakdown.productionShortfallCarryForward, 4768);
    } finally {
      require(gatePath).assessNoQtyMonthlyPlanningGate = origPlanningGate;
      delete require.cache[pendingPath];
      require(pendingPath);
    }
    });
  });

  it("fetchStoreAdditionalMonthlyPlanPendingActions does not emit when preview has no procurement need", async () => {
    await withMonthlyPlanningEnabled(true, async () => {
      const gatePath = require.resolve("../../src/services/noQtyMonthlyPlanningGateService");
      const pendingPath = require.resolve("../../src/services/pendingActionsService");
      const origGate = require(gatePath);
      const origPlanningGate = origGate.assessNoQtyMonthlyPlanningGate;

      require(gatePath).assessNoQtyMonthlyPlanningGate = async (_db, periodKey) => ({
        gate: "ADDITIONAL_PLAN_REQUIRED",
        action: "Create Additional Monthly Plan",
        plan: { id: 73, periodKey, planSequenceNo: 2, status: "APPROVED" },
        preview: {
          canCreate: true,
          nextPlanSequenceNo: 3,
          totals: {
            totalAdditionalRequirementQty: 1025,
            additionalItemCount: 1,
            procurementRequired: false,
            netRmShortageQty: 0,
            componentBreakdown: {},
          },
          items: [{ fgItemId: 10, unit: "Nos", hasAdditionalRequirement: true, uncoveredComponents: [] }],
        },
      });

      delete require.cache[pendingPath];
      const { fetchStoreAdditionalMonthlyPlanPendingActions: fetchAdditional } = require(pendingPath);

      try {
        const actions = await fetchAdditional({
          monthlyProductionPlan: { findMany: async () => [{ periodKey: "2026-07" }] },
        });
        assert.equal(actions.length, 0);
      } finally {
        require(gatePath).assessNoQtyMonthlyPlanningGate = origPlanningGate;
        delete require.cache[pendingPath];
        require(pendingPath);
      }
    });
  });

  it("fetchStoreAdditionalMonthlyPlanPendingActions does not emit when preview cannot create", async () => {
    await withMonthlyPlanningEnabled(true, async () => {
    const gatePath = require.resolve("../../src/services/noQtyMonthlyPlanningGateService");
    const pendingPath = require.resolve("../../src/services/pendingActionsService");
    const origGate = require(gatePath);
    const origPlanningGate = origGate.assessNoQtyMonthlyPlanningGate;

    require(gatePath).assessNoQtyMonthlyPlanningGate = async () => ({
      gate: "READY_FOR_EXECUTION",
      action: null,
      plan: null,
      preview: {
        canCreate: false,
        totals: { totalAdditionalRequirementQty: 0, additionalItemCount: 0, componentBreakdown: {} },
        items: [],
      },
    });

    delete require.cache[pendingPath];
    const { fetchStoreAdditionalMonthlyPlanPendingActions: fetchAdditional } = require(pendingPath);

    try {
      const actions = await fetchAdditional({
        monthlyProductionPlan: { findMany: async () => [{ periodKey: "2026-07" }] },
      });
      assert.equal(actions.length, 0);
    } finally {
      require(gatePath).assessNoQtyMonthlyPlanningGate = origPlanningGate;
      delete require.cache[pendingPath];
      require(pendingPath);
    }
    });
  });

  it("fetchStoreAdditionalMonthlyPlanPendingActions does not emit when draft additional plan is in progress", async () => {
    await withMonthlyPlanningEnabled(true, async () => {
    const gatePath = require.resolve("../../src/services/noQtyMonthlyPlanningGateService");
    const pendingPath = require.resolve("../../src/services/pendingActionsService");
    const origGate = require(gatePath);
    const origPlanningGate = origGate.assessNoQtyMonthlyPlanningGate;

    require(gatePath).assessNoQtyMonthlyPlanningGate = async () => ({
      gate: "PLAN_IN_PROGRESS",
      action: null,
      plan: { id: 99, status: "DRAFT", planSequenceNo: 3 },
      preview: {
        canCreate: false,
        blockingCode: "ACTIVE_PLAN_EXISTS",
        totals: { totalAdditionalRequirementQty: 16768, additionalItemCount: 1 },
        items: [],
      },
    });

    delete require.cache[pendingPath];
    const { fetchStoreAdditionalMonthlyPlanPendingActions: fetchAdditional } = require(pendingPath);

    try {
      const actions = await fetchAdditional({
        monthlyProductionPlan: { findMany: async () => [{ periodKey: "2026-07" }] },
      });
      assert.equal(actions.length, 0);
    } finally {
      require(gatePath).assessNoQtyMonthlyPlanningGate = origPlanningGate;
      delete require.cache[pendingPath];
      require(pendingPath);
    }
    });
  });

  it("fetchStoreAdditionalMonthlyPlanPendingActions emits one action for multiple FG items", async () => {
    await withMonthlyPlanningEnabled(true, async () => {
    const gatePath = require.resolve("../../src/services/noQtyMonthlyPlanningGateService");
    const pendingPath = require.resolve("../../src/services/pendingActionsService");
    const origGate = require(gatePath);
    const origPlanningGate = origGate.assessNoQtyMonthlyPlanningGate;

    require(gatePath).assessNoQtyMonthlyPlanningGate = async () => ({
      gate: "ADDITIONAL_PLAN_REQUIRED",
      action: "Create Additional Monthly Plan",
      plan: { id: 1, periodKey: "2026-07", planSequenceNo: 1, status: "APPROVED" },
      preview: {
        canCreate: true,
        nextPlanSequenceNo: 2,
        nextPlanLabel: "July Plan 2",
        approvedPlanCount: 1,
        totals: {
          totalAdditionalRequirementQty: 500,
          additionalItemCount: 2,
          componentBreakdown: {
            newUncoveredRsDemand: 500,
            productionShortfallCarryForward: 0,
            qcRejectionCarryForward: 0,
            greenLevelQty: 0,
          },
        },
        items: [
          { unit: "Nos", hasAdditionalRequirement: true, uncoveredComponents: [] },
          { unit: "Nos", hasAdditionalRequirement: true, uncoveredComponents: [] },
        ],
      },
    });

    delete require.cache[pendingPath];
    const { fetchStoreAdditionalMonthlyPlanPendingActions: fetchAdditional } = require(pendingPath);

    try {
      const actions = await fetchAdditional({
        monthlyProductionPlan: { findMany: async () => [{ periodKey: "2026-07" }] },
      });
      assert.equal(actions.length, 1);
      assert.equal(actions[0].metadata.fgItemCount, 2);
      assert.equal(actions[0].qty, 500);
    } finally {
      require(gatePath).assessNoQtyMonthlyPlanningGate = origPlanningGate;
      delete require.cache[pendingPath];
      require(pendingPath);
    }
    });
  });

  function buildPlaceWoDb({ so, lockedSheets, cycleNo, rsDocNo, uom = "KG" }) {
    return {
      salesOrder: {
        findMany: async () => [so],
        findUnique: async () => ({
          currentCycleId: so.currentCycleId,
          orderType: "NO_QTY",
          internalStatus: "OPEN",
        }),
      },
      salesOrderCycle: {
        findFirst: async ({ where } = {}) => {
          if (where?.status === "ACTIVE") return { id: so.currentCycleId };
          if (where?.id != null) return { id: where.id };
          return { id: so.currentCycleId };
        },
        findUnique: async () => ({ cycleNo }),
      },
      workOrder: {
        findMany: async () => [],
      },
      requirementSheet: {
        findMany: async () => lockedSheets,
        findUnique: async () => ({
          docNo: rsDocNo,
          lines: [{ id: 437, item: { unit: uom, unitRef: { unitCode: uom } } }],
        }),
      },
    };
  }

  function placeWoCandidate(sheet, assessment) {
    return async () => ({ sheet, assessment });
  }

  it("fetchStoreNoQtyPlaceWoPendingActions does not emit Place WO when plan is not released", async () => {
    const pendingPath = require.resolve("../../src/services/pendingActionsService");
    delete require.cache[pendingPath];
    const { fetchStoreNoQtyPlaceWoPendingActions: fetchPlaceWo } = require(pendingPath);
    const db = buildPlaceWoDb({
      so: { id: 10, docNo: "SO-26-0002", updatedAt: new Date(), currentCycleId: 5 },
      lockedSheets: [{ id: 20, docNo: "RS-001", salesOrderId: 10, cycleId: 5, version: 1, status: "LOCKED" }],
      cycleNo: 1,
      rsDocNo: "RS-001",
    });

    const actions = await fetchPlaceWo(db, {
      resolveNoQtyWoPlacementCandidateForSo: placeWoCandidate(
        { id: 20, docNo: "RS-001", cycleId: 5 },
        {
          readyToPlaceWo: false,
          released: false,
          rsBalanceQty: 5000,
          suggestedWoQty: 2905,
          placementStatus: "PARTIALLY_READY",
          readinessStatus: "AWAITING_PROCUREMENT",
          existingWoSummary: [],
          requirementSheetId: 20,
          requirementSheetDocNo: "RS-001",
        },
      ),
    });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, "NO_QTY_WO_PLACEMENT_REQUIRED");
  });

  it("fetchStoreNoQtyPlaceWoPendingActions emits Place WO when Net RM = 0 unlocks without Monthly Plan", async () => {
    const pendingPath = require.resolve("../../src/services/pendingActionsService");
    delete require.cache[pendingPath];
    const { fetchStoreNoQtyPlaceWoPendingActions: fetchPlaceWo } = require(pendingPath);
    const db = buildPlaceWoDb({
      so: { id: 11, docNo: "SO-26-0011", updatedAt: new Date(), currentCycleId: 6, customer: { name: "Acme" } },
      lockedSheets: [{ id: 21, docNo: "RS-021", salesOrderId: 11, cycleId: 6, version: 1, status: "LOCKED" }],
      cycleNo: 1,
      rsDocNo: "RS-021",
    });

    const actions = await fetchPlaceWo(db, {
      resolveNoQtyWoPlacementCandidateForSo: placeWoCandidate(
        { id: 21, docNo: "RS-021", cycleId: 6 },
        {
          readyToPlaceWo: true,
          released: true,
          skipMonthlyPlanning: true,
          rsBalanceQty: 10000,
          suggestedWoQty: 10000,
          placementStatus: "READY",
          readinessStatus: "READY_TO_PLACE_WO",
          existingWoSummary: [],
          requirementSheetId: 21,
          requirementSheetDocNo: "RS-021",
          periodKey: "2026-06",
        },
      ),
    });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "Create Work Order");
    assert.equal(actions[0].type, "NO_QTY_WO_PLACEMENT_REQUIRED");
    assert.match(actions[0].href, /sheetId=21/);
    assert.match(actions[0].href, /focus=execution/);
  });

  it("fetchStoreNoQtyPlaceWoPendingActions emits Place Partial WO even when Additional Plan is still required", async () => {
    const pendingPath = require.resolve("../../src/services/pendingActionsService");
    delete require.cache[pendingPath];
    const { fetchStoreNoQtyPlaceWoPendingActions: fetchPlaceWo } = require(pendingPath);
    const db = buildPlaceWoDb({
      so: {
        id: 224,
        docNo: "SO-26-0001",
        updatedAt: new Date(),
        currentCycleId: 383,
        customer: { name: "Acme" },
      },
      lockedSheets: [
        { id: 335, docNo: "RS-26-0002", salesOrderId: 224, cycleId: 382, version: 1, status: "LOCKED" },
        { id: 336, docNo: "RS-26-0003", salesOrderId: 224, cycleId: 383, version: 1, status: "LOCKED" },
      ],
      cycleNo: 2,
      rsDocNo: "RS-26-0002",
      uom: "Nos",
    });

    const actions = await fetchPlaceWo(db, {
      resolveNoQtyWoPlacementCandidateForSo: placeWoCandidate(
        { id: 335, docNo: "RS-26-0002", cycleId: 382 },
        {
          readyToPlaceWo: true,
          released: true,
          rsBalanceQty: 60000,
          suggestedWoQty: 48931,
          placementStatus: "PARTIALLY_READY",
          readinessStatus: "PARTIALLY_READY",
          existingWoSummary: [],
          requirementSheetId: 335,
          requirementSheetDocNo: "RS-26-0002",
          periodKey: "2026-07",
        },
      ),
    });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "Place Partial WO");
    assert.equal(actions[0].type, "NO_QTY_WO_PLACEMENT_REQUIRED");
    assert.equal(actions[0].metadata.suggestedExecutableQty, 48931);
    assert.equal(actions[0].metadata.rmCoverageStatus, "PARTIAL");
    assert.equal(actions[0].metadata.cycleId, 382);
    assert.match(actions[0].href, /sheetId=335/);
    assert.match(actions[0].href, /cycleId=382/);
    assert.match(actions[0].href, /focus=execution/);
  });

  it("fetchStoreNoQtyPlaceWoPendingActions emits Place Partial WO when partial RM is executable", async () => {
    const pendingPath = require.resolve("../../src/services/pendingActionsService");
    delete require.cache[pendingPath];
    const { fetchStoreNoQtyPlaceWoPendingActions: fetchPlaceWo } = require(pendingPath);
    const db = buildPlaceWoDb({
      so: {
        id: 10,
        docNo: "SO-26-0002",
        updatedAt: new Date(),
        currentCycleId: 5,
        customer: { name: "Acme Corp" },
      },
      lockedSheets: [{ id: 20, docNo: "RS-001", salesOrderId: 10, cycleId: 5, version: 1, status: "LOCKED" }],
      cycleNo: 1,
      rsDocNo: "RS-001",
    });

    const actions = await fetchPlaceWo(db, {
      resolveNoQtyWoPlacementCandidateForSo: placeWoCandidate(
        { id: 20, docNo: "RS-001", cycleId: 5 },
        {
          readyToPlaceWo: true,
          released: true,
          rsBalanceQty: 5000,
          suggestedWoQty: 2905,
          placementStatus: "PARTIALLY_READY",
          readinessStatus: "PARTIALLY_READY",
          existingWoSummary: [],
          requirementSheetId: 20,
          requirementSheetDocNo: "RS-001",
        },
      ),
    });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "Place Partial WO");
    assert.equal(actions[0].currentStatus, "PARTIALLY_READY_TO_PLACE_WO");
    assert.match(actions[0].documentNo, /SO-26-0002/);
    assert.match(actions[0].documentNo, /Acme Corp/);
    assert.match(actions[0].documentNo, /Cycle 1/);
    assert.match(actions[0].documentNo, /RS-001/);
    assert.match(actions[0].documentNo, /Suggested WO 2,905 KG/);
    assert.match(actions[0].href, /cycleId=5/);
    assert.match(actions[0].href, /sheetId=20/);
    assert.match(actions[0].href, /from=pending-actions/);
  });

  it("fetchStoreNoQtyPlaceWoPendingActions does not emit Place WO when suggestedWoQty is zero", async () => {
    const pendingPath = require.resolve("../../src/services/pendingActionsService");
    delete require.cache[pendingPath];
    const { fetchStoreNoQtyPlaceWoPendingActions: fetchPlaceWo } = require(pendingPath);
    const db = buildPlaceWoDb({
      so: { id: 10, docNo: "SO-26-0002", updatedAt: new Date(), currentCycleId: 5 },
      lockedSheets: [{ id: 20, docNo: "RS-001", salesOrderId: 10, cycleId: 5, version: 1, status: "LOCKED" }],
      cycleNo: 1,
      rsDocNo: "RS-001",
    });

    const actions = await fetchPlaceWo(db, {
      resolveNoQtyWoPlacementCandidateForSo: placeWoCandidate(
        { id: 20, docNo: "RS-001", cycleId: 5 },
        {
          readyToPlaceWo: false,
          released: true,
          rsBalanceQty: 5000,
          suggestedWoQty: 0,
          placementStatus: "AWAITING_PROCUREMENT",
          readinessStatus: "AWAITING_PROCUREMENT",
          existingWoSummary: [],
          requirementSheetId: 20,
        },
      ),
    });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, "NO_QTY_WO_PLANNING_STATUS");
    assert.equal(actions[0].action, "View Planning Status");
  });

  it("fetchStoreNoQtyPlaceWoPendingActions does not emit Place WO after full suggested qty is already placed", async () => {
    const pendingPath = require.resolve("../../src/services/pendingActionsService");
    delete require.cache[pendingPath];
    const { fetchStoreNoQtyPlaceWoPendingActions: fetchPlaceWo } = require(pendingPath);
    const db = buildPlaceWoDb({
      so: { id: 10, docNo: "SO-26-0002", updatedAt: new Date(), currentCycleId: 5 },
      lockedSheets: [{ id: 20, docNo: "RS-001", salesOrderId: 10, cycleId: 5, version: 1, status: "LOCKED" }],
      cycleNo: 1,
      rsDocNo: "RS-001",
    });

    const actions = await fetchPlaceWo(db, {
      resolveNoQtyWoPlacementCandidateForSo: placeWoCandidate(
        { id: 20, docNo: "RS-001", cycleId: 5 },
        {
          readyToPlaceWo: false,
          released: true,
          rsBalanceQty: 0,
          suggestedWoQty: 0,
          placementStatus: "READY",
          readinessStatus: "READY_TO_PLACE_WO",
          existingWoSummary: [{ workOrderId: 99, woStatus: "OPEN", rmPendingIssueQty: 100 }],
          requirementSheetId: 20,
        },
      ),
    });
    assert.equal(actions.length, 0);
  });

  it("fetchStoreNoQtyPlaceWoPendingActions emits Create Suggested WO when full executable qty matches RS balance", async () => {
    const pendingPath = require.resolve("../../src/services/pendingActionsService");
    delete require.cache[pendingPath];
    const { fetchStoreNoQtyPlaceWoPendingActions: fetchPlaceWo } = require(pendingPath);
    const db = buildPlaceWoDb({
      so: {
        id: 10,
        docNo: "SO-26-0002",
        updatedAt: new Date(),
        currentCycleId: 5,
        customer: { name: "Acme Corp" },
      },
      lockedSheets: [{ id: 20, docNo: "RS-001", salesOrderId: 10, cycleId: 5, version: 1, status: "LOCKED" }],
      cycleNo: 1,
      rsDocNo: "RS-001",
    });

    const actions = await fetchPlaceWo(db, {
      resolveNoQtyWoPlacementCandidateForSo: placeWoCandidate(
        { id: 20, docNo: "RS-001", cycleId: 5 },
        {
          readyToPlaceWo: true,
          released: true,
          rsBalanceQty: 5000,
          suggestedWoQty: 5000,
          placementStatus: "READY",
          readinessStatus: "READY_TO_PLACE_WO",
          existingWoSummary: [],
          requirementSheetId: 20,
          requirementSheetDocNo: "RS-001",
        },
      ),
    });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "Create Work Order");
    assert.equal(actions[0].currentStatus, "READY_TO_PLACE_WO");
    assert.match(actions[0].documentNo, /SO-26-0002/);
    assert.match(actions[0].documentNo, /Suggested WO 5,000 KG/);
    assert.match(actions[0].href, /cycleId=5/);
    assert.match(actions[0].href, /sheetId=20/);
  });

  it("fetchStoreNoQtyPlaceWoPendingActions emits prior-cycle Ready RS when ACTIVE cycle has zero balance", async () => {
    const pendingPath = require.resolve("../../src/services/pendingActionsService");
    delete require.cache[pendingPath];
    const { fetchStoreNoQtyPlaceWoPendingActions: fetchPlaceWo } = require(pendingPath);
    const db = buildPlaceWoDb({
      so: {
        id: 224,
        docNo: "SO-26-0001",
        updatedAt: new Date(),
        currentCycleId: 383,
        customer: { name: "TATA" },
      },
      lockedSheets: [
        { id: 335, docNo: "RS-26-0002", salesOrderId: 224, cycleId: 382, version: 1, status: "LOCKED" },
        { id: 336, docNo: "RS-26-0003", salesOrderId: 224, cycleId: 383, version: 1, status: "LOCKED" },
      ],
      cycleNo: 2,
      rsDocNo: "RS-26-0002",
      uom: "Nos",
    });

    const actions = await fetchPlaceWo(db, {
      resolveNoQtyWoPlacementCandidateForSo: placeWoCandidate(
        { id: 335, docNo: "RS-26-0002", cycleId: 382 },
        {
          readyToPlaceWo: true,
          released: true,
          rsBalanceQty: 11069,
          suggestedWoQty: 11069,
          placementStatus: "READY",
          readinessStatus: "READY_TO_PLACE_WO",
          existingWoSummary: [],
          requirementSheetId: 335,
          requirementSheetDocNo: "RS-26-0002",
          cycleId: 382,
        },
      ),
    });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "Create Work Order");
    assert.equal(actions[0].type, "NO_QTY_WO_PLACEMENT_REQUIRED");
    assert.equal(actions[0].metadata.rsBalanceQty, 11069);
    assert.equal(actions[0].metadata.suggestedExecutableQty, 11069);
    assert.equal(actions[0].metadata.requirementSheetDocNo, "RS-26-0002");
    assert.equal(actions[0].metadata.cycleId, 382);
    assert.equal(actions[0].metadata.requirementSheetLineId, 437);
    assert.equal(actions[0].metadata.rmCoverageStatus, "READY");
    assert.match(actions[0].href, /sheetId=335/);
    assert.match(actions[0].href, /cycleId=382/);
    assert.match(actions[0].documentNo, /Suggested WO 11,069 Nos/);
  });

  it("fetchMonthlyPlanPendingActions scopes DB query for STORE role", async () => {
    await withMonthlyPlanningEnabled(true, async () => {
      const { fetchMonthlyPlanPendingActions } = require("../../src/services/pendingActionsService");
      let capturedWhere = null;
      const db = {
        monthlyProductionPlan: {
          findMany: async ({ where }) => {
            capturedWhere = where;
            return [];
          },
        },
      };
      await fetchMonthlyPlanPendingActions(db, { role: "STORE" });
      assert.ok(capturedWhere);
      assert.deepEqual(capturedWhere, {
        OR: [{ status: "DRAFT" }, { status: "APPROVED", releasedAt: null }],
      });
    });
  });
});
