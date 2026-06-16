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
});
