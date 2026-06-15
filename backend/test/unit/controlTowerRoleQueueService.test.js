const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  assertRoleQueueAccess,
  RoleQueueAccessError,
  rowMatchesRoleQueue,
  filterRowsForRoleQueue,
} = require("../../src/services/controlTowerRoleQueueService");
const { dedupeRoleQueueRows: dedupeRoleQueueRowsIdentity } = require("../../src/services/controlTowerRowIdentity");
const {
  normalizeRmRiskRow,
  normalizeProductionRow,
  normalizeDispatchRow,
  normalizeNoQtyPlanningRow,
  normalizeContinueWorkingRow,
  normalizeQaRow,
  normalizeQaReworkRow,
  normalizeWoPlanningRow,
  CONTROL_TOWER_STATUSES,
} = require("../../src/services/controlTowerRowNormalizer");
const { attachRowIdentity } = require("../../src/services/controlTowerRowIdentity");
const { groupControlTowerRows, BOARD_GROUP_KEYS } = require("../../src/services/controlTowerBoardGroups");
const { paginateRows } = require("../../src/services/controlTowerNormalizedRowsService");

function withIdentity(row) {
  return attachRowIdentity(row);
}

describe("assertRoleQueueAccess", () => {
  it("allows ADMIN to request any role queue", () => {
    assert.equal(assertRoleQueueAccess("ADMIN", "STORE"), "STORE");
    assert.equal(assertRoleQueueAccess("ADMIN", "PURCHASE"), "PURCHASE");
  });

  it("allows non-admin only their own role queue", () => {
    assert.equal(assertRoleQueueAccess("STORE", "STORE"), "STORE");
    assert.equal(assertRoleQueueAccess("QA", "QA"), "QA");
  });

  it("denies non-admin access to another role queue", () => {
    assert.throws(
      () => assertRoleQueueAccess("STORE", "PURCHASE"),
      (err) => err instanceof RoleQueueAccessError && err.statusCode === 403,
    );
  });
});

describe("rowMatchesRoleQueue", () => {
  it("STORE gets STORE-owned RM and dispatch rows", () => {
    const rm = withIdentity(normalizeRmRiskRow({ workOrderId: 1, itemId: 1, status: "CRITICAL" }));
    const dispatch = withIdentity(normalizeDispatchRow({ salesOrderId: 2, itemId: 3, orderType: "NORMAL" }));
    assert.equal(rowMatchesRoleQueue(rm, "STORE"), true);
    assert.equal(rowMatchesRoleQueue(dispatch, "STORE"), true);
  });

  it("PURCHASE gets only purchaseHandoff / PURCHASE-owned rows", () => {
    const purchase = withIdentity(
      normalizeRmRiskRow({
        workOrderId: 1,
        itemId: 1,
        status: "CRITICAL",
        queueType: "WAITING_PURCHASE_ACTION",
        prLineCount: 1,
        poLineCount: 0,
        operationalKey: "PR_PENDING_PO",
        nextActionKey: "CREATE_PO",
      }),
    );
    const storePrePr = withIdentity(
      normalizeRmRiskRow({
        workOrderId: 2,
        itemId: 1,
        status: "CRITICAL",
        queueType: "WAITING_PURCHASE_ACTION",
        prLineCount: 0,
        operationalKey: "PROCUREMENT_PENDING",
      }),
    );
    const storeProc = withIdentity(
      normalizeRmRiskRow({
        workOrderId: 3,
        itemId: 1,
        status: "CRITICAL",
        queueType: "APPROVAL_PENDING",
      }),
    );
    assert.equal(rowMatchesRoleQueue(purchase, "PURCHASE"), true);
    assert.equal(purchase.metadata.purchaseHandoff, true);
    assert.equal(rowMatchesRoleQueue(storePrePr, "PURCHASE"), false);
    assert.equal(rowMatchesRoleQueue(storeProc, "PURCHASE"), false);
  });

  it("PRODUCTION gets only PRODUCTION-owned rows", () => {
    const prod = withIdentity(
      normalizeProductionRow({ workOrderId: 5, workOrderLineId: 1, nextAction: "PRODUCTION_PENDING" }),
    );
    const qa = withIdentity(normalizeQaRow({ qcRef: "PE-1", workOrderId: 5, status: "PENDING_QC" }));
    assert.equal(rowMatchesRoleQueue(prod, "PRODUCTION"), true);
    assert.equal(rowMatchesRoleQueue(qa, "PRODUCTION"), false);
  });

  it("QA gets QA-owned pending and rework rows", () => {
    const qa = withIdentity(normalizeQaRow({ qcRef: "PE-1", workOrderId: 5, status: "PENDING_QC" }));
    const rework = withIdentity(
      normalizeQaReworkRow({
        dispositionId: 9,
        status: "REWORK_READY_FOR_QC",
        workOrderId: 5,
        pendingReworkQcQty: 3,
      }),
    );
    assert.equal(rowMatchesRoleQueue(qa, "QA"), true);
    assert.equal(rowMatchesRoleQueue(rework, "QA"), true);
    assert.equal(qa.currentStatus, CONTROL_TOWER_STATUSES.QA_PENDING);
    assert.equal(rework.currentStatus, CONTROL_TOWER_STATUSES.QA_REWORK_PENDING);
  });

  it("STORE gets NO_QTY planning rows after ownership alignment", () => {
    const planning = withIdentity(
      normalizeNoQtyPlanningRow({
        salesOrderId: 99,
        salesOrderDocNo: "SO-99",
        latestRequirementSheetStatus: null,
        cycleNo: 1,
      }),
    );
    assert.equal(planning.currentOwner, "STORE");
    assert.equal(rowMatchesRoleQueue(planning, "STORE"), true);
  });

  it("ADMIN gets planning, commercial, and ADMIN-owned rows", () => {
    const planning = withIdentity(
      normalizeNoQtyPlanningRow({
        salesOrderId: 1,
        latestRequirementSheetStatus: "DRAFT",
      }),
    );
    const commercial = withIdentity(
      normalizeContinueWorkingRow({
        salesOrderId: 2,
        stageKey: "SALES_BILL",
        nextStep: "Bill",
      }),
    );
    const storeWoPlan = withIdentity(
      normalizeWoPlanningRow({
        salesOrderId: 3,
        operationalKey: "RM_SHORTAGE",
        nextActionKey: "RAISE_MR",
      }),
    );
    assert.equal(rowMatchesRoleQueue(planning, "ADMIN"), true);
    assert.equal(rowMatchesRoleQueue(commercial, "ADMIN"), true);
    assert.equal(rowMatchesRoleQueue(storeWoPlan, "ADMIN"), true);
  });
});

describe("filterRowsForRoleQueue and board placement", () => {
  it("places filtered QA rows in QUALITY group", () => {
    const rows = [
      withIdentity(normalizeQaRow({ qcRef: "PE-1", workOrderId: 1, status: "PENDING_QC" })),
      withIdentity(
        normalizeQaReworkRow({
          dispositionId: 2,
          status: "REWORK_READY_FOR_QC",
          workOrderId: 1,
          pendingReworkQcQty: 1,
        }),
      ),
    ];
    const qaRows = filterRowsForRoleQueue(rows, "QA");
    const grouped = groupControlTowerRows(dedupeRoleQueueRowsIdentity(qaRows, "QA"));
    const quality = grouped.groups.find((g) => g.groupKey === BOARD_GROUP_KEYS.QUALITY);
    assert.equal(quality.count, 2);
  });

  it("places PURCHASE rows in RM_READINESS group", () => {
    const row = withIdentity(
      normalizeRmRiskRow({
        workOrderId: 10,
        itemId: 1,
        status: "CRITICAL",
        queueType: "WAITING_PURCHASE_ACTION",
        prLineCount: 1,
        poLineCount: 0,
        operationalKey: "PR_PENDING_PO",
        nextActionKey: "CREATE_PO",
      }),
    );
    const purchaseRows = filterRowsForRoleQueue([row], "PURCHASE");
    const grouped = groupControlTowerRows(purchaseRows);
    const rm = grouped.groups.find((g) => g.groupKey === BOARD_GROUP_KEYS.RM_READINESS);
    assert.equal(rm.count, 1);
  });
});

describe("dedupeRoleQueueRows", () => {
  it("does not collapse different statuses for the same rowKey", () => {
    const woId = 125;
    const rm = withIdentity(
      normalizeRmRiskRow({ workOrderId: woId, itemId: 1, status: "CRITICAL" }),
    );
    const prod = withIdentity(
      normalizeProductionRow({
        workOrderId: woId,
        workOrderLineId: 1,
        nextAction: "PRODUCTION_PENDING",
      }),
    );
    assert.equal(rm.rowKey, prod.rowKey);

    const deduped = dedupeRoleQueueRowsIdentity([rm, prod], "STORE");
    assert.equal(deduped.length, 2);
    const statuses = deduped.map((r) => r.currentStatus).sort();
    assert.deepEqual(statuses, [
      CONTROL_TOWER_STATUSES.PRODUCTION_PENDING,
      CONTROL_TOWER_STATUSES.WAITING_RM,
    ]);
  });

  it("collapses duplicate same-status rows for the same rowKey within a role", () => {
    const rmA = withIdentity(
      normalizeRmRiskRow({ workOrderId: 99, itemId: 1, status: "CRITICAL" }),
    );
    const rmB = withIdentity(
      normalizeRmRiskRow({ workOrderId: 99, itemId: 2, status: "LOW_BUFFER" }),
    );
    const filtered = filterRowsForRoleQueue([rmA, rmB], "STORE");
    const deduped = dedupeRoleQueueRowsIdentity(filtered, "STORE");
    assert.equal(deduped.length, 1);
  });

  it("paginates after role filter and dedupe", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      withIdentity(
        normalizeProductionRow({
          workOrderId: i + 1,
          workOrderLineId: 1,
          nextAction: "PRODUCTION_PENDING",
        }),
      ),
    );
    const filtered = filterRowsForRoleQueue(rows, "PRODUCTION");
    const deduped = dedupeRoleQueueRowsIdentity(filtered, "PRODUCTION");
    const page = paginateRows(deduped, 1, 2);
    assert.equal(page.length, 2);
    assert.equal(deduped.length, 5);
  });
});
