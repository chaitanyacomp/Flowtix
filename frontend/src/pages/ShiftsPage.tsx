/**
 * Shift Master — production shift templates (Step 3).
 * Soft activate/deactivate only. Not wired to sessions/machines/operators yet.
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
  createShift,
  normalizeShiftCodePreview,
  updateShift,
  type ShiftRow,
} from "../lib/shiftApi";
import {
  computeShiftDurationsPreview,
  formatDurationMinutes,
} from "../lib/shiftDuration";
import {
  applyShiftFocus,
  firstEditableFocusTarget,
  isDuplicateShiftCodeError,
  type ShiftFocusIntent,
} from "../lib/shiftMasterFocus";

const fieldFocusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2";

const emptyForm = {
  shiftCode: "",
  shiftName: "",
  startTime: "06:00",
  endTime: "14:00",
  plannedBreakMinutes: "0",
  remarks: "",
  isActive: true,
};

function rowToForm(r: ShiftRow) {
  return {
    shiftCode: r.shiftCode,
    shiftName: r.shiftName,
    startTime: r.startTime.slice(0, 5),
    endTime: r.endTime.slice(0, 5),
    plannedBreakMinutes: String(r.plannedBreakMinutes ?? 0),
    remarks: r.remarks ?? "",
    isActive: r.isActive,
  };
}

export function ShiftsPage() {
  const toast = useToast();
  useListScrollRestoration();
  const [rows, setRows] = React.useState<ShiftRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [form, setForm] = React.useState(emptyForm);
  const [formBaseline, setFormBaseline] = React.useState(() => JSON.stringify(emptyForm));
  const [saving, setSaving] = React.useState(false);
  const [showInactive, setShowInactive] = React.useState(true);
  const [focusEpoch, setFocusEpoch] = React.useState(0);
  const shiftCodeRef = React.useRef<HTMLInputElement>(null);
  const shiftNameRef = React.useRef<HTMLInputElement>(null);
  const startTimeRef = React.useRef<HTMLInputElement>(null);
  const endTimeRef = React.useRef<HTMLInputElement>(null);
  const breakMinutesRef = React.useRef<HTMLInputElement>(null);
  const pendingFocusRef = React.useRef<ShiftFocusIntent | null>(null);
  const initialFocusDoneRef = React.useRef(false);
  const wb = useMasterListWorkbench();
  const { query, setSearch, clearSearch, clearFilters, setPage, setPageSize } = wb;
  const formDirty = JSON.stringify(form) !== formBaseline;
  const showCancel = selectedId != null || formDirty;
  useUnsavedChangesGuard({
    isDirty: formDirty,
    message: "Shift form has unsaved changes. Leave and discard them?",
  });

  const durationPreview = React.useMemo(
    () => computeShiftDurationsPreview(form.startTime, form.endTime, form.plannedBreakMinutes),
    [form.startTime, form.endTime, form.plannedBreakMinutes],
  );

  function queueFocus(intent: ShiftFocusIntent) {
    pendingFocusRef.current = intent;
    setFocusEpoch((n) => n + 1);
  }

  function loadShifts() {
    setLoading(true);
    setError(null);
    const qs = showInactive ? "?includeInactive=1" : "";
    apiFetch<ShiftRow[]>(`/api/shifts${qs}`)
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load shifts"))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    loadShifts();
  }, [showInactive]);

  React.useEffect(() => {
    if (loading) return;
    if (initialFocusDoneRef.current) return;
    if (selectedId != null) return;
    initialFocusDoneRef.current = true;
    queueFocus({ target: "shift-code", force: false });
  }, [loading, selectedId]);

  React.useEffect(() => {
    const intent = pendingFocusRef.current;
    if (!intent) return;
    if (!intent.force && loading) return;
    const frame = window.requestAnimationFrame(() => {
      const applied = applyShiftFocus(intent, {
        code: shiftCodeRef.current,
        name: shiftNameRef.current,
        startTime: startTimeRef.current,
        endTime: endTimeRef.current,
        breakMinutes: breakMinutesRef.current,
      });
      if (applied) pendingFocusRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusEpoch, form, selectedId, loading]);

  const filtered = React.useMemo(() => {
    const q = query.debouncedSearch;
    return rows.filter(
      (r) =>
        matchesNameSearch(r.shiftName, q) ||
        matchesNameSearch(r.shiftCode, q) ||
        matchesNameSearch(r.startTime, q) ||
        matchesNameSearch(r.endTime, q),
    );
  }, [rows, query.debouncedSearch]);

  const { pageRows, totalPages, from, to } = paginateRows(filtered, query.page, query.pageSize);
  const searching = Boolean(normalizeSearchText(query.debouncedSearch));

  function applyRowToForm(r: ShiftRow) {
    const next = rowToForm(r);
    setSelectedId(r.id);
    setForm(next);
    setFormBaseline(JSON.stringify(next));
    setError(null);
  }

  function selectRow(r: ShiftRow) {
    applyRowToForm(r);
    queueFocus({ target: firstEditableFocusTarget("edit"), force: true });
  }

  function resetToNewForm() {
    setSelectedId(null);
    setForm(emptyForm);
    setFormBaseline(JSON.stringify(emptyForm));
    setError(null);
  }

  function onNewShift() {
    resetToNewForm();
    queueFocus({ target: "shift-code", force: true });
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const shiftCode = normalizeShiftCodePreview(form.shiftCode);
    const shiftName = form.shiftName.trim();
    if (!shiftCode) {
      setError("Shift code is required");
      toast.showError("Shift code is required");
      queueFocus({ target: "shift-code", force: true });
      return;
    }
    if (!shiftName) {
      setError("Shift name is required");
      toast.showError("Shift name is required");
      queueFocus({ target: "shift-name", force: true });
      return;
    }
    if ("error" in durationPreview) {
      const previewError = durationPreview.error ?? "Invalid shift times";
      setError(previewError);
      toast.showError(previewError);
      if (/identical/i.test(previewError)) {
        queueFocus({ target: "end-time", force: true });
      } else if (/break/i.test(previewError)) {
        queueFocus({ target: "break-minutes", force: true });
      } else {
        queueFocus({ target: "start-time", force: true });
      }
      return;
    }

    const payload = {
      shiftCode,
      shiftName,
      startTime: durationPreview.startTime,
      endTime: durationPreview.endTime,
      plannedBreakMinutes: durationPreview.plannedBreakMinutes,
      remarks: form.remarks.trim() || null,
      isActive: form.isActive,
    };

    const editingId = selectedId;
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        const updated = await updateShift(editingId, payload);
        toast.showSuccess("Shift updated");
        applyRowToForm(updated);
        loadShifts();
        queueFocus({ target: firstEditableFocusTarget("edit"), force: true });
      } else {
        await createShift(payload);
        toast.showSuccess("Shift created");
        resetToNewForm();
        loadShifts();
        queueFocus({ target: "shift-code", force: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setError(msg);
      toast.showError(msg);
      if (isDuplicateShiftCodeError(msg)) {
        queueFocus({ target: "shift-code", select: true, force: true });
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: ShiftRow) {
    setSaving(true);
    setError(null);
    try {
      await updateShift(row.id, { isActive: !row.isActive });
      toast.showSuccess(row.isActive ? "Shift deactivated" : "Shift activated");
      loadShifts();
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
        title="Shifts"
        description="Production shift templates. Soft-deactivate only — not used for Start Shift sessions yet."
        actions={
          <Button type="button" size="sm" variant="outline" onClick={onNewShift} data-testid="shift-new-btn">
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
            placeholder="Search shifts…"
            aria-label="Search shifts"
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
        data-testid="shifts-workspace"
      >
        <section
          className="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm max-lg:max-h-[min(50dvh,28rem)]"
          data-testid="shifts-list-panel"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-2 py-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Shift list</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto" data-testid="shifts-list-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-2 py-1.5">Code</th>
                  <th className="px-2 py-1.5">Name</th>
                  <th className="px-2 py-1.5">Window</th>
                  <th className="px-2 py-1.5">Net</th>
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
                    <td className="px-2 py-1.5 font-mono text-[11px]">{r.shiftCode}</td>
                    <td className="px-2 py-1.5 font-medium text-slate-900">{r.shiftName}</td>
                    <td className="px-2 py-1.5 tabular-nums text-slate-700">
                      {r.startTime}–{r.endTime}
                      {r.isOvernight ? (
                        <span className="ml-1 text-[10px] font-semibold uppercase text-amber-700">overnight</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums text-slate-600">
                      {r.netProductionDurationLabel ??
                        formatDurationMinutes(r.netProductionDurationMinutes ?? 0)}
                    </td>
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
                      {loading ? "Loading…" : searching ? "No matching shifts" : "No shifts yet"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {!loading && filtered.length > 0 ? (
            <div className="shrink-0 border-t border-slate-100 px-2 py-1.5" data-testid="shifts-list-pagination">
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
          data-testid="shift-form-card"
        >
          <form
            data-testid="shift-form"
            noValidate
            className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]"
            onSubmit={(e) => void onSave(e)}
          >
            <div
              data-testid="shift-form-header"
              className="col-start-1 row-start-1 flex min-h-[2.75rem] shrink-0 items-center border-b border-slate-200 bg-white px-3 py-2 pr-[11.5rem]"
            >
              <h3 className="truncate text-sm font-bold text-slate-800">
                {selectedId ? "Edit shift" : "New shift"}
              </h3>
            </div>
            <div
              data-testid="shift-form-fields"
              className="col-start-1 row-start-2 min-h-0 overflow-y-auto px-3 py-2 pb-3"
              style={{ scrollbarGutter: "stable" }}
            >
              <div className="grid gap-2">
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Shift code <span className="font-normal text-red-600">*</span>
                  <Input
                    ref={shiftCodeRef}
                    data-testid="shift-field-code"
                    className={cn("h-8 font-mono text-sm uppercase", fieldFocusRing)}
                    value={form.shiftCode}
                    onChange={(e) => setForm((f) => ({ ...f, shiftCode: e.target.value }))}
                    onBlur={() =>
                      setForm((f) => ({ ...f, shiftCode: normalizeShiftCodePreview(f.shiftCode) }))
                    }
                    placeholder="SHIFT-A"
                    maxLength={32}
                    required
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Shift name <span className="font-normal text-red-600">*</span>
                  <Input
                    ref={shiftNameRef}
                    data-testid="shift-field-name"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.shiftName}
                    onChange={(e) => setForm((f) => ({ ...f, shiftName: e.target.value }))}
                    placeholder="Morning A"
                    maxLength={120}
                    required
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Start time <span className="font-normal text-red-600">*</span>
                  <Input
                    ref={startTimeRef}
                    data-testid="shift-field-start"
                    type="time"
                    step={60}
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.startTime}
                    onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                    required
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  End time <span className="font-normal text-red-600">*</span>
                  <Input
                    ref={endTimeRef}
                    data-testid="shift-field-end"
                    type="time"
                    step={60}
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.endTime}
                    onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                    required
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Planned break minutes
                  <Input
                    ref={breakMinutesRef}
                    data-testid="shift-field-break"
                    type="number"
                    min={0}
                    step={1}
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.plannedBreakMinutes}
                    onChange={(e) => setForm((f) => ({ ...f, plannedBreakMinutes: e.target.value }))}
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Remarks
                  <Input
                    data-testid="shift-field-remarks"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.remarks}
                    onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                    maxLength={500}
                  />
                </label>
                <label className="flex items-center gap-2 text-[11px] text-slate-600">
                  <input
                    data-testid="shift-field-active"
                    type="checkbox"
                    className={cn("h-4 w-4 rounded border-slate-300", fieldFocusRing)}
                    checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  />
                  Active
                </label>

                <div
                  data-testid="shift-duration-preview"
                  className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700"
                >
                  {"error" in durationPreview ? (
                    <p className="font-medium text-amber-800">{durationPreview.error}</p>
                  ) : (
                    <dl className="grid gap-1">
                      <div className="flex justify-between gap-2">
                        <dt>Gross shift duration</dt>
                        <dd className="tabular-nums font-semibold">
                          {formatDurationMinutes(durationPreview.grossDurationMinutes)} (
                          {durationPreview.grossDurationMinutes} min)
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>Net production duration</dt>
                        <dd className="tabular-nums font-semibold">
                          {formatDurationMinutes(durationPreview.netProductionDurationMinutes)} (
                          {durationPreview.netProductionDurationMinutes} min)
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>Overnight shift</dt>
                        <dd className="font-semibold">{durationPreview.isOvernight ? "Yes" : "No"}</dd>
                      </div>
                    </dl>
                  )}
                </div>
                <p className="text-[10px] text-slate-500">
                  Times are stored as HH:mm (time of day) without timezone conversion. End before start means
                  overnight. Shifts cannot be hard-deleted.
                </p>
              </div>
            </div>
            <div
              data-testid="shift-form-actions"
              className="col-start-1 row-start-1 z-[3] flex flex-row-reverse flex-wrap items-center gap-2 justify-self-end self-center bg-white px-3 py-2"
            >
              <Button
                type="submit"
                data-testid="shift-form-submit"
                className={cn("h-8 font-semibold", fieldFocusRing)}
                disabled={saving}
              >
                {saving ? "Saving…" : selectedId ? "Update shift" : "Create shift"}
              </Button>
              {showCancel ? (
                <Button
                  type="button"
                  data-testid="shift-form-cancel"
                  variant="outline"
                  className={cn("h-8", fieldFocusRing)}
                  onClick={onNewShift}
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
