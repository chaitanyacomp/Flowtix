import { describe, expect, it } from "vitest";
import { formatRmQty } from "../../src/lib/rmQtyDisplay";

describe("formatRmQty", () => {
  it("appends unit when provided", () => {
    expect(formatRmQty(32.926, "KG")).toBe("32.926 KG");
    expect(formatRmQty(0, "KG")).toBe("0 KG");
  });

  it("formats without unit when missing", () => {
    expect(formatRmQty(1.02, "")).toBe("1.02");
  });
});
