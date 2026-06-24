/**
 * P10-A4J / P11-A16 — When to show RS Execution Workspace on Requirement Sheet page.
 * Locked NO_QTY sheets on any cycle; not during draft/create-empty workspace.
 * Execution is independent of which cycle is currently active for planning.
 */

export const EXECUTION_WO_HISTORY_MAX_ROWS = 5;

export type PlacementStatusLike =
  | "READY"
  | "PARTIALLY_READY"
  | "AWAITING_PROCUREMENT"
  | "MISSING_BOM"
  | "ZERO_BALANCE"
  | string;

export function rmCoverageLabelFromPlacement(input: {
  placementStatus?: PlacementStatusLike | null;
  rsBalanceQty?: number | null;
}): string {
  const balance = Number(input.rsBalanceQty ?? 0);
  if (!(balance > 0)) return "Complete";
  const status = String(input.placementStatus ?? "").toUpperCase();
  if (status === "READY") return "Ready";
  if (status === "PARTIALLY_READY") return "Partial";
  if (status === "AWAITING_PROCUREMENT") return "Awaiting RM";
  if (status === "MISSING_BOM") return "Blocked";
  return "Awaiting RM";
}

export function rmCoverageChipClassName(label: string): string {
  switch (label) {
    case "Ready":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "Partial":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "Awaiting RM":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "Blocked":
      return "border-red-200 bg-red-50 text-red-800";
    case "Complete":
      return "border-slate-200 bg-slate-50 text-slate-600";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

export function placementInlineReadinessMessage(input: {
  placementStatus?: PlacementStatusLike | null;
  totalExecutableQty?: number | null;
  rsBalanceQty?: number | null;
  placementReason?: string | null;
}): string {
  const balance = Number(input.rsBalanceQty ?? 0);
  const status = String(input.placementStatus ?? "").toUpperCase();
  const executable = Number(input.totalExecutableQty ?? 0);
  if (!(balance > 0)) return "Complete — RS balance is fully placed.";
  if (status === "READY") return "Ready — full balance can be placed.";
  if (status === "PARTIALLY_READY") {
    const qty = Number.isFinite(executable) && executable > 0 ? formatExecutionQty(executable) : "0";
    return `Partial RM — ${qty} executable; remaining stays on RS.`;
  }
  if (status === "AWAITING_PROCUREMENT") {
    return "Awaiting RM — WO placement blocked until RM is physically available.";
  }
  if (status === "MISSING_BOM") return "Blocked — approved BOM required.";
  const reason = String(input.placementReason ?? "").trim();
  return reason || "Review RM coverage before placing WO.";
}

export function formatExecutionQty(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 1000) / 1000;
  return Math.abs(r - Math.round(r)) < 1e-9
    ? String(Math.round(r))
    : r.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function rmDetailCollapsedSummary(input: {
  lineCount?: number;
  readyLineCount?: number;
  partialLineCount?: number;
  shortageQty?: number;
  missingBomCount?: number;
}): string {
  const lines = Number(input.lineCount ?? 0);
  if (lines <= 0 && (input.missingBomCount ?? 0) > 0) {
    return `${input.missingBomCount} missing BOM`;
  }
  if (lines <= 0) return "No RM lines for current RS balance.";
  const parts: string[] = [];
  if ((input.readyLineCount ?? 0) > 0) parts.push(`${input.readyLineCount} ready`);
  if ((input.partialLineCount ?? 0) > 0) parts.push(`${input.partialLineCount} partial`);
  const shortage = Number(input.shortageQty ?? 0);
  if (shortage > 0) parts.push(`${formatExecutionQty(shortage)} short`);
  if ((input.missingBomCount ?? 0) > 0) parts.push(`${input.missingBomCount} BOM gap`);
  return parts.length ? parts.join(" · ") : `${lines} RM line${lines === 1 ? "" : "s"}`;
}

export function procurementCollapsedSummary(input: {
  steps?: Array<{ status?: string }>;
  summaryLabel?: string | null;
}): string {
  const label = String(input.summaryLabel ?? "").trim();
  if (label) return label;
  const steps = input.steps ?? [];
  const complete = steps.filter((s) => String(s.status ?? "").toUpperCase() === "COMPLETE").length;
  if (!steps.length) return "Procurement not started.";
  return `${complete}/${steps.length} steps complete`;
}

export function executionWoHistoryVisibleCount(total: number, expanded: boolean): number {
  if (expanded || total <= EXECUTION_WO_HISTORY_MAX_ROWS) return total;
  return EXECUTION_WO_HISTORY_MAX_ROWS;
}

export function isExecutionModeRequested(searchParams: Pick<URLSearchParams, "get">): boolean {
  if (searchParams.get("focus") !== "execution") return false;
  const raw = String(searchParams.get("sheetId") ?? "").trim();
  if (!/^\d{1,15}$/.test(raw)) return false;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0;
}

/** P10-A3F — Use execution-only page shell (hide planning chrome). */
export function shouldUseNoQtyExecutionModeShell(input: {
  executionModeRequested: boolean;
  isNoQty: boolean;
  soLoaded: boolean;
}): boolean {
  if (!input.executionModeRequested) return false;
  if (input.soLoaded && !input.isNoQty) return false;
  return true;
}

export function shouldRenderNoQtyExecutionWorkspace(input: {
  hasSheet: boolean;
  isNoQty: boolean;
  isLocked: boolean;
  showNoQtyEmptyCycleCreateWorkspace: boolean;
  canOpenRs: boolean;
}): boolean {
  return (
    input.hasSheet &&
    input.isNoQty &&
    input.isLocked &&
    !input.showNoQtyEmptyCycleCreateWorkspace &&
    input.canOpenRs
  );
}

/** Banner copy when viewing a locked RS from a cycle older than the SO active planning cycle. */
export function formatPriorCycleExecutionBanner(input: {
  viewingCycleNo: number | null | undefined;
  rsBalanceQty: number | null | undefined;
}): { title: string; detail: string } | null {
  const viewingCycleNo = input.viewingCycleNo;
  if (viewingCycleNo == null || !Number.isFinite(viewingCycleNo) || viewingCycleNo <= 0) {
    return null;
  }
  const balance =
    input.rsBalanceQty != null && Number.isFinite(input.rsBalanceQty)
      ? input.rsBalanceQty.toFixed(3).replace(/\.000$/, "")
      : null;
  return {
    title: `Cycle ${viewingCycleNo} (Previous Cycle) — Execution In Progress`,
    detail: balance
      ? `Open execution balance: ${balance}. A newer planning cycle does not stop WO placement here.`
      : "A newer planning cycle does not stop execution on this cycle.",
  };
}
