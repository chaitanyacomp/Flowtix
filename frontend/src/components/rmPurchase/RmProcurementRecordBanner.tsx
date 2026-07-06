import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ProcurementFlowLink } from "../../lib/procurementRelatedDocuments";
import type { ProcurementRecordSummary } from "../../lib/rmProcurementRecordDisplay";

type Props = {
  summary: ProcurementRecordSummary;
  className?: string;
};

function SummaryField({
  label,
  value,
  links,
}: {
  label: string;
  value: string;
  links?: ProcurementFlowLink[];
}) {
  return (
    <div className="flex min-w-[12rem] flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <dt className="w-[6.5rem] shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold text-slate-900">
        {links?.length ? (
          <span className="inline-flex flex-wrap items-center gap-x-1">
            {links.map((link, index) => (
              <React.Fragment key={`${link.displayNo}-${index}`}>
                {index > 0 ? <span className="text-slate-400">,</span> : null}
                {link.href ? (
                  <Link
                    to={link.href}
                    className="text-primary underline underline-offset-2"
                    data-testid={`rm-procurement-summary-grn-link-${index}`}
                  >
                    {link.displayNo}
                  </Link>
                ) : (
                  link.displayNo
                )}
              </React.Fragment>
            ))}
          </span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function FlowStepDetail({
  stepKey,
  detail,
  links,
}: {
  stepKey: string;
  detail: string;
  links?: ProcurementFlowLink[];
}) {
  if (stepKey === "grn" && links?.length) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1 font-bold tabular-nums text-slate-900">
        {links.map((link, index) => (
          <React.Fragment key={`${link.displayNo}-${index}`}>
            {index > 0 ? <span className="font-normal text-slate-400">,</span> : null}
            {link.href ? (
              <Link
                to={link.href}
                className="text-primary underline underline-offset-2"
                data-testid={`rm-procurement-flow-grn-link-${index}`}
              >
                {link.displayNo}
              </Link>
            ) : (
              link.displayNo
            )}
          </React.Fragment>
        ))}
      </span>
    );
  }

  if (stepKey === "po" && detail) {
    return <span className="font-bold tabular-nums text-slate-900">{detail}</span>;
  }

  if (!detail) return null;
  return <span className="font-bold tabular-nums text-slate-900">{detail}</span>;
}

export function RmProcurementRecordBanner({ summary, className }: Props) {
  return (
    <section
      className={cn("rm-po-no-print border-b border-emerald-200 bg-gradient-to-b from-emerald-50/90 to-white px-4 py-4 md:px-6", className)}
      data-testid="rm-procurement-record-banner"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-800">Procurement lifecycle</p>

      <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryField label="PO No." value={summary.poNo} />
        <SummaryField label="GRN No." value={summary.grnNos} links={summary.grnLinks} />
        <SummaryField label="GRN Date" value={summary.grnDate} />
        <SummaryField label="GRN Status" value={summary.grnStatus} />
        <SummaryField label="Supplier" value={summary.supplierName} />
      </dl>

      <div
        className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-emerald-200/80 bg-white/80 px-3 py-2.5"
        data-testid="rm-procurement-record-flow"
        aria-label="Procurement flow"
      >
        {summary.flowSteps.map((step, index) => (
          <React.Fragment key={step.key}>
            {index > 0 ? <ArrowRight className="h-4 w-4 shrink-0 text-emerald-600/70" aria-hidden /> : null}
            <div
              className={cn(
                "inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5 rounded-md border px-2.5 py-1.5 text-sm",
                step.complete
                  ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                  : "border-slate-200 bg-slate-50 text-slate-700",
              )}
              data-testid={`rm-procurement-flow-${step.key}`}
            >
              <span className="font-medium text-slate-600">{step.title}</span>
              <FlowStepDetail stepKey={step.key} detail={step.detail} links={step.links} />
            </div>
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}
