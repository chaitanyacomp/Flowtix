import * as React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

export type FlowStepStatus = "done" | "active" | "next" | "todo";

export type FlowStep = {
  label: string;
  to: string;
  /** When true, current path must match exactly to be active. */
  end?: boolean;
  /**
   * Optional state-driven status.
   * When provided for any step, the bar renders using these statuses (not URL matching).
   */
  status?: FlowStepStatus;
};

export function FlowStepBar({
  steps,
  className,
  dense = false,
  ariaLabel = "Process steps",
}: {
  steps: FlowStep[];
  className?: string;
  /** Tighter padding + typography for production-flow pages (Planning → QC). */
  dense?: boolean;
  ariaLabel?: string;
}) {
  const { pathname } = useLocation();
  const stateDriven = React.useMemo(() => steps.some((s) => s.status != null), [steps]);

  if (!steps.length) return null;

  return (
    <nav aria-label={ariaLabel} className={cn("overflow-x-auto", className)}>
      <ol
        className={cn(
          "flex min-w-max items-center rounded-md border border-slate-200 bg-white",
          dense ? "gap-1 px-1.5 py-1 text-xs" : "gap-1.5 px-2.5 py-1.5 text-sm",
        )}
      >
        {steps.map((s, idx) => {
          const activeByUrl = s.end ? pathname === s.to : pathname.startsWith(s.to);
          const st: FlowStepStatus | null = stateDriven ? (s.status ?? "todo") : null;
          const done = st === "done";
          const active = st === "active";
          const next = st === "next";
          return (
            <React.Fragment key={`${s.to}-${idx}`}>
              <li>
                <NavLink
                  to={s.to}
                  end={s.end === true}
                  className={({ isActive }) => {
                    const urlMatch = !stateDriven && (isActive || activeByUrl);
                    return cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors",
                      dense ? "px-1.5 py-0.5 text-xs" : "text-sm",
                      !stateDriven &&
                        urlMatch &&
                        "bg-sky-50 font-semibold text-sky-900 hover:bg-sky-100 hover:text-sky-950",
                      !stateDriven && !urlMatch && "font-normal text-slate-500 hover:bg-slate-50 hover:text-slate-800",
                      stateDriven && done && "bg-emerald-50 font-medium text-emerald-900 hover:bg-emerald-100",
                      stateDriven && active && "bg-sky-50 font-semibold text-sky-900 hover:bg-sky-100",
                      stateDriven && next && "bg-blue-50 font-semibold text-blue-900 ring-1 ring-blue-200 hover:bg-blue-100",
                      stateDriven && !done && !active && !next && "font-normal text-slate-500 hover:bg-slate-50 hover:text-slate-800",
                    );
                  }}
                >
                  {stateDriven && done ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
                  <span>{s.label}</span>
                </NavLink>
              </li>
              {idx < steps.length - 1 ? (
                <li className={cn("shrink-0 text-slate-300", dense ? "text-[11px]" : "text-xs")} aria-hidden>
                  →
                </li>
              ) : null}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

