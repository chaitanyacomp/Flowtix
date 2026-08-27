/**
 * REGULAR Prepare Work Order — Ready-for-WO confirmation (Admin/Store).
 * Sticky top workflow toolbar + aligned compact read-only sections.
 * Layout only — no qty / purge / readiness math changes.
 */
import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ERPBackNavigation } from "./foundation/ERPBackNavigation";
import { cn } from "../../lib/utils";
import { erpTypography } from "../../lib/erpFoundationTokens";
import { formatRmQty } from "../../lib/rmQtyDisplay";
import { formatPurgingGrams, type PurgingPlanningSummary } from "../../lib/woPlanningPurging";
import {
  rmLineDisplayStatus,
  rmLineStatusChipClass,
} from "../../lib/woPrepareWorkflowGuidance";
import { resolvePurgingPlanningPanelCopy } from "./WoPreparePurgingPlanningPanel";
import { formatPurgingDetectionDisplay } from "../../lib/purgingDetectionDisplay";
import {
  estimateRunDurationLabel,
  type ProductionRunDraft,
} from "../../lib/woProductionRunAllocation";
import {
  estimateRunCapacityContext,
  formatCompactCapacitySummary,
} from "../../lib/woRunCapacityEstimate";
import type { FgProductionStandardRow } from "../../lib/fgProductionStandardApi";
import type { MachineRow } from "../../lib/machineApi";
import { formatErpDateDisplay } from "../../lib/erpDate";
import { REGULAR_TERMS } from "../../lib/flowTerminology";

/** Shared shell: identical width / horizontal edges for toolbar + all sections. */
export const READY_FOR_WO_SHELL_CLASS = "mx-auto w-full max-w-6xl";
/** 12px vertical rhythm between aligned blocks. */
export const READY_FOR_WO_STACK_CLASS = "space-y-3";

type ShiftOption = {
  id: number;
  shiftCode: string;
  shiftName: string;
  startTime?: string | null;
  endTime?: string | null;
  plannedBreakMinutes?: number | null;
};

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

export type RegularSoReadyForWoConfirmationProps = {
  soLabel: string;
  fgName: string | null;
  customerQty: number | null;
  /** Buffer qty — shown only when non-zero */
  bufferQty: number | null;
  plannedWoQty: number | null;
  rmReadyLabel?: string | null;
  soChange?: React.ReactNode;
  runs: ProductionRunDraft[];
  machines: MachineRow[];
  standards: FgProductionStandardRow[];
  shifts: ShiftOption[];
  rmRows: RmRow[];
  hasPendingMr: boolean;
  canCreateWorkOrderMaterial: boolean;
  purgingPlanning: PurgingPlanningSummary | null | undefined;
  plannedPurgeCount: number;
  productionRunCount: number;
  canCreateWoRole: boolean;
  createDisabled: boolean;
  creating: boolean;
  onCreateWorkOrder: () => void;
  backHref: string;
  backLabel?: string;
  handoffText?: string;
  className?: string;
};

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
    <span className="inline-flex min-w-0 items-baseline gap-1">
      <span className={cn(erpTypography.helper, "shrink-0 font-medium text-slate-500")}>{label}</span>
      <span
        className={cn(
          erpTypography.tableBody,
          "min-w-0 break-words font-semibold text-slate-900",
          tabular && "tabular-nums",
        )}
      >
        {value}
      </span>
    </span>
  );
}

function machineLabel(machines: MachineRow[], machineId: number): string {
  const m = machines.find((x) => x.id === machineId);
  if (!m) return machineId > 0 ? `Machine #${machineId}` : "—";
  const code = String(m.machineCode ?? "").trim();
  const name = String(m.machineName ?? "").trim();
  if (code && name && code !== name) return `${code} · ${name}`;
  return name || code || `Machine #${machineId}`;
}

/** Friendly shift name only — never expose internal SHIFT-* codes. */
function shiftLabel(shifts: ShiftOption[], shiftId: number | null | undefined): string {
  if (shiftId == null || shiftId === 0) return "—";
  const s = shifts.find((x) => x.id === shiftId);
  if (!s) return "—";
  const name = String(s.shiftName ?? "").trim();
  if (name) return name;
  const code = String(s.shiftCode ?? "").trim();
  if (code.startsWith("SHIFT-")) return code.slice("SHIFT-".length).replace(/_/g, " ") || "—";
  return code || "—";
}

export function RegularSoReadyForWoConfirmation({
  soLabel,
  fgName,
  customerQty,
  bufferQty,
  plannedWoQty,
  rmReadyLabel,
  soChange,
  runs,
  machines,
  standards,
  shifts,
  rmRows,
  hasPendingMr,
  canCreateWorkOrderMaterial,
  purgingPlanning,
  plannedPurgeCount,
  productionRunCount,
  canCreateWoRole,
  createDisabled,
  creating,
  onCreateWorkOrder,
  backHref,
  backLabel = REGULAR_TERMS.BACK_TO_SALES_ORDERS,
  handoffText = "Store or Admin must create the Work Order.",
  className,
}: RegularSoReadyForWoConfirmationProps) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [calcOpen, setCalcOpen] = React.useState(false);
  const showBuffer = bufferQty != null && Math.abs(Number(bufferQty)) > 1e-9;
  const rmBadge =
    rmReadyLabel === "RM Shortage"
      ? "Shortage"
      : rmReadyLabel === "Ready for WO" || rmReadyLabel === "RM Available"
        ? "RM Ready"
        : rmReadyLabel || "RM Ready";

  return (
    <div
      className={cn(READY_FOR_WO_SHELL_CLASS, READY_FOR_WO_STACK_CLASS, "pb-3", className)}
      data-testid="ready-for-wo-confirmation"
      data-ready-for-wo-layout="confirmation"
    >
      {/* Sticky top workflow toolbar — single Back / Change SO / Create */}
      <header
        className="erp-ready-for-wo-toolbar"
        data-testid="ready-for-wo-sticky-toolbar"
        role="toolbar"
        aria-label="Work Order confirmation"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:flex-nowrap">
          <div className="shrink-0" data-testid="ready-for-wo-top-nav">
            <ERPBackNavigation
              to={backHref}
              label={backLabel}
              data-testid="ready-for-wo-back"
              className="max-w-full"
            />
          </div>

          <div
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1"
            data-testid="ready-for-wo-toolbar-summary"
          >
            <span className={cn(erpTypography.sectionTitle, "tracking-tight")}>{soLabel}</span>
            {fgName ? <ContextField label="FG" value={fgName} /> : null}
            {customerQty != null ? (
              <ContextField label="Customer Qty" value={formatQty(customerQty)} tabular />
            ) : null}
            {showBuffer ? (
              <ContextField label="Buffer" value={formatQty(Number(bufferQty))} tabular />
            ) : null}
            {plannedWoQty != null ? (
              <ContextField label="Planned WO Qty" value={formatQty(plannedWoQty)} tabular />
            ) : null}
            <Badge variant="success" data-testid="ready-for-wo-rm-badge">
              {rmBadge}
            </Badge>
          </div>

          <div
            className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto"
            data-testid="ready-for-wo-toolbar-actions"
          >
            {soChange ? <div className="shrink-0">{soChange}</div> : null}
            {canCreateWoRole ? (
              <Button
                type="button"
                className="h-9 min-w-[10.5rem] shrink-0 bg-emerald-700 px-4 text-[13px] font-bold shadow hover:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2"
                disabled={createDisabled || creating}
                onClick={onCreateWorkOrder}
                data-testid="next-create-wo-btn"
              >
                {creating ? "Creating…" : "Create Work Order"}
              </Button>
            ) : (
              <p
                className="max-w-[16rem] text-right text-[12px] font-medium text-slate-700"
                data-testid="ready-for-wo-handoff-text"
              >
                {handoffText}
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Readiness banner — same shell width, compact single line */}
      <section
        className="erp-ready-for-wo-section border-emerald-300 bg-emerald-50/90 px-3 py-1.5"
        data-testid="ready-for-wo-primary-banner"
        role="status"
      >
        <p className="truncate text-[13px] font-semibold leading-snug text-emerald-950">
          Planning and material checks are complete.
        </p>
      </section>

      <MachineAllocationReadOnlySummary
        runs={runs}
        machines={machines}
        standards={standards}
        shifts={shifts}
        detailsOpen={detailsOpen}
        onToggleDetails={() => setDetailsOpen((v) => !v)}
      />

      <MaterialConfirmationSummary
        rows={rmRows}
        hasPendingMr={hasPendingMr}
        canCreateWorkOrder={canCreateWorkOrderMaterial}
        purgingPlanning={purgingPlanning}
        plannedPurgeCount={plannedPurgeCount}
        productionRunCount={productionRunCount}
        calcOpen={calcOpen}
        onToggleCalc={() => setCalcOpen((v) => !v)}
      />
    </div>
  );
}

function MachineAllocationReadOnlySummary({
  runs,
  machines,
  standards,
  shifts,
  detailsOpen,
  onToggleDetails,
}: {
  runs: ProductionRunDraft[];
  machines: MachineRow[];
  standards: FgProductionStandardRow[];
  shifts: ShiftOption[];
  detailsOpen: boolean;
  onToggleDetails: () => void;
}) {
  const safeRuns = Array.isArray(runs) ? runs : [];

  return (
    <section
      className="erp-ready-for-wo-section"
      data-testid="ready-for-wo-machine-summary"
      aria-labelledby="ready-for-wo-machine-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
        <h2 id="ready-for-wo-machine-title" className={erpTypography.sectionTitle}>
          Machine allocation
        </h2>
        <button
          type="button"
          className={cn(
            erpTypography.helper,
            "inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 focus-visible:ring-offset-2",
          )}
          onClick={onToggleDetails}
          aria-expanded={detailsOpen}
          data-testid="ready-for-wo-view-allocation-details"
        >
          {detailsOpen ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          )}
          View allocation details
        </button>
      </div>

      {!safeRuns.length ? (
        <p className={cn(erpTypography.helper, "px-3 py-1.5 text-slate-600")}>No machine runs allocated.</p>
      ) : (
        <div className="min-w-0 overflow-x-auto px-3 py-1.5">
          <table className="w-full min-w-0 border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-600">
                <th className="py-1 pr-2">Machine</th>
                <th className="py-1 pr-2 text-right">Allocated Qty</th>
                <th className="py-1 pr-2">Start Date</th>
                <th className="py-1 pr-2">Starting Shift</th>
                <th className="py-1 pr-2">Est. Duration / Shifts</th>
                <th className="py-1">Purge</th>
              </tr>
            </thead>
            <tbody>
              {safeRuns.map((run) => {
                const std =
                  standards.find(
                    (s) =>
                      s.isActive &&
                      s.itemId === run.fgItemId &&
                      s.machineId === run.machineId,
                  ) ?? null;
                const duration = estimateRunDurationLabel({
                  plannedQty: run.plannedQty,
                  cycleTimeSeconds: std?.cycleTimeSeconds,
                  piecesPerCycle: std?.piecesPerCycle,
                  standardEfficiencyPercent: std?.standardEfficiencyPercent,
                });
                const shiftRow = shifts.find((s) => s.id === run.shiftId) ?? null;
                const capacity = estimateRunCapacityContext({
                  plannedQty: run.plannedQty,
                  cycleTimeSeconds: std?.cycleTimeSeconds,
                  piecesPerCycle: std?.piecesPerCycle,
                  standardEfficiencyPercent: std?.standardEfficiencyPercent,
                  shift: shiftRow,
                  plannedDate: run.plannedDate,
                });
                const capacityLabel = formatCompactCapacitySummary(capacity);
                const purge = formatPurgingDetectionDisplay(run);
                const dateYmd = run.plannedDate ? String(run.plannedDate).slice(0, 10) : "";
                return (
                  <tr key={run.clientKey} className="border-b border-slate-50 align-top last:border-b-0">
                    <td className="max-w-[12rem] py-1 pr-2 font-medium text-slate-900">
                      <span className="break-words">{machineLabel(machines, run.machineId)}</span>
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums font-semibold text-slate-900">
                      {formatQty(Number(run.plannedQty) || 0)}
                    </td>
                    <td className="whitespace-nowrap py-1 pr-2 tabular-nums text-slate-800">
                      {dateYmd ? formatErpDateDisplay(dateYmd) : "—"}
                    </td>
                    <td className="max-w-[10rem] py-1 pr-2 text-slate-800">
                      <span className="break-words">{shiftLabel(shifts, run.shiftId)}</span>
                    </td>
                    <td className="max-w-[12rem] py-1 pr-2 text-slate-800">
                      <span className="break-words">{capacityLabel || duration || "—"}</span>
                    </td>
                    <td className="max-w-[10rem] py-1 text-slate-800">
                      <span className="break-words" title={purge.reason ?? undefined}>
                        {purge.label || "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detailsOpen && safeRuns.length > 0 ? (
        <div
          className="border-t border-slate-100 px-3 py-1.5"
          data-testid="ready-for-wo-allocation-details"
        >
          <ul className={cn(erpTypography.helper, "grid gap-1 text-slate-600")}>
            {safeRuns.map((run) => (
              <li key={`detail-${run.clientKey}`} className="break-words">
                Run {run.runSequence}: {machineLabel(machines, run.machineId)} · qty{" "}
                {formatQty(Number(run.plannedQty) || 0)}
                {run.plannedDate ? ` · start ${formatErpDateDisplay(String(run.plannedDate).slice(0, 10))}` : ""}
                {run.purgingDetectionReason
                  ? ` · ${String(run.purgingDetectionReason)}`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function MaterialConfirmationSummary({
  rows,
  hasPendingMr,
  canCreateWorkOrder,
  purgingPlanning,
  plannedPurgeCount,
  productionRunCount,
  calcOpen,
  onToggleCalc,
}: {
  rows: RmRow[];
  hasPendingMr: boolean;
  canCreateWorkOrder: boolean;
  purgingPlanning: PurgingPlanningSummary | null | undefined;
  plannedPurgeCount: number;
  productionRunCount: number;
  calcOpen: boolean;
  onToggleCalc: () => void;
}) {
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
  const showPurgingSplit = rows.some((r) => Number(r.purgingRequiredQty ?? 0) > 0);

  return (
    <section
      className="erp-ready-for-wo-section"
      data-testid="ready-for-wo-material-summary"
      aria-labelledby="ready-for-wo-material-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
        <h2 id="ready-for-wo-material-title" className={erpTypography.sectionTitle}>
          Material summary
        </h2>
      </div>

      <div className="space-y-1.5 px-3 py-1.5">
        {!rows.length ? (
          <p className={erpTypography.helper}>No RM demand for current production quantities.</p>
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-0 border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-600">
                  <th className="py-1 pr-2">RM item</th>
                  <th className="py-1 pr-2 text-right">Production Qty</th>
                  <th className="py-1 pr-2 text-right">Purging Qty</th>
                  <th className="py-1 pr-2 text-right">Total Required</th>
                  <th className="py-1 pr-2 text-right">Available</th>
                  <th className="py-1">Ready / Shortage</th>
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
                    <tr key={r.rmItemId} className="border-b border-slate-50 align-top last:border-b-0">
                      <td className="max-w-[14rem] py-1 pr-2 font-medium text-slate-900">
                        <span className="break-words">{r.itemName}</span>
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums text-slate-800">
                        {formatRmQty(production, r.unit)}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums text-slate-700">
                        {showPurgingSplit || purging > 0
                          ? formatRmQty(purging, r.unit)
                          : "—"}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums font-semibold text-slate-900">
                        {formatRmQty(total, r.unit)}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums text-slate-800">
                        {formatRmQty(r.availableQty, r.unit)}
                      </td>
                      <td className="py-1">
                        <span
                          className={cn(
                            "inline-flex break-words rounded px-1.5 py-0.5 text-xs font-semibold",
                            rmLineStatusChipClass(lineStatus),
                          )}
                        >
                          {shortage > 0.0001
                            ? `Shortage ${formatRmQty(shortage, r.unit)}`
                            : lineStatus === "Ready"
                              ? "Ready"
                              : lineStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!awaitingPurge && !isLegacy ? (
          <div className="rounded-md border border-slate-100 bg-slate-50/70 px-2.5 py-1.5">
            <p className={cn(erpTypography.tableBody, "text-slate-800")}>
              Planned purging:{" "}
              <span className="font-semibold tabular-nums">{formatPurgingGrams(totalGrams)}</span>
              {plannedPurgeCount > 0 ? (
                <span className="text-slate-600">
                  {" "}
                  · {Math.max(0, plannedPurgeCount)} purge
                  {plannedPurgeCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </p>
            <button
              type="button"
              className={cn(
                erpTypography.helper,
                "mt-1 inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 focus-visible:ring-offset-2",
              )}
              onClick={onToggleCalc}
              data-testid="ready-for-wo-view-calculation"
              aria-expanded={calcOpen}
            >
              {calcOpen ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              )}
              View calculation
            </button>
            {calcOpen ? (
              <dl
                className={cn(erpTypography.helper, "mt-1 grid gap-1 text-slate-600")}
                data-testid="ready-for-wo-calculation-detail"
              >
                <div className="flex justify-between gap-4">
                  <dt>Standard per setup</dt>
                  <dd className="tabular-nums font-medium text-slate-800">
                    {formatPurgingGrams(standardPerSetup)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Planned purge count</dt>
                  <dd className="tabular-nums font-medium text-slate-800">
                    {Math.max(0, plannedPurgeCount)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Total planned purge</dt>
                  <dd className="tabular-nums font-medium text-slate-800">
                    {formatPurgingGrams(totalGrams)}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
