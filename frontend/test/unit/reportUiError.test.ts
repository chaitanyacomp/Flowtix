import { describe, expect, it } from "vitest";
import { sanitizeReportUiError } from "../../src/lib/reportUiError";

describe("sanitizeReportUiError", () => {
  it("preserves business validation messages", () => {
    expect(sanitizeReportUiError("From date must be on or before To date.")).toBe(
      "From date must be on or before To date.",
    );
    expect(sanitizeReportUiError("Invalid from date; use YYYY-MM-DD.")).toBe(
      "Invalid from date; use YYYY-MM-DD.",
    );
  });

  it("hides Prisma / path / stack internals", () => {
    const prisma =
      "Invalid `prisma.productionEntryRmConsumption.findMany()` invocation in\nD:\\Neeraj\\...\\productionWastageAnalysisQueryService.js:181\n\nUnknown argument `status`.";
    expect(sanitizeReportUiError(prisma)).toBe("Unable to load this report. Please try again.");
    expect(sanitizeReportUiError("Error: at Object.<anonymous> (/src/routes/reports.js:12)")).toBe(
      "Unable to load this report. Please try again.",
    );
  });

  it("handles empty input", () => {
    expect(sanitizeReportUiError("")).toBe("Unable to load this report. Please try again.");
  });
});
