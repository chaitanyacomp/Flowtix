import * as React from "react";
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
import {
  MACHINE_PLANNING_PAST_DATE_WARNING,
  canBackdateMachinePlanning,
  isPastMachinePlanningStartDate,
  machinePlanningDateInputMin,
  normalizePlanningYmd,
  runsHavePastStartDate,
} from "../../lib/machinePlanningBackdate";
import { erpTypography } from "../../lib/erpFoundationTokens";
import { CircleHelp } from "lucide-react";

type FgLine = {
  fgItemId: number;
  fgName: string;
  plannedQty: number;
};

type ShiftOption = {
  id: number;
  shiftCode: string;
  shiftName: string;
  isActive?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  plannedBreakMinutes?: number | null;
};

type Props = {
  fgLines: FgLine[];
  runs: ProductionRunDraft[];
  onChange: (runs: ProductionRunDraft[]) => void;
  machines: MachineRow[];
  standards: FgProductionStandardRow[];
  shifts?: ShiftOption[];
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
  error?: string | null;
  /** Clear blocked-state copy for STORE when Production/Admin has not saved allocations. */
  pendingActionMessage?: string | null;
  /** Dense Machine Run Planning capacity cells. */
  compactCapacity?: boolean;
  /** Actor role for Start Date backdate UX (server remains authoritative). */
  actorRole?: string | null;
  /** SO creation calendar day YYYY-MM-DD — earliest selectable when backdate allowed. */
  soCreatedYmd?: string | null;
  backdateReason?: string;
  onBackdateReasonChange?: (value: string) => void;
  /** Inline Start Date field validation (no page Retry / toast). */
  startDateError?: string | null;
};

type NextField = "machine" | "qty" | "date" | "shift";

type RunRowSharedProps = {
  run: ProductionRunDraft;
  eligibleMachines: MachineRow[];
  machines: MachineRow[];
  standards: FgProductionStandardRow[];
  shifts: ShiftOption[];
  readOnly?: boolean;
  disabled?: boolean;
  onUpdate: (key: string, patch: Partial<ProductionRunDraft>) => void;
  onRemove: (key: string) => void;
  dateInputMin?: string;
  allowPastDates?: boolean;
  startDateError?: string | null;
  highlightStartDate?: boolean;
  focusStartDate?: boolean;
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

function qtyFullyAllocated(allocated: number, plannedQty: number) {
  return Math.abs(allocated - plannedQty) <= 0.001;
}

function nextIncompleteField(run: ProductionRunDraft): NextField | null {
  if (!run.machineId) return "machine";
  if (!(Number(run.plannedQty) > 0)) return "qty";
  if (!run.plannedDate) return "date";
  if (run.shiftId == null) return "shift";
  return null;
}

function resolveNextFieldTarget(
  fgRuns: ProductionRunDraft[],
): { clientKey: string; field: NextField } | null {
  for (const run of fgRuns) {
    const field = nextIncompleteField(run);
    if (field) return { clientKey: run.clientKey, field };
  }
  return null;
}

function machinePlanningState(
  runCount: number,
  allocated: number,
  plannedQty: number,
): "no-runs" | "partial" | "fully-allocated" {
  if (runCount === 0) return "no-runs";
  if (qtyFullyAllocated(allocated, plannedQty) && plannedQty >= 0) return "fully-allocated";
  return "partial";
}

function ringClass(active: boolean) {
  return active ? "ring-2 ring-sky-500/70 ring-offset-1" : undefined;
}

function PurgeStatusCell({
  run,
  density,
}: {
  run: ProductionRunDraft;
  density: "default" | "compact";
}) {
  if (run.purgingDetectionStatus || run.purgingDetectionLabel) {
    const display = formatPurgingDetectionDisplay(run);
    return (
      <Badge
        variant={run.purgingRequired ? "warning" : "default"}
        density={density}
        title={display.reason ?? undefined}
        className="max-w-[14rem] whitespace-normal"
      >
        {display.label}
      </Badge>
    );
  }
  return <span className={cn(erpTypography.helper, "text-slate-400")}>Server on save</span>;
}

function ClassicCapacityCell({
  run,
  standards,
  shifts,
}: {
  run: ProductionRunDraft;
  standards: FgProductionStandardRow[];
  shifts: ShiftOption[];
}) {
  const std = standardFor(run.fgItemId, run.machineId, standards);
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

  if (!duration) return <td className="py-1.5 pr-2 text-[11px] text-slate-700" data-testid="wo-run-capacity">—</td>;

  return (
    <td className="py-1.5 pr-2 text-[11px] text-slate-700" data-testid="wo-run-capacity">
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
    </td>
  );
}

function CompactCapacityCell({
  run,
  standards,
  shifts,
}: {
  run: ProductionRunDraft;
  standards: FgProductionStandardRow[];
  shifts: ShiftOption[];
}) {
  const std = standardFor(run.fgItemId, run.machineId, standards);
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
    <td className="py-1.5 pr-2 text-sm text-slate-700" data-testid="wo-run-capacity">
      {duration ? (
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
        "—"
      )}
    </td>
  );
}

function StartDateCell({
  run,
  readOnly,
  disabled,
  onUpdate,
  dateInputMin,
  allowPastDates,
  inputClassName,
  nextAttr,
  startDateError,
  highlightStartDate,
  focusStartDate,
}: {
  run: ProductionRunDraft;
  readOnly?: boolean;
  disabled?: boolean;
  onUpdate: (key: string, patch: Partial<ProductionRunDraft>) => void;
  dateInputMin?: string;
  allowPastDates?: boolean;
  inputClassName?: string;
  nextAttr?: boolean;
  startDateError?: string | null;
  highlightStartDate?: boolean;
  focusStartDate?: boolean;
}) {
  const past = isPastMachinePlanningStartDate(run.plannedDate);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!focusStartDate || readOnly || disabled) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    try {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch {
      // ignore
    }
  }, [focusStartDate, readOnly, disabled, startDateError]);

  if (readOnly || disabled) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span>{run.plannedDate ?? "—"}</span>
        {past ? (
          <Badge
            variant="warning"
            density="compact"
            data-testid="machine-planning-backdated-badge"
          >
            Backdated
          </Badge>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Input
        ref={inputRef}
        id="machine-planning-start-date"
        type="date"
        className={cn(
          inputClassName ?? "h-8 w-[9.5rem] text-xs",
          highlightStartDate || startDateError
            ? "border-red-500 ring-2 ring-red-200 focus-visible:ring-red-300"
            : null,
        )}
        value={run.plannedDate ?? ""}
        min={dateInputMin}
        dateError={startDateError}
        dateErrorTestId="machine-planning-start-date-error"
        aria-invalid={startDateError ? true : undefined}
        onChange={(e) => {
          let next = e.target.value || null;
          if (next && !allowPastDates && dateInputMin && next < dateInputMin) {
            next = dateInputMin;
          }
          onUpdate(run.clientKey, { plannedDate: next });
        }}
        data-testid="wo-run-planned-date"
        data-invalid={startDateError ? "true" : undefined}
        data-next-field={nextAttr ? "true" : undefined}
      />
      {past ? (
        <Badge variant="warning" density="compact" data-testid="machine-planning-backdated-badge">
          Backdated
        </Badge>
      ) : null}
    </div>
  );
}

function ClassicRunRow({
  run,
  eligibleMachines,
  machines,
  standards,
  shifts,
  readOnly,
  disabled,
  onUpdate,
  onRemove,
  dateInputMin,
  allowPastDates,
  startDateError,
  highlightStartDate,
  focusStartDate,
}: RunRowSharedProps) {
  const std = standardFor(run.fgItemId, run.machineId, standards);
  return (
    <tr className="border-b border-slate-100 text-slate-800">
      <td className="py-1.5 pr-2 tabular-nums">{run.runSequence}</td>
      <td className="py-1.5 pr-2">
        {readOnly || disabled ? (
          <span>
            {machines.find((m) => m.id === run.machineId)?.machineName ??
              run.machineName ??
              `Machine #${run.machineId}`}
          </span>
        ) : (
          <select
            className="h-8 w-full max-w-[12rem] rounded border border-slate-300 bg-white px-1.5 text-xs"
            value={run.machineId || ""}
            onChange={(e) => onUpdate(run.clientKey, { machineId: Number(e.target.value) || 0 })}
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
            className="ml-auto h-8 w-24 text-right text-xs tabular-nums"
            value={String(run.plannedQty ?? "")}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d.]/g, "");
              onUpdate(run.clientKey, { plannedQty: Number(v) || 0 });
            }}
            data-testid="wo-run-planned-qty"
          />
        )}
      </td>
      <td className="py-1.5 pr-2">
        <StartDateCell
          run={run}
          readOnly={readOnly}
          disabled={disabled}
          onUpdate={onUpdate}
          dateInputMin={dateInputMin}
          allowPastDates={allowPastDates}
          startDateError={startDateError}
          highlightStartDate={highlightStartDate}
          focusStartDate={focusStartDate}
        />
      </td>
      <td className="py-1.5 pr-2">
        {readOnly || disabled || shifts.length === 0 ? (
          <span>{shifts.find((s) => s.id === run.shiftId)?.shiftName ?? "—"}</span>
        ) : (
          <select
            className="h-8 w-full max-w-[8rem] rounded border border-slate-300 bg-white px-1.5 text-xs"
            value={run.shiftId ?? ""}
            onChange={(e) =>
              onUpdate(run.clientKey, {
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
      <td className="py-1.5 pr-2 text-[11px] text-slate-600">
        {std
          ? `${std.cycleTimeSeconds}s · ${std.piecesPerCycle}/cyc · ${std.standardEfficiencyPercent}%`
          : "No FG–machine standard"}
      </td>
      <ClassicCapacityCell run={run} standards={standards} shifts={shifts} />
      <td className="py-1.5 pr-2" data-testid="wo-run-purge-detection">
        <PurgeStatusCell run={run} density="compact" />
      </td>
      {!readOnly ? (
        <td className="py-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="erp-soft-action h-8 px-2 text-sm text-red-700 hover:bg-red-50 hover:text-red-800"
            disabled={disabled}
            onClick={() => onRemove(run.clientKey)}
            data-testid="wo-run-remove"
          >
            Remove
          </Button>
        </td>
      ) : null}
    </tr>
  );
}

function CompactRunRow({
  run,
  eligibleMachines,
  machines,
  standards,
  shifts,
  readOnly,
  disabled,
  onUpdate,
  onRemove,
  nextField,
  dateInputMin,
  allowPastDates,
  startDateError,
  highlightStartDate,
  focusStartDate,
}: RunRowSharedProps & { nextField: NextField | null }) {
  const std = standardFor(run.fgItemId, run.machineId, standards);
  const isNext = (field: NextField) => nextField === field;

  return (
    <tr className="border-b border-slate-100 text-slate-800">
      <td className="py-1.5 pr-2 tabular-nums text-sm">{run.runSequence}</td>
      <td className="py-1.5 pr-2">
        {readOnly || disabled ? (
          <span>
            {machines.find((m) => m.id === run.machineId)?.machineName ??
              run.machineName ??
              `Machine #${run.machineId}`}
          </span>
        ) : (
          <select
            className={cn(
              "h-8 w-full max-w-[16rem] rounded border border-slate-300 bg-white px-1.5 text-sm",
              ringClass(isNext("machine")),
            )}
            value={run.machineId || ""}
            onChange={(e) => onUpdate(run.clientKey, { machineId: Number(e.target.value) || 0 })}
            data-testid="wo-run-machine"
            data-next-field={isNext("machine") ? "true" : undefined}
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
              "ml-auto h-8 w-24 text-right text-sm tabular-nums",
              ringClass(isNext("qty")),
            )}
            value={String(run.plannedQty ?? "")}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d.]/g, "");
              onUpdate(run.clientKey, { plannedQty: Number(v) || 0 });
            }}
            data-testid="wo-run-planned-qty"
            data-next-field={isNext("qty") ? "true" : undefined}
          />
        )}
      </td>
      <td className="py-1.5 pr-2">
        <StartDateCell
          run={run}
          readOnly={readOnly}
          disabled={disabled}
          onUpdate={onUpdate}
          dateInputMin={dateInputMin}
          allowPastDates={allowPastDates}
          inputClassName={cn("h-8 w-[9.5rem] text-xs", ringClass(isNext("date")))}
          nextAttr={isNext("date")}
          startDateError={startDateError}
          highlightStartDate={highlightStartDate}
          focusStartDate={focusStartDate}
        />
      </td>
      <td className="py-1.5 pr-2">
        {readOnly || disabled || shifts.length === 0 ? (
          <span>{shifts.find((s) => s.id === run.shiftId)?.shiftName ?? "—"}</span>
        ) : (
          <select
            className={cn(
              "h-8 w-full max-w-[8rem] rounded border border-slate-300 bg-white px-1.5 text-xs",
              ringClass(isNext("shift")),
            )}
            value={run.shiftId ?? ""}
            onChange={(e) =>
              onUpdate(run.clientKey, {
                shiftId: e.target.value ? Number(e.target.value) : null,
              })
            }
            data-next-field={isNext("shift") ? "true" : undefined}
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
      <td className="py-1.5 pr-2 text-sm text-slate-600">
        {std
          ? `${std.cycleTimeSeconds}s · ${std.piecesPerCycle}/cyc · ${std.standardEfficiencyPercent}%`
          : "No FG–machine standard"}
      </td>
      <CompactCapacityCell run={run} standards={standards} shifts={shifts} />
      <td className="py-1.5 pr-2" data-testid="wo-run-purge-detection">
        <PurgeStatusCell run={run} density="default" />
      </td>
      {!readOnly ? (
        <td className="py-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="erp-soft-action h-8 px-2 text-sm text-red-700 hover:bg-red-50 hover:text-red-800"
            disabled={disabled}
            onClick={() => onRemove(run.clientKey)}
            data-testid="wo-run-remove"
          >
            Remove
          </Button>
        </td>
      ) : null}
    </tr>
  );
}

function CompactMachineRunTask({
  fg,
  fgRuns,
  allocated,
  eligibleMachines,
  machines,
  standards,
  shifts,
  readOnly,
  disabled,
  onAdd,
  onUpdate,
  onRemove,
  showFgName,
  dateInputMin,
  allowPastDates,
  startDateErrorTargetKey,
  startDateError,
}: {
  fg: FgLine;
  fgRuns: ProductionRunDraft[];
  allocated: number;
  eligibleMachines: MachineRow[];
  machines: MachineRow[];
  standards: FgProductionStandardRow[];
  shifts: ShiftOption[];
  readOnly?: boolean;
  disabled?: boolean;
  onAdd: () => void;
  onUpdate: (key: string, patch: Partial<ProductionRunDraft>) => void;
  onRemove: (key: string) => void;
  showFgName: boolean;
  dateInputMin?: string;
  allowPastDates?: boolean;
  startDateErrorTargetKey?: string | null;
  startDateError?: string | null;
}) {
  const remaining = Math.max(0, Math.round((fg.plannedQty - allocated) * 1000) / 1000);
  const fullyAllocated = qtyFullyAllocated(allocated, fg.plannedQty);
  const state = machinePlanningState(fgRuns.length, allocated, fg.plannedQty);
  const nextTarget = resolveNextFieldTarget(fgRuns);
  const canAdd = !readOnly && !fullyAllocated;

  return (
    <div
      className="rounded-md border border-slate-100 bg-slate-50/60 p-2.5"
      data-testid="machine-planning-task-card"
      data-machine-planning-state={state}
    >
      {showFgName ? (
        <div className="mb-1.5 text-xs font-semibold text-slate-900">{fg.fgName}</div>
      ) : null}

      <p
        className={cn(
          erpTypography.kpiValue,
          "tabular-nums text-slate-900",
          !fullyAllocated && fgRuns.length > 0 ? "text-amber-900" : null,
          fullyAllocated ? "text-emerald-800" : null,
        )}
        data-testid="machine-planning-allocated-summary"
      >
        Allocated{" "}
        <span className="font-semibold">
          {allocated} / {fg.plannedQty}
        </span>
      </p>

      {fgRuns.length === 0 ? (
        <div className="mt-3 space-y-3" data-testid="machine-planning-empty-runs">
          <p className={cn(erpTypography.helper, "text-slate-600")}>No production runs yet.</p>
          {!readOnly ? (
            <div>
              <Button
                type="button"
                variant="default"
                size="default"
                className="h-9"
                disabled={disabled || eligibleMachines.length === 0}
                onClick={onAdd}
                data-testid="wo-add-production-run"
              >
                Add Machine Run
              </Button>
              {eligibleMachines.length === 0 ? (
                <span className="ml-2 text-[11px] text-amber-700">
                  No active FG Production Standard machines for this FG.
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <p
            className={cn(erpTypography.helper, "mt-1 tabular-nums text-slate-600")}
            data-testid="machine-planning-remaining-qty"
          >
            Remaining Qty{" "}
            <span className={cn("font-semibold", remaining > 0.001 ? "text-amber-800" : "text-slate-800")}>
              {remaining}
            </span>
            {remaining > 0.001 ? (
              <span className="ml-1 text-amber-900">· Allocate the remaining {remaining}</span>
            ) : null}
          </p>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold tracking-wide text-slate-600">
                  <th className="py-1.5 pr-2">Seq</th>
                  <th className="py-1.5 pr-2">Machine</th>
                  <th className="py-1.5 pr-2 text-right">Planned Qty</th>
                  <th className="py-1.5 pr-2">Start date</th>
                  <th className="py-1.5 pr-2">Shift</th>
                  <th className="py-1.5 pr-2">Cycle / Capacity</th>
                  <th className="py-1.5 pr-2">Duration / Shifts</th>
                  <th className="py-1.5 pr-2">Purge status</th>
                  {!readOnly ? <th className="py-1.5" /> : null}
                </tr>
              </thead>
              <tbody>
                {fgRuns.map((run) => (
                  <CompactRunRow
                    key={run.clientKey}
                    run={run}
                    eligibleMachines={eligibleMachines}
                    machines={machines}
                    standards={standards}
                    shifts={shifts}
                    readOnly={readOnly}
                    disabled={disabled}
                    onUpdate={onUpdate}
                    onRemove={onRemove}
                    dateInputMin={dateInputMin}
                    allowPastDates={allowPastDates}
                    startDateError={
                      startDateError && startDateErrorTargetKey === run.clientKey
                        ? startDateError
                        : null
                    }
                    highlightStartDate={Boolean(
                      startDateError && startDateErrorTargetKey === run.clientKey,
                    )}
                    focusStartDate={Boolean(
                      startDateError && startDateErrorTargetKey === run.clientKey,
                    )}
                    nextField={
                      nextTarget?.clientKey === run.clientKey ? nextTarget.field : null
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>

          {canAdd ? (
            <div className="mt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-sm"
                disabled={disabled || eligibleMachines.length === 0}
                onClick={onAdd}
                data-testid="wo-add-production-run"
              >
                Add Machine Run
              </Button>
              {eligibleMachines.length === 0 ? (
                <span className="ml-2 text-[11px] text-amber-700">
                  No active FG Production Standard machines for this FG.
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
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
  actorRole = null,
  soCreatedYmd = null,
  backdateReason = "",
  onBackdateReasonChange,
  startDateError = null,
}: Props) {
  const safeRuns = Array.isArray(runs) ? runs : [];
  const safeFgLines = Array.isArray(fgLines) ? fgLines : [];
  const safeMachines = Array.isArray(machines) ? machines : [];
  const safeStandards = Array.isArray(standards) ? standards : [];
  const runCount = deriveProductionRunCount(safeRuns);
  const purgeHints = safeRuns.filter((r) => r.purgingRequired === true).length;
  const allowPastDates = canBackdateMachinePlanning(actorRole);
  const dateInputMin = machinePlanningDateInputMin(actorRole, soCreatedYmd);
  const showPastWarning = !readOnly && runsHavePastStartDate(safeRuns);
  const floor = normalizePlanningYmd(soCreatedYmd);
  const startDateErrorTargetKey =
    startDateError
      ? (
          safeRuns.find((r) => {
            const ymd = normalizePlanningYmd(r.plannedDate);
            return Boolean(ymd && floor && ymd < floor);
          }) ?? safeRuns[0]
        )?.clientKey ?? null
      : null;

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

  if (compactCapacity) {
    return (
      <section
        className={cn(
          "rounded-md border border-slate-200/70 bg-white erp-card-surface px-3 py-2.5",
          className,
        )}
        data-testid="wo-production-run-allocation-panel"
        aria-labelledby="wo-production-run-allocation-title"
      >
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2">
          <div className="min-w-0">
            <h2
              id="wo-production-run-allocation-title"
              className={erpTypography.sectionTitle}
              data-testid="machine-planning-task-heading"
            >
              Allocate production to a machine
            </h2>
            <p className={cn(erpTypography.helper, "mt-0.5 flex items-center gap-1.5 text-slate-600")}>
              Choose a machine and allocate the planned quantity. Allocation matches planned qty when the
              totals agree — then Complete Machine Planning.
              <button
                type="button"
                className="inline-flex text-slate-400 hover:text-slate-600"
                title={MULTI_SHIFT_CAPACITY_HELP}
                aria-label={MULTI_SHIFT_CAPACITY_HELP}
                data-testid="machine-planning-tech-help"
              >
                <CircleHelp className="h-3.5 w-3.5" aria-hidden />
              </button>
            </p>
          </div>
          <p className="sr-only" data-testid="wo-production-run-count">
            {runCount || "—"}
          </p>
          {purgeHints > 0 ? (
            <p className={cn(erpTypography.helper, "text-amber-700")} data-testid="wo-planned-purge-hint">
              {purgeHints} purge(s) detected (server confirms on save)
            </p>
          ) : null}
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

        {showPastWarning ? (
          <div
            className="mt-1.5 space-y-1.5 rounded-md border border-amber-200 bg-amber-50/90 px-2.5 py-2"
            data-testid="machine-planning-past-date-warning"
            role="status"
          >
            <p className="text-[12px] font-medium text-amber-950">{MACHINE_PLANNING_PAST_DATE_WARNING}</p>
            {allowPastDates && onBackdateReasonChange ? (
              <div>
                <label
                  htmlFor="machine-planning-backdate-reason"
                  className="text-[10px] font-semibold uppercase tracking-wider text-amber-900"
                >
                  Backdate Reason
                </label>
                <textarea
                  id="machine-planning-backdate-reason"
                  className="mt-0.5 min-h-[2.5rem] w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-900"
                  value={backdateReason}
                  disabled={disabled}
                  onChange={(e) => onBackdateReasonChange(e.target.value)}
                  placeholder="Required when Start Date is in the past"
                  data-testid="machine-planning-backdate-reason"
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-2 space-y-3">
          {safeFgLines.map((fg) => {
            const fgRuns = safeRuns
              .filter((r) => r.fgItemId === fg.fgItemId)
              .sort((a, b) => a.runSequence - b.runSequence);
            const allocated = sumAllocatedQtyForFg(safeRuns, fg.fgItemId);
            const eligibleMachines = machinesForFg(fg.fgItemId, safeMachines, safeStandards);
            return (
              <CompactMachineRunTask
                key={fg.fgItemId}
                fg={fg}
                fgRuns={fgRuns}
                allocated={allocated}
                eligibleMachines={eligibleMachines}
                machines={safeMachines}
                standards={safeStandards}
                shifts={shifts}
                readOnly={readOnly}
                disabled={disabled}
                onAdd={() => addRun(fg.fgItemId)}
                onUpdate={updateRun}
                onRemove={removeRun}
                showFgName={safeFgLines.length > 1}
                dateInputMin={dateInputMin}
                allowPastDates={allowPastDates}
                startDateErrorTargetKey={startDateErrorTargetKey}
                startDateError={startDateError}
              />
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn("rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm", className)}
      data-testid="wo-production-run-allocation-panel"
      aria-labelledby="wo-production-run-allocation-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <div className="min-w-0">
          <h2
            id="wo-production-run-allocation-title"
            className="text-[11px] font-bold uppercase tracking-wider text-slate-700"
          >
            Machine production runs
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Allocate planned quantity to machines. A new run row is not automatically a physical setup or
            a material purge — those are detected separately.
          </p>
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

      {showPastWarning ? (
        <div
          className="mt-1.5 space-y-1.5 rounded-md border border-amber-200 bg-amber-50/90 px-2.5 py-2"
          data-testid="machine-planning-past-date-warning"
          role="status"
        >
          <p className="text-[12px] font-medium text-amber-950">{MACHINE_PLANNING_PAST_DATE_WARNING}</p>
          {allowPastDates && onBackdateReasonChange ? (
            <div>
              <label
                htmlFor="machine-planning-backdate-reason-classic"
                className="text-[10px] font-semibold uppercase tracking-wider text-amber-900"
              >
                Backdate Reason
              </label>
              <textarea
                id="machine-planning-backdate-reason-classic"
                className="mt-0.5 min-h-[2.5rem] w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-900"
                value={backdateReason}
                disabled={disabled}
                onChange={(e) => onBackdateReasonChange(e.target.value)}
                placeholder="Required when Start Date is in the past"
                data-testid="machine-planning-backdate-reason"
              />
            </div>
          ) : null}
        </div>
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
                <table className="w-full min-w-[40rem] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left font-semibold tracking-wide text-slate-600">
                      <th className="py-1.5 pr-2 text-[10px] uppercase">Seq</th>
                      <th className="py-1.5 pr-2 text-[10px] uppercase">Machine</th>
                      <th className="py-1.5 pr-2 text-right text-[10px] uppercase">Planned Qty</th>
                      <th className="py-1.5 pr-2 text-[10px] uppercase">Start date</th>
                      <th className="py-1.5 pr-2 text-[10px] uppercase">Shift</th>
                      <th className="py-1.5 pr-2 text-[10px] uppercase">Cycle / Capacity</th>
                      <th className="py-1.5 pr-2 text-[10px] uppercase">Duration / Shifts</th>
                      <th className="py-1.5 pr-2 text-[10px] uppercase">Purge status</th>
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
                      fgRuns.map((run) => (
                        <ClassicRunRow
                          key={run.clientKey}
                          run={run}
                          eligibleMachines={eligibleMachines}
                          machines={safeMachines}
                          standards={safeStandards}
                          shifts={shifts}
                          readOnly={readOnly}
                          disabled={disabled}
                          onUpdate={updateRun}
                          onRemove={removeRun}
                          dateInputMin={dateInputMin}
                          allowPastDates={allowPastDates}
                          startDateError={
                            startDateError && startDateErrorTargetKey === run.clientKey
                              ? startDateError
                              : null
                          }
                          highlightStartDate={Boolean(
                            startDateError && startDateErrorTargetKey === run.clientKey,
                          )}
                          focusStartDate={Boolean(
                            startDateError && startDateErrorTargetKey === run.clientKey,
                          )}
                        />
                      ))
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
