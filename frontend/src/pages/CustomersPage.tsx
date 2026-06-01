import * as React from "react";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { useAuth } from "../hooks/useAuth";
import { PageActions } from "../components/PageHeader";
import { useToast } from "../contexts/ToastContext";
import { ApiRequestError } from "../services/api";
import { Pencil, Trash2 } from "lucide-react";
import { CustomerMasterForm } from "../components/erp/CustomerMasterForm";
import { PartyMasterModal } from "../components/erp/partyMasterUi";
import type { StateRow } from "../lib/gstinValidation";

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

export function CustomersPage() {
  const toast = useToast();
  const isAdmin = useAuth().user?.role === "ADMIN";
  const [rows, setRows] = React.useState<Customer[]>([]);
  const [states, setStates] = React.useState<StateRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);

  function load() {
    return Promise.all([apiFetch<Customer[]>("/api/customers"), apiFetch<StateRow[]>("/api/states")])
      .then(([cust, st]) => {
        setRows(cust);
        setStates(st);
      })
      .catch((e) => setError(messageForCustomerLoadError(e)));
  }

  React.useEffect(() => {
    load();
  }, []);

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
      const msg = e instanceof Error ? e.message : "Could not delete customer.";
      toast.showError(msg);
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
      {isAdmin ? (
        <PageActions>
          <Button type="button" variant="outline" size="sm" onClick={openAdd}>
            + Add customer
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
              <th>Delivery locations</th>
              <th>Status</th>
              {isAdmin ? <th className="text-right">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={c.isActive === false ? "opacity-60" : undefined}>
                <td className="font-medium">{c.name}</td>
                <td>{c.contact || "—"}</td>
                <td className="max-w-[8rem] truncate text-slate-600">{c.stateName?.trim() || c.state?.trim() || "—"}</td>
                <td className="max-w-[9rem] truncate font-mono text-xs text-slate-700">{c.gstin || c.gst || "—"}</td>
                <td className="text-sm text-slate-700">
                  {c.deliveryAddressCount ? (
                    <>
                      {c.deliveryAddressCount}
                      {c.defaultDeliveryLabel ? (
                        <span className="text-slate-500"> · {c.defaultDeliveryLabel}</span>
                      ) : null}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{c.isActive === false ? "Inactive" : "Active"}</td>
                {isAdmin ? (
                  <td>
                    <div className="erp-table-actions">
                      <Button type="button" size="icon" variant="outline" onClick={() => openEdit(c.id)} aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button type="button" size="icon" variant="destructive" onClick={() => onDelete(c.id)} aria-label="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
          title={editingId != null ? "Edit customer" : "Add customer"}
          onClose={() => {
            setShowForm(false);
            setEditingId(null);
          }}
        >
          <CustomerMasterForm
            states={states}
            editingId={editingId}
            onCancel={() => {
              setShowForm(false);
              setEditingId(null);
            }}
            onSaved={async () => {
              setShowForm(false);
              setEditingId(null);
              await load();
              toast.showSuccess("Customer saved");
            }}
          />
        </PartyMasterModal>
      ) : null}
    </div>
  );
}
