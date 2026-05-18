import { describe, expect, it } from "vitest";

import {
  buildQuotationPendingSoHref,
  flowLabelForQuotationPendingSo,
  normalizeQuotationPendingSoRow,
} from "../../src/lib/dashboardCommercialWorkflow";

describe("dashboardCommercialWorkflow", () => {
  it("builds REGULAR sales order creation href", () => {
    expect(buildQuotationPendingSoHref(42, "REGULAR")).toBe(
      "/sales-orders?quotationId=42&from=dashboard",
    );
  });

  it("builds NO_QTY sales order creation href", () => {
    expect(buildQuotationPendingSoHref(7, "NO_QTY", "quotations")).toBe(
      "/sales-orders/no-qty/from-quotation?quotationId=7&from=quotations",
    );
  });

  it("uses consistent flow labels", () => {
    expect(flowLabelForQuotationPendingSo("REGULAR")).toBe("REGULAR Order");
    expect(flowLabelForQuotationPendingSo("NO_QTY")).toBe("NO_QTY Agreement");
  });

  it("normalizes API rows and falls back href", () => {
    const row = normalizeQuotationPendingSoRow({
      quotationId: 3,
      quotationNo: "QT-003",
      customerName: "Acme",
      flowType: "NO_QTY",
    });
    expect(row).toMatchObject({
      quotationId: 3,
      quotationNo: "QT-003",
      customerName: "Acme",
      flowType: "NO_QTY",
      nextStep: "Create Sales Order",
      href: "/sales-orders/no-qty/from-quotation?quotationId=3&from=dashboard",
    });
  });
});
