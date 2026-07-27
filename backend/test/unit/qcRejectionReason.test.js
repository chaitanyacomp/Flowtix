/**
 * QC rejection reason catalog validation (no disposition / SO-type logic).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  QC_REJECTION_REASON_OPTIONS,
  QC_REJECTION_REASON_OTHER_CODE,
  validateQcRejectionReasonInput,
  resolveQcRejectionReasonDescription,
} = require("../../src/services/qcRejectionReason");

describe("qcRejectionReason catalog", () => {
  it("includes the required standard reasons plus Other", () => {
    const labels = QC_REJECTION_REASON_OPTIONS.map((o) => o.label);
    for (const label of [
      "Dimensional issue",
      "Visual defect",
      "Short moulding",
      "Flash / excess material",
      "Colour variation",
      "Damage",
      "Contamination",
      "Assembly issue",
      "Other",
    ]) {
      assert.ok(labels.includes(label), `missing ${label}`);
    }
    assert.equal(QC_REJECTION_REASON_OTHER_CODE, "OTHER");
  });
});

describe("validateQcRejectionReasonInput", () => {
  it("allows no rejection without a reason", () => {
    const r = validateQcRejectionReasonInput({ rejectedQty: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.rejectionReasonCode, null);
    assert.equal(r.reasonDescription, null);
  });

  it("requires a catalog code when rejected qty > 0", () => {
    const r = validateQcRejectionReasonInput({ rejectedQty: 5 });
    assert.equal(r.ok, false);
    assert.match(r.message, /Rejection Reason is required/i);
  });

  it("accepts a standard reason and stores catalog description", () => {
    const r = validateQcRejectionReasonInput({
      rejectedQty: 2,
      rejectionReasonCode: "DIMENSIONAL_ISSUE",
    });
    assert.equal(r.ok, true);
    assert.equal(r.rejectionReasonCode, "DIMENSIONAL_ISSUE");
    assert.equal(r.reasonDescription, "Dimensional issue");
    assert.equal(
      resolveQcRejectionReasonDescription("DIMENSIONAL_ISSUE", null),
      "Dimensional issue",
    );
  });

  it("requires Specify Other Reason when Other is selected", () => {
    const missing = validateQcRejectionReasonInput({
      rejectedQty: 1,
      rejectionReasonCode: "OTHER",
    });
    assert.equal(missing.ok, false);
    assert.match(missing.message, /Specify Other Reason/i);

    const ok = validateQcRejectionReasonInput({
      rejectedQty: 1,
      rejectionReasonCode: "OTHER",
      rejectionReasonOther: "Edge crack near gate",
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.rejectionReasonCode, "OTHER");
    assert.equal(ok.reasonDescription, "Edge crack near gate");
  });

  it("rejects unknown codes", () => {
    const r = validateQcRejectionReasonInput({
      rejectedQty: 1,
      rejectionReasonCode: "NOT_A_REAL_CODE",
    });
    assert.equal(r.ok, false);
    assert.match(r.message, /valid Rejection Reason/i);
  });
});
