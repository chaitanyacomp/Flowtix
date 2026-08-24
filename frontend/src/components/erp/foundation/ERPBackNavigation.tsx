import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
  /** Prefer history replace (avoids bouncing back into a cleared detail route). */
  replace?: boolean;
  /** Disable while a navigation is in flight (double-click guard). */
  disabled?: boolean;
  /**
   * When set, renders a button and calls this instead of Link navigation.
   * Use for clear-state-then-navigate flows (Production Workspace Back).
   */
  onNavigate?: (target: ERPBackNavigationTarget) => void;
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
  replace = false,
  disabled = false,
  onNavigate,
}: ERPBackNavigationProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirmLeave = useConfirmLeaveDirty();
  const navBusyRef = React.useRef(false);
  const [navBusy, setNavBusy] = React.useState(false);

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
  const isDisabled = disabled || navBusy;

  const runNavigate = React.useCallback(() => {
    if (isDisabled || navBusyRef.current) return;
    if (!confirmLeave()) return;
    navBusyRef.current = true;
    setNavBusy(true);
    try {
      if (onNavigate) {
        onNavigate(target);
      } else {
        navigate(target.to, { replace });
      }
    } finally {
      window.setTimeout(() => {
        navBusyRef.current = false;
        setNavBusy(false);
      }, 400);
    }
  }, [isDisabled, confirmLeave, onNavigate, target, navigate, replace]);

  const sharedClassName = cn(
    "erp-back-nav-primary",
    isDisabled && "pointer-events-none opacity-60",
    className,
  );

  if (onNavigate || replace) {
    return (
      <button
        type="button"
        className={sharedClassName}
        data-testid={dataTestId}
        aria-label={displayLabel}
        disabled={isDisabled}
        onClick={(e) => {
          e.preventDefault();
          runNavigate();
        }}
      >
        <ArrowLeft className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
        <span className="min-w-0 truncate">{displayLabel}</span>
      </button>
    );
  }

  return (
    <Link
      to={target.to}
      className={sharedClassName}
      data-testid={dataTestId}
      aria-label={displayLabel}
      onClick={(e) => {
        if (isDisabled || !confirmLeave()) {
          e.preventDefault();
          return;
        }
        if (navBusyRef.current) {
          e.preventDefault();
          return;
        }
        navBusyRef.current = true;
        setNavBusy(true);
        window.setTimeout(() => {
          navBusyRef.current = false;
          setNavBusy(false);
        }, 400);
      }}
    >
      <ArrowLeft className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
      <span className="min-w-0 truncate">{displayLabel}</span>
    </Link>
  );
}
