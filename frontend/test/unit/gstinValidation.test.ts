import { describe, expect, it } from "vitest";
import {
  gstStateCodeFromGstin,
  normalizeGstinInput,
  resolveStateIdFromGstin,
  validateGstinAgainstState,
  validateGstinFormatMessage,
} from "../../src/lib/gstinValidation";

const STATES = [
  { id: 1, stateName: "Maharashtra", stateCode: "27" },
  { id: 2, stateName: "Gujarat", stateCode: "24" },
];

describe("gstinValidation", () => {
  it("normalizes GSTIN input", () => {
    expect(normalizeGstinInput(" 27aaecc1234f1z5 ")).toBe("27AAECC1234F1Z5");
  });

  it("extracts GST state code", () => {
    expect(gstStateCodeFromGstin("27AAECC1234F1Z5")).toBe("27");
  });

  it("resolves state id from GSTIN prefix", () => {
    expect(resolveStateIdFromGstin("27AAECC1234F1Z5", STATES)).toBe(1);
  });

  it("blocks invalid GSTIN format", () => {
    expect(validateGstinFormatMessage("BAD")).toBe("GSTIN must be exactly 15 characters.");
  });

  it("blocks GSTIN/state mismatch", () => {
    expect(validateGstinAgainstState("27AAECC1234F1Z5", 2, STATES)).toBe(
      "Selected state does not match the GSTIN state code.",
    );
  });
});
