/**
 * Presentation helpers for Work Order Tracking Report UI.
 * Does not change API/business calculations — display mapping only.
 */

import type { WoTrackingRow, WoTrackingSummary } from "./woTrackingResponse";

export type WoScopeFilter = "open" | "closed" | "all";

export type RecoveryBadgeKind = "NONE" | "KEEP" | "WAIVED" | "CARRY_FORWARD" | "OPEN";

const CLOSED_SO = new Set(["COMPLETED", "CLOSED", "MANUALLY_CLOSED", "CLOSED_WITH_WAIVER"]);
const WO_TERMINAL = new Set(["COMPLETED", "REJECTED", "CLOSED_WITH_SHORTFALL"]);

export function formatQtyCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
  return n.toFixed(1);
}

/** Compact progress: "1905 / 2000" */
export function formatProgressPair(done: number, total: number): string {
  return `${formatQtyCompact(done)} / ${formatQtyCompact(total)}`;
}

export function productionProgress(r: WoTrackingRow): { done: number; total: number; label: string } {
  const total = Number(r.plannedQty ?? r.requiredQty ?? r.workOrderQty ?? 0);
  const done = Number(r.producedQty ?? 0);
  return { done, total, label: formatProgressPair(done, total) };
}

export function qcProgress(r: WoTrackingRow): { done: number; total: number; label: string } {
  const total = Number(r.producedQty ?? 0);
  const done = Number(r.acceptedQty ?? 0) + Number(r.rejectedQty ?? 0);
  return { done, total, label: formatProgressPair(done, total) };
}

export function dispatchProgress(r: WoTrackingRow, isNoQty: boolean): { done: number; total: number; label: string } {
  const done = Number(r.dispatchedQty ?? 0);
  const total = isNoQty
    ? Number(r.customerDemandQty ?? r.acceptedQty ?? 0)
    : Number(r.acceptedQty ?? 0);
  return { done, total, label: formatProgressPair(done, total) };
}

export function isRowClosedPresentation(r: WoTrackingRow, isNoQty: boolean): boolean {
  if (isNoQty) {
    if (CLOSED_SO.has(String(r.salesOrderInternalStatus || "").toUpperCase())) return true;
    if (String(r.cycleStatus || "").toUpperCase() === "CLOSED") return true;
    if (WO_TERMINAL.has(String(r.workOrderStatus || "").toUpperCase())) return true;
    if (r.status === "COMPLETED") return true;
    return false;
  }
  return (
    WO_TERMINAL.has(String(r.workOrderStatus || "").toUpperCase()) ||
    r.status === "COMPLETED"
  );
}

export function filterRowsByWoScope(rows: WoTrackingRow[], scope: WoScopeFilter, isNoQty: boolean): WoTrackingRow[] {
  if (scope === "all") return rows;
  if (scope === "open") return rows.filter((r) => !isRowClosedPresentation(r, isNoQty));
  return rows.filter((r) => isRowClosedPresentation(r, isNoQty));
}

/** Map API includeClosed from Open/Closed/All UI. Closed needs includeClosed=true then client filter. */
export function includeClosedForScope(scope: WoScopeFilter): boolean {
  return scope !== "open";
}

export function classifyRecoveryBadge(r: WoTrackingRow): RecoveryBadgeKind {
  const outcome = String(r.recoveryCarryForwardOutcome || "").toUpperCase();
  const src = String(r.recoverySourceStatus || "").toUpperCase();
  const combined = `${outcome} ${src}`;
  if (!outcome || outcome === "NONE") {
    if (src === "OPEN" || src === "PARTIALLY_WAIVED") return "OPEN";
    return "NONE";
  }
  if (/WAIVE/.test(combined)) return "WAIVED";
  if (/KEEP|CARRY-FORWARD|CARRY FORWARD|ALLOCATED/.test(combined)) return "KEEP";
  if (/OPEN/.test(combined)) return "OPEN";
  if (/CARRY/.test(combined) || r.status === "SHORTFALL_PENDING") return "CARRY_FORWARD";
  return "NONE";
}

export function recoveryBadgeLabel(kind: RecoveryBadgeKind): string {
  switch (kind) {
    case "KEEP":
      return "Keep";
    case "WAIVED":
      return "Waived";
    case "CARRY_FORWARD":
      return "Carry Forward";
    case "OPEN":
      return "Open";
    default:
      return "None";
  }
}

export function recoveryBadgeVariant(
  kind: RecoveryBadgeKind,
): "default" | "success" | "warning" | "info" | "rejected" {
  switch (kind) {
    case "KEEP":
      return "info";
    case "WAIVED":
      return "warning";
    case "CARRY_FORWARD":
    case "OPEN":
      return "warning";
    default:
      return "default";
  }
}

export type StatusDisplay = {
  label: string;
  variant: "default" | "success" | "warning" | "info" | "rejected";
};

export function statusDisplay(r: WoTrackingRow, isNoQty: boolean): StatusDisplay {
  if (isNoQty && CLOSED_SO.has(String(r.salesOrderInternalStatus || "").toUpperCase())) {
    return { label: "SO Closed", variant: "success" };
  }
  if (isNoQty && String(r.cycleStatus || "").toUpperCase() === "CLOSED" && r.status === "COMPLETED") {
    return { label: "Cycle Closed", variant: "success" };
  }
  switch (r.status) {
    case "PENDING_PRODUCTION":
      return { label: "Pending Production", variant: "default" };
    case "IN_PRODUCTION":
      return { label: "In Production", variant: "info" };
    case "PENDING_QC":
    case "PARTIAL_QC":
      return { label: "Pending QC", variant: "info" };
    case "READY_TO_DISPATCH":
    case "PARTIAL_DISPATCH":
      return { label: "Ready for Dispatch", variant: "warning" };
    case "SHORTFALL_PENDING":
      return { label: "Carry Forward", variant: "warning" };
    case "COMPLETED":
      return { label: "Completed", variant: "success" };
    default:
      return { label: r.status.replace(/_/g, " "), variant: "default" };
  }
}

export type NoQtyKpiStrip = {
  openWos: number;
  openCycles: number;
  activeProductionPending: number;
  carryForwardQty: number;
  recoveryPending: number;
};

export function computeNoQtyKpiStrip(rows: WoTrackingRow[]): NoQtyKpiStrip {
  const openRows = rows.filter((r) => !isRowClosedPresentation(r, true));
  const openWoIds = new Set(openRows.map((r) => r.workOrderId));
  const openCycleKeys = new Set(
    openRows
      .filter((r) => String(r.cycleStatus || "").toUpperCase() === "ACTIVE" && r.cycleId != null)
      .map((r) => `${r.salesOrderId}:${r.cycleId}`),
  );
  let activeProductionPending = 0;
  let carryForwardQty = 0;
  let recoveryPending = 0;
  for (const r of rows) {
    activeProductionPending += Number(r.activeProductionPendingQty ?? r.productionPendingQty ?? 0);
    carryForwardQty += Number(r.recoveryAllocatedQty ?? 0);
    const kind = classifyRecoveryBadge(r);
    if (kind === "OPEN" || kind === "CARRY_FORWARD") recoveryPending += 1;
  }
  return {
    openWos: openWoIds.size,
    openCycles: openCycleKeys.size,
    activeProductionPending,
    carryForwardQty,
    recoveryPending,
  };
}

export type RegularKpiStrip = {
  openWoLines: number;
  pendingProduction: number;
  pendingQc: number;
  pendingDispatch: number;
};

export function computeRegularKpiStrip(rows: WoTrackingRow[], summary: WoTrackingSummary | null): RegularKpiStrip {
  return {
    openWoLines: summary?.openWoLines ?? rows.filter((r) => r.status !== "COMPLETED").length,
    pendingProduction: summary?.pendingProductionQtySum ?? rows.reduce((s, r) => s + r.productionPendingQty, 0),
    pendingQc: summary?.pendingQcQtySum ?? rows.reduce((s, r) => s + r.qcPendingQty, 0),
    pendingDispatch: summary?.pendingDispatchQtySum ?? rows.reduce((s, r) => s + r.dispatchPendingQty, 0),
  };
}

export function parseRecoveryDetail(r: WoTrackingRow): {
  productionShortfall: number | null;
  recoveryStatus: string;
  keepQty: number | null;
  outcome: string;
  cycleLabel: string;
  executionStatus: string;
} {
  return {
    productionShortfall: r.productionShortfallSourceQty ?? null,
    recoveryStatus: r.recoverySourceStatus ?? "—",
    keepQty: r.recoveryAllocatedQty ?? null,
    outcome: r.recoveryCarryForwardOutcome ?? "NONE",
    cycleLabel: r.cycleNo != null ? `Cycle ${r.cycleNo}${r.cycleStatus ? ` (${r.cycleStatus})` : ""}` : "—",
    executionStatus: r.executionStatus ?? "—",
  };
}
