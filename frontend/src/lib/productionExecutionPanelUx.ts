/** @deprecated Import from productionCompletionUx instead. */
export {
  formatCarryForwardSuccessMessage,
  formatProductionExecutionFinishSuccessMessage,
  formatWaiveSuccessMessage,
  productionEntriesRefreshSignature,
  shouldOpenShortfallResolutionOnFinish,
  shouldShowProductionExecutionPanel,
  workOrderLinesMetricsSignature,
} from "./productionCompletionUx";

export { PAUSE_REASON_OPTIONS as BLOCK_REASON_OPTIONS } from "./productionCompletionUx";

export function canFinishProductionExecution(): boolean {
  return false;
}

export function formatExecutionQtySummary(): string {
  return "";
}
