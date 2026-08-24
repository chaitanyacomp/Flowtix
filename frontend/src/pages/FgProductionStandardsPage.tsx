/**
 * FG Production Standard Master — FG capacity on a machine (Step 4).
 * Soft activate/deactivate only. Preview Shift is not stored.
 */
import * as React from "react";
import { apiFetch } from "../services/api";
import { useToast } from "../contexts/ToastContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { useListScrollRestoration } from "../hooks/useListScrollRestoration";
import {
  MasterListHeader,
  MasterListPageShell,
  MasterListPagination,
  MasterListToolbar,
  MasterSearchInput,
  resultCountLabel,
} from "../components/masters/MasterListWorkbench";
import { useMasterListWorkbench } from "../hooks/useMasterListWorkbench";
import { matchesNameSearch, normalizeSearchText, paginateRows } from "../lib/masterListQuery";
import {
  createFgProductionStandard,
  updateFgProductionStandard,
  type FgProductionStandardRow,
} from "../lib/fgProductionStandardApi";
import { computeExpectedShiftQtyPreview } from "../lib/fgProductionStandardCalc";
import {
  applyFgStandardFocus,
  firstEditableFocusTarget,
  isDuplicateFgMachineError,
  type FgStandardFocusIntent,
} from "../lib/fgProductionStandardFocus";
import type { MachineRow } from "../lib/machineApi";
import type { ShiftRow } from "../lib/shiftApi";

type FgItemOpt = { id: number; itemName: string; unit?: string; isActive?: boolean };

const fieldFocusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2";

const selectClass = cn(
  "h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-900",
  fieldFocusRing,
);

const emptyForm = {
  itemId: "",
  machineId: "",
  cycleTimeSeconds: "",
  piecesPerCycle: "1",
  standardEfficiencyPercent: "95",
  previewShiftId: "",
  remarks: "",
  isActive: true,
};

function rowToForm(r: FgProductionStandardRow) {
  return {
    itemId: String(r.itemId),
    machineId: String(r.machineId),
    cycleTimeSeconds: String(r.cycleTimeSeconds),
    piecesPerCycle: String(r.piecesPerCycle ?? 1),
    standardEfficiencyPercent: String(r.standardEfficiencyPercent ?? 95),
    previewShiftId: "",
    remarks: r.remarks ?? "",
    isActive: r.isActive,
  };
}

export function FgProductionStandardsPage() {
  const toast = useToast();
  useListScrollRestoration();
  const [rows, setRows] = React.useState<FgProductionStandardRow[]>([]);
  const [fgItems, setFgItems] = React.useState<FgItemOpt[]>([]);
  const [machines, setMachines] = React.useState<MachineRow[]>([]);
  const [shifts, setShifts] = React.useState<ShiftRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [form, setForm] = React.useState(emptyForm);
  const [formBaseline, setFormBaseline] = React.useState(() => JSON.stringify(emptyForm));
  const [saving, setSaving] = React.useState(false);
  const [showInactive, setShowInactive] = React.useState(true);
  const [focusEpoch, setFocusEpoch] = React.useState(0);
  const fgItemRef = React.useRef<HTMLSelectElement>(null);
  const machineRef = React.useRef<HTMLSelectElement>(null);
  const cycleTimeRef = React.useRef<HTMLInputElement>(null);
  const piecesRef = React.useRef<HTMLInputElement>(null);
  const efficiencyRef = React.useRef<HTMLInputElement>(null);
  const previewShiftRef = React.useRef<HTMLSelectElement>(null);
  const pendingFocusRef = React.useRef<FgStandardFocusIntent | null>(null);
  const initialFocusDoneRef = React.useRef(false);
  const wb = useMasterListWorkbench();
  const { query, setSearch, clearSearch, clearFilters, setPage, setPageSize } = wb;
  const formDirty = React.useMemo(() => {
    const strip = (f: typeof emptyForm) => {
      const { previewShiftId: _p, ...rest } = f;
      return JSON.stringify(rest);
    };
    return strip(form) !== strip(JSON.parse(formBaseline) as typeof emptyForm);
  }, [form, formBaseline]);

  const showCancel = selectedId != null || formDirty;
  useUnsavedChangesGuard({
    isDirty: formDirty,
    message: "FG production standard form has unsaved changes. Leave and discard them?",
  });

  const selectedPreviewShift = React.useMemo(
    () => shifts.find((s) => String(s.id) === form.previewShiftId) ?? null,
    [shifts, form.previewShiftId],
  );

  const qtyPreview = React.useMemo(() => {
    if (!selectedPreviewShift?.netProductionDurationMinutes) {
      return { error: "Select an active shift to preview expected quantity." } as const;
    }
    return computeExpectedShiftQtyPreview({
      cycleTimeSeconds: form.cycleTimeSeconds,
      piecesPerCycle: form.piecesPerCycle,
      standardEfficiencyPercent: form.standardEfficiencyPercent,
      netShiftMinutes: selectedPreviewShift.netProductionDurationMinutes,
    });
  }, [
    form.cycleTimeSeconds,
    form.piecesPerCycle,
    form.standardEfficiencyPercent,
    selectedPreviewShift,
  ]);

  function queueFocus(intent: FgStandardFocusIntent) {
    pendingFocusRef.current = intent;
    setFocusEpoch((n) => n + 1);
  }

  function loadStandards() {
    setLoading(true);
    setError(null);
    const qs = showInactive ? "?includeInactive=1" : "";
    apiFetch<FgProductionStandardRow[]>(`/api/fg-production-standards${qs}`)
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load FG production standards"))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    loadStandards();
  }, [showInactive]);

  React.useEffect(() => {
    void Promise.all([
      apiFetch<FgItemOpt[]>("/api/items?type=FG"),
      apiFetch<MachineRow[]>("/api/machines"),
      apiFetch<ShiftRow[]>("/api/shifts"),
    ])
      .then(([items, mach, sh]) => {
        setFgItems(Array.isArray(items) ? items.filter((i) => i.isActive !== false) : []);
        setMachines(Array.isArray(mach) ? mach.filter((m) => m.isActive) : []);
        setShifts(Array.isArray(sh) ? sh.filter((s) => s.isActive) : []);
      })
      .catch(() => {
        /* selects stay empty; save will still validate server-side */
      });
  }, []);

  React.useEffect(() => {
    if (loading) return;
    if (initialFocusDoneRef.current) return;
    if (selectedId != null) return;
    initialFocusDoneRef.current = true;
    queueFocus({ target: "fg-item", force: false });
  }, [loading, selectedId]);

  React.useEffect(() => {
    const intent = pendingFocusRef.current;
    if (!intent) return;
    if (!intent.force && loading) return;
    const frame = window.requestAnimationFrame(() => {
      const applied = applyFgStandardFocus(intent, {
        fgItem: fgItemRef.current,
        machine: machineRef.current,
        cycleTime: cycleTimeRef.current,
        pieces: piecesRef.current,
        efficiency: efficiencyRef.current,
        previewShift: previewShiftRef.current,
      });
      if (applied) pendingFocusRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusEpoch, form, selectedId, loading]);

  const fgOptions = React.useMemo(() => {
    const map = new Map(fgItems.map((i) => [i.id, i]));
    if (selectedId != null) {
      const selected = rows.find((r) => r.id === selectedId);
      if (selected && !map.has(selected.itemId)) {
        map.set(selected.itemId, {
          id: selected.itemId,
          itemName: selected.itemName ?? `Item #${selected.itemId}`,
          unit: selected.itemUnit ?? undefined,
          isActive: selected.itemIsActive ?? false,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [fgItems, rows, selectedId]);

  const machineOptions = React.useMemo(() => {
    const map = new Map(machines.map((m) => [m.id, m]));
    if (selectedId != null) {
      const selected = rows.find((r) => r.id === selectedId);
      if (selected && !map.has(selected.machineId)) {
        map.set(selected.machineId, {
          id: selected.machineId,
          machineCode: selected.machineCode ?? "",
          machineName: selected.machineName ?? `Machine #${selected.machineId}`,
          machineType: "OTHER",
          isActive: selected.machineIsActive ?? false,
        } as MachineRow);
      }
    }
    return [...map.values()].sort((a, b) => a.machineName.localeCompare(b.machineName));
  }, [machines, rows, selectedId]);

  const filtered = React.useMemo(() => {
    const q = query.debouncedSearch;
    return rows.filter(
      (r) =>
        matchesNameSearch(r.itemName ?? "", q) ||
        matchesNameSearch(r.machineName ?? "", q) ||
        matchesNameSearch(r.machineCode ?? "", q) ||
        matchesNameSearch(String(r.cycleTimeSeconds ?? ""), q),
    );
  }, [rows, query.debouncedSearch]);

  const { pageRows, totalPages, from, to } = paginateRows(filtered, query.page, query.pageSize);
  const searching = Boolean(normalizeSearchText(query.debouncedSearch));

  function applyRowToForm(r: FgProductionStandardRow) {
    const next = rowToForm(r);
    setSelectedId(r.id);
    setForm(next);
    setFormBaseline(JSON.stringify(next));
    setError(null);
  }

  function selectRow(r: FgProductionStandardRow) {
    applyRowToForm(r);
    queueFocus({ target: firstEditableFocusTarget("edit"), force: true });
  }

  function resetToNewForm() {
    setSelectedId(null);
    setForm(emptyForm);
    setFormBaseline(JSON.stringify(emptyForm));
    setError(null);
  }

  function onNewStandard() {
    resetToNewForm();
    queueFocus({ target: "fg-item", force: true });
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const itemId = Number(form.itemId);
    const machineId = Number(form.machineId);
    if (!Number.isInteger(itemId) || itemId < 1) {
      setError("Finished goods item is required");
      toast.showError("Finished goods item is required");
      queueFocus({ target: "fg-item", force: true });
      return;
    }
    if (!Number.isInteger(machineId) || machineId < 1) {
      setError("Machine is required");
      toast.showError("Machine is required");
      queueFocus({ target: "machine", force: true });
      return;
    }
    const cycleTimeSeconds = Number(form.cycleTimeSeconds);
    if (!Number.isFinite(cycleTimeSeconds) || cycleTimeSeconds <= 0) {
      setError("Cycle time must be greater than zero");
      toast.showError("Cycle time must be greater than zero");
      queueFocus({ target: "cycle-time", force: true });
      return;
    }
    const piecesPerCycle = Number(form.piecesPerCycle);
    if (!Number.isFinite(piecesPerCycle) || !Number.isInteger(piecesPerCycle) || piecesPerCycle < 1) {
      setError("Pieces per cycle must be a positive whole number");
      toast.showError("Pieces per cycle must be a positive whole number");
      queueFocus({ target: "pieces", force: true });
      return;
    }
    const standardEfficiencyPercent = Number(form.standardEfficiencyPercent);
    if (
      !Number.isFinite(standardEfficiencyPercent) ||
      standardEfficiencyPercent <= 0 ||
      standardEfficiencyPercent > 100
    ) {
      setError("Standard efficiency % must be greater than 0 and not more than 100");
      toast.showError("Standard efficiency % must be greater than 0 and not more than 100");
      queueFocus({ target: "efficiency", force: true });
      return;
    }

    const payload = {
      itemId,
      machineId,
      cycleTimeSeconds,
      piecesPerCycle,
      standardEfficiencyPercent,
      remarks: form.remarks.trim() || null,
      isActive: form.isActive,
    };

    const editingId = selectedId;
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        const updated = await updateFgProductionStandard(editingId, payload);
        toast.showSuccess("FG production standard updated");
        applyRowToForm(updated);
        loadStandards();
        queueFocus({ target: firstEditableFocusTarget("edit"), force: true });
      } else {
        await createFgProductionStandard(payload);
        toast.showSuccess("FG production standard created");
        resetToNewForm();
        loadStandards();
        queueFocus({ target: "fg-item", force: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setError(msg);
      toast.showError(msg);
      if (isDuplicateFgMachineError(msg)) {
        queueFocus({ target: "fg-item", force: true });
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: FgProductionStandardRow) {
    setSaving(true);
    setError(null);
    try {
      await updateFgProductionStandard(row.id, { isActive: !row.isActive });
      toast.showSuccess(row.isActive ? "Standard deactivated" : "Standard activated");
      loadStandards();
      if (selectedId === row.id) {
        setForm((f) => ({ ...f, isActive: !row.isActive }));
        setFormBaseline((b) => {
          const parsed = JSON.parse(b) as typeof emptyForm;
          return JSON.stringify({ ...parsed, isActive: !row.isActive });
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update status";
      setError(msg);
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <MasterListPageShell>
      <MasterListHeader
        title="FG Production Standards"
        description="Standard FG capacity on a machine (cycle time, cavities, efficiency). Soft-deactivate only — not used for Start Shift yet."
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onNewStandard}
            data-testid="fg-standard-new-btn"
          >
            New
          </Button>
        }
      />

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      ) : null}

      <MasterListToolbar
        search={
          <MasterSearchInput
            value={query.search}
            onChange={setSearch}
            onClear={clearSearch}
            placeholder="Search FG / machine…"
            aria-label="Search FG production standards"
          />
        }
        filters={
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        }
        resultLabel={resultCountLabel({ filtered: filtered.length, total: rows.length, searching })}
        showClearFilters={searching}
        onClearFilters={clearFilters}
      />

      <div
        className="grid min-h-0 flex-1 gap-3 max-lg:auto-rows-auto lg:h-[calc(100dvh-13.5rem)] lg:min-h-[28rem] lg:grid-cols-[minmax(0,1.15fr)_minmax(17rem,0.85fr)]"
        data-testid="fg-standards-workspace"
      >
        <section
          className="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm max-lg:max-h-[min(50dvh,28rem)]"
          data-testid="fg-standards-list-panel"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-2 py-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Standards list</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto" data-testid="fg-standards-list-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-2 py-1.5">FG</th>
                  <th className="px-2 py-1.5">Machine</th>
                  <th className="px-2 py-1.5">Cycle (s)</th>
                  <th className="px-2 py-1.5">Pcs</th>
                  <th className="px-2 py-1.5">Eff %</th>
                  <th className="px-2 py-1.5">Active</th>
                  <th className="px-2 py-1.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "cursor-pointer border-b border-slate-100",
                      selectedId === r.id ? "bg-sky-50" : undefined,
                      !r.isActive ? "opacity-60" : undefined,
                    )}
                    onClick={() => selectRow(r)}
                  >
                    <td className="px-2 py-1.5 font-medium text-slate-900">{r.itemName ?? r.itemId}</td>
                    <td className="px-2 py-1.5 text-slate-700">
                      <span className="font-mono text-[11px]">{r.machineCode}</span>{" "}
                      {r.machineName}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">{r.cycleTimeSeconds}</td>
                    <td className="px-2 py-1.5 tabular-nums">{r.piecesPerCycle}</td>
                    <td className="px-2 py-1.5 tabular-nums">{r.standardEfficiencyPercent}</td>
                    <td className="px-2 py-1.5">
                      {r.isActive ? (
                        <Badge className="bg-emerald-100 text-[10px] text-emerald-800">Active</Badge>
                      ) : (
                        <Badge className="bg-slate-100 text-[10px] text-slate-600">Inactive</Badge>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2"
                        disabled={saving}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void toggleActive(r);
                        }}
                      >
                        {r.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </td>
                  </tr>
                ))}
                {!pageRows.length ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-500">
                      {loading ? "Loading…" : searching ? "No matching standards" : "No FG production standards yet"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {!loading && filtered.length > 0 ? (
            <div className="shrink-0 border-t border-slate-100 px-2 py-1.5" data-testid="fg-standards-list-pagination">
              <MasterListPagination
                page={query.page}
                pageSize={query.pageSize}
                totalPages={totalPages}
                from={from}
                to={to}
                total={filtered.length}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </div>
          ) : null}
        </section>

        <section
          className="flex min-h-0 max-h-[min(70dvh,40rem)] flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm lg:max-h-none"
          data-testid="fg-standard-form-card"
        >
          <form
            data-testid="fg-standard-form"
            noValidate
            className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]"
            onSubmit={(e) => void onSave(e)}
          >
            <div
              data-testid="fg-standard-form-header"
              className="col-start-1 row-start-1 flex min-h-[2.75rem] shrink-0 items-center border-b border-slate-200 bg-white px-3 py-2 pr-[11.5rem]"
            >
              <h3 className="truncate text-sm font-bold text-slate-800">
                {selectedId ? "Edit standard" : "New standard"}
              </h3>
            </div>
            <div
              data-testid="fg-standard-form-fields"
              className="col-start-1 row-start-2 min-h-0 overflow-y-auto px-3 py-2 pb-3"
              style={{ scrollbarGutter: "stable" }}
            >
              <div className="grid gap-2">
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Finished goods item <span className="font-normal text-red-600">*</span>
                  <select
                    ref={fgItemRef}
                    data-testid="fg-standard-field-fg"
                    className={selectClass}
                    value={form.itemId}
                    onChange={(e) => setForm((f) => ({ ...f, itemId: e.target.value }))}
                    required
                  >
                    <option value="">Select FG…</option>
                    {fgOptions.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.itemName}
                        {i.isActive === false ? " (inactive)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Machine <span className="font-normal text-red-600">*</span>
                  <select
                    ref={machineRef}
                    data-testid="fg-standard-field-machine"
                    className={selectClass}
                    value={form.machineId}
                    onChange={(e) => setForm((f) => ({ ...f, machineId: e.target.value }))}
                    required
                  >
                    <option value="">Select machine…</option>
                    {machineOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.machineCode} — {m.machineName}
                        {!m.isActive ? " (inactive)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Cycle time (seconds) <span className="font-normal text-red-600">*</span>
                  <Input
                    ref={cycleTimeRef}
                    data-testid="fg-standard-field-cycle"
                    type="number"
                    min={0}
                    step="any"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.cycleTimeSeconds}
                    onChange={(e) => setForm((f) => ({ ...f, cycleTimeSeconds: e.target.value }))}
                    required
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Pieces per cycle / cavities <span className="font-normal text-red-600">*</span>
                  <Input
                    ref={piecesRef}
                    data-testid="fg-standard-field-pieces"
                    type="number"
                    min={1}
                    step={1}
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.piecesPerCycle}
                    onChange={(e) => setForm((f) => ({ ...f, piecesPerCycle: e.target.value }))}
                    required
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Standard efficiency % <span className="font-normal text-red-600">*</span>
                  <Input
                    ref={efficiencyRef}
                    data-testid="fg-standard-field-efficiency"
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.standardEfficiencyPercent}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, standardEfficiencyPercent: e.target.value }))
                    }
                    required
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Preview shift <span className="font-normal text-slate-400">(not saved)</span>
                  <select
                    ref={previewShiftRef}
                    data-testid="fg-standard-field-preview-shift"
                    className={selectClass}
                    value={form.previewShiftId}
                    onChange={(e) => setForm((f) => ({ ...f, previewShiftId: e.target.value }))}
                  >
                    <option value="">Select shift for preview…</option>
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.shiftCode} — {s.shiftName} (net{" "}
                        {s.netProductionDurationMinutes ?? "?"} min)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Remarks
                  <Input
                    data-testid="fg-standard-field-remarks"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.remarks}
                    onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                    maxLength={500}
                  />
                </label>
                <label className="flex items-center gap-2 text-[11px] text-slate-600">
                  <input
                    data-testid="fg-standard-field-active"
                    type="checkbox"
                    className={cn("h-4 w-4 rounded border-slate-300", fieldFocusRing)}
                    checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  />
                  Active
                </label>

                <div
                  data-testid="fg-standard-qty-preview"
                  className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700"
                >
                  {"error" in qtyPreview ? (
                    <p className="font-medium text-amber-800">{qtyPreview.error}</p>
                  ) : (
                    <dl className="grid gap-1">
                      <div className="flex justify-between gap-2">
                        <dt>Net shift minutes</dt>
                        <dd className="tabular-nums font-semibold">
                          {qtyPreview.netShiftMinutes} min ({qtyPreview.netShiftSeconds} s)
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>Theoretical qty (100%)</dt>
                        <dd className="tabular-nums font-semibold">{qtyPreview.theoreticalQuantity}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>Expected qty @ {qtyPreview.standardEfficiencyPercent}%</dt>
                        <dd className="tabular-nums font-semibold">{qtyPreview.expectedQuantity}</dd>
                      </div>
                    </dl>
                  )}
                </div>
                <p className="text-[10px] text-slate-500">
                  Expected qty = floor((net shift seconds ÷ cycle time) × pieces × efficiency ÷ 100).
                  Preview shift is for calculation only and is never stored. Standards cannot be hard-deleted.
                </p>
              </div>
            </div>
            <div
              data-testid="fg-standard-form-actions"
              className="col-start-1 row-start-1 z-[3] flex flex-row-reverse flex-wrap items-center gap-2 justify-self-end self-center bg-white px-3 py-2"
            >
              <Button
                type="submit"
                data-testid="fg-standard-form-submit"
                className={cn("h-8 font-semibold", fieldFocusRing)}
                disabled={saving}
              >
                {saving ? "Saving…" : selectedId ? "Update standard" : "Create standard"}
              </Button>
              {showCancel ? (
                <Button
                  type="button"
                  data-testid="fg-standard-form-cancel"
                  variant="outline"
                  className={cn("h-8", fieldFocusRing)}
                  onClick={onNewStandard}
                  disabled={saving}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        </section>
      </div>
    </MasterListPageShell>
  );
}
