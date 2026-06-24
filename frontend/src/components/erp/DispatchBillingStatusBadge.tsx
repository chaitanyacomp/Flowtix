import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import {
  deriveDispatchBillingStatus,
  dispatchBillingStatusLabel,
  dispatchBillingStatusTone,
  type DispatchBillingStatusInput,
} from "../../lib/dispatchBillingStatus";

const TONE_CLASS: Record<string, string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
  amber: "border-amber-200 bg-amber-50 text-amber-950",
  sky: "border-sky-200 bg-sky-50 text-sky-950",
  slate: "border-slate-200 bg-slate-50 text-slate-700",
};

export function DispatchBillingStatusBadge({
  row,
  className,
  compact,
}: {
  row: DispatchBillingStatusInput;
  className?: string;
  compact?: boolean;
}) {
  const status = deriveDispatchBillingStatus(row);
  const label = dispatchBillingStatusLabel(status);
  if (!label) return null;
  const tone = dispatchBillingStatusTone(status);
  return (
    <Badge
      variant="outline"
      className={cn(
        compact ? "text-[10px] font-semibold" : "text-[11px] font-semibold",
        TONE_CLASS[tone],
        className,
      )}
    >
      {label}
    </Badge>
  );
}
