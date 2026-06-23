/** Cycle id passed to NO_QTY flow-state API on Requirement Sheet page. */
export function resolveRequirementSheetFlowStateCycleId(args: {
  isNoQty: boolean;
  addRequirementIntent: boolean;
  activePlanningCycleId: number | null;
  sheetCycleId?: number | null;
}): number | null {
  if (!args.isNoQty) return null;
  if (args.addRequirementIntent && args.activePlanningCycleId != null) {
    const ac = Number(args.activePlanningCycleId);
    if (Number.isFinite(ac) && ac > 0) return ac;
  }
  const fromSheet = args.sheetCycleId != null ? Number(args.sheetCycleId) : NaN;
  if (Number.isFinite(fromSheet) && fromSheet > 0) return fromSheet;
  const ac = args.activePlanningCycleId != null ? Number(args.activePlanningCycleId) : NaN;
  if (Number.isFinite(ac) && ac > 0) return ac;
  return null;
}
