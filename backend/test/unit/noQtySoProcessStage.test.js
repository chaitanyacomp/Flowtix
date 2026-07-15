/**
 * NO_QTY agreement Current Stage resolver unit tests.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolveNoQtyAgreementProcessStage } = require("../../src/services/noQtySoProcessStageService");

describe("resolveNoQtyAgreementProcessStage", () => {
  it("Case 1: production finished + QC pending → QC In Progress", () => {
    const s = resolveNoQtyAgreementProcessStage({
      productionExists: true,
      productionPending: false,
      qcPending: true,
      workOrderExists: true,
    });
    assert.equal(s.key, "NO_QTY_QC_IN_PROGRESS");
    assert.equal(s.label, "QC In Progress");
  });

  it("does not combine Production and QC into one stage", () => {
    const running = resolveNoQtyAgreementProcessStage({
      productionPending: true,
      qcPending: true,
    });
    assert.equal(running.key, "NO_QTY_PRODUCTION_RUNNING");

    const qc = resolveNoQtyAgreementProcessStage({
      productionPending: false,
      qcPending: true,
    });
    assert.equal(qc.key, "NO_QTY_QC_IN_PROGRESS");
  });

  it("Case 2: FG disposition pending", () => {
    const s = resolveNoQtyAgreementProcessStage({
      productionExists: true,
      qcExists: true,
      fgDispositionPending: true,
    });
    assert.equal(s.key, "NO_QTY_FG_DISPOSITION_PENDING");
  });

  it("Case 3: recovery pending via waiver mode", () => {
    const s = resolveNoQtyAgreementProcessStage({
      closureMode: "WAIVER_REQUIRED",
      finalizedBillExists: true,
    });
    assert.equal(s.key, "NO_QTY_RECOVERY_PENDING");
    assert.equal(s.label, "Recovery Decision Pending");
  });

  it("Case 4: ready to close only when close SSOT is COMPLETE", () => {
    const s = resolveNoQtyAgreementProcessStage({
      closureMode: "COMPLETE",
      finalizedBillExists: true,
    });
    assert.equal(s.key, "NO_QTY_READY_TO_CLOSE");
  });

  it("does not show Ready to Close when billing complete but dispatch still blocks close", () => {
    const s = resolveNoQtyAgreementProcessStage({
      finalizedBillExists: true,
      nextAction: "CLOSE_SO",
      closureMode: "BLOCKED",
      closureBlockers: [{ code: "PENDING_DISPATCH", message: "outstanding dispatch" }],
    });
    assert.equal(s.key, "NO_QTY_DISPATCH_PENDING");
    assert.notEqual(s.key, "NO_QTY_READY_TO_CLOSE");
  });

  it("Case: billing pending export from close blocker", () => {
    const s = resolveNoQtyAgreementProcessStage({
      closureMode: "BLOCKED",
      closureBlockers: [{ code: "BILLING_NOT_EXPORTED" }],
      finalizedBillExists: true,
    });
    assert.equal(s.key, "NO_QTY_BILLING_PENDING_EXPORT");
  });

  it("dispatch pending after manufacturing complete", () => {
    const s = resolveNoQtyAgreementProcessStage({
      productionExists: true,
      qcExists: true,
      dispatchExists: false,
    });
    assert.equal(s.key, "NO_QTY_DISPATCH_PENDING");
  });
});
