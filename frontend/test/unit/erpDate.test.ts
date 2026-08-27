import { describe, expect, it } from "vitest";
import {
  ERP_DATE_INVALID_MESSAGE,
  ERP_DATE_MAX_YMD,
  ERP_DATE_MIN_YMD,
  formatErpDateDisplay,
  isStrictCalendarYmd,
  isYmdInInclusiveRange,
  parseErpDateInput,
  sanitizeNativeDateInputValue,
} from "../../src/lib/erpDate";

describe("erpDate", () => {
  it("accepts 1900 and 2100 boundary years", () => {
    expect(isStrictCalendarYmd(ERP_DATE_MIN_YMD)).toBe(true);
    expect(isStrictCalendarYmd(ERP_DATE_MAX_YMD)).toBe(true);
    expect(isStrictCalendarYmd("1900-01-01")).toBe(true);
    expect(isStrictCalendarYmd("2100-12-31")).toBe(true);
  });

  it("rejects years outside 1900–2100", () => {
    expect(isStrictCalendarYmd("1899-12-31")).toBe(false);
    expect(isStrictCalendarYmd("2101-01-01")).toBe(false);
  });

  it("rejects 5/6-digit years and impossible calendar days (no JS rollover)", () => {
    expect(isStrictCalendarYmd("20261-01-01")).toBe(false);
    expect(isStrictCalendarYmd("120261-01-01")).toBe(false);
    expect(isStrictCalendarYmd("2026-02-30")).toBe(false);
    expect(isStrictCalendarYmd("2026-13-01")).toBe(false);
    expect(isStrictCalendarYmd("2025-02-29")).toBe(false);
  });

  it("accepts leap-day on leap years only", () => {
    expect(isStrictCalendarYmd("2024-02-29")).toBe(true);
    expect(isStrictCalendarYmd("2026-02-29")).toBe(false);
  });

  it("formats and parses DD-MM-YYYY ↔ ISO", () => {
    expect(formatErpDateDisplay("2026-08-26")).toBe("26-08-2026");
    expect(parseErpDateInput("26-08-2026")).toEqual({ ok: true, ymd: "2026-08-26" });
    expect(parseErpDateInput("2026-08-26")).toEqual({ ok: true, ymd: "2026-08-26" });
  });

  it("uses operator-facing invalid message (never YYYY-MM-DD)", () => {
    const bad = parseErpDateInput("99-99-99999");
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.message).toBe(ERP_DATE_INVALID_MESSAGE);
      expect(bad.message).not.toMatch(/YYYY-MM-DD/);
    }
  });

  it("sanitizes native date input year to 4 digits", () => {
    expect(sanitizeNativeDateInputValue("20261-01-15")).toBe("2026-01-15");
    expect(sanitizeNativeDateInputValue("120261-01-15")).toBe("1202-01-15");
  });

  it("honours screen-specific inclusive min/max", () => {
    expect(isYmdInInclusiveRange("2026-08-20", "2026-08-26", null)).toBe(false);
    expect(isYmdInInclusiveRange("2026-08-26", "2026-08-26", "2026-12-31")).toBe(true);
    expect(isYmdInInclusiveRange("2027-01-01", "2026-01-01", "2026-12-31")).toBe(false);
  });
});
