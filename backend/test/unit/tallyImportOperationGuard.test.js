const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  beginOperation,
  updateOperation,
  endOperation,
  getOperation,
  _resetForTests,
} = require("../../src/services/tallyMasterImport/tallyImportOperationGuard");

describe("tallyImportOperationGuard", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("rejects concurrent processing of the same client operation id", () => {
    beginOperation("op-same-1", "preview", "Stock items.xml");
    assert.throws(
      () => beginOperation("op-same-1", "preview", "Stock items.xml"),
      (err) => err && err.code === "OPERATION_IN_FLIGHT" && err.statusCode === 409,
    );
  });

  it("allows a new begin after the prior operation completed", () => {
    beginOperation("op-retry-1", "preview", "a.xml");
    endOperation("op-retry-1", "completed");
    const again = beginOperation("op-retry-1", "apply", "a.xml");
    assert.equal(again.status, "running");
    assert.equal(again.kind, "apply");
  });

  it("exposes progress fields for polling", () => {
    beginOperation("op-prog-1", "preview", "Stock items.xml");
    updateOperation("op-prog-1", {
      phase: "analysing",
      percent: 55,
      message: "Analysing…",
      recordsDetected: 4246,
    });
    const op = getOperation("op-prog-1");
    assert.equal(op.phase, "analysing");
    assert.equal(op.percent, 55);
    assert.equal(op.recordsDetected, 4246);
    assert.equal(op.filename, "Stock items.xml");
  });

  it("tracks apply batch progress without completing early", () => {
    beginOperation("op-apply-1", "apply", null);
    updateOperation("op-apply-1", {
      phase: "importing",
      percent: 40,
      batchIndex: 2,
      batchTotal: 10,
      recordsProcessed: 200,
      recordsDetected: 1000,
    });
    const op = getOperation("op-apply-1");
    assert.equal(op.status, "running");
    assert.equal(op.batchIndex, 2);
    assert.equal(op.percent, 40);
    assert.notEqual(op.percent, 100);
  });
});
