const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertProductionReportNotConfirmed,
} = require("../../src/services/productionWorkOrderReportService");
const { assertProductionReportApprovalAllowed } = require("../../src/services/productionReportApprovalGateService");

describe("productionReportApprovalGateService", () => {
  it("assertProductionReportNotConfirmed rejects duplicate confirm", async () => {
    const db = {
      productionWorkOrderReport: {
        findUnique: async () => ({
          id: 701,
          status: "CONFIRMED",
          remainingQty: "0",
          lines: [],
          returnPendings: [],
          wastageDetails: [],
        }),
      },
    };
    await assert.rejects(
      () => assertProductionReportNotConfirmed(db, 15),
      (err) => err.code === "PRODUCTION_REPORT_ALREADY_CONFIRMED" && err.statusCode === 409,
    );
  });

  it("assertProductionReportApprovalAllowed delegates guards in order", async () => {
    const reportPath = require.resolve("../../src/services/productionWorkOrderReportService");
    const origNotConfirmed = require(reportPath).assertProductionReportNotConfirmed;
    const origHasEntries = require(reportPath).assertProductionReportHasApprovedEntries;
    const calls = [];
    require(reportPath).assertProductionReportNotConfirmed = async (db, woId) => {
      calls.push("notConfirmed");
    };
    require(reportPath).assertProductionReportHasApprovedEntries = async (db, woId) => {
      calls.push("hasEntries");
      return { summary: { producedQty: 10 } };
    };
    delete require.cache[require.resolve("../../src/services/productionReportApprovalGateService")];
    const gate = require("../../src/services/productionReportApprovalGateService");

    try {
      await gate.assertProductionReportApprovalAllowed({}, 15);
      assert.deepEqual(calls, ["notConfirmed", "hasEntries"]);
    } finally {
      require(reportPath).assertProductionReportNotConfirmed = origNotConfirmed;
      require(reportPath).assertProductionReportHasApprovedEntries = origHasEntries;
      delete require.cache[require.resolve("../../src/services/productionReportApprovalGateService")];
    }
  });
});
