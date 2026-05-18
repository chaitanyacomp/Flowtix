import { Link } from "react-router-dom";
import { cn } from "../../../lib/utils";
import { dashboardShell } from "../../../lib/dashboardShell";

export type DashboardShortcut = {
  label: string;
  href: string;
};

/** Compact operational deep-links when queues are quiet — not training copy. */
export function DashboardRoleShortcuts({
  items,
  className,
}: {
  items: DashboardShortcut[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <nav className={cn("erp-dash-shortcuts", className)} aria-label="Quick open">
      {items.map((item) => (
        <Link key={item.href} to={item.href} state={{ from: "dashboard" }} className={dashboardShell.btnSecondary}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
