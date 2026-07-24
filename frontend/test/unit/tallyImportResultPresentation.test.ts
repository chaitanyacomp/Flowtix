import { describe, expect, it } from "vitest";
import {
  sanitizeTallyImportResultText,
  tallyImportCorrectiveAction,
} from "../../src/lib/tallyImportResultPresentation";

describe("Tally import result presentation", () => {
  it("removes Prisma paths and stack locations", () => {
    const raw = "Invalid prisma.unit.create() at C:\\repo\\backend\\service.js:1804:22";
    const shown = sanitizeTallyImportResultText(raw);
    expect(shown).toBe("The master could not be imported safely.");
    expect(shown).not.toMatch(/prisma|C:\\|:\d+:\d+/i);
  });

  it("provides compact corrective action for duplicate units", () => {
    expect(tallyImportCorrectiveAction("Equivalent unit already exists.", null)).toContain("reused");
  });

  it("keeps clean business messages", () => {
    expect(sanitizeTallyImportResultText("Unit code is invalid.")).toBe("Unit code is invalid.");
  });
});
