import * as React from "react";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../contexts/ToastContext";
import { useIsAdmin } from "../hooks/useIsAdmin";
import {
  createWastageType,
  fetchWastageTypes,
  reorderWastageTypes,
  updateWastageType,
  type WastageTypeRow,
} from "../lib/wastageTypeApi";

export function WastageTypesPage() {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const [rows, setRows] = React.useState<WastageTypeRow[]>([]);
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    fetchWastageTypes(true)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load wastage types"))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    load();
  }, []);

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await createWastageType(trimmed);
      setName("");
      load();
      toast.showSuccess("Wastage type added");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add wastage type";
      setError(msg);
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: WastageTypeRow) {
    setSaving(true);
    setError(null);
    try {
      await updateWastageType(row.id, { isActive: !row.isActive });
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update wastage type";
      setError(msg);
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function moveRow(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setSaving(true);
    setError(null);
    try {
      const updated = await reorderWastageTypes(next.map((row) => row.id));
      setRows(updated);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to reorder wastage types";
      setError(msg);
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <PageHeader title="Wastage Types" subtitle="Production Report wastage classification master" />

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Add wastage type</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onAdd} className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-[14rem] flex-1 gap-1 text-xs font-medium text-slate-600">
              Name
              <Input className="h-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="Purging" />
            </label>
            <Button type="submit" disabled={saving}>
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Master list</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-600">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5">Status</th>
                    <th className="px-2 py-1.5 text-right">Order</th>
                    <th className="px-2 py-1.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="px-2 py-1.5 font-medium text-slate-900">{row.name}</td>
                      <td className="px-2 py-1.5">{row.isActive ? "Active" : "Disabled"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{row.sortOrder}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex justify-end gap-1">
                          <Button type="button" variant="outline" size="sm" className="h-7 px-2" disabled={saving || index === 0} onClick={() => void moveRow(index, -1)}>
                            Up
                          </Button>
                          <Button type="button" variant="outline" size="sm" className="h-7 px-2" disabled={saving || index === rows.length - 1} onClick={() => void moveRow(index, 1)}>
                            Down
                          </Button>
                          <Button type="button" variant="outline" size="sm" className="h-7 px-2" disabled={saving} onClick={() => void toggleActive(row)}>
                            {row.isActive ? "Disable" : "Enable"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
