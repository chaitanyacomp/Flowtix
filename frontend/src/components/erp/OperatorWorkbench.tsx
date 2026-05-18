import * as React from "react";
import { cn } from "../../lib/utils";

/** Compact gap between major operator blocks (above-fold focus). */
export const operatorGapClass = "gap-2";

/** 32px control height */
export const operatorInputClass = "h-8";

/** ~36px table row */
export const operatorTableRowClass = "h-9";

/** Tighter rows for operator QC / dispatch queues */
export const operatorTableRowCompactClass = "h-8";

/** QC cycle table — comfortable operator row height */
export const operatorTableRowQcClass = "min-h-[2.875rem]";

export function OperatorPageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col", operatorGapClass, className)}>{children}</div>;
}

export function OperatorPageTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold tracking-tight text-slate-900">{children}</h2>;
}

/** Top strip: selectors + metric badges + optional trailing actions */
export function OperatorTopBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-end", operatorGapClass, className)}>{children}</div>;
}

/** Left queue + right detail panel */
export function OperatorMainSplit({
  queue,
  panel,
  className,
  panelClassName,
  /** Override the outer panel container wrapper styles. */
  panelContainerClassName,
  /** When true, fixed-width dispatch/detail panel is the first column on large screens (queue on the right). */
  panelFirstOnLg,
  /**
   * ~43% queue / ~57% inspection — compact operator workstation (QC-style).
   * Default layout keeps a fixed-width second column for legacy pages.
   */
  balancedWorkbench,
  /** Override the `lg:grid-cols-[...]` template for non-balanced layouts. */
  lgGridClassName,
  queueClassName,
}: {
  queue: React.ReactNode;
  panel: React.ReactNode;
  className?: string;
  /** Optional panel wrapper classes (e.g. Production entry emphasis) without changing queue column. */
  panelClassName?: string;
  panelContainerClassName?: string;
  panelFirstOnLg?: boolean;
  balancedWorkbench?: boolean;
  lgGridClassName?: string;
  /** Muted queue column chrome (QC / dispatch line pickers). */
  queueClassName?: string;
}) {
  return (
    <div
      className={cn(
        balancedWorkbench
          ? "grid grid-cols-1 items-stretch gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-3"
          : cn(
              "grid grid-cols-1 items-start",
              lgGridClassName
                ? lgGridClassName
                : panelFirstOnLg
                  ? "lg:grid-cols-[minmax(280px,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(300px,24rem)_minmax(0,1fr)]"
                  : "lg:grid-cols-[minmax(0,1fr)_minmax(280px,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(300px,24rem)]",
            ),
        !balancedWorkbench && operatorGapClass,
        className,
      )}
    >
      <div
        className={cn(
          balancedWorkbench ? "order-1 min-h-0 min-w-0 lg:order-1" : "order-2 min-w-0",
          !balancedWorkbench && (panelFirstOnLg ? "lg:order-2" : "lg:order-1"),
          balancedWorkbench && "erp-op-queue-zone min-h-0 p-1.5",
          queueClassName,
        )}
      >
        {queue}
      </div>
      <div
        className={cn(
          balancedWorkbench ? "order-2 min-w-0 lg:order-2" : "order-1 min-w-0",
          panelContainerClassName ??
            (balancedWorkbench
              ? "erp-op-inspect-zone flex min-h-0 flex-col overflow-x-hidden overflow-y-visible lg:sticky lg:top-20 lg:z-[6] lg:max-h-[calc(100dvh-5.5rem)] lg:self-start lg:overflow-y-auto"
              : "rounded border border-slate-200 bg-white p-2 shadow-sm"),
          balancedWorkbench && "flex min-h-0 flex-col",
          !balancedWorkbench && (panelFirstOnLg ? "lg:order-1" : "lg:order-2"),
          panelClassName,
        )}
      >
        {panel}
      </div>
    </div>
  );
}

/** Inline metric (label 12px, value 14px bold) */
export function OperatorMetricBadge({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-w-[3rem] shrink-0 flex-col rounded border border-slate-200 bg-slate-50 px-1 py-0.5",
        className,
      )}
    >
      <span className="text-[12px] leading-tight text-slate-500">{label}</span>
      <span className="text-[14px] font-bold leading-tight tabular-nums text-slate-900">{value}</span>
    </div>
  );
}

const STATUS_STYLES = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-900",
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  blocked: "border-red-200 bg-red-50 text-red-900",
  done: "border-slate-200 bg-slate-100 text-slate-600",
} as const;

export type OperatorStatusKind = keyof typeof STATUS_STYLES;

export function OperatorStatusBadge({ kind, children }: { kind: OperatorStatusKind; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        STATUS_STYLES[kind],
      )}
    >
      {children}
    </span>
  );
}

export function operatorStatusRowClass(kind: OperatorStatusKind): string {
  switch (kind) {
    case "ready":
      return "bg-emerald-50/80";
    case "pending":
      return "bg-amber-50/60";
    case "blocked":
      return "bg-red-50/50";
    case "done":
      return "bg-slate-50";
    default:
      return "";
  }
}
