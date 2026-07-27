import { describe, expect, it } from "vitest";
import {
  formatSalesBillTransportRefs,
  isSalesBillTransporterRequired,
  normalizeTransportReferenceNo,
  normalizeTransportationAmount,
  normalizeVehicleNumber,
  sanitizeTransportationChargeDraft,
  validateSalesBillTransportationInput,
} from "../../src/lib/salesBillTransporterValidation";

describe("normalizeTransportationAmount", () => {
  it("accepts zero and positive amounts with up to 2 decimals", () => {
    expect(normalizeTransportationAmount(0)).toEqual({ ok: true, value: 0 });
    expect(normalizeTransportationAmount("10")).toEqual({ ok: true, value: 10 });
    expect(normalizeTransportationAmount("10.5")).toEqual({ ok: true, value: 10.5 });
    expect(normalizeTransportationAmount("10.50")).toEqual({ ok: true, value: 10.5 });
    expect(normalizeTransportationAmount(12.34)).toEqual({ ok: true, value: 12.34 });
  });

  it("rejects text, commas, negatives and more than 2 decimals", () => {
    expect(normalizeTransportationAmount("abc").ok).toBe(false);
    expect(normalizeTransportationAmount("1,000").ok).toBe(false);
    expect(normalizeTransportationAmount("-5").ok).toBe(false);
    expect(normalizeTransportationAmount(-1).ok).toBe(false);
    expect(normalizeTransportationAmount("10.555").ok).toBe(false);
    expect(normalizeTransportationAmount(10.555).ok).toBe(false);
  });

  it("rejects commas while typing in the charge draft sanitizer", () => {
    expect(sanitizeTransportationChargeDraft("12")).toBe("12");
    expect(sanitizeTransportationChargeDraft("12.")).toBe("12.");
    expect(sanitizeTransportationChargeDraft("12.3")).toBe("12.3");
    expect(sanitizeTransportationChargeDraft("1,200")).toBeNull();
    expect(sanitizeTransportationChargeDraft("12.345")).toBeNull();
    expect(sanitizeTransportationChargeDraft("-1")).toBeNull();
  });
});

describe("normalizeVehicleNumber", () => {
  it("accepts standard, BH-series and temporary Indian formats and normalizes", () => {
    expect(normalizeVehicleNumber("mh12ab1234")).toEqual({ ok: true, value: "MH 12 AB 1234" });
    expect(normalizeVehicleNumber("MH 12-AB-1234")).toEqual({ ok: true, value: "MH 12 AB 1234" });
    expect(normalizeVehicleNumber("22bh1234aa")).toEqual({ ok: true, value: "22 BH 1234 AA" });
    expect(normalizeVehicleNumber("22 BH 1234 AA")).toEqual({ ok: true, value: "22 BH 1234 AA" });
    expect(normalizeVehicleNumber("KA01T1234")).toEqual({ ok: true, value: "KA 01 T 1234" });
    expect(normalizeVehicleNumber("ka 01 temp 99")).toEqual({ ok: true, value: "KA 01 TEMP 99" });
    expect(normalizeVehicleNumber("TEMP1234")).toEqual({ ok: true, value: "TEMP 1234" });
  });

  it("rejects arbitrary vehicle text", () => {
    const r = normalizeVehicleNumber("not a vehicle");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("Enter a valid vehicle number.");
    expect(normalizeVehicleNumber("HELLO").ok).toBe(false);
    expect(normalizeVehicleNumber("12345").ok).toBe(false);
  });
});

describe("isSalesBillTransporterRequired", () => {
  it("is optional when amount is zero and charged by our company", () => {
    expect(isSalesBillTransporterRequired({ amount: 0, chargedBy: "OUR_COMPANY" })).toBe(false);
  });

  it("is required when transportation charges are positive", () => {
    expect(isSalesBillTransporterRequired({ amount: 100, chargedBy: "OUR_COMPANY" })).toBe(true);
  });

  it("is required when charged by transporter directly", () => {
    expect(isSalesBillTransporterRequired({ amount: 0, chargedBy: "TRANSPORTER_DIRECTLY" })).toBe(true);
  });
});

describe("normalizeTransportReferenceNo", () => {
  it("trims and accepts common logistics characters", () => {
    expect(normalizeTransportReferenceNo("  LR-12/AB_3  ")).toEqual({ ok: true, value: "LR-12/AB_3" });
  });

  it("rejects unsupported special characters", () => {
    const r = normalizeTransportReferenceNo("LR#99");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/letters, numbers/i);
  });

  it("rejects overly long values", () => {
    const r = normalizeTransportReferenceNo("A".repeat(65));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/at most 64/i);
  });

  it("treats blank as null", () => {
    expect(normalizeTransportReferenceNo("   ")).toEqual({ ok: true, value: null });
  });
});

describe("validateSalesBillTransportationInput", () => {
  it("requires transporterId when charges apply — free-text name is not enough", () => {
    const r = validateSalesBillTransportationInput({
      amount: 50,
      chargedBy: "OUR_COMPANY",
      transporterName: "Acme Logistics",
      vehicleNumber: "MH12AB1234",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("transporter");
      expect(r.message).toMatch(/Transporter Name is required/i);
    }
  });

  it("requires a valid vehicle when transport details apply", () => {
    const missing = validateSalesBillTransportationInput({
      amount: 50,
      chargedBy: "OUR_COMPANY",
      transporterId: 12,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.field).toBe("vehicleNumber");

    const bad = validateSalesBillTransportationInput({
      amount: 50,
      chargedBy: "OUR_COMPANY",
      transporterId: 12,
      vehicleNumber: "random text",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toBe("Enter a valid vehicle number.");
  });

  it("accepts master transporterId and vehicle when required", () => {
    expect(
      validateSalesBillTransportationInput({
        amount: 50,
        chargedBy: "OUR_COMPANY",
        transporterId: 12,
        referenceNo: "LR-1",
        vehicleNumber: "MH 12 AB 1234",
      }).ok,
    ).toBe(true);
  });

  it("allows legacy name-only and legacy vehicle omit when opted in", () => {
    expect(
      validateSalesBillTransportationInput({
        amount: 50,
        chargedBy: "OUR_COMPANY",
        transporterName: "Old Free Text Carrier",
        allowLegacyNameOnly: true,
        allowLegacyVehicleOmit: true,
      }).ok,
    ).toBe(true);
  });

  it("stays optional when transport is not applicable", () => {
    expect(
      validateSalesBillTransportationInput({
        amount: 0,
        chargedBy: "OUR_COMPANY",
        referenceNo: null,
        vehicleNumber: null,
      }).ok,
    ).toBe(true);
  });

  it("surfaces reference validation failures", () => {
    const r = validateSalesBillTransportationInput({
      amount: 0,
      chargedBy: "OUR_COMPANY",
      referenceNo: "bad@ref",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("referenceNo");
  });

  it("surfaces amount validation failures", () => {
    const r = validateSalesBillTransportationInput({
      amount: "1,200",
      chargedBy: "OUR_COMPANY",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("amount");
  });
});

describe("formatSalesBillTransportRefs", () => {
  it("labels legacy combined reference when vehicleNumber is absent", () => {
    expect(formatSalesBillTransportRefs({ transportationReferenceNo: "LR-9 / MH12AB1234" })).toMatchObject({
      isLegacyCombined: true,
      lrLabel: "LR / vehicle / ref (legacy)",
      lrValue: "LR-9 / MH12AB1234",
      vehicleValue: null,
    });
  });

  it("splits LR and vehicle when vehicleNumber is present", () => {
    expect(
      formatSalesBillTransportRefs({
        transportationReferenceNo: "LR-9",
        vehicleNumber: "MH 12 AB 1234",
      }),
    ).toMatchObject({
      isLegacyCombined: false,
      lrLabel: "LR / Transport Reference",
      lrValue: "LR-9",
      vehicleValue: "MH 12 AB 1234",
    });
  });
});
