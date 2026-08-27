import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parsePositiveQuantityDraft,
  sanitizeProductionQtyDraftInput,
} from "../../src/lib/quantityDraft";
import {
  formatProductionOperatorUnitLabel,
  formatProductionQtyForInput,
  productionOperatorQtyPlaceholder,
} from "../../src/lib/productionOperatorUx";

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

  it("quick-fill 1500 and 1571 store raw numbers accepted by validation", () => {
    for (const n of [1500, 1571]) {
      const filled = formatProductionQtyForInput(n, "Nos");
      expect(filled).toBe(String(n));
      expect(filled).not.toMatch(/,/);
      expect(filled.toLowerCase()).not.toContain("nos");
      expect(parsePositiveQuantityDraft(filled)).toBe(n);
      expect(parsePositiveQuantityDraft(sanitizeProductionQtyDraftInput(filled, "Nos"))).toBe(n);
    }
  });

  it("rejects formatted display strings with commas and unit text", () => {
    expect(sanitizeProductionQtyDraftInput("1,571 Nos", "Nos")).toBe("1571");
    expect(parsePositiveQuantityDraft(sanitizeProductionQtyDraftInput("1,571 Nos", "Nos"))).toBe(1571);
    expect(sanitizeProductionQtyDraftInput("1,500 nos", "Nos")).toBe("1500");
    expect(sanitizeProductionQtyDraftInput("-12", "Nos")).toBe("12");
    expect(sanitizeProductionQtyDraftInput("12a", "Nos")).toBe("12");
  });

  it("allows decimal entry when UOM supports decimals", () => {
    expect(sanitizeProductionQtyDraftInput("12.75", "Meter")).toBe("12.75");
    expect(sanitizeProductionQtyDraftInput("0.5", "Kg")).toBe("0.5");
    expect(sanitizeProductionQtyDraftInput("2.", "Meter")).toBe("2.");
    expect(parsePositiveQuantityDraft(sanitizeProductionQtyDraftInput("12.75", "Meter"))).toBe(12.75);
    // Integer UOM ignores decimal portion (does not glue fractional digits)
    expect(sanitizeProductionQtyDraftInput("12.75", "Nos")).toBe("12");
  });

  it("shows UOM once as fixed suffix label, not inside the input value", () => {
    const inputValue = formatProductionQtyForInput(1571, "Nos");
    const suffix = formatProductionOperatorUnitLabel("Nos");
    expect(inputValue).toBe("1571");
    expect(suffix).toBe("Nos");
    expect(`${inputValue} ${suffix}`.match(/Nos/gi)?.length).toBe(1);
    expect(productionOperatorQtyPlaceholder("Nos")).toBe("Enter quantity");
    expect(productionOperatorQtyPlaceholder("Meter")).toBe("Enter quantity");
    expect(parsePositiveQuantityDraft("")).toBeNull();
    expect(parsePositiveQuantityDraft("Enter quantity")).toBeNull();
  });

  it("manual entry enables successful positive-qty submission parse", () => {
    const typed = sanitizeProductionQtyDraftInput("1571", "Nos");
    const parsed = parsePositiveQuantityDraft(typed);
    expect(parsed).toBe(1571);
    // Simulated API body uses the parsed number, not the display string
    expect(JSON.stringify({ producedQty: parsed })).toBe('{"producedQty":1571}');
  });

  it("blank and invalid produced qty stay invalid until the operator enters a positive value", () => {
    expect(parsePositiveQuantityDraft("")).toBeNull();
    expect(parsePositiveQuantityDraft("   ")).toBeNull();
    expect(parsePositiveQuantityDraft("0")).toBeNull();
    expect(parsePositiveQuantityDraft("-5")).toBeNull();
    expect(parsePositiveQuantityDraft("15000")).toBe(15000);
  });
});

describe("production quantity safety (workspace form)", () => {
  it("does not auto-fill remaining/planned/RM max into Produced Qty", () => {
    const src = readFileSync(resolve(__dirname, "../../src/pages/ProductionPage.tsx"), "utf8");
    expect(src).toContain("resetProducedQtyField()");
    expect(src).not.toMatch(
      /if \(rem > 1e-9 && !producedQtyUserTouchedRef\.current && !isGreenLevelWo\)/,
    );
    expect(src).toContain("fillOperatorRemainingQty");
    expect(src).toContain("fillOperatorRmSupportedMaxQty");
    expect(src).toContain("producedQtyValid &&");
    expect(src).toContain("autoOpenConfirmStart");
    expect(src).toContain("resolveActiveShiftWorkspaceCueFromGate");
  });

  it("Save Production stays disabled until createFormCanSubmit (valid qty)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../src/components/erp/production/ProductionOperatorEntryShell.tsx"),
      "utf8",
    );
    expect(src).toContain("disabled={posting || !createFormCanSubmit || fieldsDisabled}");
    expect(src).toContain("Use Remaining Qty");
    expect(src).toContain("Use RM-Supported Max");
  });
});
