const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isSalesBillTransporterRequired,
  normalizeTransportReferenceNo,
  normalizeTransportationAmount,
  normalizeVehicleNumber,
  validateSalesBillTransportationInput,
} = require("../../src/services/salesBillTransporterValidation");

describe("salesBillTransporterValidation", () => {
  it("requires transporter when amount > 0 or charged by transporter", () => {
    assert.equal(isSalesBillTransporterRequired({ amount: 0, chargedBy: "OUR_COMPANY" }), false);
    assert.equal(isSalesBillTransporterRequired({ amount: 10, chargedBy: "OUR_COMPANY" }), true);
    assert.equal(isSalesBillTransporterRequired({ amount: 0, chargedBy: "TRANSPORTER_DIRECTLY" }), true);
  });

  it("accepts numeric charges with at most 2 decimals", () => {
    assert.deepEqual(normalizeTransportationAmount("0"), { ok: true, value: 0 });
    assert.deepEqual(normalizeTransportationAmount("12.5"), { ok: true, value: 12.5 });
    assert.deepEqual(normalizeTransportationAmount(12.34), { ok: true, value: 12.34 });
  });

  it("rejects text, commas, negatives and excess decimals for charges", () => {
    assert.equal(normalizeTransportationAmount("abc").ok, false);
    assert.equal(normalizeTransportationAmount("1,000").ok, false);
    assert.equal(normalizeTransportationAmount("-2").ok, false);
    assert.equal(normalizeTransportationAmount(-2).ok, false);
    assert.equal(normalizeTransportationAmount("10.999").ok, false);
    assert.equal(normalizeTransportationAmount(10.999).ok, false);
  });

  it("normalizes valid Indian vehicle numbers and rejects arbitrary text", () => {
    assert.deepEqual(normalizeVehicleNumber("mh 12 ab 1234"), { ok: true, value: "MH 12 AB 1234" });
    assert.deepEqual(normalizeVehicleNumber("22BH1234AA"), { ok: true, value: "22 BH 1234 AA" });
    assert.deepEqual(normalizeVehicleNumber("KA01TEMP12"), { ok: true, value: "KA 01 TEMP 12" });
    const bad = normalizeVehicleNumber("not a plate");
    assert.equal(bad.ok, false);
    assert.equal(bad.message, "Enter a valid vehicle number.");
  });

  it("trims LR reference and rejects bad characters / length", () => {
    assert.deepEqual(normalizeTransportReferenceNo("  AB-1/2  "), { ok: true, value: "AB-1/2" });
    assert.equal(normalizeTransportReferenceNo("bad*ref").ok, false);
    assert.equal(normalizeTransportReferenceNo("X".repeat(65)).ok, false);
    assert.equal(normalizeTransportReferenceNo("  ").value, null);
  });

  it("rejects free-text transporter name without master id for new selection", () => {
    const r = validateSalesBillTransportationInput({
      amount: 100,
      chargedBy: "OUR_COMPANY",
      transporterName: "Someone",
      vehicleNumber: "MH12AB1234",
    });
    assert.equal(r.ok, false);
    assert.match(r.message, /Transporter Name is required/i);
  });

  it("requires vehicle when transport applies and accepts transporterId + vehicle", () => {
    assert.equal(
      validateSalesBillTransportationInput({
        amount: 100,
        chargedBy: "OUR_COMPANY",
        transporterId: 7,
        referenceNo: "LR 99",
      }).ok,
      false,
    );
    const r = validateSalesBillTransportationInput({
      amount: 100,
      chargedBy: "OUR_COMPANY",
      transporterId: 7,
      referenceNo: "LR 99",
      vehicleNumber: "mh12ab1234",
    });
    assert.equal(r.ok, true);
    assert.equal(r.value.transporterId, 7);
    assert.equal(r.value.referenceNo, "LR 99");
    assert.equal(r.value.vehicleNumber, "MH 12 AB 1234");
  });

  it("preserves legacy name-only and vehicle omit when opted in", () => {
    const r = validateSalesBillTransportationInput({
      amount: 25,
      chargedBy: "TRANSPORTER_DIRECTLY",
      transporterName: "Legacy Carrier",
      allowLegacyNameOnly: true,
      allowLegacyVehicleOmit: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.value.transporterId, null);
    assert.equal(r.value.transporterName, "Legacy Carrier");
    assert.equal(r.value.vehicleNumber, null);
  });

  it("leaves transporter and vehicle optional when transport does not apply", () => {
    const r = validateSalesBillTransportationInput({
      amount: 0,
      chargedBy: "OUR_COMPANY",
    });
    assert.equal(r.ok, true);
    assert.equal(r.value.required, false);
    assert.equal(r.value.transporterId, null);
    assert.equal(r.value.vehicleNumber, null);
  });
});
