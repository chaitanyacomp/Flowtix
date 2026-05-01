import * as React from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { apiFetch } from "../services/api";
import { PageContainer, PageNoQtyFlowBackLink, PageSmartBackLink, StickyWorkspaceHead } from "../components/PageHeader";
import { withReportsReturnContextIfPresent } from "../lib/drillDownRoutes";
import { displayDispatchNo, displaySalesOrderNo } from "../lib/docNoDisplay";

type EligibleDispatch = {
  dispatchId: number;
  dispatchNo: string;
  dispatchDate: string;
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string | null;
  itemName: string | null;
  dispatchedQty: string;
  workflowStatus: string;
  draftBillId?: number | null;
  hasDraftBill?: boolean;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function dispatchDateMs(iso: string): number {
  const d = new Date(iso);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

export function SalesBillNewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sp] = useSearchParams();
  const source = sp.get("source") ?? "";
  const fromNoQtySo = source === "no_qty_so";
  const focusSoId = Number(sp.get("salesOrderId") ?? 0);
  const focusSoIdValid = Number.isFinite(focusSoId) && focusSoId > 0;
  const [focusSo, setFocusSo] = React.useState<{ id: number; customerName: string } | null>(null);

  const [rows, setRows] = React.useState<EligibleDispatch[]>([]);
  const [dispatchId, setDispatchId] = React.useState<string>("");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    setLoadError(null);
    setLoaded(false);
    apiFetch<EligibleDispatch[]>("/api/sales-bills/eligible-dispatches")
      .then((all) => {
        const list = Array.isArray(all) ? all : [];
        if (fromNoQtySo && focusSoIdValid) {
          const scoped = list
            .filter((r) => Number(r.salesOrderId) === focusSoId)
            .sort((a, b) => dispatchDateMs(b.dispatchDate) - dispatchDateMs(a.dispatchDate) || Number(b.dispatchId) - Number(a.dispatchId));
          setRows(scoped);
          // Auto-select the latest eligible dispatch for this SO (if any).
          if (scoped.length > 0) setDispatchId(String(scoped[0].dispatchId));
          else setDispatchId("");
          return;
        }
        setRows(list);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load eligible dispatches."))
      .finally(() => setLoaded(true));
  }, [fromNoQtySo, focusSoId, focusSoIdValid]);

  React.useEffect(() => {
    if (!fromNoQtySo || !focusSoIdValid) {
      setFocusSo(null);
      return;
    }
    apiFetch<any>(`/api/sales-orders/${focusSoId}`)
      .then((so) => {
        const customerName = so?.customer?.name ?? so?.po?.customer?.name ?? "—";
        setFocusSo({ id: focusSoId, customerName });
      })
      .catch(() => setFocusSo({ id: focusSoId, customerName: "—" }));
  }, [fromNoQtySo, focusSoId, focusSoIdValid]);

  async function onContinue() {
    const id = Number(dispatchId);
    if (!Number.isFinite(id) || id <= 0) return;
    setBusy(true);
    setLoadError(null);
    try {
      const bill = await apiFetch<{ id: number }>(`/api/sales-bills/from-dispatch/${id}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (fromNoQtySo && focusSoIdValid) {
        const qs = new URLSearchParams();
        qs.set("source", "no_qty_so");
        qs.set("salesOrderId", String(focusSoId));
        qs.set("dispatchId", String(id));
        navigate(
          withReportsReturnContextIfPresent(`/sales-bills/${bill.id}?${qs.toString()}`, location.search),
          { replace: true },
        );
      } else {
        navigate(withReportsReturnContextIfPresent(`/sales-bills/${bill.id}`, location.search), { replace: true });
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not start the bill.");
    } finally {
      setBusy(false);
    }
  }

  const selected = rows.find((r) => String(r.dispatchId) === dispatchId);
  const none = loaded && !loadError && rows.length === 0;
  const continuingDraft = Boolean(selected?.hasDraftBill && selected?.draftBillId);

  return (
    <PageContainer>
      <StickyWorkspaceHead
        lead={
          fromNoQtySo ? (
            <PageNoQtyFlowBackLink step="SALES_BILL" />
          ) : (
            <PageSmartBackLink defaultTo="/sales-bills" defaultLabel="Back to sales bills" />
          )
        }
      >
        <div className="min-w-0 space-y-1">
          <h1 className="text-lg font-semibold leading-snug text-slate-900">Sales bill</h1>
          <p className="text-sm leading-relaxed text-slate-600">Create customer invoice from confirmed dispatch (phase 1: 1 dispatch → 1 bill)</p>
          {fromNoQtySo && focusSoIdValid ? (
            <p className="text-sm leading-relaxed text-slate-700">
              <span className="font-medium">SO #{focusSoId}</span>
              <span className="text-slate-500"> · {focusSo?.customerName ?? "—"}</span>
            </p>
          ) : null}
          {fromNoQtySo && focusSoIdValid ? (
            <p className="text-xs leading-relaxed text-slate-600">Sales Bill is created only from actual dispatch quantity.</p>
          ) : null}
        </div>
      </StickyWorkspaceHead>

      <Card className="w-full max-w-xl min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Choose dispatch</CardTitle>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4">
          {loadError ? (
            <div className="min-w-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-800 break-words">
              {loadError}
            </div>
          ) : null}

          {none ? <p className="text-sm leading-relaxed text-slate-700">All dispatches already billed.</p> : null}

          {!none && !loadError ? (
            <>
              <p className="text-sm leading-relaxed text-slate-600">
                Choose a confirmed dispatch. If you already started a draft for the same dispatch, it will be reopened.
              </p>

              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-slate-600" htmlFor="dispatch-ref">
                  Dispatch ref
                </label>
                <select
                  id="dispatch-ref"
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={dispatchId}
                  onChange={(e) => {
                    setDispatchId(e.target.value);
                    setLoadError(null);
                  }}
                >
                  <option value="">Select dispatch…</option>
                  {rows.map((r) => (
                    <option key={r.dispatchId} value={String(r.dispatchId)}>
                      Dispatch No: {displayDispatchNo(r.dispatchId, r.dispatchNo)} · SO No:{" "}
                      {displaySalesOrderNo(r.salesOrderId, r.salesOrderDocNo)} · {r.customerName ?? "—"} · {r.itemName ?? "—"} · Qty{" "}
                      {r.dispatchedQty} · {formatDate(r.dispatchDate)}
                    </option>
                  ))}
                </select>
              </div>

              {selected ? (
                <div className="min-w-0 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <div className="break-words">
                    <span className="font-medium text-slate-800">Customer:</span> {selected.customerName ?? "—"}
                  </div>
                  <div className="break-words">
                    <span className="font-medium text-slate-800">Item:</span> {selected.itemName ?? "—"} · <span className="font-medium text-slate-800">Qty:</span>{" "}
                    {selected.dispatchedQty}
                  </div>
                  <div>
                    <span className="font-medium text-slate-800">Dispatch date:</span> {formatDate(selected.dispatchDate)}
                  </div>
                  {selected.hasDraftBill ? (
                    <div className="mt-1 text-amber-700">
                      Draft bill found for this dispatch.
                      {selected.draftBillId ? ` Continue Draft Bill (#${selected.draftBillId}).` : " Continue Draft Bill."}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <Button type="button" className="w-full sm:w-auto" disabled={!dispatchId || busy} onClick={() => void onContinue()}>
                {busy ? "Working…" : continuingDraft ? "Continue Draft Bill" : "Create Sales Bill"}
              </Button>
            </>
          ) : null}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

