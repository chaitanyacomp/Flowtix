import { describe, expect, it } from "vitest";
import {
  formatSuggestedIssueQty,
  hasPartialStoreAutofill,
  isMaterialIssueLineStockBlocked,
  stillRequiredMaterialIssueQty,
  suggestedMaterialIssueQty,
} from "../../src/lib/materialIssueUx";

describe("materialIssueUx", () => {
  it("computes still required from original and issued", () => {
    expect(stillRequiredMaterialIssueQty(5200, 3120)).toBe(2080);
    expect(stillRequiredMaterialIssueQty(5200, 5200)).toBe(0);
  });

  it("auto-fills full still required when stock covers balance", () => {
    expect(suggestedMaterialIssueQty(2080, 8000)).toBe(2080);
    expect(formatSuggestedIssueQty(2080, 8000)).toBe("2080");
  });

  it("auto-fills available only when stock is partial", () => {
    expect(suggestedMaterialIssueQty(2080, 1500)).toBe(1500);
    expect(suggestedMaterialIssueQty(5200, 2080)).toBe(2080);
  });

  it("auto-fills zero when no stock", () => {
    expect(suggestedMaterialIssueQty(2080, 0)).toBe(0);
    expect(formatSuggestedIssueQty(2080, 0)).toBe("0");
  });

  it("waits for availability before suggesting qty", () => {
    expect(suggestedMaterialIssueQty(2080, null)).toBe(0);
  });

  it("detects stock-blocked PMR lines", () => {
    expect(isMaterialIssueLineStockBlocked(2080, 0)).toBe(true);
    expect(isMaterialIssueLineStockBlocked(2080, 2080)).toBe(false);
  });

  it("detects partial autofill rows", () => {
    expect(
      hasPartialStoreAutofill([{ stillRequiredQty: 2080, available: 1500, originalRequestQty: 5200 }]),
    ).toBe(true);
    expect(hasPartialStoreAutofill([{ stillRequiredQty: 100, available: 500, originalRequestQty: 5200 }])).toBe(
      false,
    );
  });
});
