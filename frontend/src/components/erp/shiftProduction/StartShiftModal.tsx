import * as React from "react";
import { ErpModal } from "../ErpModal";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { NativeSelect } from "../../ui/native-select";
import type { MachineRow } from "../../../lib/machineApi";
import type { OperatorRow } from "../../../lib/operatorApi";
import type { ShiftRow } from "../../../lib/shiftApi";
import { startShiftSession } from "../../../lib/machineShiftSessionApi";
import {
  indiaLocalDateYmd,
  mapShiftApiError,
  operatorDisplayName,
  shiftDisplayLabel,
  validateStartOperators,
} from "../../../lib/machineShiftSessionUi";

type Props = {
  open: boolean;
  onClose: () => void;
  machine: MachineRow;
  shifts: ShiftRow[];
  operators: OperatorRow[];
  onStarted: (sessionId: number) => void;
};

type DraftOp = { operatorId: number; isPrimary: boolean };

export function StartShiftModal({ open, onClose, machine, shifts, operators, onStarted }: Props) {
  const activeShifts = React.useMemo(() => shifts.filter((s) => s.isActive), [shifts]);
  const activeOperators = React.useMemo(() => operators.filter((o) => o.isActive), [operators]);

  const [shiftId, setShiftId] = React.useState<string>("");
  const [sessionDate, setSessionDate] = React.useState(indiaLocalDateYmd());
  const [selected, setSelected] = React.useState<DraftOp[]>([]);
  const [operatorQuery, setOperatorQuery] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setShiftId(activeShifts[0] ? String(activeShifts[0].id) : "");
    setSessionDate(indiaLocalDateYmd());
    setSelected([]);
    setOperatorQuery("");
    setNotice(null);
    setSubmitting(false);
  }, [open, machine.id, activeShifts]);

  const filteredOps = React.useMemo(() => {
    const q = operatorQuery.trim().toLowerCase();
    return activeOperators.filter((o) => {
      if (selected.some((s) => s.operatorId === o.id)) return false;
      if (!q) return true;
      return (
        o.operatorName.toLowerCase().includes(q) ||
        o.operatorCode.toLowerCase().includes(q) ||
        String(o.employeeNumber ?? "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [activeOperators, operatorQuery, selected]);

  function addOperator(op: OperatorRow) {
    setSelected((prev) => {
      if (prev.some((p) => p.operatorId === op.id)) return prev;
      const next = [...prev, { operatorId: op.id, isPrimary: prev.length === 0 }];
      return next;
    });
    setOperatorQuery("");
  }

  function setPrimary(operatorId: number) {
    setSelected((prev) => prev.map((p) => ({ ...p, isPrimary: p.operatorId === operatorId })));
  }

  function removeOperator(operatorId: number) {
    setSelected((prev) => {
      const next = prev.filter((p) => p.operatorId !== operatorId);
      if (next.length && !next.some((p) => p.isPrimary)) {
        next[0] = { ...next[0], isPrimary: true };
      }
      return next;
    });
  }

  async function handleStart() {
    if (submitting) return;
    const validation = validateStartOperators(selected);
    if (validation) {
      setNotice(validation);
      return;
    }
    if (!sessionDate) {
      setNotice("Session date is required.");
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await startShiftSession({
        machineId: machine.id,
        shiftId: shiftId ? Number(shiftId) : null,
        sessionDate,
        operators: selected,
      });
      onStarted(res.session.id);
      onClose();
    } catch (e) {
      setNotice(mapShiftApiError(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <ErpModal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      escapeDisabled={() => submitting}
      aria-labelledby="start-shift-title"
      className="items-start justify-center pt-4 sm:pt-8"
    >
      <div className="mx-auto w-full max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <h2 id="start-shift-title" className="text-lg font-semibold text-slate-900">
          Start Shift
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {machine.machineName} · {machine.machineCode}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Shift</span>
            <NativeSelect value={shiftId} onChange={(e) => setShiftId(e.target.value)} disabled={submitting}>
              <option value="">No template</option>
              {activeShifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {shiftDisplayLabel(s)}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Session date</span>
            <Input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              disabled={submitting}
            />
            <span className="mt-1 block text-xs text-slate-500">
              Night shifts use the starting date (when the shift begins).
            </span>
          </label>
        </div>

        <div className="mt-4">
          <div className="mb-1 text-sm font-medium text-slate-700">Operators</div>
          <Input
            type="search"
            placeholder="Search operators…"
            value={operatorQuery}
            onChange={(e) => setOperatorQuery(e.target.value)}
            disabled={submitting}
            className="mb-2"
          />
          {operatorQuery.trim() ? (
            <ul className="mb-2 max-h-36 overflow-auto rounded-md border border-slate-200 bg-white text-sm" role="listbox">
              {filteredOps.length === 0 ? (
                <li className="px-3 py-2 text-slate-500">No matching operators</li>
              ) : (
                filteredOps.slice(0, 12).map((op) => (
                  <li key={op.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left hover:bg-teal-50"
                      onClick={() => addOperator(op)}
                      disabled={submitting}
                    >
                      {operatorDisplayName(op)}
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}

          <ul className="space-y-2">
            {selected.map((row) => {
              const op = activeOperators.find((o) => o.id === row.operatorId);
              return (
                <li
                  key={row.operatorId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800">{operatorDisplayName(op)}</div>
                    {row.isPrimary ? (
                      <span className="text-xs font-semibold text-teal-700">Primary operator</span>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-teal-700 underline"
                        onClick={() => setPrimary(row.operatorId)}
                        disabled={submitting}
                      >
                        Make primary
                      </button>
                    )}
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeOperator(row.operatorId)} disabled={submitting}>
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
          {!selected.length ? <p className="mt-2 text-xs text-slate-500">Add at least one operator. The first becomes primary.</p> : null}
          <p className="mt-2 text-xs text-slate-500">Shift session number is assigned automatically.</p>
        </div>

        {notice ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
            {notice}
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleStart} disabled={submitting} className="min-w-[8rem] bg-teal-700 hover:bg-teal-800">
            {submitting ? "Starting…" : "Start Shift"}
          </Button>
        </div>
      </div>
    </ErpModal>
  );
}
