import * as React from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch } from "../services/api";
import { PageContainer, PageNoQtyFlowBackLink, PageSmartBackLink, StickyWorkspaceHead } from "../components/PageHeader";
import { withReportsReturnContextIfPresent } from "../lib/drillDownRoutes";
import { displayDispatchNo, displaySalesOrderNo } from "../lib/docNoDisplay";
import { useWorkQueueContext } from "../hooks/useWorkQueueContext";
import { SalesBillWorkQueueHeader } from "../components/sales/SalesBillWorkQueueHeader";
import { withWorkQueueState } from "../lib/workQueueContext";

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

function todayYmdLocal(): string {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function SalesBillNewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sp] = useSearchParams();
  const { workQueue, isPendingActionsQueue } = useWorkQueueContext();
  const source = sp.get("source") ?? "";
  const fromNoQtySo = source === "no_qty_so";
  const fromDispatch = sp.get("from") === "dispatch";
  const fromPendingActions = sp.get("from") === "pending-actions" || isPendingActionsQueue;
  const workQueueDriven = Boolean(workQueue?.returnToPendingActions);
  const skipDispatchPicker = workQueueDriven;
  const dispatchIdFromUrl = (sp.get("dispatchId") ?? "").trim();
  const focusSoId = Number(sp.get("salesOrderId") ?? 0);
  const focusSoIdValid = Number.isFinite(focusSoId) && focusSoId > 0;
  const [focusSo, setFocusSo] = React.useState<{ id: number; customerName: string } | null>(null);

  const [rows, setRows] = React.useState<EligibleDispatch[]>([]);
  const [dispatchId, setDispatchId] = React.useState<string>(() =>
    /^\d+$/.test(dispatchIdFromUrl) && Number(dispatchIdFromUrl) > 0 ? dispatchIdFromUrl : "",
  );
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [newBillDate, setNewBillDate] = React.useState(todayYmdLocal);
  const queueAutoStartedRef = React.useRef(false);
  const queueAutoContinueRef = React.useRef(false);

  const openBillFromDispatch = React.useCallback(
    async (id: number) => {
      if (!Number.isFinite(id) || id <= 0) return;
      setBusy(true);
      setLoadError(null);
      try {
        const bill = await apiFetch<{ id: number }>(`/api/sales-bills/from-dispatch/${id}`, {
          method: "POST",
          body: JSON.stringify(fromNoQtySo && focusSoIdValid ? { billDate: newBillDate } : {}),
        });
        const navState = workQueue ? withWorkQueueState(workQueue) : undefined;
        if (fromNoQtySo && focusSoIdValid) {
          const qs = new URLSearchParams();
          qs.set("source", "no_qty_so");
          qs.set("salesOrderId", String(focusSoId));
          qs.set("dispatchId", String(id));
          if (fromPendingActions) qs.set("from", "pending-actions");
          navigate(
            withReportsReturnContextIfPresent(`/sales-bills/${bill.id}?${qs.toString()}`, location.search),
            { replace: true, state: navState },
          );
        } else {
          const qs = fromPendingActions ? "?from=pending-actions" : "";
          navigate(
            withReportsReturnContextIfPresent(`/sales-bills/${bill.id}${qs}`, location.search),
            { replace: true, state: navState },
          );
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Could not start the bill.");
      } finally {
        setBusy(false);
      }
    },
    [focusSoId, focusSoIdValid, fromNoQtySo, fromPendingActions, location.search, navigate, newBillDate, workQueue],
  );

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
          if (scoped.length > 0) setDispatchId(String(scoped[0].dispatchId));
          else setDispatchId("");
          return;
        }
        setRows(list);
        const urlId = (sp.get("dispatchId") ?? "").trim();
        if ((fromDispatch || fromPendingActions || workQueueDriven) && /^\d+$/.test(urlId) && Number(urlId) > 0) {
          const exists = list.some((r) => Number(r.dispatchId) === Number(urlId));
          if (exists) setDispatchId(urlId);
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load eligible dispatches."))
      .finally(() => setLoaded(true));
  }, [fromNoQtySo, fromDispatch, fromPendingActions, workQueueDriven, focusSoId, focusSoIdValid, dispatchIdFromUrl, sp]);

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

  React.useEffect(() => {
    if (!workQueue || queueAutoStartedRef.current) return;
    const item = workQueue.queueItems[workQueue.currentIndex];
    if (!item) return;
    queueAutoStartedRef.current = true;
    if (item.billId) {
      navigate(
        withReportsReturnContextIfPresent(`/sales-bills/${item.billId}?from=pending-actions`, location.search),
        { state: withWorkQueueState(workQueue), replace: true },
      );
      return;
    }
    if (item.dispatchId) {
      setDispatchId(String(item.dispatchId));
    }
  }, [workQueue, location.search, navigate]);

  React.useEffect(() => {
    if (!workQueue || !loaded || busy || loadError) return;
    const item = workQueue.queueItems[workQueue.currentIndex];
    if (!item?.dispatchId || item.billId) return;
    if (Number(dispatchId) !== item.dispatchId) return;
    if (queueAutoContinueRef.current) return;
    queueAutoContinueRef.current = true;
    void openBillFromDispatch(item.dispatchId);
  }, [workQueue, loaded, busy, loadError, dispatchId, openBillFromDispatch]);

  async function onContinue() {
    const id = Number(dispatchId);
    await openBillFromDispatch(id);
  }

  const selected = rows.find((r) => String(r.dispatchId) === dispatchId);
  const none = loaded && !loadError && rows.length === 0;
  const continuingDraft = Boolean(selected?.hasDraftBill && selected?.draftBillId);
  const queueOpening = skipDispatchPicker && (busy || !loaded || (workQueue && !queueAutoContinueRef.current && !queueAutoStartedRef.current));

  return (
    <PageContainer>
      <StickyWorkspaceHead
        lead={
          fromNoQtySo ? (
            <PageNoQtyFlowBackLink step="SALES_BILL" />
          ) : (
            <PageSmartBackLink
              defaultTo={fromPendingActions ? "/pending-actions" : "/sales-bills"}
              defaultLabel={fromPendingActions ? "Back to Pending Actions" : "Back to sales bills"}
            />
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

      {workQueue ? <SalesBillWorkQueueHeader workQueue={workQueue} className="mb-3" /> : null}

      {queueOpening ? (
        <Card className="w-full max-w-xl min-w-0 overflow-hidden">
          <CardContent className="px-4 py-8 text-sm text-slate-600" aria-busy="true">
            Opening bill from Pending Actions queue…
          </CardContent>
        </Card>
      ) : (
        <Card className="w-full max-w-xl min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">{skipDispatchPicker ? "Opening bill" : "Choose dispatch"}</CardTitle>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-4">
            {loadError ? (
              <div className="min-w-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-800 break-words">
                {loadError}
              </div>
            ) : null}

            {none ? <p className="text-sm leading-relaxed text-slate-700">All dispatches already billed.</p> : null}

            {!none && !loadError && !skipDispatchPicker ? (
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

                {fromNoQtySo ? (
                  <div className="grid gap-1.5">
                    <label className="text-xs font-medium text-slate-600" htmlFor="sb-new-bill-date">
                      Bill date *
                    </label>
                    <Input
                      id="sb-new-bill-date"
                      type="date"
                      className="h-10"
                      value={newBillDate}
                      onChange={(e) => setNewBillDate(e.target.value)}
                    />
                    <p className="text-xs leading-relaxed text-slate-500">
                      Applicable rates are picked from approved rate contracts using this bill date (not dispatch date).
                    </p>
                  </div>
                ) : null}

                <Button type="button" className="w-full sm:w-auto" disabled={!dispatchId || busy} onClick={() => void onContinue()}>
                  {busy ? "Working…" : continuingDraft ? "Continue Draft Bill" : "Create Sales Bill"}
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
