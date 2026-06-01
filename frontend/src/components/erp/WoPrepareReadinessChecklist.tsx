import { Check, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { WoPrepareReadinessItem } from "../../lib/woPrepareWorkflowGuidance";

type Props = {
  items: WoPrepareReadinessItem[];
};

export function WoPrepareReadinessChecklist({ items }: Props) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Operational Readiness</p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5 text-[12px]">
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                item.met ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700",
              )}
              aria-hidden
            >
              {item.met ? <Check className="h-3 w-3" strokeWidth={3} /> : <X className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span className={cn("font-medium", item.met ? "text-slate-800" : "text-slate-600")}>{item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
