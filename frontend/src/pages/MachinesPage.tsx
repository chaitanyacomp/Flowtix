/**
 * Machine Master — production equipment register (Step 1).
 * Soft activate/deactivate only; not wired to production sessions yet.
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
  MACHINE_TYPES,
  createMachine,
  normalizeMachineCodePreview,
  updateMachine,
  type MachineRow,
  type MachineType,
} from "../lib/machineApi";
import {
  applyMachineFocus,
  firstEditableFocusTarget,
  isDuplicateMachineCodeError,
  type MachineFocusIntent,
} from "../lib/machineMasterFocus";

const fieldFocusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2";

const selectClass = cn(
  "h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-900",
  fieldFocusRing,
);

const emptyForm = {
  machineCode: "",
  machineName: "",
  machineType: "INJECTION_MOULDING" as MachineType,
  make: "",
  model: "",
  serialNumber: "",
  departmentLocation: "",
  description: "",
  isActive: true,
};

function rowToForm(r: MachineRow) {
  return {
    machineCode: r.machineCode,
    machineName: r.machineName,
    machineType: r.machineType,
    make: r.make ?? "",
    model: r.model ?? "",
    serialNumber: r.serialNumber ?? "",
    departmentLocation: r.departmentLocation ?? "",
    description: r.description ?? "",
    isActive: r.isActive,
  };
}

export function MachinesPage() {
  const toast = useToast();
  useListScrollRestoration();
  const [rows, setRows] = React.useState<MachineRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [form, setForm] = React.useState(emptyForm);
  const [formBaseline, setFormBaseline] = React.useState(() => JSON.stringify(emptyForm));
  const [saving, setSaving] = React.useState(false);
  const [showInactive, setShowInactive] = React.useState(true);
  const [focusEpoch, setFocusEpoch] = React.useState(0);
  const machineCodeRef = React.useRef<HTMLInputElement>(null);
  const machineNameRef = React.useRef<HTMLInputElement>(null);
  const machineTypeRef = React.useRef<HTMLSelectElement>(null);
  const pendingFocusRef = React.useRef<MachineFocusIntent | null>(null);
  const initialFocusDoneRef = React.useRef(false);
  const wb = useMasterListWorkbench();
  const { query, setSearch, clearSearch, clearFilters, setPage, setPageSize } = wb;
  const formDirty = JSON.stringify(form) !== formBaseline;
  const showCancel = selectedId != null || formDirty;
  useUnsavedChangesGuard({
    isDirty: formDirty,
    message: "Machine form has unsaved changes. Leave and discard them?",
  });

  function queueFocus(intent: MachineFocusIntent) {
    pendingFocusRef.current = intent;
    setFocusEpoch((n) => n + 1);
  }

  function load() {
    setLoading(true);
    setError(null);
    const qs = showInactive ? "?includeInactive=1" : "";
    apiFetch<MachineRow[]>(`/api/machines${qs}`)
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load machines"))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    load();
  }, [showInactive]);

  /** Soft initial focus once New form is ready (skip if user already interacting). */
  React.useEffect(() => {
    if (loading) return;
    if (initialFocusDoneRef.current) return;
    if (selectedId != null) return;
    initialFocusDoneRef.current = true;
    queueFocus({ target: "machine-code", force: false });
  }, [loading, selectedId]);

  /** Apply queued focus after form/data paint. */
  React.useEffect(() => {
    const intent = pendingFocusRef.current;
    if (!intent) return;
    if (!intent.force && loading) return;
    const frame = window.requestAnimationFrame(() => {
      const applied = applyMachineFocus(intent, {
        code: machineCodeRef.current,
        name: machineNameRef.current,
        type: machineTypeRef.current,
      });
      if (applied) pendingFocusRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusEpoch, form, selectedId, loading]);

  const filtered = React.useMemo(() => {
    const q = query.debouncedSearch;
    return rows.filter(
      (r) =>
        matchesNameSearch(r.machineName, q) ||
        matchesNameSearch(r.machineCode, q) ||
        matchesNameSearch(r.machineTypeLabel ?? r.machineType, q) ||
        (r.make ? matchesNameSearch(r.make, q) : false) ||
        (r.model ? matchesNameSearch(r.model, q) : false) ||
        (r.departmentLocation ? matchesNameSearch(r.departmentLocation, q) : false),
    );
  }, [rows, query.debouncedSearch]);

  const { pageRows, totalPages, from, to } = paginateRows(filtered, query.page, query.pageSize);
  const searching = Boolean(normalizeSearchText(query.debouncedSearch));

  function applyRowToForm(r: MachineRow) {
    const next = rowToForm(r);
    setSelectedId(r.id);
    setForm(next);
    setFormBaseline(JSON.stringify(next));
    setError(null);
  }

  function selectRow(r: MachineRow) {
    applyRowToForm(r);
    queueFocus({ target: firstEditableFocusTarget("edit"), force: true });
  }

  function resetToNewForm() {
    setSelectedId(null);
    setForm(emptyForm);
    setFormBaseline(JSON.stringify(emptyForm));
    setError(null);
  }

  function onNewMachine() {
    resetToNewForm();
    queueFocus({ target: "machine-code", force: true });
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const machineCode = normalizeMachineCodePreview(form.machineCode);
    const machineName = form.machineName.trim();
    if (!machineCode) {
      setError("Machine code is required");
      toast.showError("Machine code is required");
      queueFocus({ target: "machine-code", force: true });
      return;
    }
    if (!machineName) {
      setError("Machine name is required");
      toast.showError("Machine name is required");
      queueFocus({ target: "machine-name", force: true });
      return;
    }
    if (!form.machineType) {
      setError("Machine type is required");
      toast.showError("Machine type is required");
      queueFocus({ target: "machine-type", force: true });
      return;
    }

    const payload = {
      machineCode,
      machineName,
      machineType: form.machineType,
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      serialNumber: form.serialNumber.trim() || null,
      departmentLocation: form.departmentLocation.trim() || null,
      description: form.description.trim() || null,
      isActive: form.isActive,
    };

    const editingId = selectedId;
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        const updated = await updateMachine(editingId, payload);
        toast.showSuccess("Machine updated");
        applyRowToForm(updated);
        load();
        queueFocus({ target: firstEditableFocusTarget("edit"), force: true });
      } else {
        await createMachine(payload);
        toast.showSuccess("Machine created");
        resetToNewForm();
        load();
        queueFocus({ target: "machine-code", force: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setError(msg);
      toast.showError(msg);
      if (isDuplicateMachineCodeError(msg)) {
        queueFocus({ target: "machine-code", select: true, force: true });
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: MachineRow) {
    setSaving(true);
    setError(null);
    try {
      await updateMachine(row.id, { isActive: !row.isActive });
      toast.showSuccess(row.isActive ? "Machine deactivated" : "Machine activated");
      load();
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
        title="Machines"
        description="Production machine register. Soft-deactivate only — machines are not assigned to production yet."
        actions={
          <Button type="button" size="sm" variant="outline" onClick={onNewMachine} data-testid="machine-new-btn">
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
            placeholder="Search machines…"
            aria-label="Search machines"
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
        data-testid="machines-workspace"
      >
        <section
          className="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm max-lg:max-h-[min(50dvh,28rem)]"
          data-testid="machines-list-panel"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-2 py-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Machine list</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto" data-testid="machines-list-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-2 py-1.5">Code</th>
                  <th className="px-2 py-1.5">Name</th>
                  <th className="px-2 py-1.5">Type</th>
                  <th className="px-2 py-1.5">Location</th>
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
                    <td className="px-2 py-1.5 font-mono text-[11px]">{r.machineCode}</td>
                    <td className="px-2 py-1.5 font-medium text-slate-900">{r.machineName}</td>
                    <td className="px-2 py-1.5 text-slate-700">{r.machineTypeLabel ?? r.machineType}</td>
                    <td className="px-2 py-1.5 text-slate-600">{r.departmentLocation || "—"}</td>
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
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      {loading ? "Loading…" : searching ? "No matching machines" : "No machines yet"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {!loading && filtered.length > 0 ? (
            <div className="shrink-0 border-t border-slate-100 px-2 py-1.5" data-testid="machines-list-pagination">
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
          data-testid="machine-form-card"
        >
          {/*
            DOM order = tab order: fields → submit → Cancel.
            CSS grid places actions visually in the header row (row 1).
          */}
          <form
            data-testid="machine-form"
            noValidate
            className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]"
            onSubmit={(e) => void onSave(e)}
          >
            <div
              data-testid="machine-form-header"
              className="col-start-1 row-start-1 flex min-h-[2.75rem] shrink-0 items-center border-b border-slate-200 bg-white px-3 py-2 pr-[11.5rem]"
            >
              <h3 className="truncate text-sm font-bold text-slate-800">
                {selectedId ? "Edit machine" : "New machine"}
              </h3>
            </div>
            <div
              data-testid="machine-form-fields"
              className="col-start-1 row-start-2 min-h-0 overflow-y-auto px-3 py-2 pb-3"
              style={{ scrollbarGutter: "stable" }}
            >
              <div className="grid gap-2">
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Machine code <span className="font-normal text-red-600">*</span>
                  <Input
                    ref={machineCodeRef}
                    data-testid="machine-field-code"
                    className={cn("h-8 font-mono text-sm uppercase", fieldFocusRing)}
                    value={form.machineCode}
                    onChange={(e) => setForm((f) => ({ ...f, machineCode: e.target.value }))}
                    onBlur={() =>
                      setForm((f) => ({ ...f, machineCode: normalizeMachineCodePreview(f.machineCode) }))
                    }
                    placeholder="INJ-01"
                    maxLength={32}
                    required
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Machine name <span className="font-normal text-red-600">*</span>
                  <Input
                    ref={machineNameRef}
                    data-testid="machine-field-name"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.machineName}
                    onChange={(e) => setForm((f) => ({ ...f, machineName: e.target.value }))}
                    placeholder="Injection press 01"
                    maxLength={120}
                    required
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Machine type / category <span className="font-normal text-red-600">*</span>
                  <select
                    ref={machineTypeRef}
                    data-testid="machine-field-type"
                    className={selectClass}
                    value={form.machineType}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, machineType: e.target.value as MachineType }))
                    }
                    required
                  >
                    {MACHINE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Make
                  <Input
                    data-testid="machine-field-make"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.make}
                    onChange={(e) => setForm((f) => ({ ...f, make: e.target.value }))}
                    maxLength={120}
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Model
                  <Input
                    data-testid="machine-field-model"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.model}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                    maxLength={120}
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Serial number
                  <Input
                    data-testid="machine-field-serial"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.serialNumber}
                    onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))}
                    maxLength={120}
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Department / production location
                  <Input
                    data-testid="machine-field-department"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.departmentLocation}
                    onChange={(e) => setForm((f) => ({ ...f, departmentLocation: e.target.value }))}
                    placeholder="Shop floor A"
                    maxLength={120}
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Description / remarks
                  <Input
                    data-testid="machine-field-description"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    maxLength={500}
                  />
                </label>
                <label className="flex items-center gap-2 text-[11px] text-slate-600">
                  <input
                    data-testid="machine-field-active"
                    type="checkbox"
                    className={cn("h-4 w-4 rounded border-slate-300", fieldFocusRing)}
                    checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  />
                  Active
                </label>
                <p className="text-[10px] text-slate-500">
                  Machine code is stored uppercase and must be unique (case-insensitive). Machines cannot be
                  hard-deleted.
                </p>
              </div>
            </div>
            <div
              data-testid="machine-form-actions"
              className="col-start-1 row-start-1 z-[3] flex flex-row-reverse flex-wrap items-center gap-2 justify-self-end self-center bg-white px-3 py-2"
            >
              <Button
                type="submit"
                data-testid="machine-form-submit"
                className={cn("h-8 font-semibold", fieldFocusRing)}
                disabled={saving}
              >
                {saving ? "Saving…" : selectedId ? "Update machine" : "Create machine"}
              </Button>
              {showCancel ? (
                <Button
                  type="button"
                  data-testid="machine-form-cancel"
                  variant="outline"
                  className={cn("h-8", fieldFocusRing)}
                  onClick={onNewMachine}
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
