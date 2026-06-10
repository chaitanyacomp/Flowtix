const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  filterTraceForGrn,
  lineBillStatusLabel,
  grnBillStatusLabel,
} = require("../../src/services/grnDocumentService");

describe("grnDocumentService", () => {
  it("lineBillStatusLabel returns NOT_BILLED when empty", () => {
    assert.equal(lineBillStatusLabel([]), "NOT_BILLED");
  });

  it("lineBillStatusLabel returns BILLED when all finalized", () => {
    assert.equal(
      lineBillStatusLabel([
        { status: "FINALIZED" },
        { status: "FINALIZED" },
      ]),
      "BILLED",
    );
  });

  it("lineBillStatusLabel returns PARTIALLY_BILLED for mixed", () => {
    assert.equal(
      lineBillStatusLabel([{ status: "FINALIZED" }, { status: "DRAFT" }]),
      "PARTIALLY_BILLED",
    );
  });

  it("grnBillStatusLabel prefers header BILLED", () => {
    assert.equal(grnBillStatusLabel("BILLED", ["NOT_BILLED"]), "BILLED");
  });

  it("filterTraceForGrn keeps only matching grn lines", () => {
    const full = {
      rmPo: { id: 101 },
      supplier: { name: "Acme" },
      grns: [
        { id: 1, displayNo: "GRN-1" },
        { id: 2, displayNo: "GRN-2" },
      ],
      lines: [
        {
          id: 10,
          grnLines: [
            { grnId: 1, receivedQty: 5 },
            { grnId: 2, receivedQty: 3 },
          ],
          traceChain: ["MR-1", "GRN-1"],
        },
        {
          id: 11,
          grnLines: [{ grnId: 2, receivedQty: 2 }],
          traceChain: ["MR-2", "GRN-2"],
        },
      ],
    };
    const filtered = filterTraceForGrn(full, 2, [10, 11]);
    assert.equal(filtered.grns.length, 1);
    assert.equal(filtered.grns[0].id, 2);
    assert.equal(filtered.lines.length, 2);
    assert.equal(filtered.lines[0].grnLines.length, 1);
    assert.equal(filtered.lines[0].grnLines[0].grnId, 2);
  });
});
