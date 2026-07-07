const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  markEnquiryQuotedOnQuotationApproval,
  reopenEnquiryToFeasibleAfterQuotationRollback,
  applyEnquiryStatusForQuotationWorkflowTransition,
} = require("../../src/services/enquiryQuotationLifecycle");

function makeTx(initialStatus = "FEASIBLE") {
  let status = initialStatus;
  return {
    enquiry: {
      findUnique: async () => ({ id: 10, status }),
      update: async ({ data }) => {
        status = data.status;
        return { id: 10, status };
      },
    },
    get status() {
      return status;
    },
  };
}

describe("enquiryQuotationLifecycle", () => {
  it("marks enquiry QUOTED only on first approval transition", async () => {
    const tx = makeTx("FEASIBLE");
    await applyEnquiryStatusForQuotationWorkflowTransition(tx, 10, {
      previousWorkflowStatus: "DRAFT",
      nextWorkflowStatus: "APPROVED",
    });
    assert.equal(tx.status, "QUOTED");
  });

  it("does not rewrite enquiry on idempotent approval", async () => {
    const tx = makeTx("QUOTED");
    let updateCount = 0;
    const origUpdate = tx.enquiry.update;
    tx.enquiry.update = async (...args) => {
      updateCount += 1;
      return origUpdate(...args);
    };
    await applyEnquiryStatusForQuotationWorkflowTransition(tx, 10, {
      previousWorkflowStatus: "APPROVED",
      nextWorkflowStatus: "APPROVED",
    });
    assert.equal(updateCount, 0);
    assert.equal(tx.status, "QUOTED");
  });

  it("reopens enquiry to FEASIBLE on rejection transition", async () => {
    const tx = makeTx("QUOTED");
    await applyEnquiryStatusForQuotationWorkflowTransition(tx, 10, {
      previousWorkflowStatus: "DRAFT",
      nextWorkflowStatus: "REJECTED",
    });
    assert.equal(tx.status, "FEASIBLE");
  });

  it("markEnquiryQuotedOnQuotationApproval is idempotent", async () => {
    const tx = makeTx("QUOTED");
    let updateCount = 0;
    const origUpdate = tx.enquiry.update;
    tx.enquiry.update = async (...args) => {
      updateCount += 1;
      return origUpdate(...args);
    };
    await markEnquiryQuotedOnQuotationApproval(tx, 10);
    assert.equal(updateCount, 0);
  });

  it("reopenEnquiryToFeasibleAfterQuotationRollback is idempotent", async () => {
    const tx = makeTx("FEASIBLE");
    let updateCount = 0;
    const origUpdate = tx.enquiry.update;
    tx.enquiry.update = async (...args) => {
      updateCount += 1;
      return origUpdate(...args);
    };
    await reopenEnquiryToFeasibleAfterQuotationRollback(tx, 10);
    assert.equal(updateCount, 0);
  });
});
