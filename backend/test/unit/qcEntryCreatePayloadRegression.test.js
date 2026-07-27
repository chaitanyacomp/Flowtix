/**
 * Regression: PE-26-0004 style QC save — 714 inspecting, 699 accepted, 15 rejected→rework,
 * reason Flash / excess material. Guards schema/payload drift that caused
 * PrismaClientValidationError Unknown argument `rejectionReasonCode`.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  validateQcRejectionReasonInput,
  buildQcEntryCreateData,
} = require("../../src/services/qcRejectionReason");
const { Prisma } = require("../../prisma/generated/client-v2");

const EPS = 1e-6;

describe("QC create payload — PE-26-0004 Flash / excess material → Rework", () => {
  it("Prisma QcEntry schema exposes rejectionReasonCode (client must be regenerated after migration)", () => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(Prisma.QcEntryScalarFieldEnum, "rejectionReasonCode"),
      "Generated Prisma client is missing QcEntry.rejectionReasonCode — run prisma migrate + generate",
    );
  });

  it("builds create data for 699 accepted + 15 rejected-to-rework with FLASH_EXCESS_MATERIAL", () => {
    const inspecting = 714;
    const accepted = 699;
    const rejected = 15;
    assert.ok(Math.abs(accepted + rejected - inspecting) <= EPS, "Accepted + Rejected must equal Inspecting");

    const rework = 15;
    const hold = 0;
    const scrap = 0;
    assert.ok(Math.abs(rework + hold + scrap - rejected) <= EPS, "Rework + Hold + Scrap must equal Rejected");

    const reason = validateQcRejectionReasonInput({
      rejectedQty: rejected,
      rejectionReasonCode: "FLASH_EXCESS_MATERIAL",
    });
    assert.equal(reason.ok, true);
    assert.equal(reason.rejectionReasonCode, "FLASH_EXCESS_MATERIAL");
    assert.equal(reason.reasonDescription, "Flash / excess material");

    // Mirrors production.js split routing snapshot when rework-only.
    const ledgerRejectedBucket = "REWORK";
    const rejectedRoute = null;
    const lossQty = 0;

    const data = buildQcEntryCreateData({
      docNo: "QC-26-0004",
      productionId: 593,
      acceptedQty: accepted,
      rejectedQty: rejected,
      rejectedStockBucket: ledgerRejectedBucket,
      rejectedRoute,
      lossQty,
      rejectionReasonCode: reason.rejectionReasonCode,
      reasonDescription: reason.reasonDescription,
      scrapReusable: false,
    });

    assert.deepEqual(data, {
      docNo: "QC-26-0004",
      productionId: 593,
      acceptedQty: "699",
      rejectedQty: "15",
      rejectedStockBucket: "REWORK",
      rejectedRoute: null,
      lossQty: "0",
      rejectionReasonCode: "FLASH_EXCESS_MATERIAL",
      reason: "Flash / excess material",
      scrapReusable: false,
    });

    // Every scalar key must exist on the generated QcEntry model (prevents Unknown argument).
    for (const key of Object.keys(data)) {
      if (data[key] === undefined) continue;
      assert.ok(
        Object.prototype.hasOwnProperty.call(Prisma.QcEntryScalarFieldEnum, key),
        `Unknown QcEntry create field "${key}" vs generated Prisma client`,
      );
    }
  });

  it("does not invent unknown create fields that previously broke Save Inspection", () => {
    const data = buildQcEntryCreateData({
      docNo: "QC-26-0004",
      productionId: 593,
      acceptedQty: 699,
      rejectedQty: 15,
      rejectedStockBucket: "REWORK",
      rejectedRoute: null,
      lossQty: 0,
      rejectionReasonCode: "FLASH_EXCESS_MATERIAL",
      reasonDescription: "Flash / excess material",
      scrapReusable: false,
    });
    assert.equal("rejectionReasonCode" in data, true);
    assert.equal("reason" in data, true);
    // Disposition / excess-ledger tables are separate models — must not be nested on QcEntry.create.
    assert.equal("noQtyQcExcessCycleAdjustment" in data, false);
    assert.equal("rejectedDispositions" in data, false);
  });
});
