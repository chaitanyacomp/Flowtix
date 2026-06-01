const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeGstinOnSave,
  isValidGstinFormat,
  gstStateCodeFromGstin,
  validateGstinFormatMessage,
  validateGstinAgainstState,
} = require("../../src/services/gstinNormalize");

test("normalizeGstinOnSave trims, uppercases, and limits length", () => {
  assert.equal(normalizeGstinOnSave("  27aaecc1234f1z5  "), "27AAECC1234F1Z5".slice(0, 15));
  assert.equal(normalizeGstinOnSave(""), null);
  assert.equal(normalizeGstinOnSave(null), null);
});

test("valid GSTIN passes format validation", () => {
  const gstin = "27AAECC1234F1Z5";
  assert.equal(isValidGstinFormat(gstin), true);
  assert.equal(validateGstinFormatMessage(gstin), null);
  assert.equal(gstStateCodeFromGstin(gstin), "27");
});

test("invalid GSTIN length is blocked", () => {
  assert.equal(validateGstinFormatMessage("27ABC"), "GSTIN must be exactly 15 characters.");
});

test("GSTIN state mismatch is detected", () => {
  const msg = validateGstinAgainstState("27AAECC1234F1Z5", { stateCode: "24" });
  assert.equal(msg, "Selected state does not match the GSTIN state code.");
});

test("empty GSTIN is allowed", () => {
  assert.equal(validateGstinFormatMessage(""), null);
  assert.equal(validateGstinAgainstState("", {}), null);
});
