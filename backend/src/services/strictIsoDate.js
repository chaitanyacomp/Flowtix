/**
 * Strict ISO date-only parsing for ERP write paths (YYYY-MM-DD).
 * Rejects non-four-digit years, impossible calendar days, and years outside 1900–2100.
 * Does not reinterpret DateTime/timestamp fields — callers use this for @db.Date / date-only only.
 */

const ERP_DATE_MIN_YEAR = 1900;
const ERP_DATE_MAX_YEAR = 2100;
const ISO_YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Operator-facing; never mentions ISO / YYYY-MM-DD. */
const INVALID_MESSAGE = "Enter a valid date in DD-MM-YYYY format.";

function httpError(message, statusCode = 400, code = "INVALID_DATE") {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

/**
 * @param {unknown} raw
 * @param {{ minYear?: number, maxYear?: number, required?: boolean, fieldLabel?: string }} [opts]
 * @returns {{ ok: true, ymd: string|null, utcDate: Date|null } | { ok: false, code: string, message: string }}
 */
function parseStrictIsoDateOnly(raw, opts = {}) {
  const required = opts.required === true;
  if (raw == null || String(raw).trim() === "") {
    if (required) {
      return { ok: false, code: "INVALID_DATE", message: INVALID_MESSAGE };
    }
    return { ok: true, ymd: null, utcDate: null };
  }

  // Accept Date instances that already represent a calendar day.
  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    const y = raw.getUTCFullYear();
    const mo = raw.getUTCMonth() + 1;
    const d = raw.getUTCDate();
    const ymd = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return parseStrictIsoDateOnly(ymd, opts);
  }

  const s = String(raw).trim();
  // Reject years with more than 4 digits even if regex would otherwise fail later.
  if (/^\d{5,}/.test(s) || /^\d{5,}-\d{2}-\d{2}/.test(s)) {
    return { ok: false, code: "INVALID_DATE", message: INVALID_MESSAGE };
  }

  // Allow trailing time (T…) only if the date prefix is strict YMD — strip to date-only.
  const datePart = s.length >= 10 && s[4] === "-" && s[7] === "-" ? s.slice(0, 10) : s;

  const m = ISO_YMD.exec(datePart);
  if (!m) {
    return { ok: false, code: "INVALID_DATE", message: INVALID_MESSAGE };
  }

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const minY = opts.minYear ?? ERP_DATE_MIN_YEAR;
  const maxY = opts.maxYear ?? ERP_DATE_MAX_YEAR;

  if (!Number.isInteger(y) || y < minY || y > maxY) {
    return { ok: false, code: "INVALID_DATE", message: INVALID_MESSAGE };
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) {
    return { ok: false, code: "INVALID_DATE", message: INVALID_MESSAGE };
  }

  const utcDate = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  if (
    utcDate.getUTCFullYear() !== y ||
    utcDate.getUTCMonth() !== mo - 1 ||
    utcDate.getUTCDate() !== d
  ) {
    return { ok: false, code: "INVALID_DATE", message: INVALID_MESSAGE };
  }

  return { ok: true, ymd: `${m[1]}-${m[2]}-${m[3]}`, utcDate };
}

/**
 * @param {unknown} raw
 * @param {{ minYear?: number, maxYear?: number, required?: boolean }} [opts]
 * @returns {{ ymd: string|null, utcDate: Date|null }}
 */
function assertStrictIsoDateOnly(raw, opts = {}) {
  const parsed = parseStrictIsoDateOnly(raw, opts);
  if (!parsed.ok) {
    throw httpError(parsed.message, 400, parsed.code);
  }
  return { ymd: parsed.ymd, utcDate: parsed.utcDate };
}

/**
 * Soft parse for optional query filters: blank → null; invalid → null (caller may 400).
 * @param {unknown} raw
 * @param {"start"|"end"} [bound]
 * @returns {Date|null}
 */
function parseStrictIsoDateBoundUtc(raw, bound = "start") {
  const parsed = parseStrictIsoDateOnly(raw, { required: false });
  if (!parsed.ok || !parsed.ymd) return null;
  const [y, mo, d] = parsed.ymd.split("-").map(Number);
  if (bound === "end") {
    return new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999));
  }
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
}

/**
 * Zod refine: string must be strict calendar YMD when present.
 * @param {typeof import("zod").z} z
 * @param {{ required?: boolean }} [opts]
 */
function zodStrictIsoDateString(z, opts = {}) {
  const base = opts.required ? z.string().min(1) : z.string().optional().nullable();
  return base.superRefine((val, ctx) => {
    if (val == null || val === "") {
      if (opts.required) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: INVALID_MESSAGE });
      }
      return;
    }
    const parsed = parseStrictIsoDateOnly(val, { required: Boolean(opts.required) });
    if (!parsed.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.message });
    }
  });
}

module.exports = {
  ERP_DATE_MIN_YEAR,
  ERP_DATE_MAX_YEAR,
  INVALID_MESSAGE,
  parseStrictIsoDateOnly,
  assertStrictIsoDateOnly,
  parseStrictIsoDateBoundUtc,
  zodStrictIsoDateString,
  httpError,
};
