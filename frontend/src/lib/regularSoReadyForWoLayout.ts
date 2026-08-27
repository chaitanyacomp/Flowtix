/**
 * Layout gate: REGULAR Prepare WO confirmation after machine planning completes.
 * Admin/Store Create Work Order path only — not Production compact machine-planning.
 */

export function shouldUseReadyForWoConfirmationLayout(input: {
  /** Production / intent=machine-planning compact workspace */
  useCompactMachinePlanning?: boolean;
  workflowState?: string | null;
  machinePlanningComplete?: boolean;
  machinePlanningKey?: string | null;
}): boolean {
  if (input.useCompactMachinePlanning) return false;
  const state = String(input.workflowState ?? "")
    .trim()
    .toUpperCase();
  if (state !== "READY_FOR_WO") return false;
  if (input.machinePlanningComplete) return true;
  const key = String(input.machinePlanningKey ?? "")
    .trim()
    .toUpperCase();
  return key === "MACHINE_PLANNING_COMPLETE";
}
