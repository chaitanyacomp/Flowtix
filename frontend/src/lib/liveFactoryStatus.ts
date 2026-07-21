/**
 * Shared Live Factory Status — mirrors backend liveFactorySnapshotService.
 * Used by Admin Dashboard, Control Tower Factory Monitor, and count reconciliation.
 * Prefer backend `liveFactoryBucket` when present on production-queue rows.
 */

import type { DashboardProductionStatusSource } from "./dashboardProductionStatus";
import { controlTowerHref } from "./controlTowerNavigation";

export type LiveFactoryBucket =
  | "READY_TO_START"
  | "RUNNING"
  | "PAUSED"
  | "BLOCKED"
  | "AWAITING_REPORT"
  | "PENDING_QC"
  | "COMPLETED";

export type LiveFactoryCounters = {
  readyToStart: number;
  running: number;
  paused: number;
  blocked: number;
  awaitingReport: number;
  pendingQc: number;
};

export type LiveFactoryHighlightRow = {
  workOrderId: number;
  workOrderNo: string;
  product: string;
  plannedQty: number;
  producedQty: number;
  remainingQty: number;
  unit: string | null;
  status: LiveFactoryBucket;
  statusLabel: string;
  blockerReason: string | null;
  lastActivity: string | null;
};

const HIGHLIGHT_PRIORITY: LiveFactoryBucket[] = [
  "RUNNING",
  "PAUSED",
  "BLOCKED",
  "AWAITING_REPORT",
  "READY_TO_START",
];

const EPS = 1e-6;

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function upper(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function isRmGateBlocked(row: DashboardProductionStatusSource): boolean {
  if (row.rmReadyForProduction === true) return false;
  if (row.rmReadyForProduction === false) return true;
  const gate = upper(row.rmReadinessGate);
  if (!gate) return false;
  return gate !== "READY_FOR_PRODUCTION" && gate !== "READY" && gate !== "OK";
}

/**
 * Mirror of backend classifyLiveFactoryBucket.
 * Ready ≠ Running ≠ Blocked. Pending QC on another batch does not block remaining capacity.
 */
export function classifyLiveFactoryBucket(
  row: DashboardProductionStatusSource & { liveFactoryBucket?: string | null },
): LiveFactoryBucket {
  const backend = upper(row.liveFactoryBucket);
  if (
    backend === "READY_TO_START" ||
    backend === "RUNNING" ||
    backend === "PAUSED" ||
    backend === "BLOCKED" ||
    backend === "AWAITING_REPORT" ||
    backend === "PENDING_QC" ||
    backend === "COMPLETED"
  ) {
    return backend;
  }

  const workState = upper(row.productionWorkState);
  const next = upper(row.nextAction);
  const exec = upper(row.productionExecutionStatus);
  const woStatus = upper(row.status);
  const produced = n(row.producedQty);
  const balance = Math.max(0, n(row.balanceQty));
  const canAccept =
    row.canAcceptProductionEntry == null ? null : Boolean(row.canAcceptProductionEntry);

  if (woStatus === "COMPLETED" || woStatus === "CLOSED" || exec === "COMPLETED") {
    if (balance <= EPS && produced > EPS) return "COMPLETED";
  }

  if (
    workState === "PAUSED_PRODUCTION" ||
    next === "PRODUCTION_PAUSED" ||
    next === "ON_HOLD" ||
    woStatus === "PAUSED" ||
    woStatus === "HOLD"
  ) {
    return "PAUSED";
  }

  if (next === "PRODUCTION_SHORTFALL_DECISION" || exec === "SHORTFALL_PENDING") {
    return "AWAITING_REPORT";
  }

  if (
    (next === "QC_PENDING" || (row.hasPendingQc && balance <= EPS)) &&
    (canAccept === false || balance <= EPS)
  ) {
    return "PENDING_QC";
  }

  if (canAccept === true || workState === "READY_TO_START" || workState === "CONTINUE_PRODUCTION") {
    if (workState === "CONTINUE_PRODUCTION" || (produced > EPS && balance > EPS)) {
      if (isRmGateBlocked(row) && produced <= EPS) return "BLOCKED";
      return produced > EPS ? "RUNNING" : "READY_TO_START";
    }
    if (
      workState === "READY_TO_START" ||
      (produced <= EPS && (next === "PRODUCTION_PENDING" || next === "PRODUCTION_DRAFT_REVIEW"))
    ) {
      if (isRmGateBlocked(row)) return "BLOCKED";
      return "READY_TO_START";
    }
  }

  if (canAccept === false) {
    if (isRmGateBlocked(row) && produced <= EPS) return "BLOCKED";
    if (next === "NEXT_RS_REQUIRED") return "BLOCKED";
    if (produced > EPS && balance <= EPS && row.hasPendingQc) return "PENDING_QC";
    if (next === "PRODUCTION_SHORTFALL_DECISION") return "AWAITING_REPORT";
    return "BLOCKED";
  }

  if (produced > EPS && balance > EPS) return "RUNNING";
  if (produced <= EPS && next === "PRODUCTION_PENDING") {
    return isRmGateBlocked(row) ? "BLOCKED" : "READY_TO_START";
  }

  return "BLOCKED";
}

export function liveFactoryStatusLabel(bucket: LiveFactoryBucket): string {
  switch (bucket) {
    case "READY_TO_START":
      return "Ready to Start";
    case "RUNNING":
      return "Running";
    case "PAUSED":
      return "Paused";
    case "BLOCKED":
      return "Blocked";
    case "AWAITING_REPORT":
      return "Awaiting Production Report";
    case "PENDING_QC":
      return "Pending QC";
    case "COMPLETED":
      return "Completed";
  }
}

function primaryPerWorkOrder(
  rows: DashboardProductionStatusSource[],
): DashboardProductionStatusSource[] {
  const byWo = new Map<number, DashboardProductionStatusSource>();
  for (const row of rows) {
    const woId = Number(row.workOrderId);
    if (!(woId > 0)) continue;
    const cur = byWo.get(woId);
    if (!cur || n(row.balanceQty) > n(cur.balanceQty)) byWo.set(woId, row);
  }
  return [...byWo.values()];
}

export function summarizeLiveFactoryCounters(
  rows: DashboardProductionStatusSource[] | null | undefined,
): LiveFactoryCounters {
  const primaries = primaryPerWorkOrder(rows ?? []);
  const counters: LiveFactoryCounters = {
    readyToStart: 0,
    running: 0,
    paused: 0,
    blocked: 0,
    awaitingReport: 0,
    pendingQc: 0,
  };
  for (const row of primaries) {
    const bucket = classifyLiveFactoryBucket(row);
    if (bucket === "COMPLETED") continue;
    if (bucket === "READY_TO_START") counters.readyToStart += 1;
    else if (bucket === "RUNNING") counters.running += 1;
    else if (bucket === "PAUSED") counters.paused += 1;
    else if (bucket === "BLOCKED") counters.blocked += 1;
    else if (bucket === "AWAITING_REPORT") counters.awaitingReport += 1;
    else if (bucket === "PENDING_QC") counters.pendingQc += 1;
  }
  return counters;
}

export function pickLiveFactoryHighlights(
  rows: DashboardProductionStatusSource[] | null | undefined,
  limit = 5,
): LiveFactoryHighlightRow[] {
  const max = Math.min(5, Math.max(3, limit));
  const primaries = primaryPerWorkOrder(rows ?? []);
  const ranked = primaries
    .map((row) => {
      const status = classifyLiveFactoryBucket(row);
      const blocker =
        status === "BLOCKED" || status === "PAUSED"
          ? String(row.productionBlockReasonLabel ?? row.holdReason ?? row.productionBlockRemarks ?? "").trim() ||
            (row.rmReadyForProduction === false
              ? String(row.rmReadinessGate ?? "RM not ready").replace(/_/g, " ")
              : null)
          : null;
      return {
        workOrderId: row.workOrderId,
        workOrderNo: row.workOrderNo,
        product: row.itemName,
        plannedQty: n(row.requiredQty),
        producedQty: n(row.producedQty),
        remainingQty: Math.max(0, n(row.balanceQty)),
        unit: row.itemUnit ?? null,
        status,
        statusLabel: liveFactoryStatusLabel(status),
        blockerReason: blocker,
        lastActivity: row.pausedAt ?? null,
        _rank: HIGHLIGHT_PRIORITY.indexOf(status),
      };
    })
    .filter((r) => r.status !== "COMPLETED" && r._rank >= 0)
    .sort((a, b) => {
      if (a._rank !== b._rank) return a._rank - b._rank;
      return b.workOrderId - a.workOrderId;
    })
    .slice(0, max);

  return ranked.map(({ _rank: _, ...rest }) => rest);
}

/** Deep-link: Control Tower with Production / Factory filter. */
export function liveFactoryMonitorHref(): string {
  return controlTowerHref({ group: "PRODUCTION", focus: "factory" });
}

/**
 * Authoritative RM shortage for Critical Exceptions.
 * READY_TO_RELEASE_WO (Ready to Start) must never count as blocked shortage.
 */
export function isAuthoritativeRmShortageRiskRow(row: {
  queueType?: string | null;
  status?: string | null;
  shortageQty?: number | null;
  shortageAfterReservationQty?: number | null;
}): boolean {
  if (upper(row.queueType) === "READY_TO_RELEASE_WO") return false;
  const shortage = n(row.shortageAfterReservationQty ?? row.shortageQty);
  if (shortage <= EPS) return false;
  return upper(row.status) === "CRITICAL" || shortage > EPS;
}

export function countAuthoritativeRmShortageCases(
  rows: Array<{
    workOrderId?: number | null;
    salesOrderId?: number | null;
    workOrderNo?: string | null;
    salesOrderNo?: string | null;
    queueType?: string | null;
    status?: string | null;
    shortageQty?: number | null;
    shortageAfterReservationQty?: number | null;
  }> | null | undefined,
): { caseCount: number; firstDoc: string | null } {
  const src = rows ?? [];
  const cases = new Set<string>();
  let firstDoc: string | null = null;
  for (const row of src) {
    if (!isAuthoritativeRmShortageRiskRow(row)) continue;
    const woId = Number(row.workOrderId ?? 0);
    const soId = Number(row.salesOrderId ?? 0);
    const key = woId > 0 ? `wo-${woId}` : soId > 0 ? `so-${soId}` : `row-${cases.size}`;
    if (!cases.has(key)) {
      cases.add(key);
      if (!firstDoc) {
        firstDoc =
          (row.workOrderNo && String(row.workOrderNo).trim()) ||
          (row.salesOrderNo && String(row.salesOrderNo).trim()) ||
          (woId > 0 ? `WO-${woId}` : soId > 0 ? `SO-${soId}` : null);
      }
    }
  }
  return { caseCount: cases.size, firstDoc };
}
