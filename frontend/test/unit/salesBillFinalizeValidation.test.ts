import { describe, expect, it } from "vitest";
import {
  buildSalesBillFinalizeChecks,
  canFinalizeSalesBill,
  firstFinalizeBlocker,
} from "../../src/lib/salesBillFinalizeValidation";

const readyBill = {
  id: 1,
  docNo: "SB-26-0003",
  billDate: "2026-05-01",
  dispatchId: 10,
  customerId: 5,
  customer: { id: 5, name: "Acme Corp" },
  customerStateCodeSnapshot: "27",
  gstMode: "LOCAL" as const,
  taxIntraState: true,
  netAmount: "5743.98",
  lines: [
    {
      id: 1,
      qty: "100",
      rate: "50",
      hsnCodeSnapshot: "7308",
      basicAmount: "5000",
      lineTotal: "5743.98",
    },
  ],
};

describe("salesBillFinalizeValidation", () => {
  it("passes when bill is complete", () => {
    const checks = buildSalesBillFinalizeChecks(readyBill, "2026-05-01");
    expect(canFinalizeSalesBill(checks)).toBe(true);
    expect(firstFinalizeBlocker(checks)).toBeNull();
  });

  it("blocks when system bill number is missing", () => {
    const checks = buildSalesBillFinalizeChecks({ ...readyBill, docNo: null }, "2026-05-01");
    expect(canFinalizeSalesBill(checks)).toBe(false);
    expect(firstFinalizeBlocker(checks)).toMatch(/Sales bill number/i);
  });

  it("blocks when line rates are missing", () => {
    const checks = buildSalesBillFinalizeChecks(
      {
        ...readyBill,
        lines: [{ ...readyBill.lines[0], rate: "0" }],
      },
      "2026-05-01",
    );
    expect(canFinalizeSalesBill(checks)).toBe(false);
    expect(firstFinalizeBlocker(checks)).toMatch(/Line rates/i);
  });
});
