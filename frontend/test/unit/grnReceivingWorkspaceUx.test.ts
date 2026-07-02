import { describe, expect, it } from "vitest";
import {
  computeGrnBalanceAfterReceipt,
  formatGrnWorkspaceQty,
  GRN_MODAL_DISCARD_CONFIRM,
  hasGrnModalUnsavedEntry,
  snapshotGrnModalLines,
} from "../../src/lib/grnReceivingWorkspaceUx";

describe("grnReceivingWorkspaceUx", () => {
  it("formats workspace qty with unit", () => {
    expect(formatGrnWorkspaceQty(150, "Kg")).toBe("150 Kg");
    expect(formatGrnWorkspaceQty(144.354, "Kg")).toBe("144.354 Kg");
  });

  it("computes balance after receipt", () => {
    expect(computeGrnBalanceAfterReceipt(150, 100)).toBe(50);
    expect(computeGrnBalanceAfterReceipt(150, 150)).toBe(0);
  });

  it("detects unsaved GRN modal changes", () => {
    const baseline = {
      grnDateInput: "2026-07-01",
      grnSupplierInvoiceNo: "",
      grnLines: snapshotGrnModalLines([
        { rmPoLineId: 1, receivedQty: 150, locationId: 10 },
      ]),
    };
    expect(
      hasGrnModalUnsavedEntry(baseline, {
        grnDateInput: "2026-07-01",
        grnSupplierInvoiceNo: "",
        grnLines: [{ rmPoLineId: 1, receivedQty: 150, locationId: 10 }],
      }),
    ).toBe(false);
    expect(
      hasGrnModalUnsavedEntry(baseline, {
        grnDateInput: "2026-07-02",
        grnSupplierInvoiceNo: "",
        grnLines: [{ rmPoLineId: 1, receivedQty: 150, locationId: 10 }],
      }),
    ).toBe(true);
    expect(
      hasGrnModalUnsavedEntry(baseline, {
        grnDateInput: "2026-07-01",
        grnSupplierInvoiceNo: "INV-1",
        grnLines: [{ rmPoLineId: 1, receivedQty: 150, locationId: 10 }],
      }),
    ).toBe(true);
    expect(
      hasGrnModalUnsavedEntry(baseline, {
        grnDateInput: "2026-07-01",
        grnSupplierInvoiceNo: "",
        grnLines: [{ rmPoLineId: 1, receivedQty: 120, locationId: 10 }],
      }),
    ).toBe(true);
    expect(
      hasGrnModalUnsavedEntry(baseline, {
        grnDateInput: "2026-07-01",
        grnSupplierInvoiceNo: "",
        grnLines: [{ rmPoLineId: 1, receivedQty: 150, locationId: 11 }],
      }),
    ).toBe(true);
    expect(GRN_MODAL_DISCARD_CONFIRM).toBe("Discard unsaved GRN receipt?");
  });
});
