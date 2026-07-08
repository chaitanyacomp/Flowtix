/**
 * Material Issue Workspace — WO/PMR grouping and presentation helpers.
 * M1.5: PMR actionability prefers additive backend storeIssueReady / storeActionKey.
 */

import {
  displaySalesOrderNo,
  displayWorkOrderNo,
} from "./docNoDisplay";
import { filterStoreReadyPmrs, isBackendStoreIssueReady } from "./materialIssueReadinessUx";

const EPS = 1e-6;

export type PendingPmrSummary = {
  id: number;
  docNo: string | null;
  status: string;
  workOrderId?: number;
  workOrderNo: string | null;
  salesOrderId?: number | null;
  salesOrderNo?: string | null;
  requirementSheetId?: number | null;
  productionItemName?: string | null;
  totalPending: number;
  lineCount?: number;
  /** Additive backend readiness (M1.5). */
  storeIssueReady?: boolean | null;
  hasPendingIssueQty?: boolean | null;
  storeActionKey?: string | null;
  storeActionLabel?: string | null;
};

export type WoPmrGroup = {
  workOrderId: number;
  workOrderNo: string | null;
  salesOrderNo: string | null;
  productionItemName: string | null;
  latestPmr: PendingPmrSummary;
  allPmrs: PendingPmrSummary[];
  totalPending: number;
  pendingLineCount: number;
};

export type MaterialIssueLineStatus =
  | "READY"
  | "PARTIAL"
  | "NO_STOCK"
  | "COMMITTED_ELSEWHERE"
  | "WAITING_PROCUREMENT"
  | "COMPLETE";

export type MaterialIssueLineStatusResult = {
  status: MaterialIssueLineStatus;
  label: string;
  explanation: string | null;
};

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

const ACTIONABLE_STATUSES = new Set(["REQUESTED", "PARTIALLY_ISSUED"]);

/** @deprecated Prefer backend `storeIssueReady` / `storeActionKey` (M1.5). Legacy fallback only. */
function isActionablePmrStatus(status: string): boolean {
  return ACTIONABLE_STATUSES.has(String(status ?? "").toUpperCase());
}

function isStoreReadyPmr(p: PendingPmrSummary): boolean {
  if (p.storeIssueReady != null || p.storeActionKey != null) {
    return isBackendStoreIssueReady(p);
  }
  return isActionablePmrStatus(p.status) && n(p.totalPending) > EPS;
}

/** Group pending PMRs by work order; latest PMR = highest id per WO. */
export function groupPendingPmrsByWorkOrder(pmrs: PendingPmrSummary[]): WoPmrGroup[] {
  const byWo = new Map<number, PendingPmrSummary[]>();
  for (const p of pmrs) {
    const woId = Number(p.workOrderId ?? 0);
    if (woId <= 0) continue;
    const arr = byWo.get(woId) ?? [];
    arr.push(p);
    byWo.set(woId, arr);
  }

  const groups: WoPmrGroup[] = [];
  for (const [workOrderId, list] of byWo) {
    const sorted = [...list].sort((a, b) => b.id - a.id);
    const actionable = sorted.filter(isStoreReadyPmr);
    if (actionable.length === 0) continue;
    const latestPmr = actionable[0];
    const pendingLineCount = actionable.reduce((s, p) => s + Math.max(0, Number(p.lineCount ?? 1)), 0);
    groups.push({
      workOrderId,
      workOrderNo: latestPmr.workOrderNo,
      salesOrderNo: latestPmr.salesOrderNo ?? null,
      productionItemName: latestPmr.productionItemName ?? null,
      latestPmr,
      allPmrs: sorted,
      totalPending: actionable.reduce((s, p) => s + n(p.totalPending), 0),
      pendingLineCount,
    });
  }

  return groups.sort((a, b) => a.workOrderId - b.workOrderId);
}

/** Oldest work order first (FIFO queue order for Store auto-advance). */
export function sortPendingPmrsFifo(pmrs: PendingPmrSummary[]): PendingPmrSummary[] {
  return [...pmrs].sort((a, b) => {
    const woA = Number(a.workOrderId ?? 0);
    const woB = Number(b.workOrderId ?? 0);
    if (woA !== woB) return woA - woB;
    return a.id - b.id;
  });
}

/** Hide stock warning when every PMR line is fully issued (WO handoff complete for Store). */
export function shouldShowNoRmAvailableWarning(input: {
  executionReady: boolean;
  canIssueAnyLine: boolean;
  lines: Array<{ pmrLineId?: number; pmrPendingQty?: number; pendingQty?: number }>;
}): boolean {
  if (!input.executionReady || input.canIssueAnyLine) return false;
  return input.lines.some((ln) => {
    if (!ln.pmrLineId) return false;
    return n(ln.pmrPendingQty ?? ln.pendingQty ?? 0) > EPS;
  });
}

/** Editable Material Issue entry rows are only PMR lines with executable pending qty. */
export function filterMaterialIssueEntryLines<T extends {
  pmrLineId?: number;
  pmrPendingQty?: number;
  pendingQty?: number;
  stillRequiredQty?: number;
  issueCapQty?: number;
}>(lines: T[]): T[] {
  return lines.filter((ln) => {
    if (!ln.pmrLineId) return true;
    return n(ln.pmrPendingQty ?? ln.pendingQty ?? ln.stillRequiredQty ?? ln.issueCapQty ?? 0) > EPS;
  });
}

/**
 * PMRs with store-actionable pending issue quantity.
 * Prefers additive backend `storeIssueReady` when present.
 */
export function filterPmrsWithPendingIssue(pmrs: PendingPmrSummary[]): PendingPmrSummary[] {
  return filterStoreReadyPmrs(pmrs);
}

/** Work order dropdown options — only WOs that still have RM to issue. */
export function buildActionableWorkOrderDropdownOptions(
  pmrs: PendingPmrSummary[],
): Array<{ id: number; label: string }> {
  const filtered = filterPmrsWithPendingIssue(pmrs);
  const byWo = new Map<number, PendingPmrSummary>();
  for (const p of filtered) {
    const woId = Number(p.workOrderId ?? 0);
    if (woId <= 0) continue;
    const existing = byWo.get(woId);
    if (!existing || p.id > existing.id) byWo.set(woId, p);
  }
  return [...byWo.values()]
    .map((p) => ({
      id: Number(p.workOrderId),
      label: `${displayWorkOrderNo(Number(p.workOrderId), p.workOrderNo)}${
        p.salesOrderId ? ` · ${displaySalesOrderNo(p.salesOrderId, p.salesOrderNo)}` : ""
      }${p.productionItemName ? ` · ${p.productionItemName}` : ""}`,
    }))
    .sort((a, b) => b.id - a.id);
}

/** Informational rows for fully issued WOs (monitoring only, not actionable). */
export function buildIssuedWorkOrderInfoRows(input: {
  recentIssues: Array<{ workOrderId?: number | null; workOrderNo?: string | null }>;
  actionableWorkOrderIds: Set<number>;
  /** When set, only these WOs are eligible for the issued-waiting panel (production read-model). */
  waitingForProductionIds?: Set<number>;
}): Array<{ workOrderId: number; label: string }> {
  const seen = new Set<number>();
  const rows: Array<{ workOrderId: number; label: string }> = [];
  for (const issue of input.recentIssues) {
    const woId = Number(issue.workOrderId ?? 0);
    if (woId <= 0 || input.actionableWorkOrderIds.has(woId) || seen.has(woId)) continue;
    if (input.waitingForProductionIds && !input.waitingForProductionIds.has(woId)) continue;
    seen.add(woId);
    rows.push({
      workOrderId: woId,
      label: displayWorkOrderNo(woId, issue.workOrderNo),
    });
  }
  return rows;
}

export type WorkOrderRmIssuedWaitingSnapshot = {
  status?: string | null;
  hasMaterialIssue?: boolean;
  pmrFullyIssued?: boolean;
  productionReportCount?: number;
  productionEntryCount?: number;
  executionStatus?: string | null;
  shortfallResolutionCount?: number;
};

/** Read-model filter for Material Issue right panel (mirrors backend). */
export function isWorkOrderRmIssuedWaitingForProduction(snapshot: WorkOrderRmIssuedWaitingSnapshot): boolean {
  const status = String(snapshot.status ?? "");
  if (status === "COMPLETED" || status === "REJECTED" || status === "CLOSED_WITH_SHORTFALL") return false;
  if (!snapshot.hasMaterialIssue && !snapshot.pmrFullyIssued) return false;
  if (n(snapshot.productionReportCount) > 0) return false;
  if (n(snapshot.productionEntryCount) > 0) return false;
  const exec = String(snapshot.executionStatus ?? "NOT_STARTED");
  if (exec !== "NOT_STARTED") return false;
  if (n(snapshot.shortfallResolutionCount) > 0) return false;
  return true;
}

export function mapIssuedWaitingForProductionPanelRows(
  rows: Array<{ workOrderId: number; workOrderNo: string }>,
  actionableWorkOrderIds: Set<number>,
): Array<{ workOrderId: number; label: string }> {
  return rows
    .filter((row) => row.workOrderId > 0 && !actionableWorkOrderIds.has(row.workOrderId))
    .map((row) => ({
      workOrderId: row.workOrderId,
      label: displayWorkOrderNo(row.workOrderId, row.workOrderNo),
    }));
}

/** Prefer latest actionable PMR for a work order. */
export function pickActionablePmrForWorkOrder(
  workOrderId: number,
  pmrs: PendingPmrSummary[],
): PendingPmrSummary | null {
  const forWo = pmrs
    .filter((p) => Number(p.workOrderId) === workOrderId && isStoreReadyPmr(p))
    .sort((a, b) => b.id - a.id);
  return forWo[0] ?? null;
}

/**
 * @deprecated Prefer backend line readiness fields (M1.5).
 * Kept as display fallback when issue-context line readiness fields are absent.
 */
export function resolveMaterialIssueLineStatus(input: {
  pendingQty: number;
  available: number | null;
  physicalStock?: number | null;
  issueQty?: number | string;
  woWaitingProcurement?: boolean;
  lineReadinessKey?: string | null;
  lineReadinessLabel?: string | null;
  lineReadinessExplanation?: string | null;
}): MaterialIssueLineStatusResult {
  const backendKey = String(input.lineReadinessKey ?? "").trim().toUpperCase();
  if (backendKey) {
    return {
      status: backendKey as MaterialIssueLineStatus,
      label: String(input.lineReadinessLabel ?? backendKey).trim() || backendKey,
      explanation: input.lineReadinessExplanation?.trim() || null,
    };
  }

  const pending = n(input.pendingQty);
  const available = input.available == null ? null : n(input.available);
  const physical = n(input.physicalStock ?? 0);
  const issueNow = n(input.issueQty ?? 0);

  if (pending <= EPS) {
    return { status: "COMPLETE", label: "Fully Issued", explanation: null };
  }
  if (input.woWaitingProcurement && (available == null || available <= EPS)) {
    return {
      status: "WAITING_PROCUREMENT",
      label: "Waiting procurement",
      explanation: "Material is on order — waiting for procurement or GRN at store.",
    };
  }
  if (available != null && available > EPS) {
    if (available + EPS < pending) {
      return {
        status: "PARTIAL",
        label: "Partially available",
        explanation: `Only ${available.toLocaleString()} available of ${pending.toLocaleString()} pending.`,
      };
    }
    return {
      status: "READY",
      label: "Ready to issue",
      explanation: issueNow > EPS ? null : "Enter issue quantity when ready.",
    };
  }
  if (physical > EPS) {
    return {
      status: "COMMITTED_ELSEWHERE",
      label: "Committed to other WO",
      explanation: "Physical stock exists but is committed to other work orders.",
    };
  }
  return {
    status: "NO_STOCK",
    label: "No available stock",
    explanation: "No free stock at the selected store location.",
  };
}

export type MaterialIssueLocationOption = {
  id: number;
  locationName: string;
  locationType?: string | null;
};

/** Prefer Production area when multiple issue destinations exist (M1.5 operator default). */
export function resolveDefaultMaterialIssueToLocationId(
  toLocations: MaterialIssueLocationOption[],
): number | null {
  if (!toLocations.length) return null;
  if (toLocations.length === 1) return toLocations[0].id;
  const production = toLocations.find((loc) => {
    const type = String(loc.locationType ?? "").toUpperCase();
    const name = String(loc.locationName ?? "").toLowerCase();
    return type === "PRODUCTION" || /\bproduction\b/.test(name);
  });
  return production?.id ?? null;
}
