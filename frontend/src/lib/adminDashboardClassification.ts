/**
 * Admin / factory dashboard production classification helpers.
 * Presentation only — does not change production, QC, RM, or dispatch transactions.
 *
 * Factory counters delegate to shared liveFactoryStatus (same path as Control Tower /
 * Store Production Monitor).
 */

import {
  type DashboardProductionStatusSource,
  type ProductionOperationalStatus,
} from "./dashboardProductionStatus";
import {
  summarizeLiveFactoryCounters,
  type LiveFactoryCounters,
} from "./liveFactoryStatus";

export type FactoryProductionCounters = LiveFactoryCounters;

const READY_LABELS = new Set([
  "Ready to Start",
  "Ready for Production",
  "Waiting for Production",
]);

const RUNNING_LABELS = new Set([
  "Running",
  "Continue",
  "Continue Production",
  "In Production",
  "Partially Produced",
]);

const PAUSED_LABELS = new Set(["Paused", "On Hold", "On Hold - Customer hold"]);

const AWAITING_REPORT_LABELS = new Set(["Awaiting Report", "Production Complete"]);

/** Canonical ready-to-start (RM ready, production not started). */
export function isReadyToStartStatus(status: ProductionOperationalStatus): boolean {
  if (status.tone === "ready") return true;
  return READY_LABELS.has(status.label);
}

/** Canonical running / continue — never Ready-only. */
export function isRunningProductionStatus(status: ProductionOperationalStatus): boolean {
  if (status.tone === "ready") return false;
  if (status.tone === "running") return true;
  if (status.tone === "partial" && (status.label === "Continue" || status.label === "Partially Produced")) {
    return true;
  }
  return RUNNING_LABELS.has(status.label);
}

export function isPausedProductionStatus(
  status: ProductionOperationalStatus,
  row?: Pick<DashboardProductionStatusSource, "productionWorkState" | "status">,
): boolean {
  if (status.tone === "paused") return true;
  if (row?.productionWorkState === "PAUSED_PRODUCTION") return true;
  const wo = String(row?.status ?? "").toUpperCase();
  if (wo === "PAUSED" || wo === "HOLD") return true;
  if (status.label.startsWith("On Hold") || status.label === "Paused") return true;
  return PAUSED_LABELS.has(status.label);
}

export function isAwaitingReportStatus(status: ProductionOperationalStatus): boolean {
  return status.label === "Awaiting Report" || (status.tone === "idle" && AWAITING_REPORT_LABELS.has(status.label));
}

/**
 * Factory status counters from production-queue rows.
 * Ready ≠ Running; produced qty 0 alone never counts as Running.
 * Delegates to shared Live Factory classifier (backend-aligned).
 */
export function summarizeFactoryProductionCounters(
  rows: DashboardProductionStatusSource[] | null | undefined,
): FactoryProductionCounters {
  return summarizeLiveFactoryCounters(rows);
}

/** Admin KPI / attention: Ready-to-start WOs are not Admin blockers. */
export function adminWoNeedsActionCount(counters: FactoryProductionCounters): number {
  return counters.running + counters.paused + counters.blocked + counters.awaitingReport;
}

/** True when an operational-blocker action is Admin-owned (not Store/Production execution). */
export function isAdminOwnedOperationalAction(action: {
  actionLabel?: string | null;
  stageLabel?: string | null;
  nextActionKey?: string | null;
  operationalKey?: string | null;
}): boolean {
  const label = String(action.actionLabel ?? "").trim().toLowerCase();
  const stage = String(action.stageLabel ?? "").trim().toLowerCase();
  const key = String(action.operationalKey ?? action.nextActionKey ?? "").toUpperCase();

  if (
    key === "AWAITING_RELEASE" ||
    key === "RELEASE_TO_PRODUCTION" ||
    key === "READY_FOR_ISSUE" ||
    key === "READY_FOR_PRODUCTION" ||
    key === "RM_RECEIVED" ||
    key === "CREATE_WO"
  ) {
    return false;
  }
  if (
    label.includes("release to production") ||
    label.includes("issue rm") ||
    label.includes("create work order") ||
    label.includes("open production") ||
    label.includes("ready to start")
  ) {
    return false;
  }
  if (
    stage.includes("awaiting release") ||
    stage.includes("ready for issue") ||
    stage.includes("ready for wo") ||
    stage.includes("rm ready in store") ||
    stage.includes("rm received")
  ) {
    return false;
  }
  // Remaining blockers (e.g. shortage monitoring) are Store/Purchase-owned on Admin desk.
  return false;
}

/** Deduplicate WO ids across Admin operational list keys. */
export function assertNoDuplicateWorkOrderKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const key of keys) {
    if (!key.startsWith("wo:")) continue;
    if (seen.has(key)) dupes.push(key);
    else seen.add(key);
  }
  return dupes;
}
