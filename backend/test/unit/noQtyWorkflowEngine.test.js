const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { _test } = require("../../src/services/noQtyWorkflowEngine");

describe("noQtyWorkflowEngine role-aware actions", () => {
  it("keeps NEXT_RS_READY overall and gives CREATE_NEXT_RS to Admin and Store planning owners", () => {
    const base = {
      overallAction: "NEXT_RS",
      secondaryActions: ["DISPATCH"],
      optionalActions: ["PRODUCTION"],
      salesOrderId: 10,
      cycleId: 20,
      displaySummary: "Cycle completed. Ready for Next RS.",
    };

    const admin = _test.roleAwareActionPayload({ ...base, role: "ADMIN" });
    assert.equal(admin.overallWorkflowState, "NEXT_RS_READY");
    assert.equal(admin.primaryActionForCurrentUser, "CREATE_NEXT_RS");
    assert.equal(admin.nextDepartmentAction, "NONE");

    const store = _test.roleAwareActionPayload({ ...base, role: "STORE" });
    assert.equal(store.overallWorkflowState, "NEXT_RS_READY");
    assert.equal(store.primaryActionForCurrentUser, "CREATE_NEXT_RS");
    assert.equal(store.nextDepartmentAction, "NONE");
    assert.deepEqual(store.roleAllowedSecondaryActions, ["DISPATCH"]);

    const production = _test.roleAwareActionPayload({ ...base, role: "PRODUCTION" });
    assert.equal(production.primaryActionForCurrentUser, "PRODUCTION");
    assert.equal(production.nextDepartmentAction, "CREATE_NEXT_RS");
    assert.deepEqual(production.roleAllowedOptionalActions, ["PRODUCTION"]);
  });

  it("assigns department-owned actions to matching roles only", () => {
    const dispatch = _test.roleAwareActionPayload({
      role: "STORE",
      overallAction: "DISPATCH",
      secondaryActions: [],
      optionalActions: [],
      salesOrderId: 10,
      cycleId: 20,
      displaySummary: "QC-accepted quantity is ready for dispatch.",
    });
    assert.equal(dispatch.primaryActionForCurrentUser, "DISPATCH");
    assert.equal(dispatch.nextDepartmentAction, "NONE");

    const qaViewingDispatch = _test.roleAwareActionPayload({
      role: "QA",
      overallAction: "DISPATCH",
      secondaryActions: [],
      optionalActions: [],
      salesOrderId: 10,
      cycleId: 20,
      displaySummary: "QC-accepted quantity is ready for dispatch.",
    });
    assert.equal(qaViewingDispatch.primaryActionForCurrentUser, "NONE");
    assert.equal(qaViewingDispatch.nextDepartmentAction, "DISPATCH");
  });

  it("lets Store see CREATE_NEXT_RS as secondary when dispatch is the overall action", () => {
    const store = _test.roleAwareActionPayload({
      role: "STORE",
      overallAction: "DISPATCH",
      secondaryActions: ["NEXT_RS"],
      optionalActions: [],
      salesOrderId: 10,
      cycleId: 20,
      displaySummary: "QC-accepted quantity is ready for dispatch.",
    });
    assert.equal(store.primaryActionForCurrentUser, "DISPATCH");
    assert.deepEqual(store.roleAllowedSecondaryActions, ["CREATE_NEXT_RS"]);
  });

  it("lets Admin see QC as primary while Create Next RS stays in secondary actions", () => {
    const admin = _test.roleAwareActionPayload({
      role: "ADMIN",
      overallAction: "QC",
      secondaryActions: ["NEXT_RS"],
      optionalActions: [],
      salesOrderId: 10,
      cycleId: 20,
      displaySummary: "QC or rework/hold action is pending.",
    });

    assert.equal(admin.overallWorkflowState, "QC_PENDING");
    assert.equal(admin.primaryActionForCurrentUser, "QC");
    assert.equal(admin.nextDepartmentAction, "NONE");
    assert.deepEqual(admin.roleAllowedSecondaryActions, ["CREATE_NEXT_RS"]);
  });

  it("assigns WORK_ORDER to Store and not Production", () => {
    const store = _test.roleAwareActionPayload({
      role: "STORE",
      overallAction: "WORK_ORDER",
      secondaryActions: [],
      optionalActions: [],
      salesOrderId: 10,
      cycleId: 20,
      displaySummary: "RM available. Ready for Store to place Work Order(s).",
    });
    assert.equal(store.primaryActionForCurrentUser, "WORK_ORDER");
    assert.equal(store.nextDepartmentAction, "NONE");
    assert.equal(store.actionOwner, "STORE");

    const production = _test.roleAwareActionPayload({
      role: "PRODUCTION",
      overallAction: "WORK_ORDER",
      secondaryActions: [],
      optionalActions: [],
      salesOrderId: 10,
      cycleId: 20,
      displaySummary: "RM available. Ready for Store to place Work Order(s).",
    });
    assert.equal(production.primaryActionForCurrentUser, "NONE");
    assert.equal(production.nextDepartmentAction, "WORK_ORDER");
    assert.match(_test.departmentMessageFor("PRODUCTION", "WORK_ORDER", "WORK_ORDER"), /Store/i);
  });

  it("uses Store wording for Next RS department message", () => {
    const msg = _test.departmentMessageFor("PRODUCTION", "CREATE_NEXT_RS", "CREATE_NEXT_RS");
    assert.match(msg, /Store/i);
    assert.doesNotMatch(msg, /Sales/i);
  });
});

describe("resolveNoQtyWorkflowState placement assessor after first WO", () => {
  it("keeps readyToPlaceWo when assessor allows another batch after workOrderExists", async () => {
    const executionService = require("../../src/services/requirementSheetExecutionService");
    const workflowPath = require.resolve("../../src/services/noQtyWorkflowEngine");

    const originalAssess = executionService.assessNoQtyPlacementStageForCycle;
    let assessorInvoked = false;
    executionService.assessNoQtyPlacementStageForCycle = async () => {
      assessorInvoked = true;
      return {
        readyToPlaceWo: true,
        processStageKey: "NO_QTY_READY_TO_PLACE_WO",
        processStageLabel: "Ready to place WO",
        requirementSheetId: 42,
        readinessStatus: "PARTIALLY_READY",
        released: true,
        rsBalanceQty: 7000,
        suggestedWoQty: 2500,
      };
    };

    delete require.cache[workflowPath];
    const { resolveNoQtyWorkflowState } = require("../../src/services/noQtyWorkflowEngine");

    const soId = 101;
    const cycleId = 2;
    const db = {
      salesOrder: {
        findUnique: async () => ({
          id: soId,
          orderType: "NO_QTY",
          currentCycleId: cycleId,
          internalStatus: "OPEN",
        }),
        findMany: async () => [],
      },
      salesOrderCycle: {
        findFirst: async ({ where }) => {
          if (where.id === cycleId && where.salesOrderId === soId) {
            return { id: cycleId, cycleNo: 1, status: "ACTIVE", noQtyTreatFgAsOptionalStoreStock: false };
          }
          return null;
        },
        findMany: async () => [],
      },
      requirementSheet: {
        findMany: async () => [{ id: 42, status: "LOCKED" }],
        findFirst: async ({ where, orderBy }) => {
          if (where.salesOrderId === soId && where.cycleId === cycleId) {
            return { id: 42, status: "LOCKED" };
          }
          if (where.cycle?.cycleNo?.gt != null) return null;
          return null;
        },
        findUnique: async () => null,
      },
      workOrder: {
        findMany: async ({ where }) => {
          if (where.salesOrderId === soId && where.cycleId === cycleId) {
            return [
              {
                id: 50,
                status: "PENDING",
                lines: [{ plannedQty: 3000, qty: 3000 }],
              },
            ];
          }
          return [];
        },
        findFirst: async ({ where }) => {
          if (where.salesOrderId === soId && where.cycleId === cycleId) {
            return { id: 50 };
          }
          return null;
        },
      },
      productionEntry: { findFirst: async () => null, findMany: async () => [] },
      qcEntry: { findFirst: async () => null, findMany: async () => [] },
      dispatch: { findMany: async () => [] },
      salesBill: { findFirst: async () => null },
      qcRejectedDisposition: { count: async () => 0 },
    };

    try {
      const state = await resolveNoQtyWorkflowState(db, { salesOrderId: soId, cycleId, userRole: "STORE" });
      assert.equal(assessorInvoked, true);
      assert.equal(state.workOrderExists, true);
      assert.equal(state.readyToPlaceWo, true);
      assert.equal(state.placementRequirementSheetId, 42);
      assert.match(state.displaySummary, /Remaining RS balance can be placed/i);
    } finally {
      executionService.assessNoQtyPlacementStageForCycle = originalAssess;
      delete require.cache[workflowPath];
    }
  });
});
