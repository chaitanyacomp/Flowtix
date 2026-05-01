import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { useAuth } from "../hooks/useAuth";
import {
  type QuoteLineDraft,
  defaultQuoteLineDraft,
  draftLinesToApiPayload,
  lineTotalFromDraft,
  previewNum,
  validateQuoteLinesForSave,
} from "../lib/quotationLineDraft";

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
  customer: Customer;
  lines: { id: number; item: Item; qty: string }[];
  feasibility: { status: string; remarks: string | null } | null;
  quotation: {
    totalAmount: string;
    lines: {
      item: Item;
      qty: string;
      rate: string;
      discountPct: string;
      gstPct: string;
      lineTotal: string;
      isFree?: boolean;
    }[];
  } | null;
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

function lineTotal(qty: number, rate: number, discountPct: number, gstPct: number, isFree?: boolean) {
  const r = isFree ? 0 : rate;
  const base = qty * r * (1 - discountPct / 100);
  const gst = base * (gstPct / 100);
  return Math.round((base + gst) * 100) / 100;
}

export function SalesPipelinePage() {
  const isAdmin = useAuth().user?.role === "ADMIN";
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [items, setItems] = React.useState<Item[]>([]);
  const [suppliers, setSuppliers] = React.useState<{ id: number; name: string }[]>([]);
  const [rows, setRows] = React.useState<EnquiryRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const [customerId, setCustomerId] = React.useState(0);
  const [enqLines, setEnqLines] = React.useState<{ itemId: number; qty: string }[]>([{ itemId: 0, qty: "" }]);
  const [creating, setCreating] = React.useState(false);

  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [feasRemarks, setFeasRemarks] = React.useState("");
  const [quoteLines, setQuoteLines] = React.useState<QuoteLineDraft[]>([defaultQuoteLineDraft(0)]);
  const [supplierId, setSupplierId] = React.useState<number | "">("");
  const [busy, setBusy] = React.useState(false);

  async function refresh() {
    const [c, i, s, e] = await Promise.all([
      apiFetch<Customer[]>("/api/customers"),
      apiFetch<Item[]>("/api/items?type=FG"),
      apiFetch<{ id: number; name: string }[]>("/api/suppliers"),
      apiFetch<EnquiryRow[]>("/api/enquiries"),
    ]);
    setCustomers(c);
    setItems(i);
    setSuppliers(s);
    setRows(e);
    if (c.length && !customerId) setCustomerId(c[0].id);
    if (i.length && enqLines[0].itemId === 0) setEnqLines([{ itemId: i[0].id, qty: "" }]);
    if (i.length && quoteLines[0].itemId === 0) {
      setQuoteLines([{ ...defaultQuoteLineDraft(i[0].id), rate: "100" }]);
    }
    if (e.length && selectedId == null) setSelectedId(e[0].id);
  }

  React.useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : "Failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  async function onCreateEnquiry() {
    setError(null);
    for (const l of enqLines) {
      const q = Number.parseFloat(l.qty.trim());
      if (!Number.isFinite(q) || q <= 0) {
        setError("Quantity must be greater than zero for each enquiry line.");
        return;
      }
    }
    setCreating(true);
    try {
      await apiFetch("/api/enquiries", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          lines: enqLines.map((l) => ({ itemId: l.itemId, qty: Number.parseFloat(l.qty.trim()) })),
        }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreating(false);
    }
  }

  async function onDeleteEnquiry(id: number) {
    if (!confirm("Delete enquiry?")) return;
    try {
      await apiFetch(`/api/enquiries/${id}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function onFeasibility(outcome: "feasible" | "not_feasible") {
    if (!selectedId) return;
    setBusy(true);
    try {
      await apiFetch(`/api/enquiries/${selectedId}/feasibility`, {
        method: "POST",
        body: JSON.stringify({ outcome, remarks: feasRemarks.trim() || undefined }),
      });
      setFeasRemarks("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function onQuotation() {
    if (!selectedId) return;
    const v = validateQuoteLinesForSave(quoteLines);
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/quotations", {
        method: "POST",
        body: JSON.stringify({
          enquiryId: selectedId,
          lines: draftLinesToApiPayload(quoteLines),
        }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function onConvertToPo() {
    if (!selectedId) return;
    setBusy(true);
    try {
      await apiFetch(`/api/enquiries/${selectedId}/convert-to-po`, {
        method: "POST",
        body: JSON.stringify({ supplierId: supplierId === "" ? undefined : supplierId }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const quoteSum = quoteLines.reduce((s, l) => s + lineTotalFromDraft(l, lineTotal), 0);

  return (
    <div className="grid gap-3">
      <Card>
        <CardHeader>
          <CardTitle>New enquiry (multi-item)</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? <div className="mb-3 text-sm text-red-700">{error}</div> : null}
          <div className="mb-3 grid gap-2 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-slate-600">Customer</span>
              <select
                className="h-10 rounded-md border bg-white px-3 text-sm"
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
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-600">
                <th className="py-2">FG</th>
                <th className="py-2">Qty</th>
              </tr>
            </thead>
            <tbody>
              {enqLines.map((l, i) => (
                <tr key={i} className="border-b">
                  <td className="py-1">
                    <select
                      className="h-9 w-full rounded border px-2"
                      value={l.itemId}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setEnqLines((p) => p.map((x, j) => (j === i ? { ...x, itemId: v } : x)));
                      }}
                    >
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.itemName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1">
                    <Input
                      type="number"
                      className="h-9"
                      step="any"
                      inputMode="decimal"
                      value={l.qty}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        setEnqLines((p) => p.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)));
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEnqLines((p) => [...p, { itemId: items[0]?.id ?? 0, qty: "" }])}
            >
              Add line
            </Button>
            <Button onClick={onCreateEnquiry} disabled={creating}>
              Create enquiry
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Progress selected enquiry</CardTitle>
        </CardHeader>
        <CardContent>
          {!rows.length ? (
            <p className="text-sm text-slate-600">No enquiries.</p>
          ) : (
            <div className="grid gap-4">
              <label className="grid gap-1 text-sm">
                <span className="text-slate-600">Enquiry</span>
                <select
                  className="h-10 rounded-md border bg-white px-3 text-sm"
                  value={selectedId ?? ""}
                  onChange={(e) => setSelectedId(Number(e.target.value))}
                >
                  {rows.map((r) => (
                    <option key={r.id} value={r.id}>
                      #{r.id} {r.customer.name} · {r.status}
                    </option>
                  ))}
                </select>
              </label>
              {selected ? <div className="text-sm">Status: {statusBadge(selected.status)}</div> : null}

              {selected?.status === "PENDING" ? (
                <div className="space-y-2 rounded-md border bg-slate-50 p-3">
                  <div className="text-sm font-medium">Feasibility</div>
                  <Input placeholder="Remarks" value={feasRemarks} onChange={(e) => setFeasRemarks(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy} onClick={() => onFeasibility("feasible")}>
                      Feasible
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => onFeasibility("not_feasible")}>
                      Not feasible
                    </Button>
                  </div>
                </div>
              ) : null}

              {selected?.status === "FEASIBLE" ? (
                <div className="space-y-2 rounded-md border bg-slate-50 p-3">
                  <div className="text-sm font-medium">Quotation (multi-line)</div>
                  <table className="w-full text-xs md:text-sm">
                    <thead>
                      <tr className="text-left text-slate-600">
                        <th className="py-1">FG</th>
                        <th className="py-1">Qty</th>
                        <th className="py-1">Rate</th>
                        <th className="py-1">Disc%</th>
                        <th className="py-1">GST%</th>
                        <th className="py-1">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quoteLines.map((l, i) => (
                        <tr key={i}>
                          <td className="p-0.5">
                            <select
                              className="max-w-[140px] rounded border px-1"
                              value={l.itemId}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                setQuoteLines((p) => p.map((x, j) => (j === i ? { ...x, itemId: v } : x)));
                              }}
                            >
                              {items.map((it) => (
                                <option key={it.id} value={it.id}>
                                  {it.itemName}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-0.5">
                            <Input
                              className="h-8 w-16"
                              type="number"
                              step="any"
                              inputMode="decimal"
                              value={l.qty}
                              onChange={(e) => {
                                setQuoteLines((p) => p.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)));
                              }}
                            />
                          </td>
                          <td className="p-0.5">
                            <Input
                              className="h-8 w-20"
                              type="number"
                              step="any"
                              inputMode="decimal"
                              value={l.isFree ? "0" : l.rate}
                              disabled={l.isFree}
                              onChange={(e) => {
                                setQuoteLines((p) => p.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)));
                              }}
                            />
                            {l.isFree ? <span className="block text-[10px] text-emerald-800">(Free)</span> : null}
                          </td>
                          <td className="p-0.5">
                            <Input
                              className="h-8 w-14"
                              type="number"
                              step="any"
                              inputMode="decimal"
                              value={l.discountPct}
                              onChange={(e) => {
                                setQuoteLines((p) => p.map((x, j) => (j === i ? { ...x, discountPct: e.target.value } : x)));
                              }}
                            />
                          </td>
                          <td className="p-0.5">
                            <Input
                              className="h-8 w-14"
                              type="number"
                              step="any"
                              inputMode="decimal"
                              value={l.gstPct}
                              onChange={(e) => {
                                setQuoteLines((p) => p.map((x, j) => (j === i ? { ...x, gstPct: e.target.value } : x)));
                              }}
                            />
                          </td>
                          <td className="py-1">{lineTotalFromDraft(l, lineTotal).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {quoteLines.map((l, i) => (
                    <label key={`qf-${i}`} className="mt-1 flex cursor-pointer items-center gap-2 text-xs text-slate-800">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-300"
                        checked={l.isFree}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setQuoteLines((p) =>
                            p.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    isFree: checked,
                                    rate: checked ? "0" : previewNum(x.rate) > 0 ? x.rate : "1",
                                  }
                                : x,
                            ),
                          );
                        }}
                      />
                      Free item (line {i + 1})
                    </label>
                  ))}
                  <div className="text-sm font-medium">Sum: {quoteSum.toFixed(2)}</div>
                  <Button size="sm" disabled={busy} onClick={onQuotation}>
                    Save quotation
                  </Button>
                </div>
              ) : null}

              {selected?.status === "QUOTED" ? (
                <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50/50 p-3">
                  <div className="text-sm font-medium">Convert to customer PO</div>
                  <label className="grid gap-1 text-sm">
                    <span>Optional supplier</span>
                    <select
                      className="h-10 rounded-md border bg-white px-3 text-sm"
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
                  <Button disabled={busy} onClick={onConvertToPo}>
                    Convert to PO &amp; stock decision
                  </Button>
                </div>
              ) : null}

              {selected && isAdmin ? (
                <Button variant="destructive" size="sm" onClick={() => selected && onDeleteEnquiry(selected.id)}>
                  Delete enquiry
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All enquiries</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-600">
                  <th className="py-2">#</th>
                  <th className="py-2">Customer</th>
                  <th className="py-2">Lines</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="py-2 font-medium">#{r.id}</td>
                    <td className="py-2">{r.customer?.name}</td>
                    <td className="py-2">
                      {r.lines.map((l) => (
                        <span key={l.id} className="mr-2">
                          {l.item.itemName}×{l.qty}
                        </span>
                      ))}
                    </td>
                    <td className="py-2">{statusBadge(r.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
