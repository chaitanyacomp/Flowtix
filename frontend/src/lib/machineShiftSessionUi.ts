/**
 * Pure UI helpers for Shift Production (Step 4A) — status, dates, errors.
 */
import { ApiRequestError } from "../services/api";
import type { ShiftDowntimeIncident, ShiftRunSegment, ShiftSessionDetail } from "./machineShiftSessionApi";

export type MachineShiftUiStatus = "NO_ACTIVE" | "SHIFT_ACTIVE" | "PRODUCTION_RUNNING" | "DOWNTIME";

const ERROR_MESSAGES: Record<string, string> = {
  PRODUCTION_MANAGER_ACTION_REQUIRED: "A Production Manager must perform this action.",
  SHIFT_SESSION_ALREADY_OPEN: "This machine already has an active shift. Open that shift instead.",
  ACTIVE_RUN_SEGMENT_EXISTS: "A production run is already active on this machine. Close it first.",
  PRIMARY_OPERATOR_CANNOT_LEAVE: "Assign another primary operator before this person leaves the shift.",
  DOWNTIME_ALREADY_OPEN: "Production is already paused. Resume or continue the open downtime first.",
  NO_ACTIVE_RUN_TO_PAUSE: "Start a production run before pausing for downtime.",
  NO_OPEN_DOWNTIME: "There is no open downtime to resume.",
  SHIFT_SESSION_NOT_OPEN: "This shift is no longer open.",
  MACHINE_NOT_FOUND: "Machine was not found.",
  OPERATOR_NOT_FOUND: "Operator was not found.",
  OPERATOR_ACTIVE_ON_ANOTHER_MACHINE:
    "This operator is already active on another machine. They must leave that shift before joining here.",
  SHIFT_NOT_FOUND: "Shift template was not found.",
  WORK_ORDER_NOT_USABLE: "That work order cannot be started on this shift.",
  RUN_ALLOCATION_MACHINE_MISMATCH: "That planned run belongs to a different machine.",
  VALIDATION: "Please check the form and try again.",
  SHIFT_ACTION_FORBIDDEN: "You are not allowed to perform this action.",
  SHIFT_REPORT_HAS_UNAPPROVED_ENTRIES:
    "Approve or remove the pending production entries before submitting the Shift Report.",
  SHIFT_REPORT_PRODUCTION_LOCKED:
    "Shift Report has already been submitted. Production quantities cannot change unless the report is returned or the shift is reopened.",
  REPORT_LINE_QTY_IMBALANCE: "Each line's gross output must equal scrap plus quantity sent to QC.",
  REPORT_LINE_QTY_IDENTITY: "Each line's gross output must equal scrap plus quantity sent to QC.",
  DECLARED_OPERATOR_NOT_ON_SESSION: "The declared operator must be a participant on this shift.",
  REPORT_RETURNED_CANNOT_VERIFY: "A returned Shift Report must be corrected and submitted again before verification.",
  SHIFT_OVER_REQUIRES_VERIFIED_REPORT: "Complete and verify the Shift Report before Shift Over.",
  HANDOVER_REMARKS_REQUIRED: "Add a short note when machine status is Unknown.",
  REOPEN_BLOCKED_NEXT_SESSION: "This shift cannot be reopened because the next shift has already started.",
  SHIFT_SESSION_CANNOT_CANCEL:
    "This shift cannot be cancelled because production, downtime, or a Shift Report has already started.",
  SHIFT_SESSION_ALREADY_CANCELLED: "This shift session was cancelled. Start a new shift if needed.",
  ZERO_PRODUCTION_REASON_REQUIRED: "Select a reason when recording zero production for this shift.",
  ZERO_PRODUCTION_REMARKS_REQUIRED: "Add remarks when the zero-production reason is Other.",
  ZERO_PRODUCTION_NOT_ELIGIBLE:
    "Zero production cannot be recorded when this shift already has approved production, scrap, or pending entries.",
  ADJUSTMENT_NOT_AVAILABLE_FOR_ZERO_REPORT:
    "Historical adjustment is not available for a zero-production Shift Report.",
  REPORT_AWAITING_MANAGER: "This Shift Report is submitted and waiting for manager review.",
  REPORT_ALREADY_VERIFIED: "This Shift Report is already verified.",
  REPORT_LINES_REQUIRED: "Add at least one Shift Report line before saving.",
  ADJUSTMENT_REQUIRES_VERIFIED: "Historical adjustment is allowed only for a verified Shift Report.",
  ADJUSTMENT_REQUIRES_SHIFT_OVER: "Historical adjustment is allowed only after Shift Over.",
  ADJUSTMENT_ALREADY_OPEN: "An unresolved adjustment already exists for this verified report.",
  ADJUSTMENT_ALREADY_DENIED: "This adjustment request was already denied.",
  ADJUSTMENT_ALREADY_APPROVED: "This adjustment request was already approved.",
  ADJUSTMENT_ALREADY_APPLIED: "This adjustment request was already applied.",
  ADJUSTMENT_NOT_REQUESTED: "Only a pending adjustment request can be decided.",
  ADJUSTMENT_NOT_APPROVED: "Only an approved adjustment can be applied.",
  ADJUSTMENT_TARGET_INVALID: "The target report is no longer a verified version.",
  ADJUSTMENT_NOT_FOUND: "Historical adjustment request was not found.",
  DECISION_NOTE_REQUIRED: "Add a decision note when denying an adjustment.",
  REPORT_HEADER_TOTAL_MISMATCH: "Report totals must equal the sum of all line quantities.",
  RUN_SEGMENT_NOT_ON_SESSION: "A report line references a run that does not belong to this shift.",
  REPORT_LINE_DUPLICATE: "The same run and product appear more than once on this proposal.",
};

/** India-local calendar date YYYY-MM-DD for session start date. */
export function indiaLocalDateYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function formatIndiaDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(dt);
}

export function formatIndiaTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(dt);
}

export function formatElapsed(fromIso: string | null | undefined, nowMs = Date.now()): string {
  if (!fromIso) return "—";
  const start = new Date(fromIso).getTime();
  if (!Number.isFinite(start)) return "—";
  const sec = Math.max(0, Math.floor((nowMs - start) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function operatorDisplayName(op: { operatorName?: string | null; operatorCode?: string | null } | null | undefined): string {
  if (!op) return "—";
  const name = String(op.operatorName ?? "").trim();
  const code = String(op.operatorCode ?? "").trim();
  if (name && code) return `${name} (${code})`;
  return name || code || "—";
}

export function machineDisplayName(m: { machineName?: string | null; machineCode?: string | null } | null | undefined): string {
  if (!m) return "—";
  const name = String(m.machineName ?? "").trim();
  const code = String(m.machineCode ?? "").trim();
  if (name && code) return `${name} · ${code}`;
  return name || code || "—";
}

export function shiftDisplayLabel(s: { shiftName?: string | null; shiftCode?: string | null; startTime?: string; endTime?: string } | null | undefined): string {
  if (!s) return "—";
  const name = String(s.shiftName ?? s.shiftCode ?? "").trim() || "Shift";
  if (s.startTime && s.endTime) return `${name} (${s.startTime}–${s.endTime})`;
  return name;
}

export function downtimeReasonLabel(reason: string | null | undefined): string {
  const key = String(reason ?? "").toUpperCase();
  const map: Record<string, string> = {
    MACHINE_BREAKDOWN: "Machine breakdown",
    WAITING_FOR_RM: "Waiting for RM",
    TOOL_MOULD_MAINTENANCE: "Tool / mould maintenance",
    QUALITY_CONCERN: "Quality concern",
    EMERGENCY_PRIORITY_PRODUCTION: "Emergency / priority production",
    POWER_UTILITY_FAILURE: "Power / utility failure",
    MANAGEMENT_HOLD: "Management hold",
    OTHER: "Other",
  };
  return map[key] ?? (key ? key.replace(/_/g, " ").toLowerCase() : "—");
}

export function findActiveRun(session: ShiftSessionDetail | null | undefined): ShiftRunSegment | null {
  if (!session?.runSegments?.length) return null;
  return session.runSegments.find((r) => String(r.status).toUpperCase() === "ACTIVE") ?? null;
}

export function findOpenDowntimeIncident(session: ShiftSessionDetail | null | undefined): ShiftDowntimeIncident | null {
  if (!session?.downtimeIncidents?.length) return null;
  return (
    session.downtimeIncidents.find((inc) => {
      if (inc.endedAt) return false;
      return (inc.segments || []).some((s) => !s.segmentEndAt);
    }) ?? null
  );
}

export function deriveMachineShiftUiStatus(session: ShiftSessionDetail | null | undefined): MachineShiftUiStatus {
  if (!session || String(session.status).toUpperCase() !== "OPEN") return "NO_ACTIVE";
  if (findOpenDowntimeIncident(session)) return "DOWNTIME";
  if (findActiveRun(session)) return "PRODUCTION_RUNNING";
  return "SHIFT_ACTIVE";
}

export function machineShiftStatusLabel(status: MachineShiftUiStatus): string {
  switch (status) {
    case "NO_ACTIVE":
      return "No Active Shift";
    case "SHIFT_ACTIVE":
      return "Shift Active";
    case "PRODUCTION_RUNNING":
      return "Production Running";
    case "DOWNTIME":
      return "Downtime";
    default:
      return "Unknown";
  }
}

export function machineShiftStatusTone(status: MachineShiftUiStatus): "neutral" | "success" | "warning" | "danger" {
  switch (status) {
    case "PRODUCTION_RUNNING":
      return "success";
    case "SHIFT_ACTIVE":
      return "success";
    case "DOWNTIME":
      return "danger";
    default:
      return "neutral";
  }
}

export function mapShiftApiError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ApiRequestError) {
    if (err.code === "OPERATOR_ACTIVE_ON_ANOTHER_MACHINE" && err.message) return err.message;
    if (err.code && ERROR_MESSAGES[err.code]) return ERROR_MESSAGES[err.code];
    if (err.message) return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Operator ids that are active on another open session (exclude current session when joining). */
export function busyOperatorIdSet(
  busy: { operatorId: number; sessionId?: number | null }[] | null | undefined,
  excludeSessionId?: number | null,
): Set<number> {
  const out = new Set<number>();
  for (const row of busy || []) {
    if (excludeSessionId != null && row.sessionId === excludeSessionId) continue;
    if (Number.isFinite(row.operatorId) && row.operatorId > 0) out.add(row.operatorId);
  }
  return out;
}

/** Validate start-shift operator selection: ≥1 operator, exactly one primary. */
export function validateStartOperators(
  operators: { operatorId: number; isPrimary: boolean }[],
): string | null {
  if (!operators.length) return "Select at least one operator.";
  const ids = new Set(operators.map((o) => o.operatorId));
  if (ids.size !== operators.length) return "Each operator can be selected only once.";
  const primaries = operators.filter((o) => o.isPrimary);
  if (primaries.length !== 1) return "Mark exactly one primary operator.";
  return null;
}

export function canShowManagerControls(caps: {
  canPerformManagerActions?: boolean;
} | null | undefined): boolean {
  return Boolean(caps?.canPerformManagerActions);
}

/** Compact Shift Report lifecycle stage for the session workspace. */
export type ShiftLifecycleStage =
  | "SHIFT_ACTIVE"
  | "REPORT_DRAFT"
  | "SUBMITTED"
  | "RETURNED"
  | "VERIFIED"
  | "SHIFT_OVER"
  | "CANCELLED";

export function deriveShiftLifecycleStage(session: ShiftSessionDetail | null | undefined): ShiftLifecycleStage {
  if (!session) return "SHIFT_ACTIVE";
  const sessionStatus = String(session.status).toUpperCase();
  if (sessionStatus === "CANCELLED") return "CANCELLED";
  if (sessionStatus === "SHIFT_OVER") return "SHIFT_OVER";
  const status = String(session.report?.latestVersion?.status ?? "").toUpperCase();
  if (status === "SUBMITTED") return "SUBMITTED";
  if (status === "RETURNED") return "RETURNED";
  if (status === "VERIFIED") return "VERIFIED";
  if (status === "DRAFT") return "REPORT_DRAFT";
  return "SHIFT_ACTIVE";
}

export function shiftLifecycleStageLabel(stage: ShiftLifecycleStage): string {
  switch (stage) {
    case "SHIFT_ACTIVE":
      return "Shift Active";
    case "REPORT_DRAFT":
      return "Report Draft";
    case "SUBMITTED":
      return "Submitted";
    case "RETURNED":
      return "Returned";
    case "VERIFIED":
      return "Verified";
    case "SHIFT_OVER":
      return "Shift Over";
    case "CANCELLED":
      return "Cancelled";
    default:
      return "Shift Active";
  }
}

export function shiftLifecycleNextAction(
  stage: ShiftLifecycleStage,
  opts?: { canManage?: boolean },
): { label: string; action: "report" | "review" | "shift-over" | "summary" | "reopen" | "none" } {
  switch (stage) {
    case "SHIFT_ACTIVE":
    case "REPORT_DRAFT":
    case "RETURNED":
      return {
        label: stage === "SHIFT_ACTIVE" ? "Prepare Shift Report" : "Complete Shift Report",
        action: "report",
      };
    case "SUBMITTED":
      return {
        label: opts?.canManage ? "Review Report" : "Awaiting Manager Verification",
        action: "review",
      };
    case "VERIFIED":
      return opts?.canManage
        ? { label: "Complete Shift Over", action: "shift-over" }
        : { label: "View Shift Report", action: "report" };
    case "SHIFT_OVER":
      return { label: "View Summary / Request Reopen", action: "summary" };
    case "CANCELLED":
      return { label: "Session cancelled", action: "none" };
    default:
      return { label: "Prepare Shift Report", action: "report" };
  }
}

/** True when backend marks the OPEN session as eligible for mistaken-start cancel. */
export function canCancelShiftSession(
  session: ShiftSessionDetail | null | undefined,
  caps: { canPerformManagerActions?: boolean } | null | undefined,
): boolean {
  if (!canShowManagerControls(caps)) return false;
  if (!session || String(session.status).toUpperCase() !== "OPEN") return false;
  return Boolean(session.canCancel);
}

export const SHIFT_QTY_LOCK_MSG_SUBMITTED =
  "Shift Report submitted — production quantities are locked pending manager review.";
export const SHIFT_QTY_LOCK_MSG_VERIFIED_OPEN =
  "Shift Report verified — production quantities remain locked. Complete Shift Over.";
export const SHIFT_QTY_LOCK_MSG_VERIFIED_SHIFT_OVER =
  "Shift Report verified and Shift Over completed.";

/**
 * State-aware production-qty lock banner for Shift Report / Current Production Run.
 * Prefers report + session status over the stale single backend lock reason string.
 */
export function shiftProductionQtyLockDisplayMessage(
  session: Pick<ShiftSessionDetail, "status" | "productionQtyLocked" | "report"> | null | undefined,
): string | null {
  if (!session?.productionQtyLocked) return null;
  const reportStatus = String(session.report?.latestVersion?.status ?? "").toUpperCase();
  const sessionStatus = String(session.status ?? "").toUpperCase();

  if (reportStatus === "VERIFIED" && sessionStatus === "SHIFT_OVER") {
    return SHIFT_QTY_LOCK_MSG_VERIFIED_SHIFT_OVER;
  }
  if (reportStatus === "VERIFIED") {
    return SHIFT_QTY_LOCK_MSG_VERIFIED_OPEN;
  }
  return SHIFT_QTY_LOCK_MSG_SUBMITTED;
}

export const ZERO_PRODUCTION_REASON_OPTIONS: { value: string; label: string }[] = [
  { value: "NO_WORK_ORDER", label: "No work order available" },
  { value: "MACHINE_BREAKDOWN", label: "Machine breakdown" },
  { value: "MATERIAL_UNAVAILABLE", label: "Material unavailable" },
  { value: "POWER_FAILURE", label: "Power failure" },
  { value: "PLANNED_MAINTENANCE", label: "Planned maintenance" },
  { value: "OTHER", label: "Other" },
];

export function zeroProductionReasonLabel(reason: string | null | undefined): string {
  const key = String(reason ?? "").toUpperCase();
  return ZERO_PRODUCTION_REASON_OPTIONS.find((o) => o.value === key)?.label ?? (key ? key.replace(/_/g, " ") : "—");
}

export function reportVersionStatusLabel(status: string | null | undefined): string {
  const s = String(status ?? "").toUpperCase();
  if (s === "DRAFT") return "Draft";
  if (s === "SUBMITTED") return "Submitted";
  if (s === "RETURNED") return "Returned";
  if (s === "VERIFIED") return "Verified";
  return s || "—";
}

export type HandoverStatusUi = "RETAINED" | "CLEARED" | "UNKNOWN";

export const HANDOVER_OPTIONS: {
  value: HandoverStatusUi;
  label: string;
  hint: string;
}[] = [
  {
    value: "RETAINED",
    label: "Material Retained",
    hint: "RM or WIP stays on the machine for the next shift.",
  },
  {
    value: "CLEARED",
    label: "Machine Cleared",
    hint: "Machine was cleared; next shift starts without retained material.",
  },
  {
    value: "UNKNOWN",
    label: "Status Unknown",
    hint: "Handover status is unclear — a short remark is required.",
  },
];

export function handoverStateLabel(state: string | null | undefined): string {
  const s = String(state ?? "").toUpperCase();
  if (s === "RETAINED") return "Material Retained";
  if (s === "CLEARED") return "Machine Cleared";
  if (s === "UNKNOWN") return "Status Unknown";
  return s || "—";
}

export function formatShiftQty(n: number | null | undefined): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0";
  const rounded = Math.round(x * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

export function mergeShiftReportEditableLines(
  session: ShiftSessionDetail | null | undefined,
): {
  lines: import("./machineShiftSessionApi").ShiftReportLine[];
  source: "draft" | "live" | "snapshot";
  editable: boolean;
} {
  const latest = session?.report?.latestVersion ?? null;
  const status = String(latest?.status ?? "").toUpperCase();
  if (latest && (status === "DRAFT" || status === "RETURNED")) {
    // RETURNED is read-only display until save creates new DRAFT; still seed scrap from returned.
    const live = session?.qtyLines ?? [];
    const byKey = new Map(live.map((l) => [`${l.runSegmentId}:${l.itemId}`, l]));
    const lines: import("./machineShiftSessionApi").ShiftReportLine[] = (latest.lines || []).map((l) => {
      const liveRow = byKey.get(`${l.runSegmentId}:${l.itemId}`);
      // Qty Sent to QC / gross refresh from live APPROVED PEs when editing DRAFT or RETURNED.
      const qtySentToQc = Number(liveRow?.qtySentToQc ?? l.qtySentToQc ?? 0);
      const scrap = Number(l.productionScrapQty ?? 0);
      return {
        ...l,
        itemName: l.itemName ?? liveRow?.itemName ?? null,
        itemLabel: l.itemLabel ?? liveRow?.itemLabel ?? null,
        workOrderNo: l.workOrderNo ?? liveRow?.workOrderNo ?? null,
        runSegmentLabel: l.runSegmentLabel ?? liveRow?.runSegmentLabel ?? null,
        runSegmentNo: l.runSegmentNo ?? liveRow?.runSegmentNo ?? null,
        qtySentToQc,
        productionScrapQty: scrap,
        grossOutputQty: Math.round((qtySentToQc + scrap) * 1000) / 1000,
        pendingDraftCount: liveRow?.pendingDraftCount ?? l.pendingDraftCount ?? 0,
        pendingDraftQty: liveRow?.pendingDraftQty ?? l.pendingDraftQty ?? 0,
      };
    });
    // Include live APPROVED lines missing from returned/draft (new PE after return).
    if (status === "DRAFT" || status === "RETURNED") {
      for (const liveRow of live) {
        const key = `${liveRow.runSegmentId}:${liveRow.itemId}`;
        if (!lines.some((l) => `${l.runSegmentId}:${l.itemId}` === key)) {
          lines.push({ ...liveRow });
        }
      }
    }
    return { lines, source: status === "DRAFT" ? "draft" : "snapshot", editable: status === "DRAFT" || status === "RETURNED" };
  }
  if (latest && (status === "SUBMITTED" || status === "VERIFIED")) {
    return { lines: latest.lines || [], source: "snapshot", editable: false };
  }
  return { lines: session?.qtyLines ?? [], source: "live", editable: true };
}
