import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "../../../lib/utils";

export type DashboardControlColumnVariant = "operational" | "commercial";

export function DashboardControlColumn({
  variant,
  title,
  subtitle,
  compact,
  children,
  className,
  footer,
  "aria-label": ariaLabel,
}: {
  variant: DashboardControlColumnVariant;
  title: string;
  subtitle?: string;
  /** Tighter header and body — commercial / operational action panels. */
  compact?: boolean;
  children: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
  "aria-label"?: string;
}) {
  const isOps = variant === "operational";
  return (
    <section
      aria-label={ariaLabel ?? title}
      className={cn(
        "erp-dash-control-col flex flex-col rounded-lg border shadow-sm",
        compact
          ? isOps
            ? "border-slate-200/80 bg-white ring-1 ring-slate-900/[0.04] border-l-[3px] border-l-blue-700"
            : "border-slate-200/70 bg-slate-50/50 ring-1 ring-slate-900/[0.02]"
          : isOps
            ? "border-slate-300/95 bg-white ring-1 ring-slate-900/[0.05] border-l-[4px] border-l-blue-700"
            : "border-slate-200/90 bg-gradient-to-b from-slate-50/95 to-white/90 ring-1 ring-slate-900/[0.03]",
        className,
      )}
    >
      <header
        className={cn(
          "shrink-0 border-b border-slate-200/70",
          compact ? "bg-transparent px-2 py-1" : "bg-slate-50/40 px-2.5 py-1.5",
        )}
      >
        <div className="flex items-center gap-1.5">
          {!compact ? (
            <span
              className={cn(
                "inline-flex h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_2px_rgba(255,255,255,1)]",
                isOps ? "bg-emerald-500 ring-1 ring-emerald-600/25" : "bg-violet-500 ring-1 ring-violet-600/20",
              )}
              aria-hidden
            />
          ) : null}
          <h2
            className={cn(
              "font-extrabold leading-tight tracking-tight text-slate-950",
              compact ? "text-[13px]" : "text-[15px]",
            )}
          >
            {title}
          </h2>
        </div>
        {subtitle ? (
          <p className={cn("mt-0.5 font-medium leading-snug text-slate-600", compact ? "text-[11px]" : "pl-4 text-[12px]")}>
            {subtitle}
          </p>
        ) : null}
      </header>
      <div className={cn("erp-dash-control-col__body space-y-1", compact ? "p-1" : "p-1.5 md:p-2")}>
        {children}
      </div>
      {footer ? (
        <footer className={cn("shrink-0 border-t border-slate-200/60", compact ? "px-2 py-0.5" : "px-2 py-1")}>
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

export function DashboardViewAllLink({ href, label = "View all" }: { href: string; label?: string }) {
  return (
    <Link
      to={href}
      state={{ from: "dashboard" }}
      className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-blue-800 no-underline hover:text-blue-950 hover:underline"
    >
      {label}
      <span aria-hidden>→</span>
    </Link>
  );
}
