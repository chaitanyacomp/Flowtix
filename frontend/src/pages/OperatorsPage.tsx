/**
 * Operator Master — production operator register (Step 2).
 * Soft activate/deactivate only. Shop-floor workers are not uniquely linked to ERP users.
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
  createOperator,
  normalizeOperatorCodePreview,
  updateOperator,
  type OperatorRow,
} from "../lib/operatorApi";
import {
  applyOperatorFocus,
  firstEditableFocusTarget,
  isDuplicateEmployeeNumberError,
  isDuplicateOperatorCodeError,
  type OperatorFocusIntent,
} from "../lib/operatorMasterFocus";

const fieldFocusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2";

const emptyForm = {
  operatorCode: "",
  operatorName: "",
  employeeNumber: "",
  department: "",
  designationSkill: "",
  remarks: "",
  isActive: true,
};

function rowToForm(r: OperatorRow) {
  return {
    operatorCode: r.operatorCode,
    operatorName: r.operatorName,
    employeeNumber: r.employeeNumber ?? "",
    department: r.department ?? "",
    designationSkill: r.designationSkill ?? "",
    remarks: r.remarks ?? "",
    isActive: r.isActive,
  };
}

export function OperatorsPage() {
  const toast = useToast();
  useListScrollRestoration();
  const [rows, setRows] = React.useState<OperatorRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [form, setForm] = React.useState(emptyForm);
  const [formBaseline, setFormBaseline] = React.useState(() => JSON.stringify(emptyForm));
  const [saving, setSaving] = React.useState(false);
  const [showInactive, setShowInactive] = React.useState(true);
  const [focusEpoch, setFocusEpoch] = React.useState(0);
  const operatorCodeRef = React.useRef<HTMLInputElement>(null);
  const operatorNameRef = React.useRef<HTMLInputElement>(null);
  const employeeNumberRef = React.useRef<HTMLInputElement>(null);
  const pendingFocusRef = React.useRef<OperatorFocusIntent | null>(null);
  const initialFocusDoneRef = React.useRef(false);
  const wb = useMasterListWorkbench();
  const { query, setSearch, clearSearch, clearFilters, setPage, setPageSize } = wb;
  const formDirty = JSON.stringify(form) !== formBaseline;
  const showCancel = selectedId != null || formDirty;
  useUnsavedChangesGuard({
    isDirty: formDirty,
    message: "Operator form has unsaved changes. Leave and discard them?",
  });

  function queueFocus(intent: OperatorFocusIntent) {
    pendingFocusRef.current = intent;
    setFocusEpoch((n) => n + 1);
  }

  function loadOperators() {
    setLoading(true);
    setError(null);
    const qs = showInactive ? "?includeInactive=1" : "";
    apiFetch<OperatorRow[]>(`/api/operators${qs}`)
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load operators"))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    loadOperators();
  }, [showInactive]);

  React.useEffect(() => {
    if (loading) return;
    if (initialFocusDoneRef.current) return;
    if (selectedId != null) return;
    initialFocusDoneRef.current = true;
    queueFocus({ target: "operator-code", force: false });
  }, [loading, selectedId]);

  React.useEffect(() => {
    const intent = pendingFocusRef.current;
    if (!intent) return;
    if (!intent.force && loading) return;
    const frame = window.requestAnimationFrame(() => {
      const applied = applyOperatorFocus(intent, {
        code: operatorCodeRef.current,
        name: operatorNameRef.current,
        employeeNumber: employeeNumberRef.current,
      });
      if (applied) pendingFocusRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusEpoch, form, selectedId, loading]);

  const filtered = React.useMemo(() => {
    const q = query.debouncedSearch;
    return rows.filter(
      (r) =>
        matchesNameSearch(r.operatorName, q) ||
        matchesNameSearch(r.operatorCode, q) ||
        (r.employeeNumber ? matchesNameSearch(r.employeeNumber, q) : false) ||
        (r.department ? matchesNameSearch(r.department, q) : false) ||
        (r.designationSkill ? matchesNameSearch(r.designationSkill, q) : false),
    );
  }, [rows, query.debouncedSearch]);

  const { pageRows, totalPages, from, to } = paginateRows(filtered, query.page, query.pageSize);
  const searching = Boolean(normalizeSearchText(query.debouncedSearch));

  function applyRowToForm(r: OperatorRow) {
    const next = rowToForm(r);
    setSelectedId(r.id);
    setForm(next);
    setFormBaseline(JSON.stringify(next));
    setError(null);
  }

  function selectRow(r: OperatorRow) {
    applyRowToForm(r);
    queueFocus({ target: firstEditableFocusTarget("edit"), force: true });
  }

  function resetToNewForm() {
    setSelectedId(null);
    setForm(emptyForm);
    setFormBaseline(JSON.stringify(emptyForm));
    setError(null);
  }

  function onNewOperator() {
    resetToNewForm();
    queueFocus({ target: "operator-code", force: true });
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const operatorCode = normalizeOperatorCodePreview(form.operatorCode);
    const operatorName = form.operatorName.trim();
    if (!operatorCode) {
      setError("Operator code is required");
      toast.showError("Operator code is required");
      queueFocus({ target: "operator-code", force: true });
      return;
    }
    if (!operatorName) {
      setError("Operator name is required");
      toast.showError("Operator name is required");
      queueFocus({ target: "operator-name", force: true });
      return;
    }

    const payload = {
      operatorCode,
      operatorName,
      employeeNumber: form.employeeNumber.trim() || null,
      department: form.department.trim() || null,
      designationSkill: form.designationSkill.trim() || null,
      remarks: form.remarks.trim() || null,
      isActive: form.isActive,
    };

    const editingId = selectedId;
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        const updated = await updateOperator(editingId, payload);
        toast.showSuccess("Operator updated");
        applyRowToForm(updated);
        loadOperators();
        queueFocus({ target: firstEditableFocusTarget("edit"), force: true });
      } else {
        await createOperator(payload);
        toast.showSuccess("Operator created");
        resetToNewForm();
        loadOperators();
        queueFocus({ target: "operator-code", force: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setError(msg);
      toast.showError(msg);
      if (isDuplicateOperatorCodeError(msg)) {
        queueFocus({ target: "operator-code", select: true, force: true });
      } else if (isDuplicateEmployeeNumberError(msg)) {
        queueFocus({ target: "employee-number", force: true });
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: OperatorRow) {
    setSaving(true);
    setError(null);
    try {
      await updateOperator(row.id, { isActive: !row.isActive });
      toast.showSuccess(row.isActive ? "Operator deactivated" : "Operator activated");
      loadOperators();
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
        title="Operators"
        description="Shop-floor operator register. Operators can join and leave Shift Sessions. Soft-deactivate only."
        actions={
          <Button type="button" size="sm" variant="outline" onClick={onNewOperator} data-testid="operator-new-btn">
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
            placeholder="Search operators…"
            aria-label="Search operators"
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
        data-testid="operators-workspace"
      >
        <section
          className="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm max-lg:max-h-[min(50dvh,28rem)]"
          data-testid="operators-list-panel"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-2 py-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Operator list</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto" data-testid="operators-list-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-2 py-1.5">Code</th>
                  <th className="px-2 py-1.5">Name</th>
                  <th className="px-2 py-1.5">Emp #</th>
                  <th className="px-2 py-1.5">Department</th>
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
                    <td className="px-2 py-1.5 font-mono text-[11px]">{r.operatorCode}</td>
                    <td className="px-2 py-1.5 font-medium text-slate-900">{r.operatorName}</td>
                    <td className="px-2 py-1.5 text-slate-600">{r.employeeNumber || "—"}</td>
                    <td className="px-2 py-1.5 text-slate-600">{r.department || "—"}</td>
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
                      {loading ? "Loading…" : searching ? "No matching operators" : "No operators yet"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {!loading && filtered.length > 0 ? (
            <div className="shrink-0 border-t border-slate-100 px-2 py-1.5" data-testid="operators-list-pagination">
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
          data-testid="operator-form-card"
        >
          <form
            data-testid="operator-form"
            noValidate
            className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]"
            onSubmit={(e) => void onSave(e)}
          >
            <div
              data-testid="operator-form-header"
              className="col-start-1 row-start-1 flex min-h-[2.75rem] shrink-0 items-center border-b border-slate-200 bg-white px-3 py-2 pr-[11.5rem]"
            >
              <h3 className="truncate text-sm font-bold text-slate-800">
                {selectedId ? "Edit operator" : "New operator"}
              </h3>
            </div>
            <div
              data-testid="operator-form-fields"
              className="col-start-1 row-start-2 min-h-0 overflow-y-auto px-3 py-2 pb-3"
              style={{ scrollbarGutter: "stable" }}
            >
              <div className="grid gap-2">
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Operator code <span className="font-normal text-red-600">*</span>
                  <Input
                    ref={operatorCodeRef}
                    data-testid="operator-field-code"
                    className={cn("h-8 font-mono text-sm uppercase", fieldFocusRing)}
                    value={form.operatorCode}
                    onChange={(e) => setForm((f) => ({ ...f, operatorCode: e.target.value }))}
                    onBlur={() =>
                      setForm((f) => ({
                        ...f,
                        operatorCode: normalizeOperatorCodePreview(f.operatorCode),
                      }))
                    }
                    placeholder="OP-01"
                    maxLength={32}
                    required
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Operator name <span className="font-normal text-red-600">*</span>
                  <Input
                    ref={operatorNameRef}
                    data-testid="operator-field-name"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.operatorName}
                    onChange={(e) => setForm((f) => ({ ...f, operatorName: e.target.value }))}
                    placeholder="Ramesh Kumar"
                    maxLength={120}
                    required
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Employee number
                  <Input
                    ref={employeeNumberRef}
                    data-testid="operator-field-employee"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.employeeNumber}
                    onChange={(e) => setForm((f) => ({ ...f, employeeNumber: e.target.value }))}
                    maxLength={64}
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Department
                  <Input
                    data-testid="operator-field-department"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.department}
                    onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                    maxLength={120}
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Designation / skill
                  <Input
                    data-testid="operator-field-designation"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.designationSkill}
                    onChange={(e) => setForm((f) => ({ ...f, designationSkill: e.target.value }))}
                    maxLength={120}
                  />
                </label>
                <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
                  Remarks
                  <Input
                    data-testid="operator-field-remarks"
                    className={cn("h-8 text-sm", fieldFocusRing)}
                    value={form.remarks}
                    onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                    maxLength={500}
                  />
                </label>
                <label className="flex items-center gap-2 text-[11px] text-slate-600">
                  <input
                    data-testid="operator-field-active"
                    type="checkbox"
                    className={cn("h-4 w-4 rounded border-slate-300", fieldFocusRing)}
                    checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  />
                  Active
                </label>
                <p className="text-[10px] text-slate-500">
                  Operator code is stored uppercase and must be unique. Employee number is unique when set.
                  Operators cannot be hard-deleted. ERP login users are managed separately and are not linked
                  here.
                </p>
              </div>
            </div>
            <div
              data-testid="operator-form-actions"
              className="col-start-1 row-start-1 z-[3] flex flex-row-reverse flex-wrap items-center gap-2 justify-self-end self-center bg-white px-3 py-2"
            >
              <Button
                type="submit"
                data-testid="operator-form-submit"
                className={cn("h-8 font-semibold", fieldFocusRing)}
                disabled={saving}
              >
                {saving ? "Saving…" : selectedId ? "Update operator" : "Create operator"}
              </Button>
              {showCancel ? (
                <Button
                  type="button"
                  data-testid="operator-form-cancel"
                  variant="outline"
                  className={cn("h-8", fieldFocusRing)}
                  onClick={onNewOperator}
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
