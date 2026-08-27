/**
 * Scrap report From/To query helpers — omit blanks; reject invalid / inverted ranges.
 * UI displays dates as DD-MM-YYYY. API receives ISO YYYY-MM-DD.
 * User-facing errors never mention API/ISO format.
 */

import { ERP_DATE_INVALID_MESSAGE, parseErpDateInput } from "./erpDate";

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

  const parsed = parseErpDateInput(t, { allowBlank: false });
  if (!parsed.ok) {
    // Prefer labelled message for report filters; fall back to global wording.
    return { kind: "invalid", message: INVALID_MSG(label) || ERP_DATE_INVALID_MESSAGE };
  }
  return { kind: "ok", value: parsed.ymd };
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
