import { ApiRequestError } from "../services/api";

export type OperationalErrorPresentation = {
  userMessage: string;
  technicalDetail: string | null;
  isPlanningSetupIncomplete: boolean;
  canRetryInitializePlanning: boolean;
};

const PLANNING_SETUP_MESSAGE =
  "Production planning setup is incomplete.\n\nPlease contact system administrator or apply latest database update.";

export const PLANNING_INIT_FAILED_MESSAGE =
  "Unable to initialize production planning.\n\nPlease apply latest database update or contact system administrator.";

const GENERIC_OPERATIONAL_MESSAGE = "This operation could not be completed. Please try again or contact your administrator.";

const TECHNICAL_PATTERNS =
  /prisma|invocation|p20\d{2}|migration|database table|schema is out of date|regularsoplanningsnapshot|foreign key|constraint failed|sqlstate|column .+ (does not exist|cannot be null)/i;

function isTechnicalLeak(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return TECHNICAL_PATTERNS.test(t);
}

function isPlanningSetupError(raw: string, code?: string): boolean {
  if (code === "MISSING_TABLE" || code === "SCHEMA_MISMATCH" || code === "RAW_QUERY_FAILED") {
    return true;
  }
  const lower = raw.toLowerCase();
  return (
    lower.includes("regularsoplanningsnapshot") ||
    lower.includes("production-planning-snapshot") ||
    lower.includes("planning snapshot") ||
    (lower.includes("required database table") && lower.includes("missing"))
  );
}

/** Maps known backend process-stage labels to operational title case. */
export function formatProcessStageDisplayLabel(label: string): string {
  const t = label.trim();
  if (!t || t === "—") return t;
  const known: Record<string, string> = {
    "wo pending": "WO Pending",
    "dispatch pending": "Dispatch Pending",
    "production pending": "Production Pending",
    "qa in progress": "QA In Progress",
    "sales bill pending": "Sales Bill Pending",
    "draft": "Draft",
  };
  const mapped = known[t.toLowerCase()];
  if (mapped) return mapped;
  if (t === t.toLowerCase() && t.includes(" ")) {
    return t.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return t;
}

export function presentOperationalError(error: unknown): OperationalErrorPresentation {
  const raw =
    error instanceof ApiRequestError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error ?? "");
  const code = error instanceof ApiRequestError ? error.code : undefined;

  const planning = isPlanningSetupError(raw, code);
  if (planning) {
    return {
      userMessage: PLANNING_SETUP_MESSAGE,
      technicalDetail: raw.trim() || null,
      isPlanningSetupIncomplete: true,
      canRetryInitializePlanning: true,
    };
  }

  if (isTechnicalLeak(raw)) {
    return {
      userMessage: GENERIC_OPERATIONAL_MESSAGE,
      technicalDetail: raw.trim() || null,
      isPlanningSetupIncomplete: false,
      canRetryInitializePlanning: false,
    };
  }

  return {
    userMessage: raw.trim() || GENERIC_OPERATIONAL_MESSAGE,
    technicalDetail: null,
    isPlanningSetupIncomplete: false,
    canRetryInitializePlanning: false,
  };
}

/** After an explicit Initialize Planning attempt fails. */
export function presentPlanningInitFailure(error: unknown): OperationalErrorPresentation {
  const raw =
    error instanceof ApiRequestError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error ?? "");
  const code = error instanceof ApiRequestError ? error.code : undefined;
  const technical = raw.trim() || null;
  const stillPlanningSetup = isPlanningSetupError(raw, code);

  return {
    userMessage: PLANNING_INIT_FAILED_MESSAGE,
    technicalDetail: technical,
    isPlanningSetupIncomplete: stillPlanningSetup,
    canRetryInitializePlanning: stillPlanningSetup,
  };
}

/** Sanitize before showing any API error string in operational UI. */
export function sanitizeOperationalMessage(raw: string, code?: string): string {
  return presentOperationalError(
    code ? new ApiRequestError(raw, 500, code) : new Error(raw),
  ).userMessage;
}
