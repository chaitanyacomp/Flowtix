import * as React from "react";
import { Navigate } from "react-router-dom";
import { Ban, Pencil, Tags, X } from "lucide-react";
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
  status: "APPROVED" | "SUPERSEDED" | "INACTIVE" | string;
  revisedFromId?: number | null;
  deactivatedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  customer?: { id: number; name: string } | null;
  item?: { id: number; itemName: string; itemType?: string | null } | null;
  revisedFrom?: { id: number } | null;
  createdBy?: { id: number; name?: string | null; email?: string | null } | null;
};

type PendingAction =
  | { type: "add"; payload: FormPayload }
  | { type: "revise"; id: number; payload: FormPayload }
  | { type: "deactivate"; row: RateContractRow }
  | { type: "deactivateFuture" };

type FormPayload = {
  customerId: number;
  itemId: number;
  rate: number;
  gstRate: number;
  effectiveFrom: string;
};

const FUTURE_EFFECTIVE_DATE_MSG = "Future effective date is not allowed.";

function todayYmdLocal(): string {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isFutureEffectiveYmd(ymd: string): boolean {
  const t = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  return t > todayYmdLocal();
}

function isRowCurrentlyActive(row: RateContractRow): boolean {
  if (row.status !== "APPROVED") return false;
  return !isFutureEffectiveYmd(isoToYmdLocal(row.effectiveFrom));
}

function isoToYmdLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return todayYmdLocal();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMoney(v: string | number): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatPct(v: string | number): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "-";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function actorLabel(row: RateContractRow): string {
  return row.createdBy?.name || row.createdBy?.email || (row.createdBy?.id ? `User #${row.createdBy.id}` : "-");
}

function statusTone(status: string): string {
  if (status === "APPROVED") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "SUPERSEDED") return "bg-slate-100 text-slate-700 ring-slate-200";
  return "bg-rose-50 text-rose-700 ring-rose-200";
}

function isFutureDatedHistoryRow(row: RateContractRow): boolean {
  return isFutureEffectiveYmd(isoToYmdLocal(row.effectiveFrom));
}

function RateContractHistoryTable({
  rows,
  variant = "default",
  saving,
  onRevise,
  onDeactivate,
}: {
  rows: RateContractRow[];
  variant?: "default" | "invalid";
  saving: boolean;
  onRevise: (row: RateContractRow) => void;
  onDeactivate: (row: RateContractRow) => void;
}) {
  if (!rows.length) return null;
  const invalidVariant = variant === "invalid";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] border-collapse text-sm">
        <thead>
          <tr
            className={cn(
              "border-b text-left text-[11px] font-semibold uppercase tracking-wide",
              invalidVariant ? "border-amber-200/90 bg-amber-50/80 text-amber-900/80" : "border-slate-200 bg-slate-50/90 text-slate-600",
            )}
          >
            <th className="whitespace-nowrap px-3 py-2.5">Customer</th>
            <th className="whitespace-nowrap px-3 py-2.5">Item</th>
            <th className="whitespace-nowrap px-3 py-2.5 text-right">Rate</th>
            <th className="whitespace-nowrap px-3 py-2.5 text-right">GST %</th>
            <th className="whitespace-nowrap px-3 py-2.5">Effective from</th>
            <th className="whitespace-nowrap px-3 py-2.5">Status</th>
            <th className="whitespace-nowrap px-3 py-2.5">Active</th>
            <th className="whitespace-nowrap px-3 py-2.5">Revised from</th>
            <th className="whitespace-nowrap px-3 py-2.5">Created by</th>
            <th className="whitespace-nowrap px-3 py-2.5">Last updated</th>
            <th className="whitespace-nowrap px-3 py-2.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const active = isRowCurrentlyActive(r);
            const futurePending = r.status === "APPROVED" && !active;
            return (
              <tr
                key={r.id}
                className={cn(
                  "border-b border-slate-100 transition-colors",
                  invalidVariant
                    ? idx % 2 === 0
                      ? "bg-amber-50/40"
                      : "bg-amber-50/20"
                    : idx % 2 === 0
                      ? "bg-white"
                      : "bg-slate-50/40",
                )}
              >
                <td className="max-w-[170px] truncate px-3 py-2 font-medium text-slate-900" title={r.customer?.name ?? undefined}>
                  {r.customer?.name ?? `Customer #${r.customerId}`}
                </td>
                <td className="max-w-[190px] truncate px-3 py-2 text-slate-800" title={r.item?.itemName ?? undefined}>
                  {r.item?.itemName ?? `Item #${r.itemId}`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">{formatMoney(r.rate)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-800">{formatPct(r.gstRate)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{formatDate(r.effectiveFrom)}</td>
                <td className="px-3 py-2">
                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1", statusTone(r.status))}>{r.status}</span>
                </td>
                <td className="px-3 py-2">
                  <Badge variant={active ? "success" : futurePending ? "warning" : "default"} className="font-normal">
                    {active ? "Active" : futurePending ? "Future" : "Inactive"}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.revisedFromId ? `#${r.revisedFromId}` : "-"}</td>
                <td className="max-w-[150px] truncate px-3 py-2 text-slate-700" title={actorLabel(r)}>
                  {actorLabel(r)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{formatDate(r.updatedAt ?? r.createdAt)}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => onRevise(r)} disabled={!active || saving}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      Revise
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50"
                      onClick={() => onDeactivate(r)}
                      disabled={!active || saving}
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden />
                      Deactivate
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
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
  const [editingRowId, setEditingRowId] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);

  const [pendingAction, setPendingAction] = React.useState<PendingAction | null>(null);
  const [adminPassword, setAdminPassword] = React.useState("");
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [effectiveFromError, setEffectiveFromError] = React.useState<string | null>(null);
  const [futureCleanupBusy, setFutureCleanupBusy] = React.useState(false);

  function resetForm() {
    setCustomerId(0);
    setItemId(0);
    setRateStr("");
    setGstRateStr("");
    setEffectiveFrom(todayYmdLocal());
    setEditingRowId(null);
  }

  function loadList() {
    setListLoading(true);
    setLoadError(null);
    apiFetch<RateContractRow[]>("/api/rate-contracts?includeHistory=1")
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load rate contracts"))
      .finally(() => setListLoading(false));
  }

  React.useEffect(() => {
    Promise.all([apiFetch<CustomerOption[]>("/api/customers"), apiFetch<ItemOption[]>("/api/items?type=FG")])
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

  function readFormPayload(): FormPayload | null {
    const cid = Number(customerId);
    const iid = Number(itemId);
    const rate = Number(rateStr);
    const gstRate = Number(gstRateStr);
    if (!Number.isFinite(cid) || cid <= 0) return toast.showError("Customer is required."), null;
    if (!Number.isFinite(iid) || iid <= 0) return toast.showError("Item is required."), null;
    if (!Number.isFinite(rate) || rate <= 0) return toast.showError("Enter a valid rate."), null;
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) {
      toast.showError("GST rate must be between 0 and 100.");
      return null;
    }
    if (!effectiveFrom.trim()) return toast.showError("Effective from date is required."), null;
    if (isFutureEffectiveYmd(effectiveFrom)) {
      setEffectiveFromError(FUTURE_EFFECTIVE_DATE_MSG);
      toast.showError(FUTURE_EFFECTIVE_DATE_MSG);
      return null;
    }
    setEffectiveFromError(null);
    return { customerId: cid, itemId: iid, rate, gstRate, effectiveFrom };
  }

  const { validHistoryRows, invalidFutureRows } = React.useMemo(() => {
    const validHistoryRows: RateContractRow[] = [];
    const invalidFutureRows: RateContractRow[] = [];
    for (const r of rows) {
      if (isFutureDatedHistoryRow(r)) invalidFutureRows.push(r);
      else validHistoryRows.push(r);
    }
    return { validHistoryRows, invalidFutureRows };
  }, [rows]);

  const futureApprovedInInvalid = React.useMemo(
    () => invalidFutureRows.filter((r) => r.status === "APPROVED"),
    [invalidFutureRows],
  );

  function openPasswordModal(action: PendingAction) {
    setPasswordError(null);
    setAdminPassword("");
    setPendingAction(action);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = readFormPayload();
    if (!payload) return;
    if (editingRowId) openPasswordModal({ type: "revise", id: editingRowId, payload });
    else openPasswordModal({ type: "add", payload });
  }

  function startRevise(row: RateContractRow) {
    setEditingRowId(row.id);
    setCustomerId(row.customerId);
    setItemId(row.itemId);
    setRateStr(String(row.rate));
    setGstRateStr(String(row.gstRate));
    setEffectiveFrom(isoToYmdLocal(row.effectiveFrom));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function verifyAndContinue() {
    if (!pendingAction) return;
    if (!adminPassword.trim()) {
      setPasswordError("Admin password is required.");
      return;
    }
    setSaving(true);
    setPasswordError(null);
    try {
      const verify = await apiFetch<{ success: boolean }>("/api/admin/verify-password", {
        method: "POST",
        body: JSON.stringify({ password: adminPassword }),
      });
      if (!verify?.success) {
        setPasswordError("Incorrect admin password.");
        return;
      }

      if (pendingAction.type === "add") {
        await apiFetch<RateContractRow>("/api/rate-contracts", {
          method: "POST",
          body: JSON.stringify({ ...pendingAction.payload, adminPassword }),
        });
        toast.showSuccess("Rate contract added");
        resetForm();
      } else if (pendingAction.type === "revise") {
        await apiFetch<RateContractRow>(`/api/rate-contracts/${pendingAction.id}/revise`, {
          method: "PUT",
          body: JSON.stringify({ ...pendingAction.payload, adminPassword }),
        });
        toast.showSuccess("Rate contract revised");
        resetForm();
      } else if (pendingAction.type === "deactivateFuture") {
        setFutureCleanupBusy(true);
        const res = await apiFetch<{ message?: string; deactivatedCount?: number }>("/api/rate-contracts/deactivate-future", {
          method: "POST",
          body: JSON.stringify({ adminPassword }),
        });
        toast.showSuccess(res.message ?? "Future-dated rate contracts deactivated");
      } else {
        await apiFetch<RateContractRow>(`/api/rate-contracts/${pendingAction.row.id}`, {
          method: "DELETE",
          body: JSON.stringify({ adminPassword }),
        });
        toast.showSuccess("Rate contract deactivated");
      }

      setPendingAction(null);
      setAdminPassword("");
      loadList();
    } catch (err) {
      toast.showError(err instanceof Error ? err.message : "Could not update rate contract");
    } finally {
      setSaving(false);
      setFutureCleanupBusy(false);
    }
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  const formTitle = editingRowId ? `Revise rate #${editingRowId}` : "Add rate";
  const modalVerb =
    pendingAction?.type === "deactivate"
      ? "Deactivate"
      : pendingAction?.type === "deactivateFuture"
        ? "Deactivate future"
        : pendingAction?.type === "revise"
          ? "Revise"
          : "Add";

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">Rate Contracts</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Customer-wise item rates with preserved history for NO_QTY billing.
        </p>
      </div>

      <div className="rounded-lg border border-amber-100/90 bg-gradient-to-r from-amber-50/95 to-white px-3 py-2.5 text-xs leading-relaxed text-amber-950 shadow-sm">
        <span className="font-semibold">Note:</span> Rate revisions create new approved rows. Old rows remain in history. Effective from
        must be today or earlier. Transaction reset does not delete rate contracts (use Full Demo Reset to wipe them).
      </div>

      <Card className="border-slate-200/90 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Tags className="h-4 w-4 text-violet-600" aria-hidden />
            {formTitle}
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
                <option value="">Select...</option>
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
                <option value="">Select...</option>
                {fgItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.itemName}
                  </option>
                ))}
              </select>
            </label>
            <label className="erp-form-field">
              <span className="erp-form-label">Rate *</span>
              <Input className="h-9 tabular-nums" inputMode="decimal" value={rateStr} onChange={(e) => setRateStr(e.target.value)} placeholder="0.00" />
            </label>
            <label className="erp-form-field">
              <span className="erp-form-label">GST rate *</span>
              <Input className="h-9 tabular-nums" inputMode="decimal" value={gstRateStr} onChange={(e) => setGstRateStr(e.target.value)} placeholder="18" />
            </label>
            <label className="erp-form-field">
              <span className="erp-form-label">Effective from *</span>
              <Input
                type="date"
                className="h-9"
                max={todayYmdLocal()}
                value={effectiveFrom}
                onChange={(e) => {
                  const v = e.target.value;
                  setEffectiveFrom(v);
                  setEffectiveFromError(isFutureEffectiveYmd(v) ? FUTURE_EFFECTIVE_DATE_MSG : null);
                }}
              />
              {effectiveFromError ? <span className="mt-1 text-[11px] text-rose-700">{effectiveFromError}</span> : null}
            </label>
            <div className="flex items-end gap-2 pb-0.5">
              <Button type="submit" className="h-9 w-full sm:w-auto" disabled={saving}>
                {saving ? "Working..." : editingRowId ? "Save revision" : "Add rate"}
              </Button>
              {editingRowId ? (
                <Button type="button" variant="outline" className="h-9" onClick={resetForm} disabled={saving}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-200/90 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <CardTitle className="text-base font-semibold text-slate-900">Contract history</CardTitle>
            {!listLoading && !loadError ? (
              <p className="text-[11px] tabular-nums text-slate-500">
                {validHistoryRows.length} current / past
                {invalidFutureRows.length > 0 ? ` · ${invalidFutureRows.length} future-dated hidden` : ""}
              </p>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-0 p-0 sm:p-0">
          {loadError ? (
            <div className="px-4 py-3 text-sm text-red-800">{loadError}</div>
          ) : listLoading ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">Loading...</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-600">No rate contracts yet. Add one above.</div>
          ) : (
            <>
              {validHistoryRows.length === 0 ? (
                <div className="border-b border-slate-100 px-4 py-6 text-center text-sm text-slate-600">
                  No current or past rate contracts in history.
                  {invalidFutureRows.length > 0 ? " Expand invalid / future-dated history below." : ""}
                </div>
              ) : (
                <RateContractHistoryTable
                  rows={validHistoryRows}
                  saving={saving}
                  onRevise={startRevise}
                  onDeactivate={(row) => openPasswordModal({ type: "deactivate", row })}
                />
              )}

              {invalidFutureRows.length > 0 ? (
                <details className="group border-t border-amber-200/80 bg-amber-50/25">
                  <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-semibold text-amber-950 marker:content-none [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span>Invalid / Future-dated history</span>
                      <Badge variant="warning" className="font-normal">
                        {invalidFutureRows.length}
                      </Badge>
                      <span className="text-[11px] font-normal text-amber-900/80">(collapsed — not used for billing)</span>
                    </span>
                  </summary>
                  <div className="space-y-2 border-t border-amber-200/60 px-4 pb-3 pt-2">
                    <p className="text-[11px] leading-relaxed text-amber-950/90">
                      These rows have an effective date after today. They are kept for audit only and do not apply to quotations or
                      billing.
                    </p>
                    {futureApprovedInInvalid.length > 0 ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-200/90 bg-rose-50/80 px-2.5 py-2 text-xs text-rose-950">
                        <span>
                          <span className="font-semibold">{futureApprovedInInvalid.length}</span> still approved — deactivate to
                          clear from this list.
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 border-rose-300 bg-white text-rose-900 hover:bg-rose-50"
                          disabled={futureCleanupBusy || saving}
                          onClick={() => openPasswordModal({ type: "deactivateFuture" })}
                        >
                          Deactivate all future-dated
                        </Button>
                      </div>
                    ) : null}
                    <RateContractHistoryTable
                      rows={invalidFutureRows}
                      variant="invalid"
                      saving={saving}
                      onRevise={startRevise}
                      onDeactivate={(row) => openPasswordModal({ type: "deactivate", row })}
                    />
                  </div>
                </details>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {pendingAction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Admin Password Required</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  This action affects billing rates. Please enter admin password to continue.
                </p>
              </div>
              <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-slate-100" onClick={() => setPendingAction(null)} aria-label="Close">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="px-4 py-3">
              {pendingAction.type === "deactivate" ? (
                <div className="mb-3 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  Deactivate {pendingAction.row.customer?.name ?? `customer #${pendingAction.row.customerId}`} / {pendingAction.row.item?.itemName ?? `item #${pendingAction.row.itemId}`}.
                </div>
              ) : null}
              <label className="erp-form-field">
                <span className="erp-form-label">Password</span>
                <Input
                  type="password"
                  autoFocus
                  className="h-9"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void verifyAndContinue();
                  }}
                />
              </label>
              {passwordError ? <div className="mt-2 text-xs text-rose-700">{passwordError}</div> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
              <Button type="button" variant="outline" className="h-9" onClick={() => setPendingAction(null)} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" className="h-9" onClick={() => void verifyAndContinue()} disabled={saving}>
                {saving ? "Verifying..." : `Verify & ${modalVerb}`}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
