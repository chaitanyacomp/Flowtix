import * as React from "react";
import { cn } from "../../../lib/utils";
import { PRODUCTION_OPERATOR_WORKBENCH_GRID } from "../../../lib/productionOperatorWorkbenchLayout";
import {
  ProductionOperatorIdentityBar,
  type ProductionOperatorIdentityBarProps,
} from "./ProductionOperatorIdentityBar";

type Props = {
  identity: ProductionOperatorIdentityBarProps;
  /** Alerts above entry (RM block, draft lock) — keep minimal */
  alerts?: React.ReactNode;
  /** Production entry form — left column primary */
  entry: React.ReactNode;
  /** Recent entries — right column (~35%) */
  recentPanel: React.ReactNode;
  /** Other open WOs — full-width bottom */
  bottomQueue?: React.ReactNode;
  /** Optional extension below queue (report panel, etc.) */
  afterQueue?: React.ReactNode;
  entryId?: string;
  className?: string;
};

/**
 * FT-PD-066 MES operator console — single cohesive workbench.
 * Header → 65/35 grid (entry | recent) → bottom queue.
 */
export function ProductionOperatorWorkbench({
  identity,
  alerts,
  entry,
  recentPanel,
  bottomQueue,
  afterQueue,
  entryId = "regular-production-entry",
  className,
}: Props) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-sm border border-slate-300 bg-[#f4f6f8] shadow-sm",
        className,
      )}
      data-testid="production-operator-workbench"
    >
      <ProductionOperatorIdentityBar {...identity} className="shrink-0 border-b-0" />

      <div className={cn(PRODUCTION_OPERATOR_WORKBENCH_GRID, "min-h-0 flex-1 items-stretch")}>
        <section
          id={entryId}
          className="flex min-h-0 min-w-0 flex-col border-b border-slate-200 bg-white lg:border-b-0 lg:border-r"
        >
          <div className="border-b border-slate-100 bg-slate-50/50 px-3 py-1">
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Production entry</h2>
          </div>
          <div className="min-h-0 flex-1 px-3 py-2">
            {alerts ? <div className="mb-2 space-y-1">{alerts}</div> : null}
            {entry}
          </div>
        </section>

        <aside
          className="flex min-h-0 min-w-0 flex-col border-b border-slate-200 bg-[#eef1f4] lg:border-b-0"
          data-testid="production-operator-recent-panel"
        >
          <div className="border-b border-slate-200/80 bg-slate-100/80 px-3 py-1">
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Recent entries</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-2">{recentPanel}</div>
        </aside>
      </div>

      {bottomQueue ? (
        <footer className="shrink-0 border-t border-slate-300 bg-white px-3 py-2">{bottomQueue}</footer>
      ) : null}
      {afterQueue ? <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-2">{afterQueue}</div> : null}
    </div>
  );
}
