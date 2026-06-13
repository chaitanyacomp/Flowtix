import { describe, expect, it } from "vitest";
import { isPurchaseBillTallyBulkExportEligible } from "../../src/lib/purchaseBillTallyExport";

describe("isPurchaseBillTallyBulkExportEligible", () => {
  it("allows finalized not-exported bills", () => {
    expect(isPurchaseBillTallyBulkExportEligible({ id: 1, status: "FINALIZED", isExported: false })).toBe(true);
  });

  it("rejects draft, exported, and cancelled bills", () => {
    expect(isPurchaseBillTallyBulkExportEligible({ id: 1, status: "DRAFT", isExported: false })).toBe(false);
    expect(isPurchaseBillTallyBulkExportEligible({ id: 1, status: "FINALIZED", isExported: true })).toBe(false);
    expect(
      isPurchaseBillTallyBulkExportEligible({
        id: 1,
        status: "FINALIZED",
        isExported: false,
        cancelledAt: "2026-01-01T00:00:00Z",
      }),
    ).toBe(false);
  });
});
