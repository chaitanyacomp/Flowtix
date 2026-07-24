const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { calculateSalesBillSnapshot } = require("../../src/services/salesBillCalculationService");
const { buildSalesBillTallyXml } = require("../../src/services/salesBillTallyXml");

const row = (overrides = {}) => ({ dispatchId: 1, allocatedQty: 1, itemId: 1, itemName: "Item", hsnCode: "3925",
  unit: "Nos", rate: 100, discountRate: 0, gstRate: 18, taxTreatment: "GOODS", ...overrides });

describe("multi-dispatch Sales Bill calculation", () => {
  it("leaves all GST components uncommitted while POS is unresolved", () => {
    const result = calculateSalesBillSnapshot({
      allocationRows: [row({ rate: 44000, gstRate: 28 })],
      transportation: { amount: 1000, chargedBy: "OUR_COMPANY" },
      intraState: null,
    });
    assert.equal(result.totals.totalCgst.toString(), "0");
    assert.equal(result.totals.totalSgst.toString(), "0");
    assert.equal(result.totals.totalIgst.toString(), "0");
    assert.equal(result.totals.totalTax.toString(), "0");
    assert.equal(result.lines[0].igstAmount.toString(), "0");
  });

  it("splits the observed 18% GST bucket equally after proportional freight allocation", () => {
    const result = calculateSalesBillSnapshot({
      allocationRows: [row({ rate: 101826 })],
      transportation: { amount: 1000, chargedBy: "OUR_COMPANY" },
      intraState: true,
    });
    assert.deepEqual(Object.fromEntries(Object.entries(result.totals).map(([key, value]) => [key, value.toFixed(2)])), {
      goodsTaxableValue: "101826.00", transportationAmount: "1000.00", transportationTaxableValue: "1000.00",
      totalBasic: "102826.00", totalCgst: "9254.34", totalSgst: "9254.34", totalIgst: "0.00",
      totalTax: "18508.68", roundOffAmount: "0.32", netAmount: "121335.00",
    });
    assert.equal(result.lines[0].cgstAmount.toFixed(2), result.lines[0].sgstAmount.toFixed(2));
  });

  it("aggregates compatible quantities while preserving dispatch allocations", () => {
    const result = calculateSalesBillSnapshot({ allocationRows: [row({ dispatchId: 11, allocatedQty: 5000 }), row({ dispatchId: 12, allocatedQty: 3000 })], intraState: true });
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].qty.toString(), "8000");
    assert.deepEqual(result.lines[0].sourceAllocations.map((x) => [x.dispatchId, x.allocatedQty.toString()]), [[11, "5000"], [12, "3000"]]);
  });

  it("keeps incompatible items and GST rates as separate invoice lines", () => {
    const result = calculateSalesBillSnapshot({ allocationRows: [row({ gstRate: 5, rate: 40000 }), row({ dispatchId: 2, itemId: 2, itemName: "B", rate: 60000, gstRate: 18 })], intraState: true });
    assert.equal(result.lines.length, 2);
  });

  it("allocates seller transportation proportionately across 5% and 18% taxable values", () => {
    const result = calculateSalesBillSnapshot({ allocationRows: [row({ rate: 40000, gstRate: 5 }), row({ dispatchId: 2, itemId: 2, rate: 60000, gstRate: 18 })], transportation: { amount: 1000, chargedBy: "OUR_COMPANY" }, intraState: true });
    assert.deepEqual(result.lines.map((x) => x.transportationAllocation.toString()), ["400", "600"]);
    assert.equal(result.totals.transportationTaxableValue.toString(), "1000");
    assert.equal(result.totals.totalCgst.toString(), "6464");
    assert.equal(result.totals.totalSgst.toString(), "6464");
  });

  it("uses IGST interstate and excludes transporter-direct charges from bill totals", () => {
    const direct = calculateSalesBillSnapshot({ allocationRows: [row()], transportation: { amount: 250, chargedBy: "TRANSPORTER_DIRECTLY" }, intraState: false });
    assert.equal(direct.totals.transportationTaxableValue.toString(), "0");
    assert.equal(direct.totals.totalIgst.toString(), "18");
    assert.equal(direct.totals.netAmount.toString(), "118");
  });

  it("assigns the cent rounding remainder to the largest taxable line", () => {
    const result = calculateSalesBillSnapshot({ allocationRows: [row({ rate: 1, gstRate: 5 }), row({ dispatchId: 2, itemId: 2, rate: 2, gstRate: 18 })], transportation: { amount: 0.01, chargedBy: "OUR_COMPANY" }, intraState: true });
    assert.equal(result.lines.reduce((sum, x) => sum + Number(x.transportationAllocation), 0).toFixed(2), "0.01");
    assert.equal(result.lines[1].transportationAllocation.toString(), "0.01");
  });

  it("rounds equal intrastate component rates independently", () => {
    const result = calculateSalesBillSnapshot({ allocationRows: [row({ rate: 0.06, gstRate: 18 })], intraState: true });
    assert.equal(result.totals.totalTax.toFixed(2), "0.02");
    assert.equal(result.totals.totalCgst.toFixed(2), "0.01");
    assert.equal(result.totals.totalSgst.toFixed(2), "0.01");
    assert.equal(result.lines[0].cgstAmount.plus(result.lines[0].sgstAmount).toFixed(2), "0.02");
  });

  it("matches the observed 141436.85 intrastate component calculation", () => {
    const result = calculateSalesBillSnapshot({ allocationRows: [row({ rate: 140436.85, gstRate: 18 })], transportation: { amount: 1000, chargedBy: "OUR_COMPANY" }, intraState: true });
    assert.equal(result.totals.goodsTaxableValue.toFixed(2), "140436.85");
    assert.equal(result.totals.totalBasic.toFixed(2), "141436.85");
    assert.equal(result.totals.totalCgst.toFixed(2), "12729.32");
    assert.equal(result.totals.totalSgst.toFixed(2), "12729.32");
    assert.equal(result.totals.totalTax.toFixed(2), "25458.64");
    assert.equal(result.totals.roundOffAmount.toFixed(2), "-0.49");
    assert.equal(result.totals.netAmount.toFixed(2), "166895.00");
  });

  it("keeps bucket totals equal to the sum of line totals", () => {
    const result = calculateSalesBillSnapshot({
      allocationRows: [row({ rate: 333.33, gstRate: 5 }), row({ dispatchId: 2, itemId: 2, rate: 777.77, gstRate: 18 })],
      transportation: { amount: 123.45, chargedBy: "OUR_COMPANY" }, intraState: true,
    });
    for (const field of ["cgstAmount", "sgstAmount", "igstAmount"]) {
      const lineSum = result.lines.reduce((sum, line) => sum.plus(line[field]), result.totals.totalBasic.minus(result.totals.totalBasic));
      const totalField = field === "cgstAmount" ? "totalCgst" : field === "sgstAmount" ? "totalSgst" : "totalIgst";
      assert.equal(lineSum.toFixed(2), result.totals[totalField].toFixed(2));
    }
  });

  it("rejects zero allocation and negative transportation", () => {
    assert.throws(() => calculateSalesBillSnapshot({ allocationRows: [row({ allocatedQty: 0 })], intraState: true }), /greater than zero/);
    assert.throws(() => calculateSalesBillSnapshot({ allocationRows: [row()], transportation: { amount: -1 }, intraState: true }), /cannot be negative/);
  });

  it("exports one balanced Tally voucher with multi-rate goods and one freight ledger", () => {
    const payload = {
      salesBillId: 9, voucherNo: "SB-9", billDate: new Date("2026-07-19"),
      customer: { customerName: "Acme" }, tax: { taxIntraState: true, subtotal: "101000", totalCgst: "6464", totalSgst: "6464", totalIgst: "0", gstTotal: "12928", roundOffAmount: "0", totalAmount: "113928" },
      transportation: { taxableAmount: "1000", ledger: "Freight Charges", roundOffLedger: "Round Off" },
      tally: { ledgers: { sales: null, cgst: null, sgst: null, igst: null } },
      taxBuckets: [
        { gstRate: 5, salesLedger: "Local Sales @5%", cgstLedger: "Output CGST @2.5%", sgstLedger: "Output SGST @2.5%", cgst: "1010", sgst: "1010", igst: "0" },
        { gstRate: 18, salesLedger: "Local Sales @18%", cgstLedger: "Output CGST @9%", sgstLedger: "Output SGST @9%", cgst: "5454", sgst: "5454", igst: "0" },
      ],
      lines: [
        { itemId: 1, itemName: "A", hsnCode: "1", gstRate: "5", unit: "Nos", quantity: "1", rate: "40000", baseAmount: "40000", salesLedger: "Local Sales @5%" },
        { itemId: 2, itemName: "B", hsnCode: "2", gstRate: "18", unit: "Nos", quantity: "1", rate: "60000", baseAmount: "60000", salesLedger: "Local Sales @18%" },
      ],
    };
    const xml = buildSalesBillTallyXml(payload);
    assert.equal((xml.match(/<VOUCHER /g) || []).length, 1);
    assert.equal((xml.match(/<LEDGERNAME>Freight Charges<\/LEDGERNAME>/g) || []).length, 1);
    assert.match(xml, /Output CGST @2.5%/);
    assert.match(xml, /Output CGST @9%/);
  });
});
