import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { PageHeader } from "../components/PageHeader";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { useToast } from "../contexts/ToastContext";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { Link, Navigate } from "react-router-dom";
import type { StockAdjustmentPolicyDto } from "../lib/stockAdjustmentPolicyText";
import { REGULAR_TERMS } from "../lib/flowTerminology";

type StateRow = { id: number; stateName: string; stateCode: string };

export function AdminSettingsPage() {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const [strict, setStrict] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [savingStockAdj, setSavingStockAdj] = React.useState(false);
  const [states, setStates] = React.useState<StateRow[]>([]);
  const [companyStateId, setCompanyStateId] = React.useState<number | "">("");
  const [legacyCompanyState, setLegacyCompanyState] = React.useState<string | null>(null);
  const [companyGstin, setCompanyGstin] = React.useState("");
  const [savingCompanyState, setSavingCompanyState] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [sa, setSa] = React.useState<StockAdjustmentPolicyDto>({
    stockAdjustmentReverseRoles: "ADMIN_ONLY",
    stockAdjustmentReverseWindowType: "HOURS",
    stockAdjustmentReverseWindowValue: 24,
    stockAdjustmentCreateRoles: "ADMIN_AND_STORE",
  });

  React.useEffect(() => {
    setError(null);
    Promise.all([
      apiFetch<{ strictInventoryControl: boolean }>("/api/settings/inventory-mode"),
      apiFetch<StockAdjustmentPolicyDto>("/api/settings/stock-adjustment-control"),
      apiFetch<{
        companyState: string | null;
        companyStateId: number | null;
        companyStateName: string | null;
        companyStateCode: string | null;
        companyGstin: string | null;
      }>("/api/settings/company-state"),
      apiFetch<StateRow[]>("/api/states"),
    ])
      .then(([inv, ctrl, co, st]) => {
        setStrict(Boolean(inv.strictInventoryControl));
        setSa(ctrl);
        setStates(st);
        setCompanyStateId(co.companyStateId ?? "");
        setLegacyCompanyState(co.companyState?.trim() ? co.companyState : null);
        setCompanyGstin(co.companyGstin?.trim() ? co.companyGstin : "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  async function onSaveStrict(next: boolean) {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/settings/inventory-mode", {
        method: "PUT",
        body: JSON.stringify({ strictInventoryControl: next }),
      });
      setStrict(next);
      toast.showSuccess("Settings saved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function onSaveCompanyGstDetails() {
    setSavingCompanyState(true);
    setError(null);
    try {
      const saved = await apiFetch<{
        companyState: string | null;
        companyStateId: number | null;
        companyStateName: string | null;
        companyStateCode: string | null;
        companyGstin: string | null;
      }>("/api/settings/company-state", {
        method: "PUT",
        body: JSON.stringify({
          companyStateId: companyStateId === "" ? null : Number(companyStateId),
          companyGstin: companyGstin.trim() === "" ? null : companyGstin,
        }),
      });
      setCompanyStateId(saved.companyStateId ?? "");
      setLegacyCompanyState(saved.companyState?.trim() ? saved.companyState : null);
      setCompanyGstin(saved.companyGstin?.trim() ? saved.companyGstin : "");
      toast.showSuccess("Company GST details saved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      toast.showError(msg);
    } finally {
      setSavingCompanyState(false);
    }
  }

  async function onSaveStockAdjustment() {
    setSavingStockAdj(true);
    setError(null);
    try {
      const saved = await apiFetch<StockAdjustmentPolicyDto>("/api/settings/stock-adjustment-control", {
        method: "PUT",
        body: JSON.stringify(sa),
      });
      setSa(saved);
      toast.showSuccess("Stock adjustment settings saved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      toast.showError(msg);
    } finally {
      setSavingStockAdj(false);
    }
  }

  const showWindowValue = sa.stockAdjustmentReverseWindowType === "HOURS" || sa.stockAdjustmentReverseWindowType === "DAYS";

  return (
    <div className="grid gap-4">
      <PageHeader title="Admin settings" />
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Company GST Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-700">
          <div className="rounded-md border border-sky-200 bg-sky-50/70 px-3 py-2 text-[12px] text-sky-900">
            For full company branding (name, address, logo, signatory, document presentation), use{" "}
            <Link to="/admin/company-profile" className="font-semibold underline">
              Company Profile
            </Link>
            . The fields below are kept here for quick GST setup; they share the same source.
          </div>
          <p className="text-slate-600">Used to decide same-state (CGST+SGST) vs different-state (IGST) for purchase GST split.</p>
          <div className="grid max-w-md gap-3">
            <label className="grid gap-1">
              <span className="font-medium text-slate-800">Company state</span>
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                disabled={loading}
                value={companyStateId}
                onChange={(e) => setCompanyStateId(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">Select state</option>
                {states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.stateName} ({s.stateCode})
                  </option>
                ))}
              </select>
              {companyStateId === "" && legacyCompanyState ? (
                <div className="text-[12px] text-slate-600">
                  Previous value: <span className="font-medium">{legacyCompanyState}</span>
                </div>
              ) : null}
            </label>

            <label className="grid gap-1">
              <span className="font-medium text-slate-800">Company GSTIN</span>
              <input
                type="text"
                className="h-9 rounded-md border border-slate-200 px-2 text-sm font-mono"
                disabled={loading}
                value={companyGstin}
                onChange={(e) => setCompanyGstin(e.target.value.toUpperCase())}
                placeholder="Optional"
                maxLength={15}
                inputMode="text"
              />
            </label>
          </div>

          <Button type="button" disabled={loading || savingCompanyState} onClick={() => void onSaveCompanyGstDetails()}>
            {savingCompanyState ? "Saving…" : "Save company GST details"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Strict Inventory Control</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-700">
          {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">{error}</div> : null}
          <p>
            When <strong>ON</strong>, stock shortages block the next process (for example{" "}
            {REGULAR_TERMS.WORK_ORDER_PREPARATION}) until inventory is resolved. When <strong>OFF</strong>, shortages still show as warnings
            but you can continue—useful for testing or flexible operations.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-slate-900">Current mode:</span>
            {loading ? (
              <span className="text-slate-500">Loading…</span>
            ) : (
              <span className={strict ? "text-red-700" : "text-amber-800"}>{strict ? "ON (strict)" : "OFF (flexible)"}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={strict ? "outline" : "default"} disabled={loading || saving || !strict} onClick={() => onSaveStrict(false)}>
              Set OFF
            </Button>
            <Button type="button" variant={strict ? "default" : "outline"} disabled={loading || saving || strict} onClick={() => onSaveStrict(true)}>
              Set ON
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Stock Adjustment Control</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-700">
          <p className="text-slate-600">
            These rules control who can reverse stock adjustments and how long reversal is allowed.
          </p>
          <div className="grid max-w-xl gap-4">
            <label className="grid gap-1">
              <span className="font-medium text-slate-800">Who can create stock adjustments?</span>
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                disabled={loading}
                value={sa.stockAdjustmentCreateRoles}
                onChange={(e) =>
                  setSa((p) => ({
                    ...p,
                    stockAdjustmentCreateRoles: e.target.value as StockAdjustmentPolicyDto["stockAdjustmentCreateRoles"],
                  }))
                }
              >
                <option value="ADMIN_AND_STORE">Administrators and Store</option>
                <option value="ADMIN_ONLY">Administrators only</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="font-medium text-slate-800">Who can reverse stock adjustments?</span>
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                disabled={loading}
                value={sa.stockAdjustmentReverseRoles}
                onChange={(e) =>
                  setSa((p) => ({
                    ...p,
                    stockAdjustmentReverseRoles: e.target.value as StockAdjustmentPolicyDto["stockAdjustmentReverseRoles"],
                  }))
                }
              >
                <option value="ADMIN_ONLY">Administrators only</option>
                <option value="ADMIN_AND_STORE">Administrators and Store</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="font-medium text-slate-800">Reversal time limit type</span>
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                disabled={loading}
                value={sa.stockAdjustmentReverseWindowType}
                onChange={(e) =>
                  setSa((p) => ({
                    ...p,
                    stockAdjustmentReverseWindowType: e.target.value as StockAdjustmentPolicyDto["stockAdjustmentReverseWindowType"],
                  }))
                }
              >
                <option value="SAME_DAY">Same day only</option>
                <option value="HOURS">Hours</option>
                <option value="DAYS">Days</option>
                <option value="NO_LIMIT">No limit</option>
              </select>
            </label>
            {showWindowValue ? (
              <label className="grid gap-1">
                <span className="font-medium text-slate-800">
                  {sa.stockAdjustmentReverseWindowType === "HOURS" ? "Number of hours" : "Number of days"}
                </span>
                <input
                  type="number"
                  min={1}
                  max={36500}
                  className="h-9 max-w-[12rem] rounded-md border border-slate-200 px-2 text-sm"
                  disabled={loading}
                  value={sa.stockAdjustmentReverseWindowValue}
                  onChange={(e) =>
                    setSa((p) => ({
                      ...p,
                      stockAdjustmentReverseWindowValue: Math.max(1, Math.min(36500, Number(e.target.value) || 1)),
                    }))
                  }
                />
              </label>
            ) : null}
          </div>
          <Button type="button" disabled={loading || savingStockAdj} onClick={() => void onSaveStockAdjustment()}>
            {savingStockAdj ? "Saving…" : "Save stock adjustment rules"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
