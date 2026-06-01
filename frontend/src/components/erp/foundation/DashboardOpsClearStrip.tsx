import { CheckCircle2 } from "lucide-react";
import { cn } from "../../../lib/utils";

export function dashboardClearStateCopy(role: string): { title: string; hint?: string } {
  switch (role) {
    case "STORE":
      return { title: "Queues clear — dispatch & billing", hint: "KPIs live" };
    case "PRODUCTION":
      return { title: "Operations clear — production & QA", hint: "No pending actions" };
    case "QA":
      return { title: "Queues clear — production QA", hint: "Batches & rework clear" };
    case "PURCHASE":
      return { title: "Queues clear — purchase ops", hint: "Procurement & bills quiet" };
    default:
      return { title: "Queues clear — operations", hint: "All pipelines quiet" };
  }
}

/** Slim operational status when actionable queues are empty. */
export function DashboardOpsClearStrip({ role, className }: { role: string; className?: string }) {
  const { title, hint } = dashboardClearStateCopy(role);
  return (
    <div className={cn("erp-dash-clear-strip", className)} role="status">
      <CheckCircle2 className="erp-dash-clear-strip__icon" aria-hidden />
      <span className="font-semibold text-emerald-950">{title}</span>
      {hint ? <span className="text-emerald-900/70">· {hint}</span> : null}
    </div>
  );
}
