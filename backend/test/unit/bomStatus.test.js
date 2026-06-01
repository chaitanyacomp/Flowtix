const { describe, it } = require("node:test");

const assert = require("node:assert/strict");

const {

  bomIsApproved,

  bomLooksLocked,

  bomIsDraft,

  bomIsInactive,

  approvedBomWhere,

  approvedBomOrderBy,

} = require("../../src/services/bomStatus");



describe("bomStatus helpers", () => {

  it("approvedBomWhere targets APPROVED only", () => {

    assert.deepEqual(approvedBomWhere(42), { fgItemId: 42, status: "APPROVED" });

  });



  it("approvedBomOrderBy prefers latest revision", () => {

    assert.deepEqual(approvedBomOrderBy, { revisionNo: "desc" });

  });



  it("bomIsApproved uses status and legacy isLocked", () => {

    assert.equal(bomIsApproved({ status: "APPROVED" }), true);

    assert.equal(bomIsApproved({ status: "DRAFT" }), false);

    assert.equal(bomIsApproved({ isLocked: true, status: null }), true);

  });



  it("bomIsDraft and bomIsInactive", () => {

    assert.equal(bomIsDraft({ status: "DRAFT" }), true);

    assert.equal(bomIsInactive({ status: "INACTIVE" }), true);

    assert.equal(bomLooksLocked({ status: "DRAFT" }), false);

    assert.equal(bomLooksLocked({ status: "APPROVED" }), true);

  });

});


