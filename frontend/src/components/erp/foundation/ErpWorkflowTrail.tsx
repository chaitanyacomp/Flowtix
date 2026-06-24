import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { ErpNavContext } from "../../../lib/erpNavContext";

export type ErpWorkflowTrailProps = {
  navContext: ErpNavContext;
  className?: string;
};

export function ErpWorkflowTrail({ navContext, className }: ErpWorkflowTrailProps) {
  const { parentHref, parentLabel, trail } = navContext;

  return (
    <div className={cn("min-w-0 space-y-1", className)} data-testid="erp-workflow-trail">
      <Link to={parentHref} className="erp-back-nav-chip">
        <ArrowLeft className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
        <span>Back to {parentLabel}</span>
      </Link>
      <nav
        aria-label="Workflow hierarchy"
        className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-snug text-slate-600"
        data-testid="erp-workflow-trail-breadcrumb"
      >
        {trail.map((item, idx) => {
          const isCurrent = idx === trail.length - 1;
          const clickable = Boolean(item.href) && !isCurrent;
          return (
            <React.Fragment key={`${item.label}-${idx}`}>
              {idx > 0 ? (
                <span className="text-slate-300" aria-hidden>
                  /
                </span>
              ) : null}
              {clickable ? (
                <Link to={item.href!} className="font-medium text-sky-900 no-underline hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span className={cn(isCurrent && "font-semibold text-slate-900")}>{item.label}</span>
              )}
            </React.Fragment>
          );
        })}
      </nav>
    </div>
  );
}
