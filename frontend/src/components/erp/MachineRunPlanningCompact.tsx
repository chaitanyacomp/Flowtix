/**
 * Machine Run Planning — premium compact workspace (layout only).
 * Uses shared ERP foundation tokens; no qty / workflow math changes.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CircleHelp, ChevronDown, ChevronRight } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import { Badge } from "../ui/badge";
import { DecimalInput } from "../ui/DecimalInput";
import { cn } from "../../lib/utils";
import { formatRmQty } from "../../lib/rmQtyDisplay";
import { formatPurgingGrams, type PurgingPlanningSummary } from "../../lib/woPlanningPurging";
import {
  rmLineDisplayStatus,
  rmLineStatusChipClass,
} from "../../lib/woPrepareWorkflowGuidance";
import { resolvePurgingPlanningPanelCopy } from "./WoPreparePurgingPlanningPanel";
import {
  REGULAR_SO_BUFFER_PERCENT_DECIMALS,
  REGULAR_SO_BUFFER_PERCENT_MAX,
  REGULAR_SO_BUFFER_PERCENT_SOFT_MAX,
  classifyRegularSoBufferPercent,
  formatRegularSoBufferPercentDisplay,
  type ProductionPlanningMetrics,
} from "../../lib/regularSoProductionPlanning";
import { erpTypography } from "../../lib/erpFoundationTokens";
import { displaySalesOrderNo } from "../../lib/docNoDisplay";
import { MULTI_SHIFT_CAPACITY_HELP } from "../../lib/woRunCapacityEstimate";

type SoOption = { id: number; docNo?: string | null };

type ContextStripProps = {
  soLabel: string;
  fgName: string | null;
  customerQty: number | null;
  plannedQty: number | null;
  statusLabel: string;
  statusTone?: "neutral" | "success" | "warning";
  rmLabel?: string | null;
  soChange?: React.ReactNode;
};

/** Slim header: SO · FG · Customer Qty · Planned Qty · RM · stage · Change SO. */
export function MachineRunPlanningContextStrip({
  soLabel,
  fgName,
  customerQty,
  plannedQty,
  statusLabel,
  statusTone = "neutral",
  rmLabel,
  soChange,
}: ContextStripProps) {
  const statusVariant =
    statusTone === "success" ? "success" : statusTone === "warning" ? "warning" : "default";
  const rmVariant =
    rmLabel === "RM Shortage" ? "rejected" : rmLabel === "Ready for WO" ? "success" : "info";

  return (
    <div
      className={cn(
        "rounded-md border border-slate-200/70 bg-white",
        "erp-card-surface flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5",
      )}
      data-testid="machine-planning-context-strip"
    >
      <span className={cn(erpTypography.sectionTitle, "tracking-tight")}>{soLabel}</span>
      {fgName ? <ContextField label="FG" value={fgName} /> : null}
      {customerQty != null ? (
        <ContextField label="Customer Qty" value={formatQty(customerQty)} tabular />
      ) : null}
      {plannedQty != null ? (
        <ContextField label="Planned Qty" value={formatQty(plannedQty)} tabular />
      ) : null}
      <Badge variant={statusVariant} data-testid="machine-planning-status-badge">
        {statusLabel}
      </Badge>
      {rmLabel ? (
        <Badge variant={rmVariant} data-testid="machine-planning-rm-badge">
          {rmLabel}
        </Badge>
      ) : null}
      {soChange ? <div className="ml-auto shrink-0">{soChange}</div> : null}
    </div>
  );
}

function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

function ContextField({
  label,
  value,
  tabular,
}: {
  label: string;
  value: string;
  tabular?: boolean;
}) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className={cn(erpTypography.helper, "font-medium text-slate-500")}>{label}</span>
      <span
        className={cn(
          erpTypography.tableBody,
          "font-semibold text-slate-900",
          tabular && "tabular-nums",
        )}
      >
        {value}
      </span>
    </span>
  );
}

type SoChangeProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSoId: number;
  orders: SoOption[];
  isDirty?: boolean;
  onSelectSo: (nextId: number) => void;
};

/** Toggleable Change SO control — Cancel / Escape / outside close; dirty confirm before switch. */
export function MachineRunPlanningSoChangeControl({
  open,
  onOpenChange,
  currentSoId,
  orders,
  isDirty,
  onSelectSo,
}: SoChangeProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const selectRef = React.useRef<HTMLSelectElement>(null);

  React.useEffect(() => {
    if (!open) return;
    selectRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, onOpenChange]);

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        onClick={() => onOpenChange(true)}
        data-testid="machine-planning-change-so"
      >
        Change SO
      </Button>
    );
  }

  return (
    <div
      ref={rootRef}
      className="flex flex-wrap items-center gap-2"
      data-testid="machine-planning-so-selector"
      role="group"
      aria-label="Change sales order"
    >
      <select
        ref={selectRef}
        className="erp-flow-filter-input h-8 min-w-[12rem] rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-900"
        value={currentSoId || ""}
        aria-label="Select sales order"
        onChange={(e) => {
          const next = Number(e.target.value);
          if (!next || next === currentSoId) {
            onOpenChange(false);
            return;
          }
          if (isDirty) {
            const ok = window.confirm(
              "You have unsaved machine planning changes. Switch sales order and discard them?",
            );
            if (!ok) {
              e.target.value = String(currentSoId);
              return;
            }
          }
          onSelectSo(next);
          onOpenChange(false);
        }}
      >
        {orders.map((o) => (
          <option key={o.id} value={o.id}>
            {displaySalesOrderNo(o.id, o.docNo ?? null)}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        onClick={() => onOpenChange(false)}
        data-testid="machine-planning-change-so-cancel"
      >
        Cancel
      </Button>
    </div>
  );
}

type HandoffStripProps = {
  nextOwner: string;
  rmState: string;
  canReopen: boolean;
  reopening?: boolean;
  onReopen?: () => void;
};

export function MachineRunPlanningHandoffStrip({
  nextOwner,
  rmState,
  canReopen,
  reopening,
  onReopen,
}: HandoffStripProps) {
  const ready = rmState === "Ready for WO" || rmState === "RM Available";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2",
        ready ? "border-emerald-200 bg-emerald-50/80" : "border-amber-200 bg-amber-50/80",
      )}
      data-testid="machine-planning-handoff-strip"
      role="status"
    >
      <Badge variant="success">Planning complete</Badge>
      <span className={cn(erpTypography.tableBody, ready ? "text-emerald-900" : "text-amber-950")}>
        Handed to <span className="font-semibold">{nextOwner}</span> for Work Order creation.
      </span>
      <Badge
        variant={rmState === "RM Shortage" ? "rejected" : ready ? "success" : "info"}
        data-testid="machine-planning-handoff-rm"
      >
        {rmState === "Ready for WO"
          ? "Ready for Work Order"
          : rmState === "RM Shortage"
            ? "RM shortage — Store action needed"
            : rmState}
      </Badge>
      {canReopen ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto h-8"
          disabled={reopening}
          onClick={onReopen}
          data-testid="reopen-machine-planning"
        >
          {reopening ? "Reopening…" : "Reopen Planning"}
        </Button>
      ) : null}
    </div>
  );
}

type QtyStripProps = {
  metrics: ProductionPlanningMetrics;
  bufferPercentInput: string;
  onBufferPercentInputChange: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  /** When true, allocated runs no longer match revised Planned Qty — reallocation required. */
  allocationStale?: boolean;
  bufferReason?: string;
  onBufferReasonChange?: (value: string) => void;
  bufferRequiresAdminApproval?: boolean;
  isAdmin?: boolean;
  allowStoreReasonEntry?: boolean;
  approvalStatus?: "none" | "pending" | "approved" | "rejected" | "stale";
  requestingApproval?: boolean;
  onRequestAdminApproval?: () => void;
};

/**
 * Production buffer — set only here (before machine allocation).
 * Collapsed when 0; compact editor on demand; summary + Edit when applied.
 * Customer/Planned live in the context strip. Add Machine Run stays the dominant action.
 */
export function MachineRunPlanningQtyStrip({
  metrics,
  bufferPercentInput,
  onBufferPercentInputChange,
  disabled,
  readOnly,
  allocationStale = false,
  bufferReason = "",
  onBufferReasonChange,
  bufferRequiresAdminApproval,
  isAdmin,
  allowStoreReasonEntry = false,
  approvalStatus = "none",
  requestingApproval = false,
  onRequestAdminApproval,
}: QtyStripProps) {
  const bufferPct = Number(bufferPercentInput) || Number(metrics.productionBufferPercent) || 0;
  const bufferQty = Number(metrics.productionBufferQty) || 0;
  const hasBuffer = Math.abs(bufferPct) > 0.0001 || Math.abs(bufferQty) > 0.0001;
  const [editing, setEditing] = React.useState(false);
  const locked = Boolean(readOnly || disabled);
  const showCompactEditor = !locked && editing;
  const band = classifyRegularSoBufferPercent(bufferPct);
  const showApprovalHint = bufferRequiresAdminApproval || band === "REQUIRES_ADMIN_APPROVAL";
  const reasonEditable = Boolean(isAdmin || allowStoreReasonEntry);

  React.useEffect(() => {
    if (locked) setEditing(false);
  }, [locked]);

  return (
    <div
      className="space-y-1.5 rounded-md border border-slate-200/70 bg-white px-3 py-2 erp-card-surface"
      data-testid="machine-planning-qty-strip"
    >
      {allocationStale ? (
        <p
          className="text-[11px] font-medium text-amber-900"
          data-testid="machine-planning-buffer-stale-banner"
          role="status"
        >
          Buffer changed Planned Qty — reallocate machine runs until allocated total matches.
        </p>
      ) : null}

      {!hasBuffer && !showCompactEditor && !locked ? (
        <button
          type="button"
          className={cn(
            erpTypography.helper,
            "font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline",
          )}
          onClick={() => setEditing(true)}
          data-testid="machine-planning-add-buffer"
        >
          + Add production buffer
        </button>
      ) : null}

      {hasBuffer && !showCompactEditor ? (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1"
          data-testid="machine-planning-buffer-summary"
        >
          <p className="text-sm text-slate-800">
            <span className="font-medium text-slate-600">Buffer</span>{" "}
            <span className="font-semibold tabular-nums text-slate-950">
              {formatRegularSoBufferPercentDisplay(bufferPct)}%
            </span>
            {Math.abs(bufferQty) > 0.0001 ? (
              <span className="text-slate-600"> (+{formatQty(bufferQty)} qty)</span>
            ) : null}
          </p>
          {!locked ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setEditing(true)}
              data-testid="machine-planning-edit-buffer"
            >
              Edit
            </Button>
          ) : null}
        </div>
      ) : null}

      {showCompactEditor ? (
        <div
          className="flex flex-wrap items-end gap-x-3 gap-y-2"
          data-testid="machine-planning-buffer-editor"
        >
          <div className="flex flex-col gap-1" data-testid="machine-planning-metric-cell">
            <label
              htmlFor="machine-planning-buffer-input"
              className={cn(erpTypography.helper, "flex items-center gap-1 font-medium text-slate-600")}
            >
              Production buffer
              <span
                className="inline-flex text-slate-400"
                title="Optional production buffer above customer qty. Policy and admin approval rules apply when above soft max."
              >
                <CircleHelp className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">
                  Optional production buffer above customer qty. Policy and admin approval rules apply
                  when above soft max.
                </span>
              </span>
            </label>
            <div className="flex h-8 items-center gap-1.5">
              <DecimalInput
                id="machine-planning-buffer-input"
                className="h-8 w-[4.5rem] text-sm tabular-nums"
                value={bufferPercentInput}
                maxFractionDigits={REGULAR_SO_BUFFER_PERCENT_DECIMALS}
                onValueChange={onBufferPercentInputChange}
                data-testid="machine-planning-buffer-input"
              />
              <span className={cn(erpTypography.helper, "text-slate-500")}>%</span>
            </div>
          </div>
          {Math.abs(bufferQty) > 0.0001 ? (
            <div className="flex flex-col gap-1" data-testid="machine-planning-buffer-qty">
              <p className={cn(erpTypography.helper, "font-medium text-slate-600")}>Buffer qty</p>
              <p className="flex h-8 items-center text-sm font-semibold tabular-nums text-slate-950">
                {formatQty(bufferQty)}
              </p>
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setEditing(false)}
            data-testid="machine-planning-buffer-done"
          >
            Done
          </Button>
        </div>
      ) : null}

      {showApprovalHint && (showCompactEditor || hasBuffer) ? (
        <div className="space-y-1.5 rounded border border-amber-200 bg-amber-50/80 px-2 py-1.5">
          <p className="text-[11px] font-medium text-amber-950">
            Buffer above {REGULAR_SO_BUFFER_PERCENT_SOFT_MAX}% requires a reason and Admin approval (max{" "}
            {REGULAR_SO_BUFFER_PERCENT_MAX}%).
          </p>
          {onBufferReasonChange ? (
            <textarea
              className="min-h-[2.5rem] w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-900"
              value={bufferReason}
              disabled={locked || !reasonEditable}
              onChange={(e) => onBufferReasonChange(e.target.value)}
              placeholder={
                isAdmin
                  ? "Required when buffer is above 5%"
                  : allowStoreReasonEntry
                    ? "Required — then request Admin approval"
                    : "Admin must enter a reason and apply buffer above 5%"
              }
              data-testid="machine-planning-buffer-reason"
            />
          ) : null}
          {approvalStatus === "pending" ? (
            <p className="text-[11px] font-semibold text-amber-900">Waiting for Admin approval.</p>
          ) : null}
          {!isAdmin && allowStoreReasonEntry && onRequestAdminApproval && approvalStatus !== "approved" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={locked || requestingApproval || !bufferReason.trim() || approvalStatus === "pending"}
              onClick={onRequestAdminApproval}
            >
              {requestingApproval ? "Requesting…" : "Request Admin Approval"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type RmRow = {
  rmItemId: number;
  itemName: string;
  unit?: string;
  requiredQty: number;
  productionRequiredQty?: number;
  purgingRequiredQty?: number;
  availableQty: number;
  shortage: number;
  shortageQty?: number;
  status?: "AVAILABLE" | "PARTIAL" | "SHORTAGE";
};

type CombinedRmProps = {
  rows: RmRow[];
  hasPendingMr: boolean;
  canCreateWorkOrder?: boolean;
  purgingPlanning: PurgingPlanningSummary | null | undefined;
  plannedPurgeCount: number;
  productionRunCount: number;
  overallRmLabel?: string | null;
};

export function MachineRunCombinedRmSummary({
  rows,
  hasPendingMr,
  canCreateWorkOrder = false,
  purgingPlanning,
  plannedPurgeCount,
  productionRunCount,
  overallRmLabel,
}: CombinedRmProps) {
  const [calcOpen, setCalcOpen] = React.useState(false);
  const copy = resolvePurgingPlanningPanelCopy({
    purgingDetectionSource: purgingPlanning?.purgingDetectionSource,
    purgingDetectionLabel: purgingPlanning?.purgingDetectionLabel,
    productionRunCount,
  });
  const isLegacy = copy.isLegacy;
  const awaitingPurge =
    productionRunCount <= 0 ||
    copy.helperText.includes("after machine runs are allocated") ||
    copy.helperText.includes("after machine allocation");
  const standardPerSetup = Number(purgingPlanning?.standardPurgingQtyGramsPerSetup ?? 0);
  const totalGrams =
    purgingPlanning?.totalPlannedPurgingGrams ??
    Math.round(standardPerSetup * Math.max(plannedPurgeCount, 0) * 1000) / 1000;

  const anyShortage = rows.some((r) => (Number(r.shortageQty ?? r.shortage) || 0) > 0.0001);
  const readinessLabel =
    overallRmLabel === "Ready for WO"
      ? "Ready for Work Order"
      : overallRmLabel === "RM Shortage" || anyShortage
        ? "Shortage"
        : overallRmLabel === "RM Available"
          ? "Ready"
          : anyShortage
            ? "Shortage"
            : "Ready";

  return (
    <section
      className="rounded-md border border-slate-200/70 bg-white erp-card-surface"
      data-testid="machine-planning-combined-rm"
      aria-labelledby="machine-planning-rm-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <h2 id="machine-planning-rm-title" className={erpTypography.sectionTitle}>
          Material Readiness
        </h2>
        <Badge
          variant={readinessLabel === "Shortage" ? "rejected" : "success"}
          data-testid="machine-planning-material-readiness-badge"
        >
          {readinessLabel}
        </Badge>
      </div>

      <div className="space-y-2 px-3 py-2">
        {!rows.length ? (
          <p className={erpTypography.helper}>No RM demand for current production quantities.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-600">
                  <th className="py-1.5 pr-2">RM</th>
                  <th className="py-1.5 pr-2 text-right">Required</th>
                  <th className="py-1.5 pr-2 text-right">Available</th>
                  <th className="py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const shortage = Number(r.shortageQty ?? r.shortage) || 0;
                  const production = Number(r.productionRequiredQty ?? r.requiredQty) || 0;
                  const purging = Number(r.purgingRequiredQty ?? 0) || 0;
                  const total = Number(r.requiredQty) || production + purging;
                  const lineStatus = rmLineDisplayStatus({
                    shortage,
                    available: Number(r.availableQty) || 0,
                    hasPendingMr,
                    canCreateWorkOrder,
                  });
                  return (
                    <tr key={r.rmItemId} className="border-b border-slate-50">
                      <td className="py-1.5 pr-2 font-medium text-slate-900">{r.itemName}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums font-semibold text-slate-900">
                        {formatRmQty(total, r.unit)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-slate-800">
                        {formatRmQty(r.availableQty, r.unit)}
                      </td>
                      <td className="py-1.5">
                        <span
                          className={cn(
                            "inline-flex rounded px-1.5 py-0.5 text-xs font-semibold",
                            rmLineStatusChipClass(lineStatus),
                          )}
                        >
                          {shortage > 0.0001 ? `Shortage ${formatRmQty(shortage, r.unit)}` : lineStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div
          className="rounded-md border border-slate-100 bg-slate-50/70 px-2.5 py-2"
          data-testid="machine-planning-purging-summary"
        >
          {awaitingPurge && !isLegacy ? (
            <p className={cn(erpTypography.helper, "text-slate-700")} data-testid="machine-planning-purging-awaiting">
              Purging will be calculated after machine allocation
            </p>
          ) : isLegacy ? (
            <p className={cn(erpTypography.helper, "text-slate-700")}>{copy.helperText}</p>
          ) : (
            <p className={cn(erpTypography.tableBody, "text-slate-800")}>
              Planned purging:{" "}
              <span className="font-semibold tabular-nums" data-testid="machine-planning-planned-purge">
                {formatPurgingGrams(totalGrams)}
              </span>
              {plannedPurgeCount > 0 ? (
                <span className="text-slate-600">
                  {" "}
                  · {Math.max(0, plannedPurgeCount)} purge
                  {plannedPurgeCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </p>
          )}

          {!awaitingPurge && !isLegacy ? (
            <button
              type="button"
              className={cn(
                erpTypography.helper,
                "mt-1.5 inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900",
              )}
              onClick={() => setCalcOpen((v) => !v)}
              data-testid="machine-planning-view-calculation"
              aria-expanded={calcOpen}
            >
              {calcOpen ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              )}
              View calculation
            </button>
          ) : null}

          {calcOpen && !awaitingPurge && !isLegacy ? (
            <dl
              className={cn(erpTypography.helper, "mt-1.5 grid gap-1 text-slate-600")}
              data-testid="machine-planning-calculation-detail"
            >
              <div className="flex justify-between gap-4">
                <dt>Standard per setup</dt>
                <dd className="tabular-nums font-medium text-slate-800">
                  {formatPurgingGrams(standardPerSetup)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Planned purge count</dt>
                <dd className="tabular-nums font-medium text-slate-800">{Math.max(0, plannedPurgeCount)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Total planned purge</dt>
                <dd className="tabular-nums font-medium text-slate-800">{formatPurgingGrams(totalGrams)}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Plain-language reason when Complete cannot run. */
export function machinePlanningCompleteDisabledReason(input: {
  runCount: number;
  allocationError: string | null | undefined;
  plannedQty: number;
  allocatedQty: number;
}): string | null {
  const planned = Number(input.plannedQty) || 0;
  const allocated = Number(input.allocatedQty) || 0;
  if (input.runCount < 1 && planned > 0) {
    return "Add a machine run and allocate the full planned quantity.";
  }
  if (input.allocationError) {
    const remaining = Math.round((planned - allocated) * 1000) / 1000;
    if (remaining > 0.001) {
      return `Allocate remaining ${formatQty(remaining)} to complete planning.`;
    }
    if (remaining < -0.001) {
      return `Allocated quantity exceeds planned qty by ${formatQty(Math.abs(remaining))}.`;
    }
    return "Finish machine allocation so allocated qty equals planned qty.";
  }
  return null;
}

type ActionBarProps = {
  showEditActions: boolean;
  saving?: boolean;
  completing?: boolean;
  disabled?: boolean;
  /** When set, Complete is disabled and the reason is shown. */
  completeDisabledReason?: string | null;
  onSaveDraft: () => void;
  onComplete: () => void;
  /** Return false to block navigation (dirty confirm). */
  onBackNavigate?: () => boolean;
};

export function MachineRunPlanningActionBar({
  showEditActions,
  saving,
  completing,
  disabled,
  completeDisabledReason,
  onSaveDraft,
  onComplete,
  onBackNavigate,
}: ActionBarProps) {
  const busy = Boolean(saving || completing || disabled);
  const completeBlocked = Boolean(completeDisabledReason);
  return (
    <div
      className="erp-sticky-workflow-bar flex-col items-stretch gap-1.5 sm:flex-row sm:items-center sm:justify-end"
      data-testid="machine-planning-action-bar"
      role="toolbar"
      aria-label="Machine planning actions"
    >
      {showEditActions && completeBlocked ? (
        <p
          className={cn(erpTypography.helper, "order-first w-full text-amber-800 sm:mr-auto sm:w-auto")}
          data-testid="machine-planning-complete-reason"
          role="status"
        >
          {completeDisabledReason}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link
          to="/planning-dashboard"
          className={cn(buttonVariants({ variant: "ghost", size: "default" }), "no-underline")}
          data-testid="machine-planning-back-hub"
          onClick={(e) => {
            if (onBackNavigate && !onBackNavigate()) e.preventDefault();
          }}
        >
          <ArrowLeft className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
          Back
        </Link>
        {showEditActions ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="default"
              disabled={busy}
              onClick={onSaveDraft}
              data-testid="machine-planning-save-draft"
            >
              {saving && !completing ? "Saving…" : "Save Draft"}
            </Button>
            <Button
              type="button"
              variant="default"
              size="default"
              disabled={busy || completeBlocked}
              onClick={onComplete}
              data-testid="machine-planning-complete"
              title={completeDisabledReason ?? undefined}
            >
              {completing ? "Completing…" : "Complete Machine Planning"}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Help title shared with allocation panel tooltip (not shown as body copy). */
export const MACHINE_RUN_TECHNICAL_HELP = MULTI_SHIFT_CAPACITY_HELP;
