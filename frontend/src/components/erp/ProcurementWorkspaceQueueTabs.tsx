import { cn } from "../../lib/utils";
import {
  emptyProcurementQueueCounts,
  PROCUREMENT_QUEUE_TABS,
  type ProcurementQueueCounts,
  type ProcurementQueueTabId,
} from "../../lib/procurementWorkspaceQueues";

type Props = {
  activeTab: ProcurementQueueTabId;
  counts?: ProcurementQueueCounts | null;
  onChange: (tabId: ProcurementQueueTabId) => void;
  disabled?: boolean;
};

export function ProcurementWorkspaceQueueTabs({ activeTab, counts, onChange, disabled }: Props) {
  const c = counts ?? emptyProcurementQueueCounts();

  return (
    <div
      className="flex flex-wrap gap-1 rounded-lg border border-violet-200/70 bg-violet-50/30 p-1"
      role="tablist"
      aria-label="Procurement demand class queues"
      data-testid="procurement-workspace-queue-tabs"
    >
      {PROCUREMENT_QUEUE_TABS.map((tab) => {
        const count = c[tab.countKey];
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            data-testid={`procurement-queue-tab-${tab.id}`}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-[11px] font-bold transition",
              active
                ? "bg-white text-violet-950 shadow-sm ring-1 ring-violet-200/80"
                : "text-slate-700 hover:bg-white/70 hover:text-slate-900",
              disabled && "cursor-not-allowed opacity-60",
            )}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            <span className={cn("ml-1 tabular-nums", active ? "text-violet-800" : "text-slate-500")}>
              ({count})
            </span>
          </button>
        );
      })}
    </div>
  );
}
