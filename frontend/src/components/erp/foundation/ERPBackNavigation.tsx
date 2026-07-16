import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  resolveERPBackTarget,
  type ERPBackNavigationKind,
  type ERPBackNavigationTarget,
} from "../../../lib/erpBackNavigation";
import type { ErpNavContext } from "../../../lib/erpNavContext";
import { useAuth } from "../../../hooks/useAuth";
import { useConfirmLeaveDirty } from "../../../contexts/DirtyFormContext";

export type ERPBackNavigationProps = {
  /** Explicit destination — bypasses context resolution. */
  to?: string;
  /** Full label (e.g. "Back to Dashboard"). When omitted, derived from context or defaultLabel. */
  label?: string;
  defaultTo?: string;
  defaultLabel?: string;
  kind?: ERPBackNavigationKind;
  navContext?: ErpNavContext | null;
  workflowSessionFallback?: boolean;
  workOrderId?: number;
  reportBack?: ERPBackNavigationTarget;
  className?: string;
  "data-testid"?: string;
};

/**
 * Global ERP back navigation — large, visible, context-aware.
 * Back button = navigation. Pair with ErpWorkflowTrail for workflow breadcrumbs below.
 */
export function ERPBackNavigation({
  to,
  label,
  defaultTo = "/dashboard",
  defaultLabel = "Back to Dashboard",
  kind = "generic",
  navContext = null,
  workflowSessionFallback = false,
  workOrderId,
  reportBack,
  className,
  "data-testid": dataTestId = "erp-back-navigation",
}: ERPBackNavigationProps) {
  const location = useLocation();
  const { user } = useAuth();
  const confirmLeave = useConfirmLeaveDirty();

  const target = React.useMemo(() => {
    if (to) {
      return { to, label: label?.trim() || defaultLabel };
    }
    return resolveERPBackTarget(location, {
      defaultTo,
      defaultLabel,
      navContext,
      kind,
      workflowSessionFallback,
      role: user?.role,
      workOrderId,
      reportBack,
    });
  }, [
    to,
    label,
    location,
    defaultTo,
    defaultLabel,
    navContext,
    kind,
    workflowSessionFallback,
    user?.role,
    workOrderId,
    reportBack,
  ]);

  const displayLabel = label?.trim() || target.label;

  return (
    <Link
      to={target.to}
      className={cn("erp-back-nav-primary", className)}
      data-testid={dataTestId}
      onClick={(e) => {
        if (!confirmLeave()) e.preventDefault();
      }}
    >
      <ArrowLeft className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
      <span>{displayLabel}</span>
    </Link>
  );
}
