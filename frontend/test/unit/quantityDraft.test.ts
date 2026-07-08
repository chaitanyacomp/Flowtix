import { describe, expect, it } from "vitest";
import { parsePositiveQuantityDraft, sanitizeQtyInputDraft } from "../../src/lib/quantityDraft";

describe("sanitizeQtyInputDraft", () => {
  it("strips thousands separators from pasted qty text", () => {
    expect(sanitizeQtyInputDraft("2,991")).toBe("2991");
    expect(sanitizeQtyInputDraft("1,234.5")).toBe("1234.5");
    expect(sanitizeQtyInputDraft("250")).toBe("250");
  });
});

describe("parsePositiveQuantityDraft", () => {
  it("parses comma-formatted mandatory positive qty after sanitization", () => {
    expect(parsePositiveQuantityDraft("2,991")).toBe(2991);
    expect(parsePositiveQuantityDraft("")).toBe(null);
    expect(parsePositiveQuantityDraft("0")).toBe(null);
  });
});
