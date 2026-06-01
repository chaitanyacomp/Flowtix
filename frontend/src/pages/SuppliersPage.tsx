import * as React from "react";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { useAuth } from "../hooks/useAuth";
import { PageActions } from "../components/PageHeader";
import { useToast } from "../contexts/ToastContext";
import { ApiRequestError } from "../services/api";
import { Pencil, Trash2 } from "lucide-react";
import { SupplierMasterForm } from "../components/erp/SupplierMasterForm";
import { PartyMasterModal } from "../components/erp/partyMasterUi";
import type { StateRow } from "../lib/gstinValidation";

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

export function SuppliersPage() {
  const toast = useToast();
  const role = useAuth().user?.role;
  const canWrite = role === "ADMIN" || role === "STORE";
  const isAdmin = role === "ADMIN";
  const [rows, setRows] = React.useState<Supplier[]>([]);
  const [states, setStates] = React.useState<StateRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);

  function load() {
    return Promise.all([apiFetch<Supplier[]>("/api/suppliers"), apiFetch<StateRow[]>("/api/states")])
      .then(([sup, st]) => {
        setRows(sup);
        setStates(st);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load suppliers."));
  }

  React.useEffect(() => {
    load();
  }, []);

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

  function openAdd() {
    setError(null);
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(id: number) {
    setError(null);
    setEditingId(id);
    setShowForm(true);
  }

  return (
    <div>
      {canWrite ? (
        <PageActions>
          <Button type="button" variant="outline" size="sm" onClick={openAdd}>
            + Add supplier
          </Button>
        </PageActions>
      ) : null}
      {error && !showForm ? (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      ) : null}
      <div className="erp-table-wrap">
        <table className="erp-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>State</th>
              <th>GSTIN</th>
              <th>Supply locations</th>
              <th>Status</th>
              {canWrite ? <th className="text-right">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className={s.isActive === false ? "opacity-60" : undefined}>
                <td className="font-medium">{s.name}</td>
                <td>{s.contact || "—"}</td>
                <td className="max-w-[8rem] truncate text-slate-600">{s.stateName?.trim() || s.state?.trim() || "—"}</td>
                <td className="max-w-[9rem] truncate font-mono text-xs text-slate-700">{s.gstin || s.gst || "—"}</td>
                <td className="text-sm text-slate-700">
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
                <td className="text-sm">{s.isActive === false ? "Inactive" : "Active"}</td>
                {canWrite ? (
                  <td>
                    <div className="erp-table-actions">
                      <Button type="button" size="icon" variant="outline" onClick={() => openEdit(s.id)} aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {isAdmin ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="destructive"
                          onClick={() => void onDelete(s.id)}
                          aria-label="Delete"
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
        </table>
      </div>

      {showForm ? (
        <PartyMasterModal
          title={editingId != null ? "Edit supplier" : "Add supplier"}
          onClose={() => {
            setShowForm(false);
            setEditingId(null);
          }}
        >
          <SupplierMasterForm
            states={states}
            editingId={editingId}
            onCancel={() => {
              setShowForm(false);
              setEditingId(null);
            }}
            onSaved={() => {
              setShowForm(false);
              setEditingId(null);
              void load();
              toast.showSuccess("Supplier saved");
            }}
          />
        </PartyMasterModal>
      ) : null}
    </div>
  );
}
