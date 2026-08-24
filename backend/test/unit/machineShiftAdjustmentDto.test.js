/**
 * Step 4C DTO — adjustment actor display names.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  mapAdjustmentRequest,
  getMappedAdjustmentRequest,
} = require("../../src/services/machineShiftSessionReadService");

describe("mapAdjustmentRequest actor display names", () => {
  it("exposes requestedByName, decidedByName, appliedByName", () => {
    const dto = mapAdjustmentRequest({
      id: 1,
      reportVersionId: 9,
      status: "APPLIED",
      adjustReason: "Fix scrap",
      remarks: null,
      proposedGrossOutputQty: 11,
      proposedProductionScrapQty: 1,
      proposedQtySentToQc: 10,
      proposedLines: [],
      requestedAt: new Date(),
      requestedByUserId: 2,
      requestedByUser: { id: 2, name: "Requester" },
      decidedAt: new Date(),
      decidedByUserId: 3,
      decidedByUser: { id: 3, name: "Manager" },
      decisionNote: "ok",
      appliedAt: new Date(),
      appliedByUserId: 3,
      appliedByUser: { id: 3, name: "Manager" },
      appliedReportVersionId: 10,
    });
    assert.equal(dto.requestedByName, "Requester");
    assert.equal(dto.decidedByName, "Manager");
    assert.equal(dto.appliedByName, "Manager");
  });

  it("uses Unknown user when actors are missing", () => {
    const dto = mapAdjustmentRequest({
      id: 2,
      reportVersionId: 9,
      status: "DENIED",
      adjustReason: "x",
      proposedGrossOutputQty: 1,
      proposedProductionScrapQty: 0,
      proposedQtySentToQc: 1,
      proposedLines: [],
      requestedAt: new Date(),
      requestedByUserId: 8,
      requestedByUser: null,
      decidedAt: new Date(),
      decidedByUserId: null,
      decidedByUser: null,
      decisionNote: "no",
      appliedAt: null,
      appliedByUserId: null,
      appliedReportVersionId: null,
    });
    assert.equal(dto.requestedByName, "Unknown user");
    assert.equal(dto.decidedByName, "Unknown user");
    assert.equal(dto.appliedByName, null);
  });

  it("getMappedAdjustmentRequest hydrates actors", async () => {
    const db = {
      shiftProductionReportAdjustmentRequest: {
        findUnique: async () => ({
          id: 5,
          reportVersionId: 1,
          status: "REQUESTED",
          adjustReason: "reason",
          remarks: null,
          proposedGrossOutputQty: 2,
          proposedProductionScrapQty: 0,
          proposedQtySentToQc: 2,
          proposedLines: [],
          requestedAt: new Date(),
          requestedByUserId: 1,
          requestedByUser: { id: 1, name: "Ops" },
          decidedAt: null,
          decidedByUserId: null,
          decidedByUser: null,
          decisionNote: null,
          appliedAt: null,
          appliedByUserId: null,
          appliedByUser: null,
          appliedReportVersionId: null,
        }),
      },
    };
    const dto = await getMappedAdjustmentRequest(5, db);
    assert.equal(dto.requestedByName, "Ops");
  });
});
