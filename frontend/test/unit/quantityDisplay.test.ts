import { describe, expect, it } from "vitest";
import {
  bindQuantityFormatter,
  formatConsumptionQuantity,
  formatDispatchQuantity,
  formatFgQuantity,
  formatPlanningQuantity,
  formatQtyNumber,
  formatQuantityWithUnit,
  formatQcQuantity,
  formatRmQuantity,
  formatScrapQuantity,
  formatStockQuantity,
  qtyDecimalPlacesFromUnit,
} from "../../src/lib/quantityDisplay";

describe("qtyDecimalPlacesFromUnit", () => {
  it("uses integer precision for count units", () => {
    expect(qtyDecimalPlacesFromUnit("Nos")).toBe(0);
    expect(qtyDecimalPlacesFromUnit("PCS")).toBe(0);
    expect(qtyDecimalPlacesFromUnit("Sheets")).toBe(0);
  });

  it("uses three decimals for weight and measure units", () => {
    expect(qtyDecimalPlacesFromUnit("Kg")).toBe(3);
    expect(qtyDecimalPlacesFromUnit("m")).toBe(3);
    expect(qtyDecimalPlacesFromUnit("L")).toBe(3);
  });
});

describe("formatQuantityWithUnit", () => {
  it("formats meter with trailing zero strip", () => {
    expect(formatQuantityWithUnit(523.809, "m")).toBe("523.809 m");
  });

  it("formats integer FG units without decimals", () => {
    expect(formatQuantityWithUnit(523, "Nos")).toBe("523 Nos");
    expect(formatQuantityWithUnit(250, "Sheets")).toBe("250 Sheets");
  });

  it("formats kg with precision", () => {
    expect(formatQuantityWithUnit(12.5, "Kg")).toBe("12.5 Kg");
    expect(formatQuantityWithUnit(12.5, "Kg", { decimalPlaces: 3 })).toBe("12.5 Kg");
  });

  it("omits unit when includeUnit is false", () => {
    expect(formatQuantityWithUnit(12.5, { unit: "Kg", includeUnit: false })).toBe("12.5");
  });

  it("returns em dash for invalid values", () => {
    expect(formatQuantityWithUnit(Number.NaN, "Kg")).toBe("— Kg");
    expect(formatQuantityWithUnit(null, "Kg")).toBe("— Kg");
    expect(formatQuantityWithUnit(null, { unit: "Kg", includeUnit: false })).toBe("—");
  });
});

describe("category formatters", () => {
  it("formatRmQuantity appends RM unit", () => {
    expect(formatRmQuantity(15, "Kg")).toBe("15 Kg");
    expect(formatRmQuantity(0.85, "Kg")).toBe("0.85 Kg");
  });

  it("formatFgQuantity appends FG unit", () => {
    expect(formatFgQuantity(250, "Nos")).toBe("250 Nos");
  });

  it("formatDispatchQuantity and formatQcQuantity use FG precision", () => {
    expect(formatDispatchQuantity(120, "Nos")).toBe("120 Nos");
    expect(formatQcQuantity(118, "Nos")).toBe("118 Nos");
  });

  it("formatStockQuantity uses item unit", () => {
    expect(formatStockQuantity(150, "Kg")).toBe("150 Kg");
  });

  it("formatPlanningQuantity uses planning item unit", () => {
    expect(formatPlanningQuantity(523.809, "m")).toBe("523.809 m");
  });

  it("formatConsumptionQuantity uses RM unit", () => {
    expect(formatConsumptionQuantity(12, "Kg")).toBe("12 Kg");
  });

  it("formatScrapQuantity uses scrap item unit", () => {
    expect(formatScrapQuantity(2, "Nos")).toBe("2 Nos");
  });
});

describe("formatQtyNumber", () => {
  it("formats number only without unit suffix", () => {
    expect(formatQtyNumber(523.809, "m")).toBe("523.809");
    expect(formatQtyNumber(523, "Nos")).toBe("523");
  });
});

describe("bindQuantityFormatter", () => {
  it("binds default unit for a screen context", () => {
    const fmtFg = bindQuantityFormatter("fg", "Nos");
    expect(fmtFg(250)).toBe("250 Nos");
    expect(fmtFg(250, "m")).toBe("250 m");
  });
});
