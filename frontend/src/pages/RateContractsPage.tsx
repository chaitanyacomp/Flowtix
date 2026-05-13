import * as React from "react";
import { Navigate } from "react-router-dom";
import { Tags } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { apiFetch } from "../services/api";
import { useToast } from "../contexts/ToastContext";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { cn } from "../lib/utils";

type CustomerOption = { id: number; name: string };
type ItemOption = { id: number; itemName: string; itemType?: string };

type RateContractRow = {
  id: number;
  customerId: number;
  itemId: number;
  rate: string | number;
  gstRate: string | number;
  effectiveFrom: string;
  status: string;
  createdAt?: string;
  customer?: { id: number; name: string } | null;
  item?: { id: number; itemName: string; itemType?: string | null } | null;
};

function todayYmdLocal(): string {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatMoney(v: string | number): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatPct(v: string | number): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function formatEffective(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function RateContractsPage() {
  const toast = useToast();
  const isAdmin = useIsAdmin();

  const [customers, setCustomers] = React.useState<CustomerOption[]>([]);
  const [fgItems, setFgItems] = React.useState<ItemOption[]>([]);
  const [rows, setRows] = React.useState<RateContractRow[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [listLoading, setListLoading] = React.useState(true);

  const [customerId, setCustomerId] = React.useState<number>(0);
  const [itemId, setItemId] = React.useState<number>(0);
  const [rateStr, setRateStr] = React.useState("");
  const [gstRateStr, setGstRateStr] = React.useState("");
  const [effectiveFrom, setEffectiveFrom] = React.useState(todayYmdLocal);
  const [saving, setSaving] = React.useState(false);

  function loadList() {
    setListLoading(true);
    setLoadError(null);
    apiFetch<RateContractRow[]>("/api/rate-contracts")
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load rate contracts"))
      .finally(() => setListLoading(false));
  }

  React.useEffect(() => {
    Promise.all([
      apiFetch<CustomerOption[]>("/api/customers"),
      apiFetch<ItemOption[]>("/api/items?type=FG"),
    ])
      .then(([c, it]) => {
        setCustomers(Array.isArray(c) ? c : []);
        setFgItems(Array.isArray(it) ? it : []);
      })
      .catch(() => {
        setCustomers([]);
        setFgItems([]);
      });
  }, []);

  React.useEffect(() => {
    loadList();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cid = Number(customerId);
    const iid = Number(itemId);
    const rate = Number(rateStr);
    const gstRate = Number(gstRateStr);
    if (!Number.isFinite(cid) || cid <= 0) {
      toast.showError("Customer is required.");
      return;
    }
    if (!Number.isFinite(iid) || iid <= 0) {
      toast.showError("Item is required.");
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.showError("Enter a valid rate.");
      return;
    }
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) {
      toast.showError("GST rate must be between 0 and 100.");
      return;
    }
    if (!effectiveFrom.trim()) {
      toast.showError("Effective from date is required.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch<RateContractRow>("/api/rate-contracts", {
        method: "POST",
        body: JSON.stringify({
          customerId: cid,
          itemId: iid,
          rate,
          gstRate,
          effectiveFrom,
        }),
      });
      toast.showSuccess("Rate contract added");
      setRateStr("");
      setGstRateStr("");
      setEffectiveFrom(todayYmdLocal());
      loadList();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not add rate contract";
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">Rate Contracts</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Customer-wise item rates with effective date for NO_QTY billing.
        </p>
      </div>

      <div className="rounded-lg border border-amber-100/90 bg-gradient-to-r from-amber-50/95 to-white px-3 py-2.5 text-xs leading-relaxed text-amber-950 shadow-sm">
        <span className="font-semibold">Note:</span> Rate changes are added as new entries. Old rates are kept for audit.
      </div>

      <Card className="border-slate-200/90 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Tags className="h-4 w-4 text-violet-600" aria-hidden />
            Add rate
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={onSubmit} className="erp-form grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <label className="erp-form-field sm:col-span-2 lg:col-span-1">
              <span className="erp-form-label">Customer *</span>
              <select
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-sm"
                value={customerId || ""}
                onChange={(e) => setCustomerId(Number(e.target.value) || 0)}
              >
                <option value="">Select…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="erp-form-field sm:col-span-2 lg:col-span-1">
              <span className="erp-form-label">Item (FG) *</span>
              <select
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-sm"
                value={itemId || ""}
                onChange={(e) => setItemId(Number(e.target.value) || 0)}
              >
                <option value="">Select…</option>
                {fgItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.itemName}
                  </option>
                ))}
              </select>
            </label>
            <label className="erp-form-field">
              <span className="erp-form-label">Rate *</span>
              <Input
                className="h-9 tabular-nums"
                inputMode="decimal"
                value={rateStr}
                onChange={(e) => setRateStr(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <label className="erp-form-field">
              <span className="erp-form-label">GST rate *</span>
              <Input
                className="h-9 tabular-nums"
                inputMode="decimal"
                value={gstRateStr}
                onChange={(e) => setGstRateStr(e.target.value)}
                placeholder="18"
              />
            </label>
            <label className="erp-form-field">
              <span className="erp-form-label">Effective from *</span>
              <Input type="date" className="h-9" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </label>
            <div className="flex items-end pb-0.5">
              <Button type="submit" className="h-9 w-full sm:w-auto" disabled={saving}>
                {saving ? "Adding…" : "Add rate"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-200/90 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-3">
          <CardTitle className="text-base font-semibold text-slate-900">Contract history</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {loadError ? (
            <div className="px-4 py-3 text-sm text-red-800">{loadError}</div>
          ) : listLoading ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-600">No rate contracts yet. Add one above.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    <th className="whitespace-nowrap px-3 py-2.5">Customer</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Item</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right">Rate</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right">GST %</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Effective from</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr
                      key={r.id}
                      className={cn(
                        "border-b border-slate-100 transition-colors",
                        idx % 2 === 0 ? "bg-white" : "bg-slate-50/40",
                      )}
                    >
                      <td className="max-w-[200px] truncate px-3 py-2 font-medium text-slate-900" title={r.customer?.name ?? undefined}>
                        {r.customer?.name ?? `Customer #${r.customerId}`}
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-slate-800" title={r.item?.itemName ?? undefined}>
                        {r.item?.itemName ?? `Item #${r.itemId}`}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">{formatMoney(r.rate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-800">{formatPct(r.gstRate)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">{formatEffective(r.effectiveFrom)}</td>
                      <td className="px-3 py-2">
                        <Badge variant="default" className="font-normal tabular-nums">
                          {r.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
