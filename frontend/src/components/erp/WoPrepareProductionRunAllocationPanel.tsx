import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import type { FgProductionStandardRow } from "../../lib/fgProductionStandardApi";
import type { MachineRow } from "../../lib/machineApi";
import {
  deriveProductionRunCount,
  estimateRunDurationLabel,
  sumAllocatedQtyForFg,
  type ProductionRunDraft,
} from "../../lib/woProductionRunAllocation";
import {
  estimateRunCapacityContext,
  formatCompactCapacitySummary,
  formatExceedsOneShiftBadge,
  MULTI_SHIFT_CAPACITY_HELP,
} from "../../lib/woRunCapacityEstimate";
import { formatPurgingDetectionDisplay } from "../../lib/purgingDetectionDisplay";
import { erpTypography } from "../../lib/erpFoundationTokens";
import { CircleHelp } from "lucide-react";

type FgLine = {
  fgItemId: number;
  fgName: string;
  plannedQty: number;
};

type Props = {
  fgLines: FgLine[];
  runs: ProductionRunDraft[];
  onChange: (runs: ProductionRunDraft[]) => void;
  machines: MachineRow[];
  standards: FgProductionStandardRow[];
  shifts?: Array<{
    id: number;
    shiftCode: string;
    shiftName: string;
    isActive?: boolean;
    startTime?: string | null;
    endTime?: string | null;
    plannedBreakMinutes?: number | null;
  }>;
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
  error?: string | null;
  /** Clear blocked-state copy for STORE when Production/Admin has not saved allocations. */
  pendingActionMessage?: string | null;
  /** Dense Machine Run Planning capacity cells. */
  compactCapacity?: boolean;
};

function newClientKey() {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function machinesForFg(
  fgItemId: number,
  machines: MachineRow[] | null | undefined,
  standards: FgProductionStandardRow[] | null | undefined,
): MachineRow[] {
  const stds = Array.isArray(standards) ? standards : [];
  const machs = Array.isArray(machines) ? machines : [];
  const eligible = new Set(
    stds
      .filter((s) => s.isActive && s.itemId === fgItemId && s.machineIsActive !== false)
      .map((s) => s.machineId),
  );
  return machs.filter((m) => m.isActive && eligible.has(m.id));
}

function standardFor(
  fgItemId: number,
  machineId: number,
  standards: FgProductionStandardRow[] | null | undefined,
) {
  const stds = Array.isArray(standards) ? standards : [];
  return stds.find((s) => s.isActive && s.itemId === fgItemId && s.machineId === machineId) ?? null;
}

export function WoPrepareProductionRunAllocationPanel({
  fgLines,
  runs,
  onChange,
  machines,
  standards,
  shifts = [],
  readOnly,
  disabled,
  className,
  error,
  pendingActionMessage,
  compactCapacity = false,
}: Props) {
  const safeRuns = Array.isArray(runs) ? runs : [];
  const safeFgLines = Array.isArray(fgLines) ? fgLines : [];
  const safeMachines = Array.isArray(machines) ? machines : [];
  const safeStandards = Array.isArray(standards) ? standards : [];
  const runCount = deriveProductionRunCount(safeRuns);
  const purgeHints = safeRuns.filter((r) => r.purgingRequired === true).length;

  function updateRun(key: string, patch: Partial<ProductionRunDraft>) {
    if (readOnly || disabled) return;
    onChange(safeRuns.map((r) => (r.clientKey === key ? { ...r, ...patch } : r)));
  }

  function removeRun(key: string) {
    if (readOnly || disabled) return;
    onChange(safeRuns.filter((r) => r.clientKey !== key));
  }

  function addRun(fgItemId: number) {
    if (readOnly || disabled) return;
    const fgRuns = safeRuns.filter((r) => r.fgItemId === fgItemId);
    const nextSeq = fgRuns.reduce((m, r) => Math.max(m, r.runSequence), 0) + 1;
    const remaining = Math.max(
      0,
      (safeFgLines.find((f) => f.fgItemId === fgItemId)?.plannedQty ?? 0) -
        sumAllocatedQtyForFg(safeRuns, fgItemId),
    );
    const eligible = machinesForFg(fgItemId, safeMachines, safeStandards);
    onChange([
      ...safeRuns,
      {
        clientKey: newClientKey(),
        fgItemId,
        runSequence: nextSeq,
        machineId: eligible[0]?.id ?? 0,
        plannedQty: remaining > 0 ? remaining : 0,
        plannedDate: null,
        shiftId: null,
      },
    ]);
  }

  return (
    <section
      className={cn(
        compactCapacity
          ? "rounded-md border border-slate-200/70 bg-white erp-card-surface px-3 py-2.5"
          : "rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm",
        className,
      )}
      data-testid="wo-production-run-allocation-panel"
      aria-labelledby="wo-production-run-allocation-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <div className="min-w-0">
          <h2
            id="wo-production-run-allocation-title"
            className={compactCapacity ? erpTypography.sectionTitle : "text-[11px] font-bold uppercase tracking-wider text-slate-700"}
          >
            {compactCapacity ? "Machine Runs" : "Machine production runs"}
          </h2>
          {compactCapacity ? (
            <p className={cn(erpTypography.helper, "mt-0.5 flex items-center gap-1 text-slate-600")}>
              {MULTI_SHIFT_CAPACITY_HELP}
              <span title={MULTI_SHIFT_CAPACITY_HELP} className="inline-flex text-slate-400">
                <CircleHelp className="h-3.5 w-3.5" aria-hidden />
              </span>
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] text-slate-500">
              Allocate planned quantity to machines. A new run row is not automatically a physical setup or
              a material purge — those are detected separately.
            </p>
          )}
        </div>
        <div className="text-right">
          <p className={cn(erpTypography.helper, "font-semibold text-slate-600")}>
            Production run count
          </p>
          <p
            className={cn(erpTypography.sectionTitle, "tabular-nums")}
            data-testid="wo-production-run-count"
          >
            {runCount || "—"}
          </p>
          {purgeHints > 0 ? (
            <p className={cn(erpTypography.helper, "text-amber-700")} data-testid="wo-planned-purge-hint">
              {purgeHints} purge(s) detected (server confirms on save)
            </p>
          ) : null}
        </div>
      </div>

      {readOnly ? (
        <p className="mt-1.5 text-[11px] text-slate-500" data-testid="wo-run-allocation-readonly">
          View only — Admin or Production assigns machines.
        </p>
      ) : null}

      {pendingActionMessage ? (
        <div
          className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-950"
          data-testid="wo-machine-allocation-pending"
          role="status"
        >
          {pendingActionMessage}
        </div>
      ) : null}

      {error && !pendingActionMessage ? (
        <p className="mt-1.5 text-[11px] font-medium text-red-700" data-testid="wo-run-allocation-error">
          {error}
        </p>
      ) : null}

      <div className="mt-2 space-y-3">
        {safeFgLines.map((fg) => {
          const fgRuns = safeRuns
            .filter((r) => r.fgItemId === fg.fgItemId)
            .sort((a, b) => a.runSequence - b.runSequence);
          const allocated = sumAllocatedQtyForFg(safeRuns, fg.fgItemId);
          const qtyMismatch = Math.abs(allocated - fg.plannedQty) > 0.001;
          const eligibleMachines = machinesForFg(fg.fgItemId, safeMachines, safeStandards);

          return (
            <div key={fg.fgItemId} className="rounded-md border border-slate-100 bg-slate-50/60 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-900">
                  {fg.fgName}
                  <span className="ml-2 font-medium text-slate-600">
                    Planned WO qty{" "}
                    <span className="tabular-nums text-slate-900">{fg.plannedQty}</span>
                  </span>
                </div>
                <div
                  className={cn(
                    "text-[11px] tabular-nums",
                    qtyMismatch ? "font-semibold text-red-700" : "text-slate-600",
                  )}
                >
                  Allocated {allocated}
                  {qtyMismatch ? " · must equal planned qty" : ""}
                </div>
              </div>

              <div className="mt-1.5 overflow-x-auto">
                <table className={cn("w-full border-collapse", compactCapacity ? "min-w-[48rem] text-sm" : "min-w-[40rem] text-xs")}>
                  <thead>
                    <tr className="border-b border-slate-200 text-left font-semibold tracking-wide text-slate-600">
                      <th className={cn("py-1.5 pr-2", compactCapacity ? "text-xs" : "text-[10px] uppercase")}>Seq</th>
                      <th className={cn("py-1.5 pr-2", compactCapacity ? "text-xs" : "text-[10px] uppercase")}>Machine</th>
                      <th className={cn("py-1.5 pr-2 text-right", compactCapacity ? "text-xs" : "text-[10px] uppercase")}>
                        Planned Qty
                      </th>
                      <th className={cn("py-1.5 pr-2", compactCapacity ? "text-xs" : "text-[10px] uppercase")}>
                        Start date
                      </th>
                      <th className={cn("py-1.5 pr-2", compactCapacity ? "text-xs" : "text-[10px] uppercase")}>Shift</th>
                      <th className={cn("py-1.5 pr-2", compactCapacity ? "text-xs" : "text-[10px] uppercase")}>
                        Cycle / Capacity
                      </th>
                      <th className={cn("py-1.5 pr-2", compactCapacity ? "text-xs" : "text-[10px] uppercase")}>
                        Duration / Shifts
                      </th>
                      <th className={cn("py-1.5 pr-2", compactCapacity ? "text-xs" : "text-[10px] uppercase")}>
                        Purge status
                      </th>
                      {!readOnly ? <th className="py-1.5" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {fgRuns.length === 0 ? (
                      <tr>
                        <td colSpan={readOnly ? 8 : 9} className="py-2 text-slate-500">
                          No production runs yet.
                        </td>
                      </tr>
                    ) : (
                      fgRuns.map((run) => {
                        const std = standardFor(run.fgItemId, run.machineId, safeStandards);
                        const shiftRow = shifts.find((s) => s.id === run.shiftId) ?? null;
                        const capacity = estimateRunCapacityContext({
                          plannedQty: run.plannedQty,
                          cycleTimeSeconds: std?.cycleTimeSeconds,
                          piecesPerCycle: std?.piecesPerCycle,
                          standardEfficiencyPercent: std?.standardEfficiencyPercent,
                          shift: shiftRow,
                          plannedDate: run.plannedDate,
                        });
                        const duration =
                          capacity.estimatedDurationLabel ??
                          estimateRunDurationLabel({
                            plannedQty: run.plannedQty,
                            cycleTimeSeconds: std?.cycleTimeSeconds,
                            piecesPerCycle: std?.piecesPerCycle,
                            standardEfficiencyPercent: std?.standardEfficiencyPercent,
                          });
                        return (
                          <tr key={run.clientKey} className="border-b border-slate-100 text-slate-800">
                            <td className="py-1.5 pr-2 tabular-nums">{run.runSequence}</td>
                            <td className="py-1.5 pr-2">
                              {readOnly || disabled ? (
                                <span>
                                  {safeMachines.find((m) => m.id === run.machineId)?.machineName ??
                                    run.machineName ??
                                    `Machine #${run.machineId}`}
                                </span>
                              ) : (
                                <select
                                  className={cn(
                                    "h-8 w-full rounded border border-slate-300 bg-white px-1.5",
                                    compactCapacity ? "max-w-[16rem] text-sm" : "max-w-[12rem] text-xs",
                                  )}
                                  value={run.machineId || ""}
                                  onChange={(e) =>
                                    updateRun(run.clientKey, { machineId: Number(e.target.value) || 0 })
                                  }
                                  data-testid="wo-run-machine"
                                >
                                  <option value="">Select machine</option>
                                  {eligibleMachines.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.machineCode} — {m.machineName}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td className="py-1.5 pr-2 text-right">
                              {readOnly || disabled ? (
                                <span className="tabular-nums">{run.plannedQty}</span>
                              ) : (
                                <Input
                                  inputMode="decimal"
                                  className={cn(
                                    "ml-auto h-8 w-24 text-right tabular-nums",
                                    compactCapacity ? "text-sm" : "text-xs",
                                  )}
                                  value={String(run.plannedQty ?? "")}
                                  onChange={(e) => {
                                    const v = e.target.value.replace(/[^\d.]/g, "");
                                    updateRun(run.clientKey, { plannedQty: Number(v) || 0 });
                                  }}
                                  data-testid="wo-run-planned-qty"
                                />
                              )}
                            </td>
                            <td className="py-1.5 pr-2">
                              {readOnly || disabled ? (
                                <span>{run.plannedDate ?? "—"}</span>
                              ) : (
                                <Input
                                  type="date"
                                  className="h-8 w-[9.5rem] text-xs"
                                  value={run.plannedDate ?? ""}
                                  onChange={(e) =>
                                    updateRun(run.clientKey, {
                                      plannedDate: e.target.value || null,
                                    })
                                  }
                                />
                              )}
                            </td>
                            <td className="py-1.5 pr-2">
                              {readOnly || disabled || shifts.length === 0 ? (
                                <span>
                                  {shifts.find((s) => s.id === run.shiftId)?.shiftName ?? "—"}
                                </span>
                              ) : (
                                <select
                                  className="h-8 w-full max-w-[8rem] rounded border border-slate-300 bg-white px-1.5 text-xs"
                                  value={run.shiftId ?? ""}
                                  onChange={(e) =>
                                    updateRun(run.clientKey, {
                                      shiftId: e.target.value ? Number(e.target.value) : null,
                                    })
                                  }
                                >
                                  <option value="">—</option>
                                  {shifts
                                    .filter((s) => s.isActive !== false)
                                    .map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.shiftName}
                                      </option>
                                    ))}
                                </select>
                              )}
                            </td>
                            <td className={cn("py-1.5 pr-2 text-slate-600", compactCapacity ? "text-sm" : "text-[11px]")}>
                              {std
                                ? `${std.cycleTimeSeconds}s · ${std.piecesPerCycle}/cyc · ${std.standardEfficiencyPercent}%`
                                : "No FG–machine standard"}
                            </td>
                            <td className={cn("py-1.5 pr-2 text-slate-700", compactCapacity ? "text-sm" : "text-[11px]")} data-testid="wo-run-capacity">
                              {duration ? (
                                compactCapacity ? (
                                  <div className="flex flex-col items-start gap-1">
                                    <div
                                      className="tabular-nums font-semibold text-slate-900"
                                      title={
                                        [
                                          capacity.expectedCompletionLabel
                                            ? `Est. complete: ${capacity.expectedCompletionLabel}`
                                            : null,
                                          MULTI_SHIFT_CAPACITY_HELP,
                                        ]
                                          .filter(Boolean)
                                          .join("\n") || undefined
                                      }
                                    >
                                      {formatCompactCapacitySummary(capacity) ?? duration}
                                    </div>
                                    {formatExceedsOneShiftBadge(capacity) ? (
                                      <Badge
                                        variant="warning"
                                        density="compact"
                                        role="status"
                                        data-testid="wo-run-multi-shift-badge"
                                      >
                                        {formatExceedsOneShiftBadge(capacity)}
                                      </Badge>
                                    ) : null}
                                  </div>
                                ) : (
                                  <div className="space-y-0.5">
                                    <div className="tabular-nums font-medium">{duration}</div>
                                    {capacity.shiftDurationHours != null ? (
                                      <div className="text-[10px] text-slate-500">
                                        Shift ~{capacity.shiftDurationHours} h
                                        {capacity.estimatedShiftsRequired != null
                                          ? ` · ~${capacity.estimatedShiftsRequired} shift(s)`
                                          : ""}
                                      </div>
                                    ) : null}
                                    {capacity.expectedCompletionLabel ? (
                                      <div className="text-[10px] text-slate-500" title={capacity.expectedCompletionLabel}>
                                        Est. complete {capacity.expectedCompletionLabel.slice(0, 16)}…
                                      </div>
                                    ) : null}
                                    {capacity.warning ? (
                                      <div className="text-[10px] font-medium text-amber-800" role="status">
                                        {capacity.warning}
                                      </div>
                                    ) : null}
                                  </div>
                                )
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-1.5 pr-2" data-testid="wo-run-purge-detection">
                              {run.purgingDetectionStatus || run.purgingDetectionLabel ? (
                                (() => {
                                  const display = formatPurgingDetectionDisplay(run);
                                  return (
                                    <Badge
                                      variant={run.purgingRequired ? "warning" : "default"}
                                      density={compactCapacity ? "default" : "compact"}
                                      title={display.reason ?? undefined}
                                      className="max-w-[14rem] whitespace-normal"
                                    >
                                      {display.label}
                                    </Badge>
                                  );
                                })()
                              ) : (
                                <span className={cn(erpTypography.helper, "text-slate-400")}>Server on save</span>
                              )}
                            </td>
                            {!readOnly ? (
                              <td className="py-1.5">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="erp-soft-action h-8 px-2 text-sm text-red-700 hover:bg-red-50 hover:text-red-800"
                                  disabled={disabled}
                                  onClick={() => removeRun(run.clientKey)}
                                  data-testid="wo-run-remove"
                                >
                                  Remove
                                </Button>
                              </td>
                            ) : null}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {!readOnly ? (
                <div className="mt-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={disabled || eligibleMachines.length === 0}
                    onClick={() => addRun(fg.fgItemId)}
                    data-testid="wo-add-production-run"
                  >
                    Add run
                  </Button>
                  {eligibleMachines.length === 0 ? (
                    <span className="ml-2 text-[11px] text-amber-700">
                      No active FG Production Standard machines for this FG.
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
