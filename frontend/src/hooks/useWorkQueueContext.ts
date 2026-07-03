import * as React from "react";
import { useLocation } from "react-router-dom";
import {
  readWorkQueueFromLocationState,
  remainingWorkQueueCount,
  workQueuePositionLabel,
  type WorkQueueContext,
} from "../lib/workQueueContext";

export function useWorkQueueContext(): {
  workQueue: WorkQueueContext | null;
  isPendingActionsQueue: boolean;
  positionLabel: string | null;
  remainingAfterCurrent: number;
} {
  const location = useLocation();
  const workQueue = React.useMemo(
    () => readWorkQueueFromLocationState(location.state),
    [location.state],
  );

  return {
    workQueue,
    isPendingActionsQueue: Boolean(workQueue?.returnToPendingActions),
    positionLabel: workQueue ? workQueuePositionLabel(workQueue) : null,
    remainingAfterCurrent: workQueue ? remainingWorkQueueCount(workQueue, true) : 0,
  };
}
