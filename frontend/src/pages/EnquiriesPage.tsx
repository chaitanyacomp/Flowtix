import * as React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { PageActions } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../contexts/ToastContext";
import { Trash2, X } from "lucide-react";
import { useFastEntryForm } from "../hooks/useFastEntryForm";

/** Must match backend `enquiries.js` validation message. */
const ENQUIRY_DUPLICATE_ITEM_MESSAGE =
  "The same item cannot be added more than once in one enquiry.";

function enquiryLinesHaveDuplicateItem(lines: readonly { itemId: number }[]): boolean {
  const ids = lines.map((l) => l.itemId);
  return new Set(ids).size !== ids.length;
}

/** Items selectable on this row: current row's item, or any item not used on another row. */
function itemOptionsForLine(items: Item[], lines: { itemId: number }[], rowIndex: number): Item[] {
  return items.filter((it) => {
    const cur = lines[rowIndex]?.itemId;
    if (it.id === cur) return true;
    return !lines.some((l, j) => j !== rowIndex && l.itemId === it.id);
  });
}

type Customer = { id: number; name: string };
type Item = { id: number; itemName: string };

type EnquiryStatus =
  | "DRAFT"
  | "OPEN"
  | "PENDING"
  | "FEASIBLE"
  | "NOT_FEASIBLE"
  | "QUOTED"
  | "PO_RECEIVED"
  | "CLOSED";

type EnquiryRow = {
  id: number;
  status: EnquiryStatus;
  remarks?: string | null;
  createdAt: string;
  customer: Customer;
  lines: { id: number; item: Item; qty: string }[];
  feasibility: { status: string; remarks: string | null } | null;
  quotation: unknown | null;
};

function statusBadge(status: EnquiryStatus) {
  const map: Record<string, "default" | "success" | "warning" | "rejected"> = {
    DRAFT: "warning",
    OPEN: "warning",
    PENDING: "warning",
    FEASIBLE: "default",
    NOT_FEASIBLE: "rejected",
    QUOTED: "success",
    PO_RECEIVED: "success",
    CLOSED: "default",
  };
  return <Badge variant={map[status] || "default"}>{status.replace(/_/g, " ")}</Badge>;
}

function feasLabel(f: EnquiryRow["feasibility"]) {
  if (!f) return "—";
  if (f.status === "COMPLETED") return "Feasible";
  if (f.status === "REJECTED") return "Not feasible";
  return f.status;
}

function nextStepLabel(r: EnquiryRow): string {
  if (r.quotation) return "Quotation created";
  if (r.status === "FEASIBLE") return "Create quotation";
  if (["OPEN", "DRAFT", "PENDING"].includes(r.status)) return "Check feasibility";
  if (r.status === "NOT_FEASIBLE") return "—";
  return "—";
}

export function EnquiriesPage() {
  const toast = useToast();
  const isAdmin = useAuth().user?.role === "ADMIN";
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [items, setItems] = React.useState<Item[]>([]);
  const [rows, setRows] = React.useState<EnquiryRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const [customerId, setCustomerId] = React.useState(0);
  const [remarks, setRemarks] = React.useState("");
  const [enqLines, setEnqLines] = React.useState<{ itemId: number; qty: number }[]>([{ itemId: 0, qty: Number.NaN }]);
  const [creating, setCreating] = React.useState(false);

  const newFormRef = React.useRef<HTMLDivElement | null>(null);
  const customerSelectRef = React.useRef<HTMLSelectElement | null>(null);
  useFastEntryForm({ containerRef: newFormRef, initialFocusRef: customerSelectRef });

  const newItemSelectRefs = React.useRef<Array<HTMLSelectElement | null>>([]);
  const newQtyInputRefs = React.useRef<Array<HTMLInputElement | null>>([]);

  const [editRow, setEditRow] = React.useState<EnquiryRow | null>(null);
  const [editCustomerId, setEditCustomerId] = React.useState(0);
  const [editRemarks, setEditRemarks] = React.useState("");
  const [editLines, setEditLines] = React.useState<{ itemId: number; qty: number }[]>([]);
  const [savingEdit, setSavingEdit] = React.useState(false);

  const [feasForId, setFeasForId] = React.useState<number | null>(null);
  const [feasRemarks, setFeasRemarks] = React.useState("");
  const [feasBusy, setFeasBusy] = React.useState(false);

  async function refresh() {
    const [c, i, e] = await Promise.all([
      apiFetch<Customer[]>("/api/customers"),
      apiFetch<Item[]>("/api/items?type=FG"),
      apiFetch<EnquiryRow[]>("/api/enquiries"),
    ]);
    setCustomers(c);
    setItems(i);
    setRows(e);
    if (c.length && !customerId) setCustomerId(c[0].id);
    if (i.length && enqLines[0].itemId === 0) setEnqLines([{ itemId: i[0].id, qty: Number.NaN }]);
  }

  React.useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : "Failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If user updates an enquiry indirectly (e.g. approving a quotation) and then returns to this tab/page,
  // ensure the list reflects the latest server status without requiring a manual reload.
  React.useEffect(() => {
    function onFocus() {
      refresh().catch(() => {});
    }
    function onVis() {
      if (document.visibilityState === "visible") refresh().catch(() => {});
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate() {
    setError(null);
    if (enquiryLinesHaveDuplicateItem(enqLines)) {
      setError(ENQUIRY_DUPLICATE_ITEM_MESSAGE);
      toast.showError(ENQUIRY_DUPLICATE_ITEM_MESSAGE);
      return;
    }
    for (const l of enqLines) {
      const q = Number(l.qty);
      if (!Number.isFinite(q) || q <= 0) {
        setError("Quantity must be greater than zero for each enquiry line.");
        toast.showError("Quantity must be greater than zero for each enquiry line.");
        return;
      }
    }
    setCreating(true);
    try {
      await apiFetch("/api/enquiries", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          remarks: remarks.trim() || undefined,
          lines: enqLines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })),
        }),
      });
      setRemarks("");
      await refresh();
      toast.showSuccess("Enquiry saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreating(false);
    }
  }

  function openEdit(r: EnquiryRow) {
    setError(null);
    setEditRow(r);
    setEditCustomerId(r.customer.id);
    setEditRemarks(r.remarks ?? "");
    setEditLines(r.lines.map((l) => ({ itemId: l.item.id, qty: Number(l.qty) })));
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editRow) return;
    setError(null);
    if (enquiryLinesHaveDuplicateItem(editLines)) {
      setError(ENQUIRY_DUPLICATE_ITEM_MESSAGE);
      toast.showError(ENQUIRY_DUPLICATE_ITEM_MESSAGE);
      return;
    }
    for (const l of editLines) {
      const q = Number(l.qty);
      if (!Number.isFinite(q) || q <= 0) {
        setError("Quantity must be greater than zero for each enquiry line.");
        toast.showError("Quantity must be greater than zero for each enquiry line.");
        return;
      }
    }
    setSavingEdit(true);
    try {
      await apiFetch(`/api/enquiries/${editRow.id}`, {
        method: "PUT",
        body: JSON.stringify({
          customerId: editCustomerId,
          remarks: editRemarks.trim() || null,
          lines: editLines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
        }),
      });
      setEditRow(null);
      await refresh();
      toast.showSuccess("Saved successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSavingEdit(false);
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Delete this enquiry?")) return;
    try {
      await apiFetch(`/api/enquiries/${id}`, { method: "DELETE" });
      await refresh();
      toast.showSuccess("Deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function applyFeasibility(id: number, outcome: "feasible" | "not_feasible") {
    setFeasBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/enquiries/${id}/feasibility`, {
        method: "PUT",
        body: JSON.stringify({ outcome, remarks: feasRemarks.trim() || undefined }),
      });
      setFeasForId(null);
      setFeasRemarks("");
      await refresh();
      toast.showSuccess("Feasibility updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setFeasBusy(false);
    }
  }

  const canFeasibility = (s: EnquiryStatus) =>
    ["OPEN", "DRAFT", "PENDING", "FEASIBLE", "NOT_FEASIBLE"].includes(s);

  return (
    <div className="grid gap-6">
      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      <div>
        <h1 className="text-xl font-semibold text-slate-900">Enquiries</h1>
        <p className="mt-0.5 text-[13px] text-slate-600">Create a new enquiry and track recent progress.</p>
      </div>

      <section className="grid gap-3">
        <h2 className="text-base font-semibold text-slate-900">Create Enquiry</h2>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div ref={newFormRef} className="grid max-w-2xl gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-medium text-slate-600">
                  Customer
                  <select
                    ref={customerSelectRef}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 shadow-sm"
                    data-testid="enquiry-customer-select"
                    value={customerId}
                    onChange={(e) => setCustomerId(Number(e.target.value))}
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-slate-600">
                  Remarks (optional)
                  <Input className="h-9" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Notes" />
                </label>
              </div>

              <div className="grid gap-2">
                <div className="grid grid-cols-12 gap-2 text-[12px] font-medium text-slate-600">
                  <div className="col-span-7 sm:col-span-8">Item</div>
                  <div className="col-span-5 sm:col-span-4">Qty</div>
                </div>
                {enqLines.map((l, i) => (
                  <div key={`nl-${i}`} className="grid grid-cols-12 items-end gap-2">
                    <div className="col-span-7 sm:col-span-8">
                      <select
                        ref={(el) => {
                          newItemSelectRefs.current[i] = el;
                        }}
                        className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 shadow-sm"
                        data-testid="enquiry-item-select"
                        value={l.itemId}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setEnqLines((p) => p.map((x, j) => (j === i ? { ...x, itemId: v } : x)));
                          window.setTimeout(() => newQtyInputRefs.current[i]?.focus(), 0);
                        }}
                      >
                        {itemOptionsForLine(items, enqLines, i).map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.itemName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-5 sm:col-span-4 flex items-center gap-2">
                      <Input
                        ref={(el) => {
                          newQtyInputRefs.current[i] = el;
                        }}
                        className="h-9"
                        type="number"
                        data-testid="enquiry-qty-input"
                        min={0.001}
                        step="any"
                        value={Number.isFinite(l.qty) ? String(l.qty) : ""}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          const used = new Set(enqLines.map((x) => x.itemId));
                          const nextItem = items.find((it) => !used.has(it.id));
                          if (!nextItem) return;
                          setEnqLines((p) => [...p, { itemId: nextItem.id, qty: Number.NaN }]);
                          window.setTimeout(() => newItemSelectRefs.current[i + 1]?.focus(), 0);
                        }}
                        onChange={(e) => {
                          const raw = (e.target as HTMLInputElement).value;
                          const v = raw.trim() === "" ? Number.NaN : Number(raw);
                          setEnqLines((p) => p.map((x, j) => (j === i ? { ...x, qty: v } : x)));
                        }}
                      />
                      {enqLines.length > 1 ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-9 w-9"
                          aria-label="Remove item"
                          onClick={() => setEnqLines((p) => p.filter((_, j) => j !== i))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  data-testid="enquiry-add-line-btn"
                  className="text-sm font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-800"
                  onClick={() => {
                    const used = new Set(enqLines.map((x) => x.itemId));
                    const nextItem = items.find((it) => !used.has(it.id));
                    if (!nextItem) {
                      toast.showError(
                        "Every item is already on this enquiry. Change quantity on an existing line instead of adding the same item again.",
                      );
                      return;
                    }
                    setEnqLines((p) => [...p, { itemId: nextItem.id, qty: Number.NaN }]);
                    window.setTimeout(() => newItemSelectRefs.current[enqLines.length]?.focus(), 0);
                  }}
                >
                  + Add another item
                </button>

                <Button type="button" data-testid="create-enquiry-btn" onClick={onCreate} disabled={creating}>
                  {creating ? "Saving…" : "Create Enquiry"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Recent Enquiries</h2>
            <p className="mt-0.5 text-[13px] text-slate-600">Enquiry ID is assigned automatically.</p>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-[13px] text-slate-700">
            No enquiries yet. Start by creating a new enquiry.
          </div>
        ) : (
          <div className="erp-table-wrap">
            <table className="erp-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Next Step</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const primaryIsFeas = canFeasibility(r.status) && !r.quotation && r.status !== "FEASIBLE";
                  const primaryIsCreateQuote = r.status === "FEASIBLE" && !r.quotation;
                  const primaryIsViewQuote = Boolean(r.quotation);
                  const primaryLabel = primaryIsViewQuote
                    ? "View quotation"
                    : primaryIsCreateQuote
                      ? "Create quotation"
                      : primaryIsFeas
                        ? "Check feasibility"
                        : null;

                  return (
                    <tr key={r.id}>
                      <td className="font-medium">#{r.id}</td>
                      <td className="whitespace-nowrap text-slate-600">{new Date(r.createdAt).toLocaleDateString()}</td>
                      <td className="min-w-[10rem]">{r.customer.name}</td>
                      <td>{statusBadge(r.status)}</td>
                      <td className="text-sm text-slate-700">{nextStepLabel(r)}</td>
                      <td className="text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          {primaryIsCreateQuote || primaryIsViewQuote ? (
                            <Link
                              to={`/quotations/new?enquiryId=${r.id}`}
                              data-testid="next-create-quotation"
                              className="inline-flex h-9 items-center rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700"
                            >
                              {primaryLabel}
                            </Link>
                          ) : primaryIsFeas ? (
                            <Button
                              type="button"
                              size="sm"
                              className="h-9"
                              data-testid="enquiry-check-feasibility-btn"
                              onClick={() => setFeasForId(feasForId === r.id ? null : r.id)}
                            >
                              {feasForId === r.id ? "Close" : "Check feasibility"}
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )}

                          {isAdmin && !r.quotation ? (
                            <Button
                              type="button"
                              size="icon"
                              variant="destructive"
                              className="h-9 w-9"
                              aria-label="Delete"
                              onClick={() => onDelete(r.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>

                        {feasForId === r.id ? (
                          <div className="mt-2 max-w-sm rounded border border-slate-200 bg-slate-50 p-2 text-left">
                            <Input
                              className="mb-2 h-9"
                              placeholder="Remarks"
                              value={feasRemarks}
                              onChange={(e) => setFeasRemarks(e.target.value)}
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" disabled={feasBusy} onClick={() => applyFeasibility(r.id, "feasible")}>
                                Feasible
                              </Button>
                              <Button size="sm" variant="outline" disabled={feasBusy} onClick={() => applyFeasibility(r.id, "not_feasible")}>
                                Not feasible
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editRow ? (
        <div className="erp-modal-backdrop" role="dialog">
          <Card className="erp-modal-shell-md max-h-[90vh]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Edit enquiry #{editRow.id}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveEdit} className="erp-form min-w-0">
                <div className="erp-form-field">
                  <span className="erp-form-label">Customer</span>
                  <select className="erp-select" value={editCustomerId} onChange={(e) => setEditCustomerId(Number(e.target.value))}>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Remarks</span>
                  <Input value={editRemarks} onChange={(e) => setEditRemarks(e.target.value)} />
                </div>
                {editLines.map((l, i) => (
                  <div key={`el-${i}`} className="erp-form-line-card space-y-2">
                    <div className="erp-form-field">
                      <span className="erp-form-label">Item</span>
                      <select
                        className="erp-select"
                        value={l.itemId}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setEditLines((p) => p.map((x, j) => (j === i ? { ...x, itemId: v } : x)));
                        }}
                      >
                        {itemOptionsForLine(items, editLines, i).map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.itemName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="erp-form-field max-w-[10rem]">
                      <span className="erp-form-label">Qty</span>
                      <Input
                        type="number"
                        min={0.001}
                        step="any"
                        value={Number.isFinite(l.qty) ? String(l.qty) : ""}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const v = raw.trim() === "" ? Number.NaN : Number(raw);
                          setEditLines((p) => p.map((x, j) => (j === i ? { ...x, qty: v } : x)));
                        }}
                      />
                    </div>
                    {editLines.length > 1 ? (
                      <div className="flex justify-end">
                        <Button type="button" size="sm" variant="outline" onClick={() => setEditLines((p) => p.filter((_, j) => j !== i))}>
                          Remove
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const used = new Set(editLines.map((x) => x.itemId));
                    const nextItem = items.find((it) => !used.has(it.id));
                    if (!nextItem) {
                      toast.showError(
                        "Every item is already on this enquiry. Change quantity on an existing line instead of adding the same item again.",
                      );
                      return;
                    }
                    setEditLines((p) => [...p, { itemId: nextItem.id, qty: Number.NaN }]);
                  }}
                >
                  Add line
                </Button>
                <div className="flex gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setEditRow(null)} disabled={savingEdit}>
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
