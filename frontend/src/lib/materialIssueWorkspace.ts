/**
 * Material Issue Workspace — WO/PMR grouping and line status labels (UX only).
 */

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

export function isActionablePmrStatus(status: string): boolean {
  return ACTIONABLE_STATUSES.has(String(status ?? "").toUpperCase());
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
    const actionable = sorted.filter(
      (p) => isActionablePmrStatus(p.status) && n(p.totalPending) > EPS,
    );
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

/** PMRs with store-actionable pending issue quantity. */
export function filterPmrsWithPendingIssue(pmrs: PendingPmrSummary[]): PendingPmrSummary[] {
  return pmrs.filter((p) => isActionablePmrStatus(p.status) && n(p.totalPending) > EPS);
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
      label: `${p.workOrderNo ?? `WO-${p.workOrderId}`}${
        p.salesOrderNo ? ` · ${p.salesOrderNo}` : ""
      }${p.productionItemName ? ` · ${p.productionItemName}` : ""}`,
    }))
    .sort((a, b) => b.id - a.id);
}

/** Informational rows for fully issued WOs (monitoring only, not actionable). */
export function buildIssuedWorkOrderInfoRows(input: {
  recentIssues: Array<{ workOrderId?: number | null; workOrderNo?: string | null }>;
  actionableWorkOrderIds: Set<number>;
}): Array<{ workOrderId: number; label: string }> {
  const seen = new Set<number>();
  const rows: Array<{ workOrderId: number; label: string }> = [];
  for (const issue of input.recentIssues) {
    const woId = Number(issue.workOrderId ?? 0);
    if (woId <= 0 || input.actionableWorkOrderIds.has(woId) || seen.has(woId)) continue;
    seen.add(woId);
    rows.push({
      workOrderId: woId,
      label: issue.workOrderNo?.trim() || `WO-${woId}`,
    });
  }
  return rows;
}

/** Prefer latest actionable PMR for a work order. */
export function pickActionablePmrForWorkOrder(
  workOrderId: number,
  pmrs: PendingPmrSummary[],
): PendingPmrSummary | null {
  const forWo = pmrs
    .filter((p) => Number(p.workOrderId) === workOrderId && isActionablePmrStatus(p.status))
    .sort((a, b) => b.id - a.id);
  return forWo[0] ?? null;
}

export function resolveMaterialIssueLineStatus(input: {
  pendingQty: number;
  available: number | null;
  physicalStock?: number | null;
  issueQty?: number | string;
  woWaitingProcurement?: boolean;
}): MaterialIssueLineStatusResult {
  const pending = n(input.pendingQty);
  const available = input.available == null ? null : n(input.available);
  const physical = n(input.physicalStock ?? 0);
  const issueNow = n(input.issueQty ?? 0);

  if (pending <= EPS) {
    return { status: "COMPLETE", label: "Fully issued", explanation: null };
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

export function pmrNextActionLabel(input: {
  canIssueAny: boolean;
  waitingProcurement?: boolean;
}): string {
  if (input.canIssueAny) return "Issue available RM";
  if (input.waitingProcurement) return "Waiting procurement / GRN";
  return "Review allocation in RM Control Center";
}
