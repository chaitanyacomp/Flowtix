import { describe, expect, it } from "vitest";
import { buildScrapReportDateQuery, parseScrapReportDateParam } from "../../src/lib/scrapReportDateQuery";

describe("scrapReportDateQuery", () => {
  it("omits blank From/To from API query", () => {
    expect(buildScrapReportDateQuery("", "")).toEqual({ ok: true });
    expect(buildScrapReportDateQuery("  ", "\t")).toEqual({ ok: true });
  });

  it("keeps valid single-sided ranges (ISO value from native date input)", () => {
    expect(buildScrapReportDateQuery("2026-07-01", "")).toEqual({ ok: true, from: "2026-07-01" });
    expect(buildScrapReportDateQuery("", "2026-07-15")).toEqual({ ok: true, to: "2026-07-15" });
  });

  it("accepts DD-MM-YYYY display format and normalizes to ISO for API", () => {
    expect(parseScrapReportDateParam("16-07-2026", "From")).toEqual({ kind: "ok", value: "2026-07-16" });
    expect(buildScrapReportDateQuery("01-07-2026", "15-07-2026")).toEqual({
      ok: true,
      from: "2026-07-01",
      to: "2026-07-15",
    });
  });

  it("rejects invalid dates with DD-MM-YYYY user message (never YYYY-MM-DD)", () => {
    const bad = parseScrapReportDateParam("not-a-date", "From");
    expect(bad.kind).toBe("invalid");
    if (bad.kind === "invalid") {
      expect(bad.message).toBe("Invalid From date. Please enter date in DD-MM-YYYY format.");
      expect(bad.message).not.toMatch(/YYYY-MM-DD/);
    }
    const range = buildScrapReportDateQuery("32-13-2026", "2026-07-01");
    expect(range.ok).toBe(false);
    if (!range.ok) {
      expect(range.clientError).toMatch(/DD-MM-YYYY/);
      expect(range.clientError).not.toMatch(/YYYY-MM-DD/);
    }
  });

  it("rejects From later than To", () => {
    const r = buildScrapReportDateQuery("2026-07-20", "2026-07-01");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.clientError).toBe("From date must be on or before To date.");
  });
});
