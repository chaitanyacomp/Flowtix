import { describe, expect, it } from "vitest";
import { formatOperationalWarningMessage } from "../../src/lib/operationalWarningPresentation";

describe("operationalWarningPresentation", () => {
  it("maps internal warning codes to business language", () => {
    expect(
      formatOperationalWarningMessage({
        code: "LEGACY_RESERVATION_EXCEEDS_PHYSICAL",
        message: "LEGACY_RESERVATION_EXCEEDS_PHYSICAL",
      }),
    ).toBe("Reserved quantity exceeds available stock");
  });

  it("prefers human message when provided", () => {
    expect(
      formatOperationalWarningMessage({
        code: "AWAITING_PO",
        message: "Purchase Request exists — waiting for Purchase to create RM PO.",
      }),
    ).toBe("Purchase Request exists — waiting for Purchase to create RM PO.");
  });
});
