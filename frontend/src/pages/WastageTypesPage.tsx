import * as React from "react";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../contexts/ToastContext";
import { useIsAdmin } from "../hooks/useIsAdmin";
import {
  WASTAGE_TYPE_CATEGORIES,
  createWastageType,
  fetchWastageTypes,
  reorderWastageTypes,
  updateWastageType,
  type WastageTypeCategory,
  type WastageTypeRow,
} from "../lib/wastageTypeApi";

const selectClass =
  "h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-900";

type Draft = {
  code: string;
  name: string;
  category: WastageTypeCategory;
  description: string;
};

const EMPTY_DRAFT: Draft = { code: "", name: "", category: "MISC", description: "" };

export function WastageTypesPage() {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const [rows, setRows] = React.useState<WastageTypeRow[]>([]);
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editDraft, setEditDraft] = React.useState<Draft>(EMPTY_DRAFT);
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
    const name = draft.name.trim();
    if (!name) return;
    setSaving(true);
    setError(null);
    try {
      await createWastageType({
        name,
        code: draft.code.trim() || null,
        category: draft.category,
        description: draft.description.trim() || null,
      });
      setDraft(EMPTY_DRAFT);
      load();
      toast.showSuccess("Wastage type added");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add wastage type";
      setError(msg);
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row: WastageTypeRow) {
    setEditingId(row.id);
    setEditDraft({
      code: row.code ?? "",
      name: row.name,
      category: row.category ?? "MISC",
      description: row.description ?? "",
    });
  }

  async function saveEdit(id: number) {
    const name = editDraft.name.trim();
    if (!name) {
      toast.showError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateWastageType(id, {
        name,
        code: editDraft.code.trim() || null,
        category: editDraft.category,
        description: editDraft.description.trim() || null,
      });
      setEditingId(null);
      load();
      toast.showSuccess("Wastage type updated");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update wastage type";
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update wastage type";
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reorder wastage types";
      setError(msg);
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <PageHeader
        title="Wastage Types"
        subtitle="Production Report wastage classification master (Lane C). Inactive types stay visible on historical reports but cannot be selected for new classification."
      />

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Add wastage type</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onAdd} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Code (optional)
              <Input
                className="h-9"
                value={draft.code}
                onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
                placeholder="PURGE"
                maxLength={32}
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-600 lg:col-span-1">
              Name
              <Input
                className="h-9"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Purging"
                required
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Category
              <select
                className={selectClass}
                value={draft.category}
                onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as WastageTypeCategory }))}
              >
                {WASTAGE_TYPE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Description
              <Input
                className="h-9"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Optional"
                maxLength={500}
              />
            </label>
            <Button type="submit" disabled={saving} className="h-9">
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
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-600">No wastage types yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <th className="px-2 py-1.5">Code</th>
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5">Category</th>
                    <th className="px-2 py-1.5">Description</th>
                    <th className="px-2 py-1.5">Status</th>
                    <th className="px-2 py-1.5 text-right">Order</th>
                    <th className="px-2 py-1.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const editing = editingId === row.id;
                    return (
                      <tr key={row.id} className="border-b border-slate-100 align-top">
                        <td className="px-2 py-1.5 tabular-nums text-slate-700">
                          {editing ? (
                            <Input
                              className="h-8 w-24"
                              value={editDraft.code}
                              onChange={(e) => setEditDraft((d) => ({ ...d, code: e.target.value }))}
                              maxLength={32}
                            />
                          ) : (
                            row.code || "—"
                          )}
                        </td>
                        <td className="px-2 py-1.5 font-medium text-slate-900">
                          {editing ? (
                            <Input
                              className="h-8 min-w-[8rem]"
                              value={editDraft.name}
                              onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                            />
                          ) : (
                            row.name
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {editing ? (
                            <select
                              className={selectClass}
                              value={editDraft.category}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, category: e.target.value as WastageTypeCategory }))
                              }
                            >
                              {WASTAGE_TYPE_CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                              {row.category}
                            </span>
                          )}
                        </td>
                        <td className="max-w-[14rem] px-2 py-1.5 text-slate-600">
                          {editing ? (
                            <Input
                              className="h-8"
                              value={editDraft.description}
                              onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                              maxLength={500}
                            />
                          ) : (
                            <span className="line-clamp-2">{row.description || "—"}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">{row.isActive ? "Active" : "Inactive"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{row.sortOrder}</td>
                        <td className="px-2 py-1.5">
                          <div className="flex flex-wrap justify-end gap-1">
                            {editing ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-7 px-2"
                                  disabled={saving}
                                  onClick={() => void saveEdit(row.id)}
                                >
                                  Save
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2"
                                  disabled={saving}
                                  onClick={() => setEditingId(null)}
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2"
                                disabled={saving}
                                onClick={() => startEdit(row)}
                              >
                                Edit
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2"
                              disabled={saving || index === 0}
                              onClick={() => void moveRow(index, -1)}
                            >
                              Up
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2"
                              disabled={saving || index === rows.length - 1}
                              onClick={() => void moveRow(index, 1)}
                            >
                              Down
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2"
                              disabled={saving}
                              onClick={() => void toggleActive(row)}
                            >
                              {row.isActive ? "Disable" : "Enable"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
