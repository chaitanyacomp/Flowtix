import { Link } from "react-router-dom";
import { Button, buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import type { WoPrepareBlockedCardModel } from "../../lib/woPrepareWorkflowGuidance";

type Props = {
  model: WoPrepareBlockedCardModel;
  onRefresh: () => void;
  refreshing?: boolean;
};

/** Compact operational strip — RM blocker with single primary CTA (max ~100px tall). */
export function WoPrepareWorkOrderBlockedCard({ model, onRefresh, refreshing }: Props) {
  return (
    <section
      className={cn(
        "flex max-h-[100px] flex-wrap items-center justify-between gap-2 overflow-hidden",
        "rounded-md border border-amber-300/90 bg-amber-50/70 px-2.5 py-2 shadow-sm ring-1 ring-amber-200/70",
      )}
      aria-label={model.title}
    >
      <div className="min-w-0 flex-1 leading-snug">
        <p className="text-[12px] font-bold text-slate-950">
          {model.currentStatus} · {model.owner}
        </p>
        <p className="line-clamp-2 text-[11px] text-slate-700">{model.reason}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <Link
          to={model.rmWorkspaceHref}
          className={cn(
            buttonVariants({ size: "sm" }),
            "h-8 bg-slate-900 px-3 text-[12px] font-semibold text-white shadow hover:bg-slate-800 no-underline",
          )}
          data-testid="wo-prepare-open-rm-workspace"
        >
          Open RM Control Center
        </Link>
        {model.showRefresh ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-[11px] font-semibold"
            disabled={refreshing}
            onClick={onRefresh}
            data-testid="wo-prepare-refresh-status"
          >
            {refreshing ? "…" : "Refresh"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
