/**
 * Location Master — physical/process stock locations (not inventory buckets).
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

type LocationRow = {
  id: number;
  locationCode: string;
  locationName: string;
  locationType: string;
  locationTypeLabel?: string;
  departmentOwner: string;
  departmentLabel?: string;
  allowRm: boolean;
  allowFg: boolean;
  allowSfg: boolean;
  allowConsumable: boolean;
  allowedItemTypesLabel?: string;
  isActive: boolean;
  isSystem: boolean;
};

const LOCATION_TYPES = [
  { value: "RM_STORE", label: "RM Store" },
  { value: "PRODUCTION", label: "Production" },
  { value: "FG_STORE", label: "FG Store" },
  { value: "WIP", label: "WIP" },
  { value: "SCRAP", label: "Scrap" },
  { value: "VENDOR", label: "Vendor" },
  { value: "CONSUMABLE", label: "Consumable" },
  { value: "DISPATCH", label: "Dispatch" },
] as const;

const DEPARTMENTS = [
  { value: "STORES", label: "Stores" },
  { value: "PRODUCTION", label: "Production" },
  { value: "PURCHASE", label: "Purchase" },
  { value: "PLANT_HEAD", label: "Plant Head" },
] as const;

const emptyForm = {
  locationName: "",
  locationType: "RM_STORE" as (typeof LOCATION_TYPES)[number]["value"],
  departmentOwner: "STORES" as (typeof DEPARTMENTS)[number]["value"],
  allowRm: true,
  allowFg: false,
  allowSfg: false,
  allowConsumable: false,
  isActive: true,
};

export function LocationsPage() {
  const toast = useToast();
  useListScrollRestoration();
  const [rows, setRows] = React.useState<LocationRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [form, setForm] = React.useState(emptyForm);
  const [formBaseline, setFormBaseline] = React.useState(() => JSON.stringify(emptyForm));
  const [saving, setSaving] = React.useState(false);
  const [showInactive, setShowInactive] = React.useState(false);
  const wb = useMasterListWorkbench();
  const { query, setSearch, clearSearch, clearFilters, setPage, setPageSize } = wb;
  useUnsavedChangesGuard({
    isDirty: JSON.stringify(form) !== formBaseline,
    message: "Location form has unsaved changes. Leave and discard them?",
  });

  function load() {
    setLoading(true);
    setError(null);
    const qs = showInactive ? "?includeInactive=1" : "";
    apiFetch<LocationRow[]>(`/api/locations${qs}`)
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    load();
  }, [showInactive]);

  const filtered = React.useMemo(() => {
    const q = query.debouncedSearch;
    return rows.filter(
      (r) =>
        matchesNameSearch(r.locationName, q) ||
        matchesNameSearch(r.locationCode, q) ||
        matchesNameSearch(r.locationTypeLabel ?? r.locationType, q),
    );
  }, [rows, query.debouncedSearch]);

  const { pageRows, totalPages, from, to } = paginateRows(filtered, query.page, query.pageSize);
  const searching = Boolean(normalizeSearchText(query.debouncedSearch));

  function selectRow(r: LocationRow) {
    setSelectedId(r.id);
    const next = {
      locationName: r.locationName,
      locationType: r.locationType as typeof emptyForm.locationType,
      departmentOwner: r.departmentOwner as typeof emptyForm.departmentOwner,
      allowRm: r.allowRm,
      allowFg: r.allowFg,
      allowSfg: r.allowSfg,
      allowConsumable: r.allowConsumable,
      isActive: r.isActive,
    };
    setForm(next);
    setFormBaseline(JSON.stringify(next));
  }

  function newLocation() {
    setSelectedId(null);
    setForm(emptyForm);
    setFormBaseline(JSON.stringify(emptyForm));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.locationName.trim()) {
      setError("Location name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (selectedId) {
        await apiFetch(`/api/locations/${selectedId}`, {
          method: "PUT",
          body: JSON.stringify(form),
        });
        toast.showSuccess("Location updated");
      } else {
        await apiFetch("/api/locations", {
          method: "POST",
          body: JSON.stringify(form),
        });
        toast.showSuccess("Location created");
      }
      load();
      newLocation();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setError(msg);
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <MasterListPageShell>
      <MasterListHeader
        title="Locations"
        description="Physical and process locations for inventory. Quality state uses separate stock buckets."
        actions={
          <Button type="button" size="sm" variant="outline" onClick={newLocation}>
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
            placeholder="Search locations…"
            aria-label="Search locations"
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

      <div className="loc-workspace grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(16rem,0.9fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-2 py-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Location list</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="loc-table w-full">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Department</th>
                  <th>Allowed types</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "cursor-pointer",
                      selectedId === r.id ? "bg-sky-50" : undefined,
                      !r.isActive ? "opacity-60" : undefined,
                    )}
                    onClick={() => selectRow(r)}
                  >
                    <td className="font-mono text-[11px]">{r.locationCode}</td>
                    <td className="font-medium">{r.locationName}</td>
                    <td>{r.locationTypeLabel ?? r.locationType}</td>
                    <td>{r.departmentLabel ?? r.departmentOwner}</td>
                    <td className="text-[11px]">{r.allowedItemTypesLabel ?? "—"}</td>
                    <td>
                      {r.isActive ? (
                        <Badge className="bg-emerald-100 text-[10px] text-emerald-800">Yes</Badge>
                      ) : (
                        <Badge className="bg-slate-100 text-[10px] text-slate-600">No</Badge>
                      )}
                    </td>
                  </tr>
                ))}
                {!pageRows.length ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      {loading ? "Loading…" : searching ? "No matching locations" : "No locations"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {!loading && filtered.length > 0 ? (
            <div className="shrink-0 border-t border-slate-100 px-2 py-1.5">
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

        <section className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <h3 className="text-sm font-bold text-slate-800">{selectedId ? "Edit location" : "New location"}</h3>
          <form className="mt-3 grid gap-2" onSubmit={onSave}>
            <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
              Location name
              <Input
                className="h-8 text-sm"
                value={form.locationName}
                onChange={(e) => setForm((f) => ({ ...f, locationName: e.target.value }))}
                disabled={selectedId != null && rows.find((r) => r.id === selectedId)?.isSystem}
              />
            </label>
            <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
              Location type
              <select
                className="h-8 rounded-md border border-slate-200 px-2 text-sm"
                value={form.locationType}
                onChange={(e) =>
                  setForm((f) => ({ ...f, locationType: e.target.value as typeof f.locationType }))
                }
              >
                {LOCATION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-0.5 text-[11px] font-medium text-slate-600">
              Department owner
              <select
                className="h-8 rounded-md border border-slate-200 px-2 text-sm"
                value={form.departmentOwner}
                onChange={(e) =>
                  setForm((f) => ({ ...f, departmentOwner: e.target.value as typeof f.departmentOwner }))
                }
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-1 text-[11px] font-medium text-slate-600">
              Allowed item types
              <div className="flex flex-wrap gap-3">
                {(
                  [
                    ["allowRm", "RM"],
                    ["allowSfg", "SFG"],
                    ["allowFg", "FG"],
                    ["allowConsumable", "Consumable"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-1 font-normal">
                    <input
                      type="checkbox"
                      checked={form[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              Active
            </label>
            <p className="text-[10px] text-slate-500">
              Code is auto-generated on create. Existing stock is mapped to RM Store until transfers are enabled.
            </p>
            <Button type="submit" className="mt-1 h-8 w-full text-sm font-semibold" disabled={saving}>
              {saving ? "Saving…" : selectedId ? "Update location" : "Create location"}
            </Button>
          </form>
        </section>
      </div>
    </MasterListPageShell>
  );
}
