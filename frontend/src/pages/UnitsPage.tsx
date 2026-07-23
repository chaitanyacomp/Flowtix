import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch } from "../services/api";
import { useToast } from "../contexts/ToastContext";
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

type UnitRow = { id: number; unitName: string; unitCode?: string | null };

export function UnitsPage() {
  const toast = useToast();
  const [rows, setRows] = React.useState<UnitRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [unitName, setUnitName] = React.useState("");
  const [unitCode, setUnitCode] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const wb = useMasterListWorkbench();
  const { query, setSearch, clearSearch, clearFilters, setPage, setPageSize } = wb;

  function load() {
    setLoading(true);
    setError(null);
    apiFetch<UnitRow[]>("/api/units")
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load units"))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    load();
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.debouncedSearch;
    return rows.filter(
      (u) =>
        matchesNameSearch(u.unitName, q) ||
        (u.unitCode ? matchesNameSearch(u.unitCode, q) : false),
    );
  }, [rows, query.debouncedSearch]);

  const { pageRows, totalPages, from, to } = paginateRows(filtered, query.page, query.pageSize);
  const searching = Boolean(normalizeSearchText(query.debouncedSearch));

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = unitName.trim();
    if (!name) {
      setError("Unit name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch<UnitRow>("/api/units", {
        method: "POST",
        body: JSON.stringify({ unitName: name, unitCode: unitCode.trim() || null }),
      });
      setUnitName("");
      setUnitCode("");
      load();
      toast.showSuccess("Unit added");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add unit";
      setError(msg);
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <MasterListPageShell>
      <MasterListHeader title="Units" description="Master list for item unit dropdown" />

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Add unit</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onAdd} className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Unit name
              <Input className="h-9" value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="Nos" />
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Unit code (optional)
              <Input className="h-9" value={unitCode} onChange={(e) => setUnitCode(e.target.value)} placeholder="NOS" />
            </label>
            <div className="flex items-end">
              <Button type="submit" className="h-9 w-full" disabled={saving}>
                {saving ? "Saving…" : "Add"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

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
        resultLabel={resultCountLabel({ filtered: filtered.length, total: rows.length, searching })}
        showClearFilters={searching}
        onClearFilters={clearFilters}
      />

      {loading ? (
        <MasterTableShell>
          <thead>
            <tr>
              <th className={masterThClass}>&nbsp;</th>
              <th className={masterThClass}>&nbsp;</th>
            </tr>
          </thead>
          <MasterTableSkeleton cols={2} />
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
              </tr>
            </thead>
            <tbody>
              {pageRows.map((u) => (
                <tr key={u.id} style={{ height: 50 }}>
                  <MasterTruncatedCell text={u.unitName} />
                  <td className={masterTdClass}>{u.unitCode ?? "—"}</td>
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
    </MasterListPageShell>
  );
}
