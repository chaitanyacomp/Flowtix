import * as React from "react";
import { apiFetch, ApiRequestError } from "../services/api";
import { Button } from "../components/ui/button";
import { NativeSelect } from "../components/ui/native-select";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../contexts/ToastContext";
import { Pencil, Trash2 } from "lucide-react";
import { CustomerMasterForm } from "../components/erp/CustomerMasterForm";
import { PartyMasterModal } from "../components/erp/partyMasterUi";
import type { StateRow } from "../lib/gstinValidation";
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

function messageForCustomerLoadError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const m = (err.message || "").trim();
    if (/prisma|p20\d{2}|invocation/i.test(m)) return "Could not load customers. Please try again.";
    return m || "Could not load customers.";
  }
  return err instanceof Error ? err.message : "Could not load customers.";
}

type Customer = {
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
  deliveryAddressCount?: number;
  defaultDeliveryLabel?: string | null;
};

const CUSTOMER_LEAVE_MESSAGE = "Customer form has unsaved changes. Leave and discard them?";

export function CustomersPage() {
  const toast = useToast();
  const isAdmin = useAuth().user?.role === "ADMIN";
  useListScrollRestoration();
  const [rows, setRows] = React.useState<Customer[]>([]);
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
    message: CUSTOMER_LEAVE_MESSAGE,
    enabled: showForm,
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
    if (!confirmLeaveIfDirty(formDirty, CUSTOMER_LEAVE_MESSAGE)) return;
    closeForm();
  }

  function load() {
    setLoading(true);
    setError(null);
    return Promise.all([apiFetch<Customer[]>("/api/customers"), apiFetch<StateRow[]>("/api/states")])
      .then(([cust, st]) => {
        setRows(cust);
        setStates(st);
      })
      .catch((e) => setError(messageForCustomerLoadError(e)))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    void load();
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.debouncedSearch;
    const stateId = query.filters.stateId || "";
    const gst = query.filters.gst || "all";
    let list = rows.filter((c) => matchesNameSearch(c.name, q));
    if (query.statusFilter === "active") list = list.filter((c) => c.isActive !== false);
    if (query.statusFilter === "inactive") list = list.filter((c) => c.isActive === false);
    if (stateId) list = list.filter((c) => String(c.stateId ?? "") === stateId);
    if (gst === "with") list = list.filter((c) => Boolean((c.gstin || c.gst || "").trim()));
    if (gst === "without") list = list.filter((c) => !(c.gstin || c.gst || "").trim());
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

  const hasActiveFilters = searching;

  async function onDelete(id: number) {
    if (!confirm("Delete customer?")) return;
    setError(null);
    try {
      await apiFetch(`/api/customers/${id}`, { method: "DELETE" });
      await load();
      toast.showSuccess("Customer deleted");
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) {
        toast.showInfo("Customer cannot be deleted because it is used in transactions.");
        return;
      }
      toast.showError(e instanceof Error ? e.message : "Could not delete customer.");
    }
  }

  async function runBulk(action: "activate" | "deactivate" | "delete") {
    if (bulkInFlight.current) return;
    const ids = bulkSel.getSelectedIdsArray();
    if (!ids.length) return;
    bulkInFlight.current = true;
    setBulkBusy(true);
    try {
      const result = await postMasterBulkMutation("customers", action, ids);
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

  const addBtn = isAdmin ? (
    <Button type="button" size="sm" onClick={openAdd} data-testid="master-add-customer">
      + Add customer
    </Button>
  ) : null;

  return (
    <MasterListPageShell>
      <MasterListHeader
        title="Customers"
        description="Customer master, GST details and delivery locations."
        actions={addBtn}
      />

      {error && !showForm ? <MasterErrorState message={error} onRetry={() => void load()} /> : null}

      <MasterListToolbar
        search={
          <MasterSearchInput
            value={query.search}
            onChange={setSearch}
            onClear={clearSearch}
            placeholder="Search customers by name…"
            aria-label="Search customers by name"
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
        showClearFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        bulkBar={
          isAdmin && bulkSel.selectedCount > 0 ? (
            <MasterBulkActionBar
              selectedCount={bulkSel.selectedCount}
              entityLabel={bulkSel.selectedCount === 1 ? "customer" : "customers"}
              busy={bulkBusy}
              onClear={bulkSel.clear}
              onActivate={() => void runBulk("activate")}
              onDeactivate={() => void runBulk("deactivate")}
              onDelete={() => setBulkDeleteOpen(true)}
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
          title="No customers yet"
          description="Add a customer master to capture GST details and delivery locations."
          action={addBtn}
        />
      ) : filtered.length === 0 ? (
        <MasterNoResultsState query={query.debouncedSearch || "filters"} onClear={clearFilters} />
      ) : (
        <>
          <MasterTableShell>
            <thead>
              <tr>
                {isAdmin ? (
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
                <th className={masterThClass}>Delivery locations</th>
                <MasterSortHeader label="Status" sortKey="status" activeKey={query.sortKey} dir={query.sortDir} onToggle={toggleSort} />
                {isAdmin ? <th className={cnActionsTh}>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((c) => (
                <tr key={c.id} className={c.isActive === false ? "opacity-70" : undefined} style={{ height: 50 }}>
                  {isAdmin ? (
                    <MasterRowCheckbox
                      id={c.id}
                      checked={bulkSel.selectedIds.has(c.id)}
                      onChange={(checked) => bulkSel.toggleOne(c.id, checked)}
                      label={c.name}
                    />
                  ) : null}
                  <MasterTruncatedCell text={c.name} />
                  <td className={masterTdClass}>{c.contact || "—"}</td>
                  <td className={`${masterTdClass} max-w-[8rem] truncate`} title={c.stateName || c.state || undefined}>
                    {c.stateName?.trim() || c.state?.trim() || "—"}
                  </td>
                  <td className={`${masterTdClass} max-w-[9rem] truncate font-mono text-xs`} title={c.gstin || c.gst || undefined}>
                    {c.gstin || c.gst || "—"}
                  </td>
                  <td className={masterTdClass}>
                    {c.deliveryAddressCount ? (
                      <>
                        {c.deliveryAddressCount}
                        {c.defaultDeliveryLabel ? <span className="text-slate-500"> · {c.defaultDeliveryLabel}</span> : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={masterTdClass}>
                    <MasterStatusBadge active={c.isActive !== false} />
                  </td>
                  {isAdmin ? (
                    <td className={masterTdClass}>
                      <div className="erp-table-actions" onClick={(e) => e.stopPropagation()}>
                        <Button type="button" size="icon" variant="outline" onClick={() => openEdit(c.id)} aria-label={`Edit ${c.name}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="text-slate-600 hover:text-red-700"
                          onClick={() => void onDelete(c.id)}
                          aria-label={`Delete ${c.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
        <PartyMasterModal title={editingId != null ? "Edit customer" : "Add customer"} onClose={requestCloseForm}>
          <CustomerMasterForm
            states={states}
            editingId={editingId}
            onDirtyChange={onFormDirtyChange}
            onCancel={requestCloseForm}
            onSaved={async () => {
              closeForm();
              await load();
              toast.showSuccess("Customer saved");
            }}
          />
        </PartyMasterModal>
      ) : null}

      <BulkDeleteConfirmModal
        open={bulkDeleteOpen}
        count={bulkSel.selectedCount}
        entityLabel="customer"
        loading={bulkBusy}
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={() => void runBulk("delete")}
      />
    </MasterListPageShell>
  );
}

const cnActionsTh = `${masterThClass} text-right`;
