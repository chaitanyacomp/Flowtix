import * as React from "react";
import { cn } from "../../lib/utils";

/** Use around `CommercialWorkflowStrip` on quotation / sales-order screens for consistent rhythm. */
export const commercialWorkflowStripFramedClassName =
  "rounded-md border border-slate-200 bg-white px-2 py-1.5 shadow-sm text-[11px] sm:text-[12px]";

/**
 * Tighter variant for compact ERP workspace headers (enquiry / quotation transaction screens).
 * Smaller text + reduced vertical padding so the strip does not consume header height.
 */
export const commercialWorkflowStripDenseFramedClassName =
  "rounded-md border border-slate-200 bg-white px-1.5 py-0.5 shadow-sm text-[10px] sm:text-[11px]";

/** Commercial / sales stages only — do not mix with operational (Production, QC, etc.). */
export type CommercialWorkflowStage = "enquiry" | "feasibility" | "quotation" | "sales_order";

const STEPS: { key: CommercialWorkflowStage; label: string }[] = [
  { key: "enquiry", label: "Enquiry" },
  { key: "feasibility", label: "Feasibility" },
  { key: "quotation", label: "Quotation" },
  { key: "sales_order", label: "Sales Order" },
];

/**
 * Compact horizontal strip for the commercial pipeline.
 * Highlights the current stage only (not a full app menu).
 */
export function CommercialWorkflowStrip(props: {
  active: CommercialWorkflowStage;
  className?: string;
}) {
  const { active, className } = props;
  return (
    <nav
      aria-label="Commercial workflow"
      className={cn(
        "flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px] font-medium text-slate-500 sm:text-xs",
        className,
      )}
    >
      {STEPS.map((s, i) => {
        const isActive = s.key === active;
        return (
          <React.Fragment key={s.key}>
            {i > 0 ? (
              <span className="select-none text-slate-300" aria-hidden="true">
                →
              </span>
            ) : null}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 transition-colors",
                isActive
                  ? "bg-blue-100 font-semibold text-blue-900 ring-1 ring-blue-300/70 shadow-sm"
                  : "text-slate-500",
              )}
            >
              {s.label}
            </span>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
