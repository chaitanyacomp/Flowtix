import { describe, expect, it } from "vitest";
import { buildSalesBillTaxSummary, lineTaxRates } from "../../src/lib/salesBillTaxDisplay";

const line = (gstRate: number, basicAmount: string, cgstAmount: string, sgstAmount: string, igstAmount = "0", transportationAllocation = "0") =>
  ({ gstRate, basicAmount, cgstAmount, sgstAmount, igstAmount, transportationAllocation });

describe("Sales Bill GST display", () => {
  it("shows intrastate 18% as equal 9% components", () => expect(lineTaxRates(line(18, "118", "9", "9"), true)).toEqual({ gst: "18%", cgst: "9%", sgst: "9%", igst: null }));
  it("shows interstate 18% only as IGST 18%", () => expect(lineTaxRates(line(18, "118", "0", "0", "21.24"), false)).toEqual({ gst: "18%", cgst: null, sgst: null, igst: "18%" }));
  it("groups multi-rate stored amounts and transportation-inclusive taxable values exactly", () => {
    const summary = buildSalesBillTaxSummary([line(5, "400.40", "10.01", "10.01", "0", "0.40"), line(18, "600.60", "54.05", "54.05", "0", "0.60")], true);
    expect(summary.map((row) => [row.gstRateLabel, row.taxableValue, row.cgstRateLabel, row.cgstAmount])).toEqual([["5%", "400.40", "2.5%", "10.01"], ["18%", "600.60", "9%", "54.05"]]);
    expect(summary.reduce((sum, row) => sum + Number(row.taxableValue), 0).toFixed(2)).toBe("1001.00");
  });
  it("keeps legacy stored totals without deriving rates from tax amounts", () => {
    const summary = buildSalesBillTaxSummary([line(18, "100.00", "8.99", "9.01")], true);
    expect(summary[0]).toMatchObject({ gstRateLabel: "18%", cgstAmount: "8.99", sgstAmount: "9.01" });
  });
});
