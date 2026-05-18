import { CircleHelp } from "lucide-react";
import { Button } from "../../ui/button";
import { cn } from "../../../lib/utils";
import { dashboardShell } from "../../../lib/dashboardShell";

type DashboardWalkthroughHelpProps = {
  onRegular: () => void;
  onNoQty: () => void;
  className?: string;
};

/** Demo / admin sample flows — hidden behind a small help control (not onboarding chrome). */
export function DashboardWalkthroughHelp({ onRegular, onNoQty, className }: DashboardWalkthroughHelpProps) {
  return (
    <details className={cn("relative", className)}>
      <summary
        className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md border border-slate-200/80 bg-white text-slate-500 shadow-sm hover:bg-slate-50 [&::-webkit-details-marker]:hidden"
        aria-label="Sample workflow flows"
        title="Sample flows"
      >
        <CircleHelp className="h-3.5 w-3.5" aria-hidden />
      </summary>
      <div className="absolute right-0 z-10 mt-1 flex min-w-[10rem] flex-col gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-md">
        <Button
          type="button"
          size="sm"
          className={cn("h-7 justify-start px-2 text-[11px] font-semibold shadow-none", dashboardShell.btnPrimary)}
          onClick={onRegular}
        >
          Regular SO
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 justify-start px-2 text-[11px] font-medium shadow-none"
          onClick={onNoQty}
        >
          NO_QTY
        </Button>
      </div>
    </details>
  );
}
