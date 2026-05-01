import * as React from "react";
import { apiFetch, ApiRequestError } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { PageActions } from "../components/PageHeader";
import { useToast } from "../contexts/ToastContext";
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

export function OpeningStockPage() {
  const toast = useToast();
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (saving) return;

    if (itemId === "") {
      setError("Item is required");
      return;
    }
    const qty = Number(qtyStr);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Opening Qty must be greater than 0");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        itemId: Number(itemId),
        openingQty: qty,
        stockBucket: bucket,
        remarks: remarks.trim() || null,
      };
      if (editingId != null) {
        await apiFetch(`/api/opening-stock/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await apiFetch("/api/opening-stock", { method: "POST", body: JSON.stringify(payload) });
      }
      toast.showSuccess("Saved as Draft");
      closeForm();
      await load();
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : "Save failed";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteDraft(r: OpeningStockRow) {
    if (r.status !== "DRAFT") return;
    if (!confirm("Delete this draft opening stock row?")) return;
    setError(null);
    try {
      await apiFetch(`/api/opening-stock/${r.id}`, { method: "DELETE" });
      toast.showSuccess("Draft deleted");
      await load();
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : "Delete failed";
      toast.showError(msg);
    }
  }

  async function onReverse(r: OpeningStockRow) {
    if (r.status !== "APPROVED" || r.openingLedgerReversedAt) return;
    const reason = window.prompt("Reason for reversing this opening stock (required):");
    if (reason == null) return;
    if (!reason.trim()) {
      toast.showError("Reason is required");
      return;
    }
    setError(null);
    try {
      await apiFetch(`/api/opening-stock/${r.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      toast.showSuccess("Opening stock reversed in ledger");
      await load();
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : "Reverse failed";
      toast.showError(msg);
    }
  }

  async function onApprove(r: OpeningStockRow) {
    if (r.status !== "DRAFT") return;
    if (!confirm("Approve opening stock? This will create stock transaction.")) return;
    setError(null);
    try {
      await apiFetch(`/api/opening-stock/${r.id}/approve`, { method: "POST" });
      toast.showSuccess("Approved");
      await load();
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : "Approve failed";
      toast.showError(msg);
    }
  }

  return (
    <div>
      <PageActions>
        <Button type="button" size="sm" variant="outline" onClick={openAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add Entry
        </Button>
      </PageActions>

      {error ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

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
                      onClick={() => void onDeleteDraft(r)}
                      disabled={r.status !== "DRAFT"}
                      aria-label="Delete draft"
                      title={r.status !== "DRAFT" ? "Approved entries cannot be deleted" : "Delete draft"}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void onReverse(r)}
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
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      onClick={() => void onApprove(r)}
                      disabled={r.status !== "DRAFT"}
                    >
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
                  </div>
                </div>

                <div className="sticky bottom-0 z-[2] border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-8px_16px_-16px_rgba(0,0,0,0.55)]">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={saving}>
                      {saving ? "Saving..." : "Save as Draft"}
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

