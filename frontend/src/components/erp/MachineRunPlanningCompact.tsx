/**
 * Machine Run Planning — premium compact workspace pieces (layout only).
 * Uses shared ERP foundation tokens; no qty / workflow math.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CircleHelp } from "lucide-react";
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
  type ProductionPlanningMetrics,
} from "../../lib/regularSoProductionPlanning";
import { erpKpi, erpTable, erpTypography } from "../../lib/erpFoundationTokens";
import { displaySalesOrderNo } from "../../lib/docNoDisplay";

type SoOption = { id: number; docNo?: string | null };

type ContextStripProps = {
  soLabel: string;
  fgName: string | null;
  customerQty: number | null;
  plannedQty: number | null;
  bomRevision: string | null;
  statusLabel: string;
  statusTone?: "neutral" | "success" | "warning";
  rmLabel?: string | null;
  nextOwner: string;
  soChange?: React.ReactNode;
};

export function MachineRunPlanningContextStrip({
  soLabel,
  fgName,
  customerQty,
  plannedQty,
  bomRevision,
  statusLabel,
  statusTone = "neutral",
  rmLabel,
  nextOwner,
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
        "erp-card-surface flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2",
      )}
      data-testid="machine-planning-context-strip"
    >
      <span className={cn(erpTypography.sectionTitle, "tracking-tight")}>{soLabel}</span>
      {fgName ? (
        <ContextField label="FG item" value={fgName} />
      ) : null}
      {customerQty != null ? (
        <ContextField label="Customer Qty" value={String(customerQty)} tabular />
      ) : null}
      {plannedQty != null ? (
        <ContextField label="Planned Qty" value={String(plannedQty)} tabular />
      ) : null}
      <ContextField label="BOM revision" value={bomRevision || "—"} />
      <Badge variant={statusVariant} data-testid="machine-planning-status-badge">
        {statusLabel}
      </Badge>
      {rmLabel ? (
        <Badge variant={rmVariant} data-testid="machine-planning-rm-badge">
          {rmLabel}
        </Badge>
      ) : null}
      <ContextField label="Next Owner" value={nextOwner} />
      {soChange ? <div className="ml-auto shrink-0">{soChange}</div> : null}
    </div>
  );
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
    <span className="inline-flex min-w-0 flex-col gap-0.5">
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
        className="h-8"
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
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/80 px-3 py-2"
      data-testid="machine-planning-handoff-strip"
      role="status"
    >
      <Badge variant="success">Handed to Store</Badge>
      <span className={cn(erpTypography.tableBody, "text-emerald-900")}>
        Next Owner: <span className="font-semibold">{nextOwner}</span>
      </span>
      <span className={cn(erpTypography.tableBody, "text-emerald-900")}>
        RM: <span className="font-semibold">{rmState}</span>
      </span>
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
};

/** Symmetrical planning metrics — shared label baseline + equal value/control height. */
export function MachineRunPlanningQtyStrip({
  metrics,
  bufferPercentInput,
  onBufferPercentInputChange,
  disabled,
  readOnly,
}: QtyStripProps) {
  return (
    <div
      className={cn(erpKpi.strip, "erp-card-surface overflow-hidden rounded-md")}
      data-testid="machine-planning-qty-strip"
    >
      <MetricCell label="Customer Qty" value={String(metrics.customerCommittedQty)} />
      <div className={cn(erpKpi.segment, "gap-1")}>
        <label
          htmlFor="machine-planning-buffer-input"
          className={cn(erpTypography.helper, "flex items-center gap-1 font-semibold text-slate-600")}
        >
          Buffer %
          <span
            className="inline-flex text-slate-400"
            title="Production buffer above customer qty. Policy and admin approval rules apply when above soft max."
          >
            <CircleHelp className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">
              Production buffer above customer qty. Policy and admin approval rules apply when above soft max.
            </span>
          </span>
        </label>
        <div className="flex h-8 items-center">
          {readOnly || disabled ? (
            <span className="text-sm font-semibold tabular-nums text-slate-950">
              {bufferPercentInput || metrics.productionBufferPercent}
            </span>
          ) : (
            <DecimalInput
              id="machine-planning-buffer-input"
              className="h-8 w-[4.5rem] text-sm tabular-nums"
              value={bufferPercentInput}
              maxFractionDigits={REGULAR_SO_BUFFER_PERCENT_DECIMALS}
              onValueChange={onBufferPercentInputChange}
              data-testid="machine-planning-buffer-input"
            />
          )}
        </div>
      </div>
      <MetricCell label="Additional Qty" value={String(metrics.productionBufferQty)} />
      <MetricCell label="Planned Qty" value={String(metrics.plannedProductionQty)} emphasize />
      <MetricCell label="FG Stock Adjustment" value={String(metrics.fgStockAdjustmentQty)} />
    </div>
  );
}

function MetricCell({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className={cn(erpKpi.segment, "gap-1")} data-testid="machine-planning-metric-cell">
      <p className={cn(erpTypography.helper, "font-semibold text-slate-600")}>{label}</p>
      <p
        className={cn(
          "flex h-8 items-center text-sm tabular-nums text-slate-950",
          emphasize ? "font-bold" : "font-semibold",
        )}
      >
        {value}
      </p>
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
};

export function MachineRunCombinedRmSummary({
  rows,
  hasPendingMr,
  canCreateWorkOrder = false,
  purgingPlanning,
  plannedPurgeCount,
  productionRunCount,
}: CombinedRmProps) {
  const copy = resolvePurgingPlanningPanelCopy({
    purgingDetectionSource: purgingPlanning?.purgingDetectionSource,
    purgingDetectionLabel: purgingPlanning?.purgingDetectionLabel,
    productionRunCount,
  });
  const isLegacy = copy.isLegacy;
  const standardPerSetup = Number(purgingPlanning?.standardPurgingQtyGramsPerSetup ?? 0);
  const totalGrams =
    purgingPlanning?.totalPlannedPurgingGrams ??
    Math.round(standardPerSetup * Math.max(plannedPurgeCount, 0) * 1000) / 1000;

  return (
    <section
      className="rounded-md border border-slate-200/70 bg-white erp-card-surface"
      data-testid="machine-planning-combined-rm"
      aria-labelledby="machine-planning-rm-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/50 px-3 py-2">
        <h2 id="machine-planning-rm-title" className={erpTypography.sectionTitle}>
          RM Summary
        </h2>
        <div className={cn(erpTypography.helper, "flex flex-wrap gap-x-4 gap-y-1 text-slate-600")}>
          <span>
            Runs <span className="font-semibold tabular-nums text-slate-900">{productionRunCount || "—"}</span>
          </span>
          <span>
            Planned purge{" "}
            <span className="font-semibold tabular-nums text-slate-900">
              {isLegacy || productionRunCount <= 0 ? "—" : Math.max(0, plannedPurgeCount)}
            </span>
          </span>
          <span>
            Standard{" "}
            <span className="font-semibold tabular-nums text-slate-900">
              {formatPurgingGrams(standardPerSetup)}
            </span>
          </span>
          <span>
            Total purge{" "}
            <span className="font-semibold tabular-nums text-slate-900">
              {isLegacy || productionRunCount <= 0 ? "—" : formatPurgingGrams(totalGrams)}
            </span>
          </span>
        </div>
      </div>

      <div className="min-w-0 px-3 py-2">
        {!rows.length ? (
          <p className={erpTypography.helper}>No RM demand for current production quantities.</p>
        ) : (
          <div className={erpTable.wrap}>
            <table className={cn(erpTable.standard, "w-full min-w-[40rem]")}>
              <thead>
                <tr>
                  <th scope="col">RM item</th>
                  <th scope="col" className="text-right">
                    Production
                  </th>
                  <th scope="col" className="text-right">
                    Purging
                  </th>
                  <th scope="col" className="text-right">
                    Total
                  </th>
                  <th scope="col" className="text-right">
                    Available
                  </th>
                  <th scope="col" className="text-right">
                    Shortage
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody className={erpTypography.tableBody}>
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
                    <tr key={r.rmItemId}>
                      <td className="font-medium text-slate-900">{r.itemName}</td>
                      <td className={cn(erpTable.numericCell, "text-right")}>
                        {formatRmQty(production, r.unit)}
                      </td>
                      <td className={cn(erpTable.numericCell, "text-right")}>
                        {formatRmQty(purging, r.unit)}
                      </td>
                      <td className={cn(erpTable.numericCell, "text-right font-semibold")}>
                        {formatRmQty(total, r.unit)}
                      </td>
                      <td className={cn(erpTable.numericCell, "text-right")}>
                        {formatRmQty(r.availableQty, r.unit)}
                      </td>
                      <td className={cn(erpTable.numericCell, "text-right")}>
                        {formatRmQty(shortage, r.unit)}
                      </td>
                      <td>
                        <span
                          className={cn(
                            "inline-flex rounded px-1.5 py-0.5 text-xs font-semibold",
                            rmLineStatusChipClass(lineStatus),
                          )}
                        >
                          {lineStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

type ActionBarProps = {
  showEditActions: boolean;
  saving?: boolean;
  completing?: boolean;
  disabled?: boolean;
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
  onSaveDraft,
  onComplete,
  onBackNavigate,
}: ActionBarProps) {
  const busy = Boolean(saving || completing || disabled);
  return (
    <div
      className="erp-sticky-workflow-bar justify-end gap-2"
      data-testid="machine-planning-action-bar"
      role="toolbar"
      aria-label="Machine planning actions"
    >
      <Link
        to="/planning-dashboard"
        className={cn(buttonVariants({ variant: "ghost", size: "default" }), "no-underline")}
        data-testid="machine-planning-back-hub"
        onClick={(e) => {
          if (onBackNavigate && !onBackNavigate()) e.preventDefault();
        }}
      >
        <ArrowLeft className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
        Back to Planning Hub
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
            disabled={busy}
            onClick={onComplete}
            data-testid="machine-planning-complete"
          >
            {completing ? "Completing…" : "Complete Machine Planning"}
          </Button>
        </>
      ) : null}
    </div>
  );
}
