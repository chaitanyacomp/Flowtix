/**
 * Strict ERP date-only validation (calendar integrity).
 * Display for operators: DD-MM-YYYY. Wire/API value: YYYY-MM-DD.
 * Does not apply screen-specific business min/max — callers supply those.
 */

export const ERP_DATE_MIN_YMD = "1900-01-01";
export const ERP_DATE_MAX_YMD = "2100-12-31";
export const ERP_DATE_MIN_YEAR = 1900;
export const ERP_DATE_MAX_YEAR = 2100;

/** User-facing only — never mention ISO/YYYY-MM-DD. */
export const ERP_DATE_INVALID_MESSAGE = "Enter a valid date in DD-MM-YYYY format.";

const ISO_YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;

export type ErpDateParseOk = { ok: true; ymd: string };
export type ErpDateParseFail = { ok: false; message: string };
export type ErpDateParseResult = ErpDateParseOk | ErpDateParseFail;

/**
 * True only for a real calendar day with a four-digit year in [minYear, maxYear].
 * Rejects JS Date rollover (e.g. 2026-02-30 → Mar 2).
 */
export function isStrictCalendarYmd(
  ymd: string,
  opts?: { minYear?: number; maxYear?: number },
): boolean {
  const m = ISO_YMD.exec(String(ymd ?? "").trim());
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const minY = opts?.minYear ?? ERP_DATE_MIN_YEAR;
  const maxY = opts?.maxYear ?? ERP_DATE_MAX_YEAR;
  if (!Number.isInteger(y) || y < minY || y > maxY) return false;
  if (m[1].length !== 4) return false;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** YYYY-MM-DD → DD-MM-YYYY for operator copy (not for <input type="date"> value). */
export function formatErpDateDisplay(ymd: string | null | undefined): string {
  const m = ISO_YMD.exec(String(ymd ?? "").trim());
  if (!m) return String(ymd ?? "").trim();
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Parse UI/API date strings to strict YYYY-MM-DD.
 * Accepts ISO YMD or DD-MM-YYYY / DD/MM/YYYY.
 */
export function parseErpDateInput(
  raw: string | null | undefined,
  opts?: { minYear?: number; maxYear?: number; allowBlank?: boolean },
): ErpDateParseResult {
  const t = String(raw ?? "").trim();
  if (!t) {
    if (opts?.allowBlank) return { ok: true, ymd: "" };
    return { ok: false, message: ERP_DATE_INVALID_MESSAGE };
  }

  let ymd: string | null = null;
  if (ISO_YMD.test(t)) {
    ymd = t.slice(0, 10);
  } else {
    const m = DMY.exec(t);
    if (m) {
      const dd = Number(m[1]);
      const mm = Number(m[2]);
      const yyyy = Number(m[3]);
      ymd = `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }

  if (!ymd || !isStrictCalendarYmd(ymd, opts)) {
    return { ok: false, message: ERP_DATE_INVALID_MESSAGE };
  }
  return { ok: true, ymd };
}

/**
 * Clamp / sanitize native date-input draft strings so the year cannot exceed 4 digits.
 * Returns cleaned YYYY-MM-DD fragment or "" when unusable.
 */
export function sanitizeNativeDateInputValue(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  // Chromium can emit year>4 digits while typing; truncate year segment only.
  const parts = t.split("-");
  if (parts.length >= 1 && parts[0].length > 4) {
    parts[0] = parts[0].slice(0, 4);
  }
  // Drop anything beyond YYYY-MM-DD shape
  const joined = parts.slice(0, 3).join("-");
  if (joined.length > 10) return joined.slice(0, 10);
  return joined;
}

/** Compare ISO YMD strings (lexicographic works for zero-padded YMD). */
export function isYmdInInclusiveRange(
  ymd: string,
  minYmd?: string | null,
  maxYmd?: string | null,
): boolean {
  if (!isStrictCalendarYmd(ymd)) return false;
  if (minYmd && isStrictCalendarYmd(minYmd) && ymd < minYmd) return false;
  if (maxYmd && isStrictCalendarYmd(maxYmd) && ymd > maxYmd) return false;
  return true;
}
