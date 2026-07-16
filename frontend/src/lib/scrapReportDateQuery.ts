/**
 * Scrap report From/To query helpers — omit blanks; reject invalid / inverted ranges.
 * UI displays dates as DD-MM-YYYY (browser locale on native date inputs).
 * API still receives ISO YYYY-MM-DD. User-facing errors never mention API/ISO format.
 */

const ISO_YMD = /^\d{4}-\d{2}-\d{2}$/;
const DMY = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/;

const INVALID_MSG = (label: "From" | "To") =>
  `Invalid ${label} date. Please enter date in DD-MM-YYYY format.`;

export type ScrapDateParse =
  | { kind: "omit" }
  | { kind: "ok"; value: string }
  | { kind: "invalid"; message: string };

/** Normalize UI/ISO date strings to YYYY-MM-DD for the API; never surface ISO in errors. */
export function parseScrapReportDateParam(raw: string | null | undefined, label: "From" | "To"): ScrapDateParse {
  const t = String(raw ?? "").trim();
  if (!t) return { kind: "omit" };

  // Native <input type="date"> value is always ISO; accept without exposing that format to users.
  if (ISO_YMD.test(t)) {
    const d = new Date(`${t}T00:00:00`);
    if (Number.isNaN(d.getTime())) return { kind: "invalid", message: INVALID_MSG(label) };
    return { kind: "ok", value: t };
  }

  const m = DMY.exec(t);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
      return { kind: "invalid", message: INVALID_MSG(label) };
    }
    const iso = `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== yyyy || d.getMonth() + 1 !== mm || d.getDate() !== dd) {
      return { kind: "invalid", message: INVALID_MSG(label) };
    }
    return { kind: "ok", value: iso };
  }

  return { kind: "invalid", message: INVALID_MSG(label) };
}

export type ScrapDateQueryBuild =
  | { ok: true; from?: string; to?: string; clientError?: undefined }
  | { ok: false; clientError: string; from?: undefined; to?: undefined };

/** Build optional from/to query values; blank omitted; invalid or From>To → clientError. */
export function buildScrapReportDateQuery(fromRaw: string, toRaw: string): ScrapDateQueryBuild {
  const fromP = parseScrapReportDateParam(fromRaw, "From");
  const toP = parseScrapReportDateParam(toRaw, "To");
  if (fromP.kind === "invalid") return { ok: false, clientError: fromP.message };
  if (toP.kind === "invalid") return { ok: false, clientError: toP.message };
  const from = fromP.kind === "ok" ? fromP.value : undefined;
  const to = toP.kind === "ok" ? toP.value : undefined;
  if (from && to && from > to) {
    return { ok: false, clientError: "From date must be on or before To date." };
  }
  return { ok: true, from, to };
}
