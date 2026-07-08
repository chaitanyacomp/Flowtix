/**
 * M1.7 — Production Workspace readiness consumption (presentation only).
 * Maps production-queue backend fields → buckets, labels, and RM strip seeds.
 * Does not decide eligibility — production POST/report APIs remain the authority.
 */

import type { ProductionRmReadiness } from "../components/erp/ProductionRmReadinessStrip";
import type { DashboardProductionStatusSource } from "./dashboardProductionStatus";
import type { ProductionConciseRmLabel } from "./productionRmConciseStatus";
import type { ProductionWorkspaceStatusBucket } from "./productionWorkspaceStatusCards";

const EPS = 1e-6;

function upper(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function hasQueueRmReadinessFields(
  row: Pick<DashboardProductionStatusSource, "rmReadinessGate" | "rmReadyForProduction">,
): boolean {
  if (row.rmReadyForProduction != null) return true;
  return Boolean(String(row.rmReadinessGate ?? "").trim());
}

/** True when production-queue row carries enough RM gate fields to seed presentation. */
export function isQueueRmReadinessSufficient(row: DashboardProductionStatusSource): boolean {
  return Number(row.workOrderLineId ?? 0) > 0 && hasQueueRmReadinessFields(row);
}

/** Backend RM gate blocks production entry (REGULAR queue rows). */
export function isQueueRmGateBlocked(
  row: Pick<DashboardProductionStatusSource, "rmReadinessGate" | "rmReadyForProduction">,
): boolean {
  if (row.rmReadyForProduction === true) return false;
  if (row.rmReadyForProduction === false) return true;
  const gate = upper(row.rmReadinessGate);
  if (!gate) return false;
  return gate !== "READY_FOR_PRODUCTION";
}

/** Ready-to-start bucket: backend nextAction + RM gate, never when RM blocked. */
export function isQueueReadyToStart(row: DashboardProductionStatusSource): boolean {
  const next = upper(row.nextAction);
  const exec = upper(row.productionExecutionStatus);
  if (next !== "PRODUCTION_PENDING") return false;
  if (exec === "BLOCKED" || exec === "SHORTFALL_PENDING") return false;
  if (n(row.producedQty) > EPS) return false;
  if (hasQueueRmReadinessFields(row)) {
    return !isQueueRmGateBlocked(row) && n(row.rmProductionAllowedNowQty) > EPS;
  }
  return true;
}

/** In-progress bucket from backend execution + qty fields only. */
export function isQueueInProgress(row: DashboardProductionStatusSource): boolean {
  const exec = upper(row.productionExecutionStatus);
  const next = upper(row.nextAction);
  if (exec === "BLOCKED" || exec === "SHORTFALL_PENDING") return false;
  if (next === "QC_PENDING" || next === "PRODUCTION_SHORTFALL_DECISION") return false;
  if (exec === "RUNNING") return true;
  const produced = n(row.producedQty);
  if (produced > EPS) {
    const remaining = Math.max(0, n(row.balanceQty));
    return remaining > EPS || next === "PRODUCTION_PENDING";
  }
  return false;
}

export function classifyProductionQueueBucketFromBackend(
  row: DashboardProductionStatusSource,
): ProductionWorkspaceStatusBucket | null {
  const next = upper(row.nextAction);
  const exec = upper(row.productionExecutionStatus);

  if (next === "QC_PENDING" || row.hasPendingQc) return "pendingQa";
  if (next === "PRODUCTION_SHORTFALL_DECISION" || exec === "SHORTFALL_PENDING") return "shortfallDecision";
  if (isQueueReadyToStart(row)) return "readyToStart";
  return null;
}

/** Never show "Ready to Produce" when backend RM gate is blocked. */
export function canShowReadyToProduceLabel(row: DashboardProductionStatusSource): boolean {
  if (!isQueueReadyToStart(row)) return false;
  if (hasQueueRmReadinessFields(row) && isQueueRmGateBlocked(row)) return false;
  return true;
}

export function deriveConciseRmLabelFromQueueRow(
  row: DashboardProductionStatusSource | null | undefined,
): ProductionConciseRmLabel | null {
  if (!row || !hasQueueRmReadinessFields(row)) return null;
  if (row.rmReadyForProduction === true) {
    return n(row.rmProductionAllowedNowQty) > EPS ? "READY" : "WAITING RM";
  }
  if (row.rmReadyForProduction === false) return "WAITING RM";
  const gate = upper(row.rmReadinessGate);
  if (gate === "READY_FOR_PRODUCTION") {
    return n(row.rmProductionAllowedNowQty) > EPS ? "READY" : "WAITING RM";
  }
  if (gate) return "WAITING RM";
  return null;
}

const KNOWN_GATES = new Set([
  "NO_PMR",
  "PMR_DRAFT_ONLY",
  "WAITING_STORE_ISSUE",
  "WAITING_RELEASE_TO_PRODUCTION",
  "READY_FOR_PRODUCTION",
]);

function normalizeQueueGate(
  row: DashboardProductionStatusSource,
): ProductionRmReadiness["gate"] {
  const gate = upper(row.rmReadinessGate);
  if (KNOWN_GATES.has(gate)) return gate as ProductionRmReadiness["gate"];
  if (row.rmReadyForProduction === true) return "READY_FOR_PRODUCTION";
  return "WAITING_STORE_ISSUE";
}

/** Partial ProductionRmReadiness for strip / entry hints — server POST remains authority. */
export function buildReadinessSeedFromQueueRow(
  row: DashboardProductionStatusSource,
): ProductionRmReadiness | null {
  const wolId = Number(row.workOrderLineId ?? 0);
  const woId = Number(row.workOrderId ?? 0);
  if (!(wolId > 0) || !(woId > 0) || !isQueueRmReadinessSufficient(row)) return null;

  const gate = normalizeQueueGate(row);
  const allowedNow = n(row.rmProductionAllowedNowQty);

  return {
    gate,
    fgItemName: row.itemName,
    fgUnit: row.itemUnit ?? "",
    woQty: n(row.requiredQty),
    woRemainingQty: n(row.balanceQty),
    productionAllowedNowQty: allowedNow,
    maxAdditionalQty: allowedNow,
    latestPmrId: null,
    latestPmrDocNo: null,
    workOrderId: woId,
    workOrderLineId: wolId,
    orderType: row.orderType,
    rmLines: [],
    flags: {
      readyForProduction: row.rmReadyForProduction === true,
      waitingForStoreIssue: gate === "WAITING_STORE_ISSUE",
      waitingForReleaseToProduction: gate === "WAITING_RELEASE_TO_PRODUCTION",
      waitingForMaterialRequest: gate === "NO_PMR" || gate === "PMR_DRAFT_ONLY",
    },
  };
}

export function isSeededQueueRmReadiness(data: ProductionRmReadiness | null | undefined): boolean {
  if (!data?.gate) return false;
  return Number(data.workOrderLineId ?? 0) > 0;
}

export function buildProductionQueueByLineId(
  rows: DashboardProductionStatusSource[],
): Map<number, DashboardProductionStatusSource> {
  const map = new Map<number, DashboardProductionStatusSource>();
  for (const row of rows) {
    const id = Number(row.workOrderLineId ?? 0);
    if (id > 0) map.set(id, row);
  }
  return map;
}
