/**
 * P10-A4J / P11-A16 — When to show RS Execution Workspace on Requirement Sheet page.
 * Locked NO_QTY sheets on any cycle; not during draft/create-empty workspace.
 * Execution is independent of which cycle is currently active for planning.
 */
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
