import * as React from "react";
import { useLocation } from "react-router-dom";
import { apiFetch, ApiRequestError } from "../services/api";
import { Button } from "../components/ui/button";
import { NativeSelect } from "../components/ui/native-select";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../contexts/ToastContext";
import { Pencil, Trash2 } from "lucide-react";
import { SupplierMasterForm } from "../components/erp/SupplierMasterForm";
import { PartyMasterModal } from "../components/erp/partyMasterUi";
import type { StateRow } from "../lib/gstinValidation";
import { isReportsReturnContext } from "../lib/drillDownRoutes";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { confirmLeaveIfDirty } from "../lib/unsavedChangesPolicy";
import { useListScrollRestoration } from "../hooks/useListScrollRestoration";
import {
  MasterBulkActionBar,
  MasterEmptyState,
  MasterErrorState,
  MasterListHeader,
  MasterListPageShell,
  MasterListPagination,
  MasterListToolbar,
  MasterNoResultsState,
  MasterRowCheckbox,
  MasterSearchInput,
  MasterSelectAllCheckbox,
  MasterSortHeader,
  MasterStatusBadge,
  MasterTableShell,
  MasterTableSkeleton,
  MasterTruncatedCell,
  masterTdClass,
  masterThClass,
  resultCountLabel,
} from "../components/masters/MasterListWorkbench";
import { useMasterListSelection, useMasterListWorkbench } from "../hooks/useMasterListWorkbench";
import {
  compareByKey,
  matchesNameSearch,
  normalizeSearchText,
  paginateRows,
} from "../lib/masterListQuery";
import { postMasterBulkMutation, summarizeMasterBulkResult } from "../lib/masterBulkApi";
import { BulkDeleteConfirmModal } from "../components/masters/BulkDeleteConfirmModal";

type Supplier = {
  id: number;
  name: string;
  contact?: string | null;
  email?: string | null;
  gst?: string | null;
  gstin?: string | null;
  state?: string | null;
  stateId?: number | null;
  stateName?: string | null;
  isActive?: boolean;
  locationCount?: number;
  defaultLocationLabel?: string | null;
};

const SUPPLIER_LEAVE_MESSAGE = "Supplier form has unsaved changes. Leave and discard them?";

export function SuppliersPage() {
  const toast = useToast();
  const location = useLocation();
  useListScrollRestoration();
  const role = useAuth().user?.role;
  const fromAnalysis = isReportsReturnContext(location.search);
  const canWrite = (role === "ADMIN" || role === "STORE") && !fromAnalysis;
  const isAdmin = role === "ADMIN" && !fromAnalysis;
  const [rows, setRows] = React.useState<Supplier[]>([]);
  const [states, setStates] = React.useState<StateRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [formDirty, setFormDirty] = React.useState(false);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const bulkInFlight = React.useRef(false);

  const wb = useMasterListWorkbench();
  const { query, setSearch, clearSearch, setStatusFilter, setFilter, clearFilters, toggleSort, setPage, setPageSize, queryContextKey } =
    wb;

  useUnsavedChangesGuard({
    isDirty: formDirty,
    message: SUPPLIER_LEAVE_MESSAGE,
    enabled: showForm && canWrite,
  });

  const onFormDirtyChange = React.useCallback((dirty: boolean) => {
    setFormDirty(dirty);
  }, []);

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setFormDirty(false);
  }

  function requestCloseForm() {
    if (!confirmLeaveIfDirty(formDirty, SUPPLIER_LEAVE_MESSAGE)) return;
    closeForm();
  }

  function load() {
    setLoading(true);
    setError(null);
    return Promise.all([apiFetch<Supplier[]>("/api/suppliers"), apiFetch<StateRow[]>("/api/states")])
      .then(([sup, st]) => {
        setRows(sup);
        setStates(st);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load suppliers."))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    void load();
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.debouncedSearch;
    const stateId = query.filters.stateId || "";
    const gst = query.filters.gst || "all";
    let list = rows.filter((s) => matchesNameSearch(s.name, q));
    if (query.statusFilter === "active") list = list.filter((s) => s.isActive !== false);
    if (query.statusFilter === "inactive") list = list.filter((s) => s.isActive === false);
    if (stateId) list = list.filter((s) => String(s.stateId ?? "") === stateId);
    if (gst === "with") list = list.filter((s) => Boolean((s.gstin || s.gst || "").trim()));
    if (gst === "without") list = list.filter((s) => !(s.gstin || s.gst || "").trim());
    const key = query.sortKey;
    list = [...list].sort((a, b) =>
      compareByKey(
        a,
        b,
        (r) => {
          if (key === "state") return r.stateName || r.state || "";
          if (key === "status") return r.isActive === false ? 1 : 0;
          if (key === "gstin") return r.gstin || r.gst || "";
          return r.name;
        },
        query.sortDir,
      ),
    );
    return list;
  }, [rows, query.debouncedSearch, query.statusFilter, query.filters, query.sortKey, query.sortDir]);

  const { pageRows, totalPages, from, to } = paginateRows(filtered, query.page, query.pageSize);
  const pageIds = React.useMemo(() => pageRows.map((r) => r.id), [pageRows]);
  const bulkSel = useMasterListSelection(pageIds, queryContextKey);

  const searching =
    Boolean(normalizeSearchText(query.debouncedSearch)) ||
    query.statusFilter !== "all" ||
    Boolean(query.filters.stateId) ||
    Boolean(query.filters.gst && query.filters.gst !== "all");

  async function onDelete(id: number) {
    if (!confirm("Delete supplier?")) return;
    setError(null);
    try {
      await apiFetch(`/api/suppliers/${id}`, { method: "DELETE" });
      await load();
      toast.showSuccess("Supplier deleted");
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) {
        toast.showInfo("Supplier is used in transactions and cannot be deleted.");
        return;
      }
      toast.showError(e instanceof Error ? e.message : "Could not delete supplier.");
    }
  }

  async function runBulk(action: "activate" | "deactivate" | "delete") {
    if (bulkInFlight.current) return;
    const ids = bulkSel.getSelectedIdsArray();
    if (!ids.length) return;
    bulkInFlight.current = true;
    setBulkBusy(true);
    try {
      const result = await postMasterBulkMutation("suppliers", action, ids);
      const verb = action === "activate" ? "activated" : action === "deactivate" ? "deactivated" : "deleted";
      const summary = summarizeMasterBulkResult(result, verb);
      if (summary.tone === "success") toast.showSuccess(summary.message);
      else if (summary.tone === "info") toast.showInfo(summary.message);
      else toast.showError(summary.message);
      bulkSel.clear();
      await load();
    } catch (e) {
      toast.showError(e instanceof Error ? e.message : "Bulk action failed.");
    } finally {
      bulkInFlight.current = false;
      setBulkBusy(false);
      setBulkDeleteOpen(false);
    }
  }

  function openAdd() {
    setError(null);
    setEditingId(null);
    setFormDirty(false);
    setShowForm(true);
  }

  function openEdit(id: number) {
    setError(null);
    setEditingId(id);
    setFormDirty(false);
    setShowForm(true);
  }

  const addBtn =
    canWrite && !fromAnalysis ? (
      <Button type="button" size="sm" onClick={openAdd} data-testid="master-add-supplier">
        + Add supplier
      </Button>
    ) : null;

  return (
    <MasterListPageShell>
      <MasterListHeader
        title="Suppliers"
        description={
          fromAnalysis
            ? "Read-only Analysis view — supplier directory for payable context."
            : "Supplier master, GST details and supply locations."
        }
        actions={addBtn}
      />

      {error && !showForm ? <MasterErrorState message={error} onRetry={() => void load()} /> : null}

      <MasterListToolbar
        search={
          <MasterSearchInput
            value={query.search}
            onChange={setSearch}
            onClear={clearSearch}
            placeholder="Search suppliers by name…"
            aria-label="Search suppliers by name"
          />
        }
        filters={
          <>
            <NativeSelect
              className="h-9 w-[8.5rem] text-sm"
              value={query.statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
              aria-label="Filter by status"
            >
              <option value="all">Status: All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </NativeSelect>
            <NativeSelect
              className="h-9 min-w-[9rem] max-w-[12rem] text-sm"
              value={query.filters.stateId || ""}
              onChange={(e) => setFilter("stateId", e.target.value)}
              aria-label="Filter by state"
            >
              <option value="">State: All</option>
              {states.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.stateName}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="h-9 w-[9.5rem] text-sm"
              value={query.filters.gst || "all"}
              onChange={(e) => setFilter("gst", e.target.value)}
              aria-label="Filter by GSTIN"
            >
              <option value="all">GSTIN: All</option>
              <option value="with">Has GSTIN</option>
              <option value="without">No GSTIN</option>
            </NativeSelect>
          </>
        }
        resultLabel={resultCountLabel({ filtered: filtered.length, total: rows.length, searching })}
        showClearFilters={searching}
        onClearFilters={clearFilters}
        bulkBar={
          canWrite && bulkSel.selectedCount > 0 ? (
            <MasterBulkActionBar
              selectedCount={bulkSel.selectedCount}
              entityLabel={bulkSel.selectedCount === 1 ? "supplier" : "suppliers"}
              busy={bulkBusy}
              onClear={bulkSel.clear}
              onActivate={() => void runBulk("activate")}
              onDeactivate={() => void runBulk("deactivate")}
              onDelete={isAdmin ? () => setBulkDeleteOpen(true) : undefined}
            />
          ) : null
        }
      />

      {loading ? (
        <MasterTableShell>
          <thead>
            <tr>
              {Array.from({ length: 8 }).map((_, i) => (
                <th key={i} className={masterThClass}>
                  &nbsp;
                </th>
              ))}
            </tr>
          </thead>
          <MasterTableSkeleton cols={8} />
        </MasterTableShell>
      ) : rows.length === 0 ? (
        <MasterEmptyState
          title="No suppliers yet"
          description="Add a supplier master to capture GST details and supply locations."
        />
      ) : filtered.length === 0 ? (
        <MasterNoResultsState query={query.debouncedSearch || "filters"} onClear={clearFilters} />
      ) : (
        <>
          <MasterTableShell>
            <thead>
              <tr>
                {canWrite ? (
                  <MasterSelectAllCheckbox
                    checked={bulkSel.allSelected}
                    indeterminate={bulkSel.someSelected}
                    inputRef={bulkSel.selectAllRef}
                    onChange={bulkSel.toggleSelectAll}
                    disabled={pageRows.length === 0}
                  />
                ) : null}
                <MasterSortHeader label="Name" sortKey="name" activeKey={query.sortKey} dir={query.sortDir} onToggle={toggleSort} />
                <th className={masterThClass}>Contact</th>
                <MasterSortHeader label="State" sortKey="state" activeKey={query.sortKey} dir={query.sortDir} onToggle={toggleSort} />
                <MasterSortHeader label="GSTIN" sortKey="gstin" activeKey={query.sortKey} dir={query.sortDir} onToggle={toggleSort} />
                <th className={masterThClass}>Supply locations</th>
                <MasterSortHeader label="Status" sortKey="status" activeKey={query.sortKey} dir={query.sortDir} onToggle={toggleSort} />
                {canWrite ? <th className={`${masterThClass} text-right`}>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((s) => (
                <tr key={s.id} className={s.isActive === false ? "opacity-70" : undefined} style={{ height: 50 }}>
                  {canWrite ? (
                    <MasterRowCheckbox
                      id={s.id}
                      checked={bulkSel.selectedIds.has(s.id)}
                      onChange={(checked) => bulkSel.toggleOne(s.id, checked)}
                      label={s.name}
                    />
                  ) : null}
                  <MasterTruncatedCell text={s.name} />
                  <td className={masterTdClass}>{s.contact || "—"}</td>
                  <td className={`${masterTdClass} max-w-[8rem] truncate`} title={s.stateName || s.state || undefined}>
                    {s.stateName?.trim() || s.state?.trim() || "—"}
                  </td>
                  <td className={`${masterTdClass} max-w-[9rem] truncate font-mono text-xs`} title={s.gstin || s.gst || undefined}>
                    {s.gstin || s.gst || "—"}
                  </td>
                  <td className={masterTdClass}>
                    {s.locationCount ? (
                      <>
                        {s.locationCount} location{s.locationCount === 1 ? "" : "s"}
                        {s.defaultLocationLabel ? (
                          <span className="ml-1 text-xs text-slate-500">· {s.defaultLocationLabel}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-slate-500">Registered office only</span>
                    )}
                  </td>
                  <td className={masterTdClass}>
                    <MasterStatusBadge active={s.isActive !== false} />
                  </td>
                  {canWrite ? (
                    <td className={masterTdClass}>
                      <div className="erp-table-actions" onClick={(e) => e.stopPropagation()}>
                        <Button type="button" size="icon" variant="outline" onClick={() => openEdit(s.id)} aria-label={`Edit ${s.name}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {isAdmin ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="text-slate-600 hover:text-red-700"
                            onClick={() => void onDelete(s.id)}
                            aria-label={`Delete ${s.name}`}
                            title="Suppliers linked to purchase orders cannot be deleted."
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
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

      {showForm ? (
        <PartyMasterModal title={editingId != null ? "Edit supplier" : "Add supplier"} onClose={requestCloseForm}>
          <SupplierMasterForm
            states={states}
            editingId={editingId}
            onDirtyChange={onFormDirtyChange}
            onCancel={requestCloseForm}
            onSaved={async () => {
              closeForm();
              await load();
              toast.showSuccess("Supplier saved");
            }}
          />
        </PartyMasterModal>
      ) : null}

      <BulkDeleteConfirmModal
        open={bulkDeleteOpen}
        count={bulkSel.selectedCount}
        entityLabel="supplier"
        loading={bulkBusy}
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={() => void runBulk("delete")}
      />
    </MasterListPageShell>
  );
}
