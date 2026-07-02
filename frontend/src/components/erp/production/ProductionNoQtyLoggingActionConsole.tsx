import * as React from "react";
import { cn } from "../../../lib/utils";

/** Premium left-column shell for NO_QTY production logging. */
export function ProductionNoQtyLoggingActionConsole({
  children,
  className,
  enabled = true,
}: {
  children: React.ReactNode;
  className?: string;
  /** When false, renders children without the console chrome. */
  enabled?: boolean;
}) {
  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <section
      className={cn(
        "rounded-xl border border-slate-200/95 bg-white p-4 shadow-[0_4px_16px_0_rgb(15_23_42_/0.08)] ring-1 ring-slate-100",
        className,
      )}
      data-testid="production-no-qty-logging-console"
    >
      {children}
    </section>
  );
}
