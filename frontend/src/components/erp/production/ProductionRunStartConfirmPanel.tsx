import * as React from "react";
import { Button } from "../../ui/button";
import { ApiRequestError } from "../../../services/api";
import {
  fetchProductionRunStarts,
  type ProductionRunStartListResponse,
} from "../../../lib/productionRunStartConfirmation";
import { isProductionEntryBlockedByRunStartGate } from "../../../lib/productionNavigationStability";
import { ConfirmProductionStartModal } from "./ConfirmProductionStartModal";
import { cn } from "../../../lib/utils";

export type ProductionRunStartEntryGate = {
  mode: "LEGACY" | "MACHINE_RUN_PLANNING" | null;
  loading: boolean;
  confirmedRunCount: number;
  entryBlocked: boolean;
  /** Machine for the selected confirmed run — used for shift qty-lock checks. */
  selectedMachineId?: number | null;
};

type Props = {
  workOrderId: number;
  canConfirm: boolean;
  /** FG filter — when set, only runs for this FG are entry-selectable. */
  fgItemId?: number | null;
  className?: string;
  onChanged?: () => void;
  /** Selected planned run for new production entries (confirmed runs only). */
  selectedRunAllocationId?: number | null;
  onSelectedRunAllocationIdChange?: (runAllocationId: number | null) => void;
  /** Notify parent when entry should stay disabled until a run is start-confirmed. */
  onEntryGateChange?: (gate: ProductionRunStartEntryGate) => void;
  /** Prefer this run from dashboard / pending-actions deep link. */
  preferredRunAllocationId?: number | null;
  /** When true, open confirm modal for preferred (or first pending) run. */
  autoOpenConfirm?: boolean;
};

/**
 * Compact strip listing planned machine runs needing start confirmation,
 * and selecting the active confirmed run for production entry.
 */
export function ProductionRunStartConfirmPanel({
  workOrderId,
  canConfirm,
  fgItemId = null,
  className,
  onChanged,
  selectedRunAllocationId = null,
  onSelectedRunAllocationIdChange,
  onEntryGateChange,
  preferredRunAllocationId = null,
  autoOpenConfirm = false,
}: Props) {
  const [data, setData] = React.useState<ProductionRunStartListResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [activeRunId, setActiveRunId] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);
  const fetchGenRef = React.useRef(0);

  const reload = React.useCallback(async () => {
    if (!(workOrderId > 0)) return;
    const gen = ++fetchGenRef.current;
    setLoading(true);
    try {
      const payload = await fetchProductionRunStarts(workOrderId);
      if (gen !== fetchGenRef.current) return;
      setData(payload);
      setError(null);
    } catch (e) {
      if (gen !== fetchGenRef.current) return;
      setError(e instanceof ApiRequestError ? e.message : "Failed to load run starts.");
      setData(null);
    } finally {
      if (gen === fetchGenRef.current) setLoading(false);
    }
  }, [workOrderId]);

  React.useEffect(() => {
    fetchGenRef.current += 1;
    setData(null);
    setLoading(true);
    void reload();
    return () => {
      fetchGenRef.current += 1;
    };
  }, [reload]);

  const fgRuns = React.useMemo(() => {
    if (!data?.runs) return [];
    if (fgItemId == null || !(Number(fgItemId) > 0)) return data.runs;
    return data.runs.filter((r) => Number(r.fgItem?.id) === Number(fgItemId));
  }, [data, fgItemId]);

  const entryAllowedRuns = fgRuns.filter((r) => r.entryAllowed || (!r.needsConfirmation && r.confirmation));
  const confirmedRunCount = fgRuns.filter((r) => !r.needsConfirmation).length;
  const entryGate = React.useMemo((): ProductionRunStartEntryGate => {
    const mode = data?.mode ?? null;
    const entryBlocked = isProductionEntryBlockedByRunStartGate({
      mode,
      confirmedRunCount,
      loading: loading || (!error && data == null),
      selectedRunAllocationId:
        mode === "MACHINE_RUN_PLANNING" ? selectedRunAllocationId : undefined,
    });
    const selectedMachineId =
      selectedRunAllocationId != null
        ? (fgRuns.find((r) => r.runAllocationId === selectedRunAllocationId)?.machine?.id ?? null)
        : null;
    return { mode, loading, confirmedRunCount, entryBlocked, selectedMachineId };
  }, [data, confirmedRunCount, loading, error, selectedRunAllocationId, fgRuns]);

  React.useEffect(() => {
    onEntryGateChange?.(entryGate);
  }, [entryGate, onEntryGateChange]);

  React.useEffect(() => {
    if (!onSelectedRunAllocationIdChange) return;
    if (!data || data.mode === "LEGACY") {
      onSelectedRunAllocationIdChange(null);
      return;
    }
    const preferred = Number(preferredRunAllocationId ?? 0);
    if (preferred > 0 && fgRuns.some((r) => r.runAllocationId === preferred)) {
      if (selectedRunAllocationId !== preferred) {
        onSelectedRunAllocationIdChange(preferred);
      }
      return;
    }
    const stillValid =
      selectedRunAllocationId != null &&
      entryAllowedRuns.some((r) => r.runAllocationId === selectedRunAllocationId);
    if (stillValid) return;
    const first = entryAllowedRuns[0]?.runAllocationId ?? null;
    onSelectedRunAllocationIdChange(first);
  }, [
    data,
    entryAllowedRuns,
    selectedRunAllocationId,
    onSelectedRunAllocationIdChange,
    preferredRunAllocationId,
    fgRuns,
  ]);

  React.useEffect(() => {
    if (!autoOpenConfirm || !canConfirm || !data || data.mode === "LEGACY") return;
    if (activeRunId != null) return;
    const preferred = Number(preferredRunAllocationId ?? 0);
    const pending = fgRuns.filter((r) => r.needsConfirmation);
    const target =
      preferred > 0
        ? pending.find((r) => r.runAllocationId === preferred) ?? pending[0]
        : pending[0];
    if (target) setActiveRunId(target.runAllocationId);
  }, [autoOpenConfirm, canConfirm, data, preferredRunAllocationId, fgRuns, activeRunId]);

  if (error) {
    return (
      <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
        {error}
      </p>
    );
  }

  if (loading || !data) {
    return (
      <div
        className={cn("rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700", className)}
        data-testid="production-run-start-panel-loading"
      >
        Loading machine run context…
      </div>
    );
  }

  if (data.mode === "LEGACY") {
    return (
      <div
        className={cn(
          "rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700",
          className,
        )}
        data-testid="production-start-legacy-banner"
      >
        {data.label}
      </div>
    );
  }

  const pending = fgRuns.filter((r) => r.needsConfirmation);
  const confirmed = fgRuns.filter((r) => !r.needsConfirmation);

  return (
    <div className={cn("space-y-2", className)} data-testid="production-run-start-panel">
      {pending.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2">
          <p className="text-sm font-medium text-amber-950">
            Confirm production start before recording entries for each run ({pending.length} pending)
          </p>
          <ul className="mt-2 space-y-1.5">
            {pending.map((r) => (
              <li
                key={r.runAllocationId}
                className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-950"
              >
                <span>
                  Run {r.runSequence} · {r.machine.machineCode} · {r.fgItem.itemName}
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={!canConfirm}
                  onClick={() => setActiveRunId(r.runAllocationId)}
                  data-testid={`open-start-confirm-${r.runAllocationId}`}
                >
                  {canConfirm ? "Confirm Machine Start" : "View only"}
                </Button>
              </li>
            ))}
          </ul>
          {!canConfirm ? (
            <p className="mt-1 text-xs text-amber-900/80">Store cannot confirm production start.</p>
          ) : null}
        </div>
      ) : null}

      {entryAllowedRuns.length > 0 ? (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Active planned run for production entry
          </label>
          <select
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            value={selectedRunAllocationId ?? ""}
            onChange={(e) => {
              const v = Number(e.target.value);
              onSelectedRunAllocationIdChange?.(Number.isFinite(v) && v > 0 ? v : null);
            }}
            data-testid="active-production-run-select"
          >
            {entryAllowedRuns.map((r) => (
              <option key={r.runAllocationId} value={r.runAllocationId}>
                Run {r.runSequence} · {r.machine.machineCode} · {r.fgItem.itemName}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Machine is taken from the planned run. Unconfirmed runs cannot be selected.
          </p>
        </div>
      ) : confirmed.length === 0 && pending.length > 0 ? (
        <p className="text-sm text-amber-900" data-testid="no-confirmed-run-for-entry">
          Confirm at least one machine run before recording production.
        </p>
      ) : null}

      {confirmed.length > 0 ? (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <p className="font-medium text-slate-800">Confirmed starts</p>
          <ul className="mt-1 space-y-1">
            {confirmed.map((r) => (
              <li key={r.runAllocationId} className="flex justify-between gap-2">
                <span>
                  Run {r.runSequence} · {r.machine.machineCode}
                  {r.confirmation?.actualPurgingRequired
                    ? ` · purge ${r.confirmation.actualPurgeQtyGrams} g`
                    : " · no purge"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveRunId(r.runAllocationId)}
                >
                  View
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ConfirmProductionStartModal
        open={activeRunId != null}
        runAllocationId={activeRunId}
        canConfirm={canConfirm}
        onClose={() => setActiveRunId(null)}
        onConfirmed={() => {
          void reload();
          onChanged?.();
        }}
      />
    </div>
  );
}
