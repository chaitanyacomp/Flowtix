import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { PageActions } from "../components/PageHeader";
import { useToast } from "../contexts/ToastContext";
import { Pencil, Trash2 } from "lucide-react";
import { normalizeMasterNameKey } from "../lib/masterNameNormalize";

type StateRow = { id: number; stateName: string; stateCode: string };

type Supplier = {
  id: number;
  name: string;
  contact: string | null;
  gst: string | null;
  email?: string | null;
  address?: string | null;
  state?: string | null;
  stateId?: number | null;
  stateName?: string | null;
  stateCode?: string | null;
};

const DUPLICATE_SUPPLIER_NAME = "Supplier name already exists.";
const SUPPLIER_DELETE_BLOCKED = "Supplier is used in transactions and cannot be deleted.";

function sanitizeSupplierDeleteErrorMessage(msg: string): string {
  if (msg === SUPPLIER_DELETE_BLOCKED) return msg;
  const m = msg.toLowerCase();
  if (
    m.includes("foreign key") ||
    m.includes("p2003") ||
    m.includes("constraint failed") ||
    m.includes("cannot delete or update a parent row")
  ) {
    return SUPPLIER_DELETE_BLOCKED;
  }
  return msg;
}

function isSupplierDeleteBlockedMessage(msg: string): boolean {
  return msg === SUPPLIER_DELETE_BLOCKED;
}

export function SuppliersPage() {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const [rows, setRows] = React.useState<Supplier[]>([]);
  const [states, setStates] = React.useState<StateRow[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [showAdd, setShowAdd] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [gst, setGst] = React.useState("");
  const [stateId, setStateId] = React.useState<number | "">("");
  const [address, setAddress] = React.useState("");

  const [editId, setEditId] = React.useState<number | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editContact, setEditContact] = React.useState("");
  const [editEmail, setEditEmail] = React.useState("");
  const [editGst, setEditGst] = React.useState("");
  const [editStateId, setEditStateId] = React.useState<number | "">("");
  const [editAddress, setEditAddress] = React.useState("");
  const [savingEdit, setSavingEdit] = React.useState(false);

  function load() {
    setLoadError(null);
    return Promise.all([apiFetch<Supplier[]>("/api/suppliers"), apiFetch<StateRow[]>("/api/states")])
      .then(([sup, st]) => {
        setRows(sup);
        setStates(st);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load"));
  }

  React.useEffect(() => {
    load();
  }, []);

  function nameExists(nm: string, excludeId?: number): boolean {
    const v = normalizeMasterNameKey(nm);
    if (!v) return false;
    return rows.some((r) => r.id !== excludeId && normalizeMasterNameKey(r.name) === v);
  }

  function openAdd() {
    setFormError(null);
    setName("");
    setContact("");
    setEmail("");
    setGst("");
    setStateId("");
    setAddress("");
    setShowAdd(true);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const nm = name.trim();
    if (!nm) {
      setFormError("Supplier name is required");
      return;
    }
    if (nameExists(nm)) {
      setFormError(DUPLICATE_SUPPLIER_NAME);
      return;
    }

    setSaving(true);
    try {
      await apiFetch("/api/suppliers", {
        method: "POST",
        body: JSON.stringify({
          name: nm,
          contact: contact.trim() || undefined,
          email: email.trim() || undefined,
          gst: gst.trim() || undefined,
          stateId: stateId === "" ? null : Number(stateId),
          address: address.trim() || undefined,
        }),
      });
      setShowAdd(false);
      await load();
      toast.showSuccess("Saved successfully");
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Failed";
      if (raw === DUPLICATE_SUPPLIER_NAME) {
        setFormError(DUPLICATE_SUPPLIER_NAME);
      } else {
        setFormError(raw);
      }
    } finally {
      setSaving(false);
    }
  }

  function startEdit(r: Supplier) {
    setFormError(null);
    setEditId(r.id);
    setEditName(r.name);
    setEditContact(r.contact || "");
    setEditEmail(r.email || "");
    setEditGst(r.gst || "");
    setEditStateId(r.stateId ?? "");
    setEditAddress(r.address || "");
  }

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (editId == null) return;
    setFormError(null);
    const nm = editName.trim();
    if (!nm) {
      setFormError("Supplier name is required");
      return;
    }
    if (nameExists(nm, editId)) {
      setFormError(DUPLICATE_SUPPLIER_NAME);
      return;
    }
    setSavingEdit(true);
    try {
      await apiFetch(`/api/suppliers/${editId}`, {
        method: "PUT",
        body: JSON.stringify({
          name: nm,
          contact: editContact || null,
          email: editEmail || null,
          gst: editGst.trim() || null,
          stateId: editStateId === "" ? null : Number(editStateId),
          address: editAddress.trim() || null,
        }),
      });
      setEditId(null);
      await load();
      toast.showSuccess("Saved successfully");
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Failed";
      if (raw === DUPLICATE_SUPPLIER_NAME) {
        setFormError(DUPLICATE_SUPPLIER_NAME);
      } else {
        setFormError(raw);
      }
    } finally {
      setSavingEdit(false);
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Delete supplier?")) return;
    try {
      await apiFetch(`/api/suppliers/${id}`, { method: "DELETE" });
      toast.showSuccess("Supplier deleted");
      await load();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Failed";
      const msg = sanitizeSupplierDeleteErrorMessage(raw);
      if (isSupplierDeleteBlockedMessage(msg)) {
        toast.showInfo(msg);
      } else {
        toast.showError(msg);
      }
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
      {loadError ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div> : null}
      <div className="erp-table-wrap">
        <table className="erp-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>State</th>
              <th>GSTIN</th>
              {isAdmin ? <th className="text-right">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.name}</td>
                <td>{r.contact || "—"}</td>
                <td className="max-w-[8rem] truncate text-slate-600" title={r.state || undefined}>
                  {r.stateName?.trim()
                    ? r.stateName
                    : r.state?.trim()
                      ? r.state
                      : "—"}
                </td>
                <td className="max-w-[9rem] truncate font-mono text-xs text-slate-700" title={r.gst || undefined}>
                  {r.gst || "—"}
                </td>
                {isAdmin ? (
                  <td>
                    <div className="erp-table-actions">
                      <Button type="button" size="icon" variant="outline" onClick={() => startEdit(r)} aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="destructive"
                        onClick={() => onDelete(r.id)}
                        aria-label="Delete"
                        title="Suppliers linked to RM purchase orders cannot be deleted."
                      >
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

      {showAdd ? (
        <div className="erp-modal-backdrop" role="dialog">
          <Card className="erp-modal-shell max-h-[85vh]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Add supplier</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={onCreate} className="erp-form">
                <div className="erp-form-field">
                  <span className="erp-form-label">Supplier name</span>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="erp-form-row-2">
                  <div className="erp-form-field">
                    <span className="erp-form-label">Contact</span>
                    <Input value={contact} onChange={(e) => setContact(e.target.value)} />
                  </div>
                  <div className="erp-form-field">
                    <span className="erp-form-label">Email</span>
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" type="email" />
                  </div>
                </div>
                <div className="erp-form-row-2">
                  <div className="erp-form-field">
                    <span className="erp-form-label">GSTIN</span>
                    <Input value={gst} onChange={(e) => setGst(e.target.value)} placeholder="Optional" className="font-mono text-sm" />
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
                {formError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{formError}</div> : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowAdd(false);
                      setFormError(null);
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? "Saving…" : "Create"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {editId != null ? (
        <div className="erp-modal-backdrop" role="dialog">
          <Card className="erp-modal-shell max-h-[85vh]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Edit supplier</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSaveEdit} className="erp-form">
                <div className="erp-form-field">
                  <span className="erp-form-label">Supplier name</span>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div className="erp-form-row-2">
                  <div className="erp-form-field">
                    <span className="erp-form-label">Contact</span>
                    <Input value={editContact} onChange={(e) => setEditContact(e.target.value)} />
                  </div>
                  <div className="erp-form-field">
                    <span className="erp-form-label">Email</span>
                    <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} type="email" />
                  </div>
                </div>
                <div className="erp-form-row-2">
                  <div className="erp-form-field">
                    <span className="erp-form-label">GSTIN</span>
                    <Input
                      value={editGst}
                      onChange={(e) => setEditGst(e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="erp-form-field">
                    <span className="erp-form-label">State</span>
                    <select
                      className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                      value={editStateId}
                      onChange={(e) => setEditStateId(e.target.value === "" ? "" : Number(e.target.value))}
                    >
                      <option value="">Select state</option>
                      {states.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.stateName} ({s.stateCode})
                        </option>
                      ))}
                    </select>
                    {editStateId === "" && rows.find((x) => x.id === editId)?.state?.trim() ? (
                      <div className="mt-1 text-[12px] text-slate-600">
                        Previous value: <span className="font-medium">{rows.find((x) => x.id === editId)?.state}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Address</span>
                  <textarea
                    className="min-h-[4rem] w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    rows={3}
                  />
                </div>
                {formError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{formError}</div> : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditId(null);
                      setFormError(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={savingEdit}>
                    {savingEdit ? "Saving…" : "Save"}
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
