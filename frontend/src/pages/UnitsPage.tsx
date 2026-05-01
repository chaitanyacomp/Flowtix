import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch } from "../services/api";
import { useToast } from "../contexts/ToastContext";

type UnitRow = { id: number; unitName: string; unitCode?: string | null };

export function UnitsPage() {
  const toast = useToast();
  const [rows, setRows] = React.useState<UnitRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [unitName, setUnitName] = React.useState("");
  const [unitCode, setUnitCode] = React.useState("");
  const [saving, setSaving] = React.useState(false);

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
    <div className="flex min-h-0 flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Units</h2>
        <p className="mt-0.5 text-sm text-slate-600">Master list for item unit dropdown</p>
      </div>

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

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Active units</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr className="text-left text-xs font-medium uppercase text-slate-500">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Code</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-6 text-center text-slate-600">
                      {loading ? "Loading…" : "No units found."}
                    </td>
                  </tr>
                ) : (
                  rows.map((u) => (
                    <tr key={u.id} className="border-b border-slate-100">
                      <td className="px-4 py-2 font-medium text-slate-900">{u.unitName}</td>
                      <td className="px-4 py-2 text-slate-700">{u.unitCode ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
