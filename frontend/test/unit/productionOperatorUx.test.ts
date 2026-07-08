import { describe, expect, it } from "vitest";
import {
  PRODUCTION_SAVE_BUTTON_LABEL,
  formatProductionOperatorMaxHelper,
  formatProductionOperatorQty,
  formatProductionOperatorShortUnit,
  productionOperatorQtyPlaceholder,
  resolveProductionEntryMaxQty,
} from "../../src/lib/productionOperatorUx";

describe("productionOperatorUx", () => {
  it("resolveProductionEntryMaxQty caps by RM when both limits apply", () => {
    expect(resolveProductionEntryMaxQty(6000, 4500)).toBe(4500);
    expect(resolveProductionEntryMaxQty(6000, null)).toBe(6000);
    expect(resolveProductionEntryMaxQty(0, 100)).toBe(100);
  });

  it("formatProductionOperatorQty includes UOM", () => {
    expect(formatProductionOperatorQty(6000, "Meter")).toMatch(/6[,.]?000/);
    expect(formatProductionOperatorQty(6000, "Meter")).toContain("Meter");
  });

  it("uses compact max helper label", () => {
    expect(formatProductionOperatorMaxHelper(6000, "Meter")).toBe("Max: 6,000 m");
    expect(formatProductionOperatorShortUnit("NOS")).toBe("nos");
  });

  it("uses operator qty placeholder", () => {
    expect(productionOperatorQtyPlaceholder("Meter")).toBe("0.000 Meter");
    expect(productionOperatorQtyPlaceholder("Nos")).toBe("Nos");
  });

  it("uses Save Production label for operator save CTA", () => {
    expect(PRODUCTION_SAVE_BUTTON_LABEL).toBe("Save Production");
  });
});
