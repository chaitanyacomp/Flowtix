import * as React from "react";
import { cn } from "../../../lib/utils";
import { dashboardWorkspaceHeadline } from "../../../lib/dashboardShell";
import { erpTypography } from "../../../lib/erpFoundationTokens";

export function DashboardWorkspaceHeader({
  role,
  className,
  trailing,
}: {
  role: string;
  className?: string;
  trailing?: React.ReactNode;
}) {
  const { title, subtitle } = dashboardWorkspaceHeadline(role);
  return (
    <header
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-200/80 pb-1.5",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className={cn(erpTypography.pageTitle, "text-[1.25rem] font-extrabold leading-tight tracking-tight")}>
          {title}
        </h1>
        <p className="mt-0.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-slate-600">{subtitle}</p>
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </header>
  );
}
