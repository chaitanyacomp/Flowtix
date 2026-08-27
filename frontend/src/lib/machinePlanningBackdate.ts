/**
 * REGULAR Machine Run Planning — controlled backdate UX helpers.
 * Server enforces authorization, SO floor, reason, and audit (frontend is not authoritative).
 */

import { MACHINE_PLANNING_BACKDATE_ROLES, hasErpRole } from "../config/erpRoles";
import { ApiRequestError } from "../services/api";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar YYYY-MM-DD (browser) — UX only; backend uses configured business TZ. */
export function localTodayYmd(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function normalizePlanningYmd(value: string | null | undefined): string | null {
  if (value == null || String(value).trim() === "") return null;
  const s = String(value).trim().slice(0, 10);
  return YMD_RE.test(s) ? s : null;
}

/** Display YYYY-MM-DD as DD-MM-YYYY for operator-facing copy. */
export function formatPlanningYmdDisplay(ymd: string | null | undefined): string {
  const n = normalizePlanningYmd(ymd);
  if (!n) return String(ymd ?? "").trim();
  const [y, m, d] = n.split("-");
  return `${d}-${m}-${y}`;
}

export function formatStartDateBeforeSoMessage(soCreatedYmd: string | null | undefined): string {
  const display = formatPlanningYmdDisplay(soCreatedYmd);
  if (display) {
    return `Start Date cannot be earlier than the Sales Order date (${display}).`;
  }
  return "Start Date cannot be earlier than the Sales Order date.";
}

export function isPastMachinePlanningStartDate(
  plannedDate: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const ymd = normalizePlanningYmd(plannedDate);
  if (!ymd) return false;
  return ymd < localTodayYmd(now);
}

export function canBackdateMachinePlanning(role: string | null | undefined): boolean {
  return hasErpRole(role ?? undefined, MACHINE_PLANNING_BACKDATE_ROLES);
}

/** PRODUCTION / STORE (and others without backdate privilege) cannot pick past dates. */
export function machinePlanningDateInputMin(
  role: string | null | undefined,
  soCreatedYmd?: string | null,
): string | undefined {
  if (canBackdateMachinePlanning(role)) {
    return soCreatedYmd && YMD_RE.test(soCreatedYmd) ? soCreatedYmd : undefined;
  }
  return localTodayYmd();
}

export function runsHavePastStartDate(
  runs: Array<{ plannedDate?: string | null }>,
  now: Date = new Date(),
): boolean {
  return (runs ?? []).some((r) => isPastMachinePlanningStartDate(r.plannedDate, now));
}

/** True when every run Start Date is on/after SO creation day (or empty). */
export function runsSatisfySoStartDateFloor(
  runs: Array<{ plannedDate?: string | null }>,
  soCreatedYmd: string | null | undefined,
): boolean {
  const floor = normalizePlanningYmd(soCreatedYmd);
  if (!floor) return true;
  for (const r of runs ?? []) {
    const ymd = normalizePlanningYmd(r.plannedDate);
    if (ymd && ymd < floor) return false;
  }
  return true;
}

/**
 * Machine planning save field-validation codes — keep form open; no page Retry panel / toast.
 * (Server remains authoritative; this is presentation routing only.)
 */
export const MACHINE_PLANNING_FIELD_VALIDATION_CODES = Object.freeze([
  "MACHINE_PLANNING_DATE_BEFORE_SO",
  "MACHINE_PLANNING_BACKDATE_FORBIDDEN",
  "MACHINE_PLANNING_BACKDATE_REASON_REQUIRED",
  "PRODUCTION_RUN_QTY_MISMATCH",
  "PRODUCTION_RUNS_REQUIRED",
  "PRODUCTION_RUN_FG_MISMATCH",
  "DUPLICATE_RUN_SEQUENCE",
  "TOO_MANY_PRODUCTION_RUNS",
  "INVALID_PRODUCTION_RUN",
  "INVALID_PRODUCTION_RUNS",
  "MACHINE_NOT_FOUND",
  "MACHINE_INACTIVE",
  "SHIFT_NOT_FOUND",
  "SHIFT_INACTIVE",
  "FG_MACHINE_STANDARD_MISSING",
  "MACHINE_PLANNING_INCOMPLETE",
] as const);

export type MachinePlanningSaveErrorKind = "start_date" | "field" | "server";

export type MachinePlanningSaveErrorPresentation = {
  kind: MachinePlanningSaveErrorKind;
  /** Inline Start Date message (DD-MM-YYYY floor when applicable). */
  startDateMessage?: string;
  /** Other field-level inline message (allocation panel). */
  fieldMessage?: string;
};

export function classifyMachinePlanningSaveError(
  error: unknown,
  opts?: { soCreatedYmd?: string | null },
): MachinePlanningSaveErrorPresentation {
  const code = error instanceof ApiRequestError ? String(error.code ?? "").trim() : "";
  const raw =
    error instanceof ApiRequestError || error instanceof Error
      ? String(error.message ?? "").trim()
      : String(error ?? "").trim();

  const isBeforeSo =
    code === "MACHINE_PLANNING_DATE_BEFORE_SO" ||
    /Start Date cannot be earlier than the Sales Order date/i.test(raw);

  if (isBeforeSo) {
    return {
      kind: "start_date",
      startDateMessage: formatStartDateBeforeSoMessage(opts?.soCreatedYmd),
    };
  }

  const knownField =
    Boolean(code) &&
    (MACHINE_PLANNING_FIELD_VALIDATION_CODES as readonly string[]).includes(code);
  const looksLikeClientValidation =
    knownField ||
    (error instanceof ApiRequestError &&
      (error.status === 400 || error.status === 403) &&
      !/prisma|database|schema|migration|ECONN|network|Cannot reach the API/i.test(raw));

  if (looksLikeClientValidation) {
    return {
      kind: "field",
      fieldMessage: raw || "Please correct the machine planning fields and try again.",
    };
  }

  return { kind: "server" };
}

export const MACHINE_PLANNING_PAST_DATE_WARNING = "You are recording a past machine plan";
