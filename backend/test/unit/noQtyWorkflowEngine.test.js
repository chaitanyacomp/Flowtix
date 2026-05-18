const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { _test } = require("../../src/services/noQtyWorkflowEngine");

describe("noQtyWorkflowEngine role-aware actions", () => {
  it("keeps NEXT_RS_READY overall but gives CREATE_NEXT_RS only to Sales/Admin owners", () => {
    const base = {
      overallAction: "NEXT_RS",
      secondaryActions: ["DISPATCH"],
      optionalActions: ["PRODUCTION"],
      salesOrderId: 10,
      cycleId: 20,
      displaySummary: "Cycle completed. Ready for Next RS.",
    };

    const sales = _test.roleAwareActionPayload({ ...base, role: "SALES" });
    assert.equal(sales.overallWorkflowState, "NEXT_RS_READY");
    assert.equal(sales.primaryActionForCurrentUser, "CREATE_NEXT_RS");
    assert.equal(sales.nextDepartmentAction, "NONE");

    const store = _test.roleAwareActionPayload({ ...base, role: "STORE" });
    assert.equal(store.overallWorkflowState, "NEXT_RS_READY");
    assert.equal(store.primaryActionForCurrentUser, "DISPATCH");
    assert.equal(store.nextDepartmentAction, "CREATE_NEXT_RS");
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

    const qcViewingDispatch = _test.roleAwareActionPayload({
      role: "QC",
      overallAction: "DISPATCH",
      secondaryActions: [],
      optionalActions: [],
      salesOrderId: 10,
      cycleId: 20,
      displaySummary: "QC-accepted quantity is ready for dispatch.",
    });
    assert.equal(qcViewingDispatch.primaryActionForCurrentUser, "NONE");
    assert.equal(qcViewingDispatch.nextDepartmentAction, "DISPATCH");
  });

  it("lets Sales/Admin prepare Next RS in parallel while QC remains the department action", () => {
    const sales = _test.roleAwareActionPayload({
      role: "SALES",
      overallAction: "QC",
      secondaryActions: ["NEXT_RS"],
      optionalActions: [],
      salesOrderId: 10,
      cycleId: 20,
      displaySummary: "QC or rework/hold action is pending.",
    });

    assert.equal(sales.overallWorkflowState, "QC_PENDING");
    assert.equal(sales.primaryActionForCurrentUser, "CREATE_NEXT_RS");
    assert.equal(sales.nextDepartmentAction, "QC");
    assert.deepEqual(sales.roleAllowedSecondaryActions, ["CREATE_NEXT_RS"]);
  });
});
