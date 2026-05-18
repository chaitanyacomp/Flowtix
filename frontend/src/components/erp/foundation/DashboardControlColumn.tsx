import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "../../../lib/utils";

export type DashboardControlColumnVariant = "operational" | "commercial";

export function DashboardControlColumn({
  variant,
  title,
  subtitle,
  children,
  className,
  footer,
  "aria-label": ariaLabel,
}: {
  variant: DashboardControlColumnVariant;
  title: string;
  subtitle?: string;
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
        isOps
          ? "border-slate-300/95 bg-white ring-1 ring-slate-900/[0.05] border-l-[4px] border-l-blue-700"
          : "border-slate-200/90 bg-gradient-to-b from-slate-50/95 to-white/90 ring-1 ring-slate-900/[0.03]",
        className,
      )}
    >
      <header className="shrink-0 border-b border-slate-200/80 bg-slate-50/40 px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_2px_rgba(255,255,255,1)]",
              isOps ? "bg-emerald-500 ring-1 ring-emerald-600/25" : "bg-violet-500 ring-1 ring-violet-600/20",
            )}
            aria-hidden
          />
          <h2 className="text-[15px] font-extrabold leading-tight tracking-tight text-slate-950">{title}</h2>
        </div>
        {subtitle ? (
          <p className="mt-0.5 pl-4 text-[12px] font-medium leading-snug text-slate-600">{subtitle}</p>
        ) : null}
      </header>
      <div className="erp-dash-control-col__body space-y-1 p-1.5 md:p-2">
        {children}
      </div>
      {footer ? <footer className="shrink-0 border-t border-slate-200/70 px-2 py-1">{footer}</footer> : null}
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
