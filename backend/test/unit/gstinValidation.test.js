const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeGstinOnSave,
  isValidGstinFormat,
  gstStateCodeFromGstin,
  validateGstinFormatMessage,
  validateGstinAgainstState,
  cleanGstinChars,
  resolveImportGstin,
} = require("../../src/services/gstinNormalize");

test("normalizeGstinOnSave trims, strips separators, uppercases valid GSTIN", () => {
  assert.equal(normalizeGstinOnSave("  27aaecc1234f1z5  "), "27AAECC1234F1Z5");
  assert.equal(normalizeGstinOnSave("27 AA ECC 1234 F1Z5"), "27AAECC1234F1Z5");
  assert.equal(normalizeGstinOnSave(""), null);
  assert.equal(normalizeGstinOnSave(null), null);
  assert.equal(normalizeGstinOnSave("27ABC"), null);
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

test("GSTIN with internal whitespace still validates when cleaned length is 15", () => {
  assert.equal(validateGstinFormatMessage("27ALSKD1412A1Z5"), null);
  assert.equal(validateGstinFormatMessage("27 ALSKD1412A1Z5"), null);
  assert.equal(cleanGstinChars("27\nALSKD1412A1Z5"), "27ALSKD1412A1Z5");
});

test("resolveImportGstin shares preview/apply validation path", () => {
  const ok = resolveImportGstin("27ALSKD1412A1Z5");
  assert.equal(ok.gstNorm, "27ALSKD1412A1Z5");
  assert.equal(ok.gstMsg, null);
  const bad = resolveImportGstin("ALSKD1412A");
  assert.equal(bad.gstNorm, null);
  assert.ok(bad.gstMsg);
});

test("GSTIN state mismatch is detected", () => {
  const msg = validateGstinAgainstState("27AAECC1234F1Z5", { stateCode: "24" });
  assert.equal(msg, "Selected state does not match the GSTIN state code.");
});

test("empty GSTIN is allowed", () => {
  assert.equal(validateGstinFormatMessage(""), null);
  assert.equal(validateGstinAgainstState("", {}), null);
});
