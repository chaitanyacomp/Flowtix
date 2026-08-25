import * as React from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { useToast } from "../contexts/ToastContext";
import { ErpModal } from "../components/erp/ErpModal";
import { ErpModalFrame, ErpModalFrameBody, ErpModalFrameFooter } from "../components/erp/ErpModalFrame";
import {
  MasterEmptyState,
  MasterListHeader,
  MasterListPageShell,
  MasterListPagination,
  MasterListToolbar,
  MasterNoResultsState,
  MasterSearchInput,
  MasterTableShell,
  MasterTableSkeleton,
  MasterTruncatedCell,
  masterTdClass,
  masterThClass,
  resultCountLabel,
} from "../components/masters/MasterListWorkbench";
import { useMasterListWorkbench } from "../hooks/useMasterListWorkbench";
import { matchesNameSearch, normalizeSearchText, paginateRows } from "../lib/masterListQuery";
import { Pencil, Power, RotateCcw, Trash2 } from "lucide-react";

type UnitRow = {
  id: number;
  unitName: string;
  unitCode?: string | null;
  isActive: boolean;
  itemCount: number;
  bomCount: number;
  inUse: boolean;
  tallyLinked: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

type ConfirmState =
  | { kind: "deactivate"; row: UnitRow }
  | { kind: "delete"; row: UnitRow }
  | null;

export function UnitsPage() {
  const toast = useToast();
  const [rows, setRows] = React.useState<UnitRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [unitName, setUnitName] = React.useState("");
  const [unitCode, setUnitCode] = React.useState("");
  const [confirm, setConfirm] = React.useState<ConfirmState>(null);

  const wb = useMasterListWorkbench({ initial: { statusFilter: "active" } });
  const { query, setSearch, clearSearch, setStatusFilter, clearFilters, setPage, setPageSize } = wb;

  function load() {
    setLoading(true);
    setError(null);
    apiFetch<UnitRow[]>("/api/units?includeInactive=true")
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load units"))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    load();
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.debouncedSearch;
    let list = rows.filter(
      (u) =>
        matchesNameSearch(u.unitName, q) ||
        (u.unitCode ? matchesNameSearch(u.unitCode, q) : false),
    );
    if (query.statusFilter === "active") list = list.filter((u) => u.isActive !== false);
    if (query.statusFilter === "inactive") list = list.filter((u) => u.isActive === false);
    return list;
  }, [rows, query.debouncedSearch, query.statusFilter]);

  const { pageRows, totalPages, from, to } = paginateRows(filtered, query.page, query.pageSize);
  const searching = Boolean(normalizeSearchText(query.debouncedSearch));
  const filtersActive = searching || query.statusFilter !== "all";

  function openCreate() {
    setEditingId(null);
    setUnitName("");
    setUnitCode("");
    setError(null);
    setFormOpen(true);
  }

  function openEdit(row: UnitRow) {
    if (!row.canEdit) {
      toast.showError("In use — deactivate only");
      return;
    }
    setEditingId(row.id);
    setUnitName(row.unitName);
    setUnitCode(row.unitCode ?? "");
    setError(null);
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditingId(null);
  }

  async function onSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    const name = unitName.trim();
    if (!name) {
      setError("Unit name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = { unitName: name, unitCode: unitCode.trim() || null };
      if (editingId != null) {
        await apiFetch(`/api/units/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
        toast.showSuccess("Unit updated");
      } else {
        await apiFetch("/api/units", { method: "POST", body: JSON.stringify(body) });
        toast.showSuccess("Unit added");
      }
      setFormOpen(false);
      setEditingId(null);
      setUnitName("");
      setUnitCode("");
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save unit";
      setError(msg);
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function runDeactivate(row: UnitRow) {
    setSaving(true);
    try {
      await apiFetch(`/api/units/${row.id}/deactivate`, { method: "POST", body: "{}" });
      toast.showSuccess(`“${row.unitName}” deactivated`);
      setConfirm(null);
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to deactivate";
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function runActivate(row: UnitRow) {
    setSaving(true);
    try {
      await apiFetch(`/api/units/${row.id}/activate`, { method: "POST", body: "{}" });
      toast.showSuccess(`“${row.unitName}” reactivated`);
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reactivate";
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function runDelete(row: UnitRow) {
    setSaving(true);
    try {
      await apiFetch(`/api/units/${row.id}`, { method: "DELETE" });
      toast.showSuccess(`“${row.unitName}” deleted`);
      setConfirm(null);
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete";
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <MasterListPageShell>
      <MasterListHeader
        title="Units"
        description="Units used on items and BOMs. Used units can be deactivated; only unused units can be renamed or deleted."
        actions={
          <Button type="button" className="h-9" onClick={openCreate} data-testid="master-add-unit">
            + Add unit
          </Button>
        }
      />

      {error && !formOpen ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      ) : null}

      <MasterListToolbar
        search={
          <MasterSearchInput
            value={query.search}
            onChange={setSearch}
            onClear={clearSearch}
            placeholder="Search units…"
            aria-label="Search units"
          />
        }
        filters={
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="whitespace-nowrap">Status</span>
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
              value={query.statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
              aria-label="Filter units by status"
              data-testid="units-status-filter"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
          </label>
        }
        resultLabel={resultCountLabel({ filtered: filtered.length, total: rows.length, searching: filtersActive })}
        showClearFilters={filtersActive}
        onClearFilters={clearFilters}
      />

      {loading ? (
        <MasterTableShell>
          <thead>
            <tr>
              <th className={masterThClass}>&nbsp;</th>
              <th className={masterThClass}>&nbsp;</th>
              <th className={masterThClass}>&nbsp;</th>
              <th className={masterThClass}>&nbsp;</th>
            </tr>
          </thead>
          <MasterTableSkeleton cols={4} />
        </MasterTableShell>
      ) : rows.length === 0 ? (
        <MasterEmptyState title="No units yet" description="Add a unit to use in item masters." />
      ) : filtered.length === 0 ? (
        <MasterNoResultsState query={query.debouncedSearch || "filters"} onClear={clearFilters} />
      ) : (
        <>
          <MasterTableShell>
            <thead>
              <tr>
                <th className={masterThClass}>Name</th>
                <th className={masterThClass}>Code</th>
                <th className={masterThClass}>Status</th>
                <th className={masterThClass}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((u) => (
                <tr key={u.id} style={{ height: 50 }} data-testid={`unit-row-${u.id}`}>
                  <MasterTruncatedCell text={u.unitName} />
                  <td className={masterTdClass}>{u.unitCode ?? "—"}</td>
                  <td className={masterTdClass}>
                    <div className="flex flex-wrap items-center gap-1">
                      {u.isActive ? (
                        <Badge variant="success" className="font-normal">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="default" className="font-normal text-slate-600">
                          Inactive
                        </Badge>
                      )}
                      {u.inUse ? (
                        <span className="text-[11px] font-medium text-amber-800" data-testid={`unit-in-use-${u.id}`}>
                          In use — deactivate only
                        </span>
                      ) : null}
                      {u.tallyLinked ? (
                        <span className="text-[11px] text-slate-500" title="Linked to Tally import">
                          Tally
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className={masterTdClass}>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={!u.canEdit || saving}
                        title={u.canEdit ? "Edit name or code" : "In use — deactivate only"}
                        aria-label={`Edit ${u.unitName}`}
                        data-testid={`unit-edit-${u.id}`}
                        onClick={() => openEdit(u)}
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        Edit
                      </Button>
                      {u.isActive ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8"
                          disabled={saving}
                          aria-label={`Deactivate ${u.unitName}`}
                          data-testid={`unit-deactivate-${u.id}`}
                          onClick={() => setConfirm({ kind: "deactivate", row: u })}
                        >
                          <Power className="mr-1 h-3.5 w-3.5" />
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8"
                          disabled={saving}
                          aria-label={`Reactivate ${u.unitName}`}
                          data-testid={`unit-reactivate-${u.id}`}
                          onClick={() => void runActivate(u)}
                        >
                          <RotateCcw className="mr-1 h-3.5 w-3.5" />
                          Reactivate
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-red-700"
                        disabled={!u.canDelete || saving}
                        title={
                          u.canDelete
                            ? "Permanently delete"
                            : u.tallyLinked
                              ? "Tally-linked — deactivate only"
                              : "In use — deactivate only"
                        }
                        aria-label={`Delete ${u.unitName}`}
                        data-testid={`unit-delete-${u.id}`}
                        onClick={() => {
                          if (!u.canDelete) return;
                          setConfirm({ kind: "delete", row: u });
                        }}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </MasterTableShell>
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
        </>
      )}

      {formOpen ? (
        <ErpModal onClose={closeForm} closeOnBackdropClick draggable aria-labelledby="unit-form-title">
          <ErpModalFrame
            size="sm"
            titleId="unit-form-title"
            title={editingId != null ? "Edit unit" : "Add unit"}
            onClose={closeForm}
            closeButtonTestId="unit-master-modal-close"
          >
            <form onSubmit={onSubmitForm} className="flex min-h-0 flex-1 flex-col">
              <ErpModalFrameBody className="space-y-3">
                <label className="grid gap-1 text-xs font-medium text-slate-600">
                  Unit name
                  <Input
                    className="h-9"
                    value={unitName}
                    onChange={(e) => setUnitName(e.target.value)}
                    placeholder="Nos"
                    autoFocus
                    data-testid="unit-form-name"
                  />
                </label>
                <label className="grid gap-1 text-xs font-medium text-slate-600">
                  Unit code (optional)
                  <Input
                    className="h-9"
                    value={unitCode}
                    onChange={(e) => setUnitCode(e.target.value)}
                    placeholder="NOS"
                    data-testid="unit-form-code"
                  />
                </label>
                {error ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
                ) : null}
              </ErpModalFrameBody>
              <ErpModalFrameFooter>
                <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving} data-testid="unit-form-save">
                  {saving ? "Saving…" : editingId != null ? "Save" : "Create"}
                </Button>
              </ErpModalFrameFooter>
            </form>
          </ErpModalFrame>
        </ErpModal>
      ) : null}

      {confirm ? (
        <ErpModal
          onClose={() => !saving && setConfirm(null)}
          closeOnBackdropClick={!saving}
          aria-label={confirm.kind === "delete" ? "Confirm delete unit" : "Confirm deactivate unit"}
        >
          <Card className="erp-modal-shell-md w-[calc(100vw-2rem)] max-w-[480px]">
            <CardContent className="space-y-3 p-4">
              {confirm.kind === "deactivate" ? (
                <>
                  <div className="text-base font-semibold text-slate-900">
                    Deactivate “{confirm.row.unitName}”?
                  </div>
                  <p className="text-sm text-slate-600">
                    It will no longer appear in item or BOM dropdowns. Existing items, BOMs, and documents keep their
                    history.
                  </p>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="outline" disabled={saving} onClick={() => setConfirm(null)}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      disabled={saving}
                      data-testid="unit-confirm-deactivate"
                      onClick={() => void runDeactivate(confirm.row)}
                    >
                      {saving ? "Working…" : "Deactivate"}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-base font-semibold text-slate-900">
                    Permanently delete “{confirm.row.unitName}”?
                  </div>
                  <p className="text-sm text-slate-600">This cannot be undone. Only unused units can be deleted.</p>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="outline" disabled={saving} onClick={() => setConfirm(null)}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={saving}
                      data-testid="unit-confirm-delete"
                      onClick={() => void runDelete(confirm.row)}
                    >
                      {saving ? "Deleting…" : "Delete"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </ErpModal>
      ) : null}
    </MasterListPageShell>
  );
}
