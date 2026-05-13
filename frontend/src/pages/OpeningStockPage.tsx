import * as React from "react";
import { apiFetch, ApiRequestError } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { PageActions } from "../components/PageHeader";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../hooks/useAuth";
import { Pencil, CheckCircle2, Plus, Trash2, Undo2, X } from "lucide-react";

type StockBucket = "USABLE" | "QC_HOLD" | "QC_PENDING" | "REWORK" | "SCRAP";
type OpeningStockStatus = "DRAFT" | "APPROVED";

type ItemRow = {
  id: number;
  itemName: string;
  itemType: "RM" | "FG";
  unit?: string | null;
  unitName?: string | null;
};

type OpeningStockRow = {
  id: number;
  itemId: number;
  itemName?: string | null;
  unit?: string | null;
  unitName?: string | null;
  openingQty: number;
  stockBucket: StockBucket;
  status: OpeningStockStatus;
  remarks?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  /** Set when the OPENING stock row has been reversed in the ledger. */
  openingLedgerReversedAt?: string | null;
};

function statusBadgeVariant(s: OpeningStockStatus): React.ComponentProps<typeof Badge>["variant"] {
  if (s === "APPROVED") return "success";
  return "warning";
}

function bucketLabel(b: StockBucket): string {
  switch (b) {
    case "USABLE":
      return "Usable";
    case "QC_HOLD":
      return "QC Hold";
    case "QC_PENDING":
      return "QC Pending";
    case "REWORK":
      return "Rework";
    case "SCRAP":
      return "Scrap";
    default:
      return b;
  }
}

function openingStockUserMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}

export function OpeningStockPage() {
  const toast = useToast();
  const auth = useAuth();
  const isAdmin = auth.user?.role === "ADMIN";

  const [items, setItems] = React.useState<ItemRow[]>([]);
  const [rows, setRows] = React.useState<OpeningStockRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);

  const [itemId, setItemId] = React.useState<number | "">("");
  const [qtyStr, setQtyStr] = React.useState("");
  const [bucket, setBucket] = React.useState<StockBucket>("USABLE");
  const [remarks, setRemarks] = React.useState("");

  const [draftConfirmOpen, setDraftConfirmOpen] = React.useState(false);
  const [draftAdminPassword, setDraftAdminPassword] = React.useState("");

  const [approveTarget, setApproveTarget] = React.useState<OpeningStockRow | null>(null);
  const [approvePassword, setApprovePassword] = React.useState("");
  const [approveSaving, setApproveSaving] = React.useState(false);

  const [reverseTarget, setReverseTarget] = React.useState<OpeningStockRow | null>(null);
  const [reverseReason, setReverseReason] = React.useState("");
  const [reversePassword, setReversePassword] = React.useState("");
  const [reverseSaving, setReverseSaving] = React.useState(false);

  const [deleteTarget, setDeleteTarget] = React.useState<OpeningStockRow | null>(null);
  const [deleteSaving, setDeleteSaving] = React.useState(false);

  const resetForm = React.useCallback(() => {
    setEditingId(null);
    setItemId("");
    setQtyStr("");
    setBucket("USABLE");
    setRemarks("");
    setError(null);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [it, os] = await Promise.all([
        apiFetch<ItemRow[]>("/api/items"),
        apiFetch<OpeningStockRow[]>("/api/opening-stock"),
      ]);
      setItems(it ?? []);
      setRows(os ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load opening stock");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  function openAdd() {
    resetForm();
    setShowForm(true);
  }

  function openEdit(r: OpeningStockRow) {
    setError(null);
    setEditingId(r.id);
    setItemId(r.itemId);
    setQtyStr(String(r.openingQty ?? ""));
    setBucket(r.stockBucket);
    setRemarks(r.remarks ?? "");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    resetForm();
  }

  function closeDraftConfirm() {
    setDraftConfirmOpen(false);
    setDraftAdminPassword("");
    setError(null);
  }

  function validateDraftFields(): { ok: false } | { ok: true; qty: number; payload: Record<string, unknown> } {
    if (itemId === "") {
      setError("Item is required");
      return { ok: false };
    }
    const qty = Number(qtyStr);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Opening Qty must be greater than 0");
      return { ok: false };
    }
    const payload = {
      itemId: Number(itemId),
      openingQty: qty,
      stockBucket: bucket,
      remarks: remarks.trim() || null,
    };
    return { ok: true, qty, payload };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (saving) return;

    const v = validateDraftFields();
    if (!v.ok) return;

    setDraftAdminPassword("");
    setDraftConfirmOpen(true);
  }

  async function confirmDraftSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const pwd = draftAdminPassword.trim();
    if (!pwd) {
      setError("Admin password is required.");
      return;
    }

    const v = validateDraftFields();
    if (!v.ok) return;

    setSaving(true);
    try {
      const body = { ...v.payload, adminPassword: pwd };
      if (editingId != null) {
        await apiFetch(`/api/opening-stock/${editingId}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await apiFetch("/api/opening-stock", { method: "POST", body: JSON.stringify(body) });
      }
      toast.showSuccess("Saved as Draft");
      closeDraftConfirm();
      closeForm();
      await load();
    } catch (err) {
      setError(openingStockUserMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function openDeleteDraft(r: OpeningStockRow) {
    if (r.status !== "DRAFT" || !isAdmin) return;
    setDeleteTarget(r);
    setError(null);
  }

  async function confirmDeleteDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!deleteTarget || deleteTarget.status !== "DRAFT") return;
    setDeleteSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/opening-stock/${deleteTarget.id}`, { method: "DELETE" });
      toast.showSuccess("Draft deleted");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.showError(openingStockUserMessage(err));
    } finally {
      setDeleteSaving(false);
    }
  }

  function openReverse(r: OpeningStockRow) {
    if (r.status !== "APPROVED" || r.openingLedgerReversedAt) return;
    setReverseTarget(r);
    setReverseReason("");
    setReversePassword("");
    setError(null);
  }

  async function submitReverse(e: React.FormEvent) {
    e.preventDefault();
    if (!reverseTarget) return;
    const r = reverseReason.trim();
    if (!r) {
      setError("Reason is required.");
      return;
    }
    if (!reversePassword.trim()) {
      setError("Admin password is required.");
      return;
    }
    setReverseSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/opening-stock/${reverseTarget.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason: r, adminPassword: reversePassword }),
      });
      toast.showSuccess("Opening stock reversed in ledger");
      setReverseTarget(null);
      setReverseReason("");
      setReversePassword("");
      await load();
    } catch (err) {
      setError(openingStockUserMessage(err));
    } finally {
      setReverseSaving(false);
    }
  }

  function openApprove(r: OpeningStockRow) {
    if (r.status !== "DRAFT") return;
    setApproveTarget(r);
    setApprovePassword("");
    setError(null);
  }

  async function submitApprove(e: React.FormEvent) {
    e.preventDefault();
    if (!approveTarget) return;
    if (!approvePassword.trim()) {
      setError("Admin password is required.");
      return;
    }
    setApproveSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/opening-stock/${approveTarget.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ adminPassword: approvePassword }),
      });
      toast.showSuccess("Approved");
      setApproveTarget(null);
      setApprovePassword("");
      await load();
    } catch (err) {
      setError(openingStockUserMessage(err));
    } finally {
      setApproveSaving(false);
    }
  }

  const selectedItemLabel =
    itemId === "" ? null : items.find((it) => it.id === Number(itemId))?.itemName ?? `Item #${itemId}`;
  const draftPreviewQty = Number(qtyStr);

  const modalBlocking = Boolean(draftConfirmOpen || approveTarget || reverseTarget || deleteTarget);

  return (
    <div>
      <PageActions>
        <Button type="button" size="sm" variant="outline" onClick={openAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add Entry
        </Button>
      </PageActions>

      {error && !modalBlocking ? (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      ) : null}

      <div className="erp-table-wrap">
        <table className="erp-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="text-right">Opening Qty</th>
              <th>Bucket</th>
              <th>Status</th>
              <th>Remarks</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.status === "APPROVED" ? "opacity-90" : ""}>
                <td className="font-medium">{r.itemName ?? `Item #${r.itemId}`}</td>
                <td className="text-right tabular-nums">{Number(r.openingQty ?? 0)}</td>
                <td>{bucketLabel(r.stockBucket)}</td>
                <td>
                  <Badge variant={statusBadgeVariant(r.status)}>{r.status}</Badge>
                </td>
                <td className="max-w-[18rem] truncate text-slate-600" title={r.remarks ?? ""}>
                  {r.remarks?.trim() ? r.remarks : "—"}
                </td>
                <td>
                  <div className="erp-table-actions justify-end">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={() => openEdit(r)}
                      disabled={r.status !== "DRAFT"}
                      aria-label="Edit"
                      title={r.status !== "DRAFT" ? "Approved entries cannot be edited" : "Edit"}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={() => openDeleteDraft(r)}
                      disabled={r.status !== "DRAFT" || !isAdmin}
                      aria-label="Delete draft"
                      title={
                        r.status !== "DRAFT"
                          ? "Approved entries cannot be deleted"
                          : !isAdmin
                            ? "Only administrators can delete drafts"
                            : "Delete draft"
                      }
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openReverse(r)}
                      disabled={r.status !== "APPROVED" || Boolean(r.openingLedgerReversedAt)}
                      title={
                        r.status !== "APPROVED"
                          ? "Approve first"
                          : r.openingLedgerReversedAt
                            ? "Already reversed in stock ledger"
                            : "Reverse ledger posting"
                      }
                    >
                      <Undo2 className="mr-2 h-4 w-4" />
                      Reverse
                    </Button>
                    <Button type="button" size="sm" variant="default" onClick={() => openApprove(r)} disabled={r.status !== "DRAFT"}>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Approve
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                  No opening stock entries yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {showForm ? (
        <div className="erp-modal-backdrop" role="dialog">
          <Card className="erp-modal-shell flex w-[calc(100vw-2rem)] max-w-[640px] max-h-[85vh] flex-col overflow-hidden">
            <div className="sticky top-0 z-[2] flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
              <div className="text-base font-semibold text-slate-900">{editingId != null ? "Edit Opening Stock" : "Add Opening Stock"}</div>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Close" onClick={closeForm}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <CardContent className="min-h-0 flex-1 p-0">
              <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-10">
                  <div className="grid gap-3">
                    <div className="erp-form-field">
                      <span className="erp-form-label">Item</span>
                      <select className="erp-select" value={itemId} onChange={(e) => setItemId(e.target.value === "" ? "" : Number(e.target.value))}>
                        <option value="">Select item</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.itemName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="erp-form-field">
                        <span className="erp-form-label">Opening Qty</span>
                        <Input type="number" min={0} step="any" value={qtyStr} onChange={(e) => setQtyStr(e.target.value)} placeholder="0" />
                      </div>
                      <div className="erp-form-field">
                        <span className="erp-form-label">Bucket</span>
                        <select className="erp-select" value={bucket} onChange={(e) => setBucket(e.target.value as StockBucket)}>
                          <option value="USABLE">USABLE</option>
                          <option value="QC_HOLD">QC_HOLD</option>
                          <option value="QC_PENDING">QC_PENDING</option>
                          <option value="REWORK">REWORK</option>
                          <option value="SCRAP">SCRAP</option>
                        </select>
                      </div>
                    </div>

                    <div className="erp-form-field">
                      <span className="erp-form-label">Remarks</span>
                      <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
                    </div>

                    <p className="text-xs text-slate-600">
                      Saving a draft requires an administrator password. Approving posts stock to the ledger and has additional confirmation.
                    </p>
                  </div>
                </div>

                <div className="sticky bottom-0 z-[2] border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-8px_16px_-16px_rgba(0,0,0,0.55)]">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={saving}>
                      {saving ? "Saving..." : "Continue…"}
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {draftConfirmOpen ? (
        <div className="erp-modal-backdrop z-[60]" role="dialog" aria-label="Confirm save opening stock draft">
          <Card className="erp-modal-shell flex w-[calc(100vw-2rem)] max-w-[640px] max-h-[85vh] flex-col overflow-hidden">
            <div className="sticky top-0 z-[2] flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
              <div className="text-base font-semibold text-slate-900">Confirm opening stock draft</div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label="Close"
                onClick={closeDraftConfirm}
                disabled={saving}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <CardContent className="min-h-0 flex-1 p-0">
              <form onSubmit={(e) => void confirmDraftSave(e)} className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-10">
                  <div className="space-y-3">
                    {error ? (
                      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
                    ) : null}
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                      <div className="grid gap-1">
                        <div>
                          <span className="text-slate-600">Item:</span> <span className="font-medium">{selectedItemLabel ?? "—"}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          <span>
                            <span className="text-slate-600">Opening Qty:</span>{" "}
                            <span className="font-semibold tabular-nums">{Number.isFinite(draftPreviewQty) ? draftPreviewQty : "—"}</span>
                          </span>
                          <span>
                            <span className="text-slate-600">Bucket:</span> <span className="font-medium">{bucketLabel(bucket)}</span>
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-600">Remarks:</span>{" "}
                          <span className="font-medium">{remarks.trim() ? remarks.trim() : "—"}</span>
                        </div>
                        <div className="text-xs text-slate-600">
                          {editingId != null ? "This updates the draft row only (no stock movement until approved)." : "This creates a draft row only (no stock movement until approved)."}
                        </div>
                      </div>
                    </div>

                    <div className="erp-form-field">
                      <span className="erp-form-label">Admin password</span>
                      <Input
                        type="password"
                        value={draftAdminPassword}
                        onChange={(e) => setDraftAdminPassword(e.target.value)}
                        placeholder="Enter admin password to confirm"
                        autoFocus
                      />
                      <p className="mt-1 text-xs text-slate-500">Required for all users (matches any active administrator account).</p>
                    </div>
                  </div>
                </div>

                <div className="sticky bottom-0 z-[2] border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-8px_16px_-16px_rgba(0,0,0,0.55)]">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="outline" onClick={closeDraftConfirm} disabled={saving}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={saving || !draftAdminPassword.trim()}>
                      {saving ? "Saving…" : "Confirm save draft"}
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {approveTarget ? (
        <div className="erp-modal-backdrop z-[60]" role="dialog" aria-modal="true" aria-labelledby="os-approve-title">
          <Card className="erp-modal-shell max-w-md">
            <CardHeader className="pb-2">
              <CardTitle id="os-approve-title" className="text-base">
                Approve opening stock
              </CardTitle>
            </CardHeader>
            <CardContent>
              {error ? (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
              ) : null}
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Approving creates an <strong>OPENING</strong> stock transaction and affects inventory, planning, and reports. Enter an administrator
                password to continue.
              </div>
              <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                <div className="grid gap-1">
                  <div>
                    <span className="text-slate-600">Item:</span>{" "}
                    <span className="font-medium">{approveTarget.itemName ?? `Item #${approveTarget.itemId}`}</span>
                  </div>
                  <div>
                    <span className="text-slate-600">Qty / Bucket:</span>{" "}
                    <span className="font-semibold tabular-nums">
                      {Number(approveTarget.openingQty ?? 0)} · {bucketLabel(approveTarget.stockBucket)}
                    </span>
                  </div>
                </div>
              </div>
              <form
                onSubmit={(e) => {
                  void submitApprove(e);
                }}
                className="grid gap-3"
              >
                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-slate-700">Admin password</span>
                  <Input
                    type="password"
                    value={approvePassword}
                    onChange={(e) => setApprovePassword(e.target.value)}
                    placeholder="Enter admin password to approve"
                    autoFocus
                  />
                </label>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={approveSaving}
                    onClick={() => {
                      setApproveTarget(null);
                      setApprovePassword("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={approveSaving || !approvePassword.trim()}>
                    {approveSaving ? "Approving…" : "Confirm approve"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {reverseTarget ? (
        <div className="erp-modal-backdrop z-[60]" role="dialog" aria-modal="true" aria-labelledby="os-reverse-title">
          <Card className="erp-modal-shell max-w-md">
            <CardHeader className="pb-2">
              <CardTitle id="os-reverse-title" className="text-base">
                Reverse opening stock
              </CardTitle>
            </CardHeader>
            <CardContent>
              {error ? (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
              ) : null}
              <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                <div className="grid gap-1">
                  <div>
                    <span className="text-slate-600">Item:</span>{" "}
                    <span className="font-medium">{reverseTarget.itemName ?? `Item #${reverseTarget.itemId}`}</span>
                  </div>
                  <div>
                    <span className="text-slate-600">Qty / Bucket:</span>{" "}
                    <span className="font-semibold tabular-nums">
                      {Number(reverseTarget.openingQty ?? 0)} · {bucketLabel(reverseTarget.stockBucket)}
                    </span>
                  </div>
                </div>
              </div>
              <form onSubmit={(e) => void submitReverse(e)} className="grid gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-slate-700">Reason</span>
                  <Input
                    value={reverseReason}
                    onChange={(e) => setReverseReason(e.target.value)}
                    placeholder="Why are you reversing this opening stock?"
                    autoFocus
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-slate-700">Admin password</span>
                  <Input
                    type="password"
                    value={reversePassword}
                    onChange={(e) => setReversePassword(e.target.value)}
                    placeholder="Enter admin password to confirm reverse"
                  />
                </label>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={reverseSaving}
                    onClick={() => {
                      setReverseTarget(null);
                      setReverseReason("");
                      setReversePassword("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={reverseSaving || !reverseReason.trim() || !reversePassword.trim()}>
                    {reverseSaving ? "Reversing…" : "Confirm reverse"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="erp-modal-backdrop z-[60]" role="dialog" aria-labelledby="os-delete-title">
          <Card className="erp-modal-shell max-w-md">
            <CardHeader className="pb-2">
              <CardTitle id="os-delete-title" className="text-base">
                Delete draft
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-slate-700">
                Delete this draft opening stock row for{" "}
                <span className="font-medium">{deleteTarget.itemName ?? `Item #${deleteTarget.itemId}`}</span>? This cannot be undone.
              </p>
              <form onSubmit={(e) => void confirmDeleteDraft(e)} className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={deleteSaving}
                  onClick={() => {
                    setDeleteTarget(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={deleteSaving}>
                  {deleteSaving ? "Deleting…" : "Delete draft"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
