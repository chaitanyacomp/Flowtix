import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { useAuth } from "../hooks/useAuth";
import { isValidNumberDraft, type NumberDraft, toNumberDraft } from "../lib/numberDraft";

type Customer = { id: number; name: string };
type Item = { id: number; itemName: string; itemType: "RM" | "FG" };
type Supplier = { id: number; name: string };
type PoLine = { itemId: number; qty: NumberDraft; rate: NumberDraft; discountPct: NumberDraft; gstPct: NumberDraft };
type PoRow = {
  id: number;
  poNumber: string;
  poDate: string;
  requiredDate?: string | null;
  customer: Customer;
  supplier?: Supplier | null;
  status: string;
  lines: { item: Item; qty: string; rate: string; lineTotal: string }[];
  salesOrder?: { id: number } | null;
};

function lineTotal(qty: NumberDraft, rate: NumberDraft, discountPct: NumberDraft, gstPct: NumberDraft) {
  const q = Number(qty || 0);
  const r = Number(rate || 0);
  const d = Number(discountPct || 0);
  const g = Number(gstPct || 0);
  const base = q * r * (1 - d / 100);
  const gst = base * (g / 100);
  return Math.round((base + gst) * 100) / 100;
}

export function PosPage() {
  const auth = useAuth();
  const isAdmin = auth.user?.role === "ADMIN";
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [items, setItems] = React.useState<Item[]>([]);
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [rows, setRows] = React.useState<PoRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const [customerId, setCustomerId] = React.useState(0);
  const [supplierId, setSupplierId] = React.useState<number | "">("");
  const [poNumber, setPoNumber] = React.useState("");
  const [poDate, setPoDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [requiredDate, setRequiredDate] = React.useState("");
  const [lines, setLines] = React.useState<PoLine[]>([{ itemId: 0, qty: "", rate: "", discountPct: 0, gstPct: 18 }]);
  const [creating, setCreating] = React.useState(false);

  function normalizeDateInput(v: string): string {
    const t = v.trim();
    return t;
  }

  async function refresh() {
    const [c, i, s, p] = await Promise.all([
      apiFetch<Customer[]>("/api/customers"),
      apiFetch<Item[]>("/api/items?type=FG"),
      apiFetch<Supplier[]>("/api/suppliers"),
      apiFetch<PoRow[]>("/api/pos"),
    ]);
    setCustomers(c);
    setItems(i);
    setSuppliers(s);
    setRows(p);
    if (c.length && !customerId) setCustomerId(c[0].id);
    if (i.length && lines[0].itemId === 0) setLines((prev) => [{ ...prev[0], itemId: i[0].id }, ...prev.slice(1)]);
  }

  React.useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addRow() {
    const itemId = items[0]?.id ?? 0;
    setLines((prev) => [...prev, { itemId, qty: "", rate: "", discountPct: 0, gstPct: 18 }]);
  }

  function removeRow(i: number) {
    setLines((prev) => prev.filter((_, j) => j !== i));
  }

  function updateLine(i: number, patch: Partial<PoLine>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function onCreate() {
    setError(null);
    if (!poNumber.trim()) {
      setError("PO Number is required.");
      return;
    }
    if (!normalizeDateInput(poDate)) {
      setError("PO Date is required.");
      return;
    }
    if (!lines.length) {
      setError("Add at least one line.");
      return;
    }
    const bad = lines.find(
      (l) =>
        !l.itemId ||
        !isValidNumberDraft(l.qty) ||
        l.qty <= 0 ||
        !isValidNumberDraft(l.rate) ||
        l.rate < 0 ||
        !isValidNumberDraft(l.discountPct) ||
        l.discountPct < 0 ||
        !isValidNumberDraft(l.gstPct) ||
        l.gstPct < 0,
    );
    if (bad) {
      setError("Please complete all numeric fields (qty > 0, rate/discount/GST not negative).");
      return;
    }
    setCreating(true);
    try {
      await apiFetch("/api/pos", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          supplierId: supplierId === "" ? null : supplierId,
          poNumber: poNumber.trim(),
          poDate,
          requiredDate: requiredDate.trim() ? requiredDate.trim() : null,
          lines: lines.map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            rate: l.rate,
            discountPct: l.discountPct,
            gstPct: l.gstPct,
          })),
        }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreating(false);
    }
  }

  async function onDeletePo(id: number) {
    if (!confirm("Delete this PO?")) return;
    setError(null);
    try {
      await apiFetch(`/api/pos/${id}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  function statusBadge(status: string) {
    if (status === "COMPLETED") return <Badge variant="success">Completed</Badge>;
    if (status === "REJECTED") return <Badge variant="rejected">Rejected</Badge>;
    return <Badge variant="warning">Pending</Badge>;
  }

  return (
    <div className="grid gap-3">
      <Card>
        <CardHeader>
          <CardTitle>Create Customer PO</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
          <div className="mb-3 grid gap-2 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-slate-600">Customer</span>
              <select
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
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
            <label className="grid gap-1 text-sm">
              <span className="text-slate-600">Supplier (optional)</span>
              <select
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={supplierId === "" ? "" : supplierId}
                onChange={(e) => setSupplierId(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mb-3 grid gap-2 md:grid-cols-3">
            <label className="grid gap-1 text-sm">
              <span className="text-slate-600">PO Number</span>
              <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="Customer PO number" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-slate-600">PO Date</span>
              <Input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-slate-600">Required Date (optional)</span>
              <Input type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} />
            </label>
          </div>
          <div className="overflow-auto rounded-md border">
            <table className="w-full min-w-0 text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left text-slate-600">
                  <th className="p-2">FG</th>
                  <th className="p-2">Qty</th>
                  <th className="p-2">Rate</th>
                  <th className="p-2">Disc %</th>
                  <th className="p-2">GST %</th>
                  <th className="p-2">Line total</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b">
                    <td className="p-1">
                      <select
                        className="h-9 w-full rounded border border-slate-200 px-2 text-sm"
                        value={l.itemId}
                        onChange={(e) => updateLine(i, { itemId: Number(e.target.value) })}
                      >
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.itemName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-1">
                      <Input type="number" className="h-9" value={l.qty} onChange={(e) => updateLine(i, { qty: toNumberDraft(e.target.value) })} />
                    </td>
                    <td className="p-1">
                      <Input type="number" className="h-9" value={l.rate} onChange={(e) => updateLine(i, { rate: toNumberDraft(e.target.value) })} />
                    </td>
                    <td className="p-1">
                      <Input
                        type="number"
                        className="h-9"
                        value={l.discountPct}
                        onChange={(e) => updateLine(i, { discountPct: toNumberDraft(e.target.value) })}
                      />
                    </td>
                    <td className="p-1">
                      <Input type="number" className="h-9" value={l.gstPct} onChange={(e) => updateLine(i, { gstPct: toNumberDraft(e.target.value) })} />
                    </td>
                    <td className="p-2 text-slate-800">{lineTotal(l.qty, l.rate, l.discountPct, l.gstPct).toFixed(2)}</td>
                    <td className="p-1">
                      {lines.length > 1 ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(i)}>
                          ✕
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              Add line
            </Button>
            <Button onClick={onCreate} disabled={creating || !items.length}>
              {creating ? "Creating..." : "Create PO"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>PO List</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {rows.map((r) => (
              <div key={r.id} className="rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">
                    {r.poNumber} · {r.customer?.name}
                    {r.supplier ? ` · ${r.supplier.name}` : ""}
                    <div className="mt-0.5 text-xs text-slate-600">
                      PO Date: {r.poDate ? new Date(r.poDate).toLocaleDateString() : "—"}
                      {r.requiredDate ? ` · Required: ${new Date(r.requiredDate).toLocaleDateString()}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(r.status)}
                    {r.salesOrder ? <span className="text-xs text-slate-600">SO #{r.salesOrder.id}</span> : null}
                    {isAdmin ? (
                      <Button variant="destructive" size="sm" onClick={() => onDeletePo(r.id)}>
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </div>
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-600">
                      <th className="py-1">Item</th>
                      <th className="py-1">Qty</th>
                      <th className="py-1">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.lines?.map((ln) => (
                      <tr key={ln.item.itemName + ln.qty}>
                        <td className="py-1">{ln.item?.itemName}</td>
                        <td className="py-1">{ln.qty}</td>
                        <td className="py-1">{ln.lineTotal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
