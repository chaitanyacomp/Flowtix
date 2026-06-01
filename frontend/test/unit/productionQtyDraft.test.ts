import { describe, expect, it } from "vitest";
import {
  parsePositiveQuantityDraft,
  sanitizeProductionQtyDraftInput,
} from "../../src/lib/quantityDraft";

describe("production qty draft", () => {
  it("sanitizes leading zeros without blocking normal entry", () => {
    expect(sanitizeProductionQtyDraftInput("0000")).toBe("0");
    expect(sanitizeProductionQtyDraftInput("02000")).toBe("2000");
    expect(sanitizeProductionQtyDraftInput("100")).toBe("100");
    expect(sanitizeProductionQtyDraftInput("")).toBe("");
  });

  it("parses positive qty after sanitize", () => {
    expect(parsePositiveQuantityDraft(sanitizeProductionQtyDraftInput("2000"))).toBe(2000);
    expect(parsePositiveQuantityDraft(sanitizeProductionQtyDraftInput("0000"))).toBe(null);
    expect(parsePositiveQuantityDraft(sanitizeProductionQtyDraftInput("2500"))).toBe(2500);
  });
});
