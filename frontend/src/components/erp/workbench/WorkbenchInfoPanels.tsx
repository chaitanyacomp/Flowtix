import * as React from "react";
import { cn } from "../../../lib/utils";

export type WorkbenchInfoPanel = {
  key: string;
  title: string;
  children: React.ReactNode;
  /** Start expanded */
  defaultOpen?: boolean;
};

export type WorkbenchInfoPanelsProps = {
  panels: WorkbenchInfoPanel[];
  className?: string;
};

/**
 * FT-PD-067 — Collapsible information panels (History, Audit, Coverage, etc.).
 */
export function WorkbenchInfoPanels({ panels, className }: WorkbenchInfoPanelsProps) {
  const visible = panels.filter((p) => p.children != null && p.children !== false);
  if (visible.length === 0) return null;

  return (
    <div className={cn("erp-workbench-info-panels space-y-1 print:hidden", className)} data-testid="workbench-info-panels">
      {visible.map((panel) => (
        <details
          key={panel.key}
          className="erp-workbench-info-panel rounded-md border border-slate-200/90 bg-slate-50/80"
          open={panel.defaultOpen}
        >
          <summary className="cursor-pointer select-none px-2.5 py-1.5 text-[12px] font-semibold text-slate-800">
            {panel.title}
          </summary>
          <div className="border-t border-slate-200/80 px-2.5 py-2">{panel.children}</div>
        </details>
      ))}
    </div>
  );
}
