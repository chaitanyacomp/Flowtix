import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useAuth } from "../hooks/useAuth";
import { PageActions } from "../components/PageHeader";
import { useToast } from "../contexts/ToastContext";
import { ApiRequestError } from "../services/api";
import { Pencil, Trash2 } from "lucide-react";
import { normalizeMasterNameDisplay, normalizeMasterNameKey } from "../lib/masterNameNormalize";

const CUSTOMER_SAVE_FAILED = "Could not save customer. Please check entered details.";

type StateRow = { id: number; stateName: string; stateCode: string };

/** Prefer API `error.message`; never surface Prisma/driver wording to users. */
function messageForCustomerSaveError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const m = (err.message || "").trim();
    if (err.code === "VALIDATION") {
      const lower = m.toLowerCase();
      if (lower.includes("email")) return "Please enter a valid email address.";
      if (!/validation failed:/i.test(m) && m.length > 0 && m.length < 160) return m;
      return "Please check the information you entered and try again.";
    }
    if (
      /prisma|invocation|invalid `\w+`|foreign key|constraint failed|p20\d{2}|unique constraint|column .+ cannot be null/i.test(
        m,
      )
    ) {
      return CUSTOMER_SAVE_FAILED;
    }
    if (m) return m;
    return CUSTOMER_SAVE_FAILED;
  }
  if (err instanceof Error) {
    const m = err.message || "";
    if (/prisma|p20\d{2}|invocation/i.test(m)) return CUSTOMER_SAVE_FAILED;
    return m || CUSTOMER_SAVE_FAILED;
  }
  return CUSTOMER_SAVE_FAILED;
}

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
  state?: string | null;
  stateId?: number | null;
  stateName?: string | null;
  stateCode?: string | null;
  address?: string | null;
};

export function CustomersPage() {
  const toast = useToast();
  const isAdmin = useAuth().user?.role === "ADMIN";
  const [rows, setRows] = React.useState<Customer[]>([]);
  const [states, setStates] = React.useState<StateRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [gst, setGst] = React.useState("");
  const [stateId, setStateId] = React.useState<number | "">("");
  const [address, setAddress] = React.useState("");

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
      const friendly = /foreign key|constraint|prisma|P2003/i.test(msg)
        ? "Customer cannot be deleted because it is used in transactions."
        : msg;
      toast.showError(friendly || "Could not delete customer.");
    }
  }

  function openAdd() {
    setError(null);
    setEditingId(null);
    setName("");
    setContact("");
    setEmail("");
    setGst("");
    setStateId("");
    setAddress("");
    setShowForm(true);
  }

  function openEdit(c: Customer) {
    setError(null);
    setEditingId(c.id);
    setName(c.name ?? "");
    setContact(c.contact ?? "");
    setEmail(c.email ?? "");
    setGst(c.gst ?? "");
    setStateId(c.stateId ?? "");
    setAddress(c.address ?? "");
    setShowForm(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (saving) return;
    const trimmedName = normalizeMasterNameDisplay(name);
    if (!trimmedName) {
      setError("Name is required");
      return;
    }
    const nameKey = normalizeMasterNameKey(trimmedName);
    const dup = rows.some((r) => r.id !== editingId && normalizeMasterNameKey(r.name) === nameKey);
    if (dup) {
      setError("A customer with this name already exists.");
      return;
    }

    setSaving(true);
    try {
      if (editingId != null) {
        const payload = {
          name: trimmedName,
          contact: contact.trim() || null,
          email: email.trim() || null,
          gst: gst.trim() || null,
          stateId: stateId === "" ? null : Number(stateId),
          address: address.trim() || null,
        };
        await apiFetch(`/api/customers/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        const payload = {
          name: trimmedName,
          contact: contact.trim() || undefined,
          email: email.trim() || undefined,
          gst: gst.trim() || undefined,
          stateId: stateId === "" ? null : Number(stateId),
          address: address.trim() || undefined,
        };
        await apiFetch("/api/customers", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      setShowForm(false);
      setEditingId(null);
      await load();
      toast.showSuccess("Saved successfully");
    } catch (err) {
      setError(messageForCustomerSaveError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {isAdmin ? (
        <PageActions>
          <Button type="button" variant="outline" size="sm" onClick={openAdd}>
            + Add
          </Button>
        </PageActions>
      ) : null}
      {error ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
      <div className="erp-table-wrap">
        <table className="erp-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>Email</th>
              <th>State</th>
              <th>GSTIN</th>
              {isAdmin ? <th className="text-right">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td>
                <td>{c.contact || "—"}</td>
                <td>{c.email || "—"}</td>
                <td className="max-w-[8rem] truncate text-slate-600" title={c.state || undefined}>
                  {c.stateName?.trim()
                    ? c.stateName
                    : c.state?.trim()
                      ? c.state
                      : "—"}
                </td>
                <td className="max-w-[9rem] truncate font-mono text-xs text-slate-700" title={c.gst || undefined}>
                  {c.gst || "—"}
                </td>
                {isAdmin ? (
                  <td>
                    <div className="erp-table-actions">
                      <Button type="button" size="icon" variant="outline" onClick={() => openEdit(c)} aria-label="Edit">
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
        <div className="erp-modal-backdrop" role="dialog">
          <Card className="erp-modal-shell max-h-[85vh]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{editingId != null ? "Edit customer" : "Add customer"}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="erp-form">
                <div className="erp-form-field">
                  <span className="erp-form-label">Customer name</span>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" autoComplete="organization" />
                </div>
                <div className="erp-form-row-2">
                  <div className="erp-form-field">
                    <span className="erp-form-label">Contact</span>
                    <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone" autoComplete="tel" />
                  </div>
                  <div className="erp-form-field">
                    <span className="erp-form-label">Email</span>
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" type="email" autoComplete="email" />
                  </div>
                </div>
                <div className="erp-form-row-2">
                  <div className="erp-form-field">
                    <span className="erp-form-label">GSTIN</span>
                    <Input
                      value={gst}
                      onChange={(e) => setGst(e.target.value)}
                      placeholder="Optional"
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="erp-form-field">
                    <span className="erp-form-label">State</span>
                    <select
                      className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                      value={stateId}
                      onChange={(e) => setStateId(e.target.value === "" ? "" : Number(e.target.value))}
                    >
                      <option value="">Select state</option>
                      {states.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.stateName} ({s.stateCode})
                        </option>
                      ))}
                    </select>
                    {editingId != null && stateId === "" && rows.find((x) => x.id === editingId)?.state?.trim() ? (
                      <div className="mt-1 text-[12px] text-slate-600">
                        Previous value: <span className="font-medium">{rows.find((x) => x.id === editingId)?.state}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Address</span>
                  <textarea
                    className="min-h-[4rem] w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Optional — multiline OK"
                    rows={3}
                  />
                </div>

                {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)} disabled={saving}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? "Saving..." : editingId != null ? "Save" : "Create"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

