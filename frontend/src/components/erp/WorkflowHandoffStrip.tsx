import { Link } from "react-router-dom";
import { Button, buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";

type Props = {
  tone?: "success" | "warning" | "neutral";
  variant?: "default" | "compact";
  headline: string;
  icon?: string;
  referenceLabel?: string;
  referenceValue?: string;
  mrLabel?: string;
  fgName?: string;
  owner: string;
  nextStep: string;
  primaryLabel: string;
  primaryHref: string;
  rmWaiting?: string[];
  secondaryLabel?: string;
  onSecondaryClick?: () => void;
};

const TONE = {
  success: "border-emerald-400 bg-emerald-50",
  warning: "border-amber-400 bg-amber-50",
  neutral: "border-slate-300 bg-slate-50",
} as const;

export function WorkflowHandoffStrip({
  tone = "success",
  variant = "default",
  headline,
  icon = "✅",
  referenceLabel,
  referenceValue,
  mrLabel,
  fgName,
  owner,
  nextStep,
  primaryLabel,
  primaryHref,
  rmWaiting,
  secondaryLabel,
  onSecondaryClick,
}: Props) {
  if (variant === "compact") {
    return (
      <section
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-2 shadow-sm",
          TONE[tone],
        )}
      >
        <p className="min-w-0 text-[13px] font-bold text-slate-950">
          {headline}
          {mrLabel ? <span className="ml-1 tabular-nums font-semibold text-slate-800">· {mrLabel}</span> : null}
        </p>
        <Link
          to={primaryHref}
          className={cn(
            buttonVariants({ size: "sm" }),
            "h-9 shrink-0 bg-slate-900 px-4 text-[12px] font-bold text-white no-underline hover:bg-slate-800",
          )}
        >
          {primaryLabel}
        </Link>
      </section>
    );
  }

  return (
    <section className={cn("rounded-lg border px-3 py-2.5 shadow-sm", TONE[tone])}>
      <p className="text-[15px] font-bold text-slate-950">
        {icon} {headline}
      </p>
      <div className="mt-2 space-y-1 text-sm text-slate-800">
        {referenceValue ? (
          <p>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
              {referenceLabel ?? "Reference"}
            </span>{" "}
            <span className="font-semibold text-slate-950">{referenceValue}</span>
            {fgName ? <span className="text-slate-700"> · FG: {fgName}</span> : null}
          </p>
        ) : null}
        {mrLabel ? (
          <p>
            <span className="font-semibold tabular-nums text-slate-950">{mrLabel}</span>
            <span className="text-slate-700"> created successfully.</span>
          </p>
        ) : null}
        {rmWaiting && rmWaiting.length > 0 ? (
          <div className="text-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">RM waiting</span>
            <ul className="mt-0.5 list-inside list-disc text-[13px]">
              {rmWaiting.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="mt-2 grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Next owner</span>
        <span className="font-semibold text-slate-950">{owner}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Next step</span>
        <span className="text-slate-800">{nextStep}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          to={primaryHref}
          className={cn(
            buttonVariants({ size: "default" }),
            "h-10 min-w-[11rem] justify-center bg-slate-900 px-5 text-sm font-bold text-white shadow hover:bg-slate-800 no-underline",
          )}
        >
          {primaryLabel}
        </Link>
        {secondaryLabel && onSecondaryClick ? (
          <Button type="button" variant="ghost" size="sm" className="h-9 text-[12px] font-semibold" onClick={onSecondaryClick}>
            {secondaryLabel}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
