import * as React from "react";
import { cn } from "../../../lib/utils";
import { OperatorMainSplit } from "../OperatorWorkbench";

type Props = {
  left: React.ReactNode;
  right: React.ReactNode;
  className?: string;
  /** Reserve space below sticky chrome (back nav, alerts). */
  viewportOffsetClass?: string;
};

/**
 * P16-18F — NO_QTY production workbench fills one viewport; internal panels scroll.
 */
export function ProductionNoQtyViewportShell({
  left,
  right,
  className,
  viewportOffsetClass = "lg:h-[calc(100dvh-11.5rem)] lg:max-h-[calc(100dvh-11.5rem)]",
}: Props) {
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", viewportOffsetClass, className)}
      data-testid="production-no-qty-viewport-shell"
    >
      <OperatorMainSplit
        balancedWorkbench
        className="min-h-0 flex-1 items-stretch lg:items-stretch"
        queueClassName="flex h-full min-h-0 flex-col overflow-hidden"
        panelContainerClassName="flex h-full min-h-0 flex-col overflow-hidden"
        queue={left}
        panel={right}
      />
    </div>
  );
}
