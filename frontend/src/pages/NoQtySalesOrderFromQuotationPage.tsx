/**
 * NO_QTY FLOW ONLY
 *
 * Creates a NO_QTY sales order from quotation — entry into requirement-sheet / cycle planning, not REGULAR SO RM check.
 *
 * DO NOT route operators here for fixed-qty (NORMAL) customer orders.
 */
import * as React from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { ApiRequestError, apiFetch } from "../services/api";
import { useToast } from "../contexts/ToastContext";
import { buildNoQtySoCreatedBannerState } from "../lib/noQtySoCreatedNavState";
import { noQtyRsCreationWorkspaceHref } from "../lib/noQtyRsActionLabels";
import { CommercialWorkflowStrip, commercialWorkflowStripFramedClassName } from "../components/erp/CommercialWorkflowStrip";
import { cn } from "../lib/utils";

type QuotationLineRow = {
  id: number;
  itemId: number;
  item: { id: number; itemName: string };
  rate: string;
  gstPct: string;
  rateEffectiveFromSnapshot?: string | null;
  rateContractLineIdSnapshot?: number | null;
};

type QuotationRow = {
  id: number;
  quotationNo: string | null;
  workflowStatus: string;
  flowTypeSnapshot?: "REGULAR" | "NO_QTY";
  enquiry: { id: number; customer: { id: number; name: string } };
  lines: QuotationLineRow[];
  createdAt: string;
};

type SalesOrderRow = {
  id: number;
  docNo?: string | null;
  orderType?: string;
  currentCycle?: { id: number; cycleNo: number; status?: string } | null;
  currentCycleId?: number | null;
};

export function NoQtySalesOrderFromQuotationPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const quotationId = Number(searchParams.get("quotationId")) || 0;

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState<QuotationRow | null>(null);

  const [customerPoReference, setCustomerPoReference] = React.useState("");
  const customerRefInputRef = React.useRef<HTMLInputElement | null>(null);
  const [customerRefError, setCustomerRefError] = React.useState<string | null>(null);
  const [remarks, setRemarks] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    if (!quotationId) return;
    setLoading(true);
    setError(null);
    apiFetch<QuotationRow>(`/api/quotations/${quotationId}`)
      .then((row) => setQ(row))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load quotation"))
      .finally(() => setLoading(false));
  }, [quotationId]);

  const backToQuotationsHref = quotationId ? `/quotations#quotation-row-${quotationId}` : "/quotations";

  async function onCreate() {
    if (!q) return;
    setError(null);
    setCustomerRefError(null);
    const po = customerPoReference.trim();
    if (!po) {
      const msg = "Agreement / Customer Reference is required.";
      setCustomerRefError(msg);
      toast.showError(msg);
      window.setTimeout(() => customerRefInputRef.current?.focus(), 0);
      return;
    }
    setCreating(true);
    try {
      const so = await apiFetch<SalesOrderRow>(`/api/sales-orders/no-qty/from-quotation/${q.id}`, {
        method: "POST",
        body: JSON.stringify({ customerPoReference: po, remarks: remarks.trim() || null }),
      });
      toast.showSuccess("Sales Order created — continuing to requirement planning");
      const cycleId = so.currentCycle?.id ?? (so as { currentCycleId?: number | null }).currentCycleId ?? null;
      const to = noQtyRsCreationWorkspaceHref({
        salesOrderId: so.id,
        cycleId,
        from: "so_created",
      });
      navigate(to, {
        state: buildNoQtySoCreatedBannerState({
          salesOrderId: so.id,
          docNo: so.docNo,
          customerName: q.enquiry.customer.name,
          cycleNo: so.currentCycle?.cycleNo ?? 1,
        }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create sales order";
      setError(msg);
      toast.showError(msg);
      if (e instanceof ApiRequestError) {
        // eslint-disable-next-line no-console
        console.error("[no_qty_so_from_quotation] create failed", { status: e.status, code: e.code, body: e.body });
      }
    } finally {
      setCreating(false);
    }
  }

  if (!quotationId) {
    return <Navigate to="/quotations" replace />;
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 pb-6">
        <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-4">
            <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 h-7 w-64 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 h-8 w-full max-w-md animate-pulse rounded bg-slate-100" />
          </div>
          <div className="px-4 py-6 text-sm text-slate-500">Loading quotation…</div>
        </div>
      </div>
    );
  }

  if (!q) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-2">
        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
        <Link
          to={backToQuotationsHref}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          Back to Quotations
        </Link>
      </div>
    );
  }

  if ((q.flowTypeSnapshot ?? "REGULAR") !== "NO_QTY") {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-2">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This quotation is REGULAR. Use regular Sales Order creation.
        </div>
        <Link
          to={backToQuotationsHref}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          Back to Quotations
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-3 pb-8">
      <div className="rounded-xl border border-slate-200/90 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-5">
          <Link
            to={backToQuotationsHref}
            className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
            Back to Quotations
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Continue to Sales Order</h1>
            <Badge variant="warning" className="text-[11px] font-semibold uppercase tracking-wide">
              NO_QTY
            </Badge>
          </div>
          <CommercialWorkflowStrip active="sales_order" className={commercialWorkflowStripFramedClassName} />
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-800 shadow-sm">
            <span>
              <span className="text-slate-500">Customer </span>
              <span className="font-semibold text-slate-900">{q.enquiry.customer.name}</span>
            </span>
            <span className="text-slate-300" aria-hidden>
              |
            </span>
            <span>
              <span className="text-slate-500">Quotation </span>
              <span className="font-mono font-semibold">{q.quotationNo || `#${q.id}`}</span>
            </span>
            <span className="text-slate-300" aria-hidden>
              |
            </span>
            <span>
              <span className="text-slate-500">Date </span>
              <span className="tabular-nums">{new Date(q.createdAt).toLocaleDateString()}</span>
            </span>
          </div>
          <p className="text-[12px] leading-snug text-slate-600">
            Same NO_QTY agreement — confirm reference below, then continue to Requirement Sheets for quantities and cycles.
          </p>
        </div>

        <div className="relative space-y-3 px-3 pb-4 pt-3 sm:px-4">
          {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

          <section className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Agreement details</h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-[11px] font-medium text-slate-600">Agreement / Customer Reference *</span>
                <Input
                  ref={customerRefInputRef}
                  className="h-9 text-[13px]"
                  value={customerPoReference}
                  onChange={(e) => {
                    setCustomerPoReference(e.target.value);
                    if (customerRefError) setCustomerRefError(null);
                  }}
                  onBlur={() => {
                    if (customerPoReference.trim()) setCustomerRefError(null);
                  }}
                />
                {customerRefError ? <div className="text-[11px] text-red-700">{customerRefError}</div> : null}
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-medium text-slate-600">Remarks (optional)</span>
                <Input className="h-9 text-[13px]" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </label>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-3 py-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Items (from quotation)</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Rate snapshots carried forward — read-only</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    <th className="whitespace-nowrap px-3 py-1.5">Item</th>
                    <th className="whitespace-nowrap px-3 py-1.5 text-right">Rate</th>
                    <th className="whitespace-nowrap px-3 py-1.5 text-right">GST %</th>
                    <th className="whitespace-nowrap px-3 py-1.5">Effective</th>
                    <th className="whitespace-nowrap px-3 py-1.5">Contract</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {q.lines.map((ln) => (
                    <tr key={ln.id}>
                      <td className="px-3 py-1.5 font-medium text-slate-900">{ln.item.itemName}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">{Number(ln.rate).toFixed(4)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">{Number(ln.gstPct).toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-slate-700">
                        {ln.rateEffectiveFromSnapshot ? new Date(ln.rateEffectiveFromSnapshot).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">
                        {ln.rateContractLineIdSnapshot != null ? `RC#${ln.rateContractLineIdSnapshot}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="sticky bottom-0 z-10 flex justify-end border-t border-slate-200 bg-white/95 px-0 py-2.5 backdrop-blur-sm">
            <Button type="button" className={cn("min-w-[12rem] font-semibold shadow-md")} onClick={() => void onCreate()} disabled={creating}>
              {creating ? "Creating…" : "Create Sales Order & continue"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
