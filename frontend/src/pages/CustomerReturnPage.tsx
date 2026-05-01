import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../services/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { salesOrdersFocusHref } from "../lib/drillDownRoutes";
import { X } from "lucide-react";
import { cn } from "../lib/utils";
import { DemoFlowBanner } from "../components/demo/DemoFlowBanner";

type Customer = { id: number; name: string };

type DispatchRow = {
  dispatchId: number;
  dispatchNo: string;
  date: string;
  customer: { id: number; name: string } | null;
  salesOrderId: number;
  salesOrderNo: string;
  itemId: number;
  itemName: string;
  unit: string;
  dispatchedQty: number;
  alreadyReturnedQty: number;
  returnableBalanceQty: number;
};

type ReturnHistoryRow = {
  id: number;
  returnNo: string;
  date: string;
  customer: { id: number; name: string };
  item: { id: number; name: string; unit: string };
  qty: number;
  disposition: "QC_HOLD" | "REWORK" | "TO_STOCK";
  status?: "IN_REWORK" | "IN_QC_HOLD" | "APPROVED_TO_STOCK" | "SCRAPPED" | "REVERSED";
  dispatchId: number;
  dispatchNo: string;
  reversedAt?: string | null;
  /** Sum of QC-accepted qty (production QC + stock-adjustment QC) on the replacement SO for this return’s item. */
  qcAcceptedQty?: number;
  scrapQty?: number;
  /** Return qty − QC passed − scrap (per return row). */
  pendingInProcessQty?: number;
  /** QC passed minus net dispatched on the replacement SO for this item. */
  dispatchableQty?: number;
  replacementNetDispatchedQty?: number;
  alreadyUsedInReplacementQty?: number;
  availableForReplacementQty?: number;
};

type DispositionUi = "TO_STOCK" | "QC_HOLD" | "REWORK";

function dispositionLabel(v: DispositionUi): string {
  if (v === "TO_STOCK") return "Return to Stock";
  if (v === "QC_HOLD") return "Hold for Checking";
  if (v === "REWORK") return "Send for Rework";
  return "—";
}

function formatQty(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 1000) / 1000;
  return String(r);
}

function returnBalanceBlock(r: ReturnHistoryRow, unit: string): React.ReactNode {
  if (r.reversedAt) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  const returnQty = formatQty(Number(r.qty ?? 0));
  const qcPassed = formatQty(Number(r.qcAcceptedQty ?? 0));
  const pending = formatQty(Number(r.pendingInProcessQty ?? 0));
  const scrap = formatQty(Number(r.scrapQty ?? 0));
  const dispatchable = formatQty(Number(r.dispatchableQty ?? 0));
  return (
    <div className="max-w-[14rem] space-y-0.5 text-[11px] leading-snug text-slate-700">
      <div>
        Return qty: <span className="font-semibold tabular-nums text-slate-900">{returnQty}</span> {unit}
      </div>
      <div>
        QC passed (usable): <span className="font-semibold tabular-nums text-slate-900">{qcPassed}</span> {unit}
      </div>
      <div>
        Pending / in rework: <span className="font-semibold tabular-nums text-slate-900">{pending}</span> {unit}
      </div>
      <div>
        Scrap: <span className="font-semibold tabular-nums text-slate-900">{scrap}</span> {unit}
      </div>
      <div>
        Dispatchable qty: <span className="font-semibold tabular-nums text-emerald-900">{dispatchable}</span> {unit}
      </div>
    </div>
  );
}

function returnStatusUi(
  r: Pick<ReturnHistoryRow, "reversedAt" | "status">,
): { label: string; variant: "default" | "warning" | "success" | "info" | "rejected" } {
  if (r.reversedAt) return { label: "Reversed", variant: "warning" };
  if (r.status === "IN_REWORK") return { label: "Waiting for Rework Approval", variant: "info" };
  if (r.status === "IN_QC_HOLD") return { label: "Waiting QC", variant: "warning" };
  if (r.status === "APPROVED_TO_STOCK") return { label: "Approved for Dispatch", variant: "success" };
  if (r.status === "SCRAPPED") return { label: "Scrapped", variant: "rejected" };
  return { label: "—", variant: "default" };
}

function queueHint(r: Pick<ReturnHistoryRow, "reversedAt" | "status">): { text: string; href: string } | null {
  if (r.reversedAt) return null;
  if (r.status === "IN_REWORK") return { text: "Go to Rework queue", href: "/customer-returns/rework" };
  if (r.status === "IN_QC_HOLD") return { text: "Go to QC Hold queue", href: "/customer-returns/qc-hold" };
  return null;
}

function approvedDispatchHint(r: Pick<ReturnHistoryRow, "reversedAt" | "status">): string | null {
  if (r.reversedAt) return null;
  if (r.status === "APPROVED_TO_STOCK") {
    return "Dispatch uses the replacement SO’s QC-cleared pool. Balance shows pass vs still in process.";
  }
  return null;
}

/** QC-cleared qty not yet reserved on a replacement SO (same rule as API `availableForReplacementQty`). */
function remainingReplacementQty(r: ReturnHistoryRow): number {
  const qc = Number(r.qcAcceptedQty ?? 0);
  const used = Number(r.alreadyUsedInReplacementQty ?? 0);
  if (!Number.isFinite(qc) || !Number.isFinite(used)) return 0;
  return Math.max(0, Math.round((qc - used) * 1000) / 1000);
}

export function CustomerReturnPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightReturnId = Number(searchParams.get("returnId") ?? 0);
  const highlightReturnValid = Number.isFinite(highlightReturnId) && highlightReturnId > 0;
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = React.useState("");
  const [customerId, setCustomerId] = React.useState(0);
  const [customerPickerOpen, setCustomerPickerOpen] = React.useState(false);
  const [customerPickerActiveIdx, setCustomerPickerActiveIdx] = React.useState(0);

  const [dispatchRows, setDispatchRows] = React.useState<DispatchRow[]>([]);
  const [dispatchLoading, setDispatchLoading] = React.useState(false);
  const [dispatchError, setDispatchError] = React.useState<string | null>(null);

  const [selectedDispatchId, setSelectedDispatchId] = React.useState<number | null>(null);
  const selectedDispatch = dispatchRows.find((d) => d.dispatchId === selectedDispatchId) ?? null;

  const [returnedQty, setReturnedQty] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [disposition, setDisposition] = React.useState<DispositionUi>("QC_HOLD");
  const [remarks, setRemarks] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [history, setHistory] = React.useState<ReturnHistoryRow[]>([]);
  const [historyError, setHistoryError] = React.useState<string | null>(null);
  const [creatingReplacementId, setCreatingReplacementId] = React.useState<number | null>(null);

  const customerOptions = React.useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, customerSearch]);

  const activeCustomer = React.useMemo(() => customers.find((c) => c.id === customerId) ?? null, [customers, customerId]);

  function selectCustomer(c: Customer) {
    setCustomerId(c.id);
    setCustomerSearch(c.name);
    setCustomerPickerOpen(false);
    setCustomerPickerActiveIdx(0);
  }

  function clearSelectedCustomer() {
    setCustomerId(0);
    setCustomerSearch("");
    setCustomerPickerOpen(false);
    setCustomerPickerActiveIdx(0);
    setDispatchRows([]);
    setSelectedDispatchId(null);
    setDispatchError(null);
    setMessage(null);
    setError(null);
    setReturnedQty("");
    setReason("");
    setDisposition("QC_HOLD");
    setRemarks("");
  }

  async function loadHistory() {
    setHistoryError(null);
    try {
      const rows = await apiFetch<ReturnHistoryRow[]>("/api/customer-returns");
      setHistory(Array.isArray(rows) ? rows : []);
    } catch {
      setHistory([]);
      setHistoryError("Could not load return history.");
    }
  }

  React.useEffect(() => {
    apiFetch<Customer[]>("/api/customers")
      .then((c) => setCustomers(Array.isArray(c) ? c : []))
      .catch(() => setCustomers([]));
    loadHistory();
  }, []);

  React.useEffect(() => {
    if (!highlightReturnValid) return;
    if (!history.some((h) => h.id === highlightReturnId)) return;
    const t = window.setTimeout(() => {
      document
        .querySelector(`[data-return-id="${highlightReturnId}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.delete("returnId");
          return n;
        },
        { replace: true },
      );
    }, 200);
    return () => window.clearTimeout(t);
  }, [highlightReturnValid, highlightReturnId, history, setSearchParams]);

  async function loadDispatches(cid: number) {
    if (!cid) {
      setDispatchRows([]);
      setSelectedDispatchId(null);
      return;
    }
    setDispatchLoading(true);
    setDispatchError(null);
    setDispatchRows([]);
    setSelectedDispatchId(null);
    setMessage(null);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("customerId", String(cid));
      qs.set("limit", "50");
      const data = await apiFetch<{ rows: DispatchRow[] }>(`/api/customer-returns/dispatches?${qs.toString()}`);
      setDispatchRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch {
      setDispatchRows([]);
      setDispatchError("Could not load dispatch list.");
    } finally {
      setDispatchLoading(false);
    }
  }

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      void loadDispatches(customerId);
    }, 150);
    return () => window.clearTimeout(t);
  }, [customerId]);

  const dispatchedQty = selectedDispatch?.dispatchedQty ?? 0;
  const alreadyReturned = selectedDispatch?.alreadyReturnedQty ?? 0;
  const returnable = selectedDispatch?.returnableBalanceQty ?? 0;

  const returnedQtyNum = Number(returnedQty);
  const returnedQtyValid =
    selectedDispatch != null &&
    Number.isFinite(returnedQtyNum) &&
    returnedQtyNum > 0 &&
    returnedQtyNum <= returnable + 1e-6;
  const returnedQtyTooHigh =
    selectedDispatch != null && Number.isFinite(returnedQtyNum) && returnedQtyNum > returnable + 1e-6;
  const reasonTrim = reason.trim();
  const reasonRequired = true; // backend + current UI validation requires reason for all dispositions
  const canRecordReturn = Boolean(selectedDispatch) && returnedQtyValid && Boolean(reasonTrim) && !saving;

  function outcomeNoteForDisposition(d: DispositionUi): string | null {
    if (d === "TO_STOCK") return "Outcome: Item will be moved back to usable stock (available for planning/dispatch).";
    if (d === "QC_HOLD") return "Outcome: Item will go to the Hold for Checking queue for inspection.";
    if (d === "REWORK") return "Outcome: Item will go to the Rework queue for correction before reuse.";
    return null;
  }

  async function submitReturn() {
    if (!selectedDispatch) return;
    setError(null);
    setMessage(null);

    const q = Number(returnedQty);
    if (!Number.isFinite(q) || q <= 0) {
      setError("Returned Qty must be a positive number.");
      return;
    }
    if (q > returnable + 1e-6) {
      setError(`Returned Qty cannot exceed Returnable Balance (${formatQty(returnable)}).`);
      return;
    }
    if (!reason.trim()) {
      setError("Reason is required.");
      return;
    }

    setSaving(true);
    try {
      await apiFetch("/api/customer-returns", {
        method: "POST",
        body: JSON.stringify({
          dispatchId: selectedDispatch.dispatchId,
          returnedQty: q,
          reason: reason.trim(),
          disposition,
          remarks: remarks.trim() ? remarks.trim() : null,
        }),
      });
      setMessage("Customer return saved.");
      setReturnedQty("");
      setReason("");
      setDisposition("QC_HOLD");
      setRemarks("");
      await loadDispatches(customerId);
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save customer return.");
    } finally {
      setSaving(false);
    }
  }

  const firstActionableReturn = React.useMemo(
    () =>
      customerId > 0
        ? history.find((r) => Number(r.customer?.id) === Number(customerId) && queueHint(r) != null) ?? null
        : null,
    [history, customerId],
  );
  const actionableQueueHint = firstActionableReturn ? queueHint(firstActionableReturn) : null;

  const showStripNoCustomer = customerId <= 0;
  const showStripQueueFollowUp =
    customerId > 0 && selectedDispatchId == null && firstActionableReturn != null && actionableQueueHint != null;
  const showStripSelectDispatch =
    customerId > 0 && selectedDispatchId == null && firstActionableReturn == null;
  const showStripReturnEntry = selectedDispatch != null;

  return (
    <div className="grid gap-3">
      <DemoFlowBanner />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-900">Customer Return</h1>
        <p className="text-sm text-slate-600">Record post-dispatch rejection and next action.</p>
      </div>

      {showStripNoCustomer ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          <p className="font-medium text-slate-900">Search and select a customer</p>
          <p className="mt-0.5 text-slate-600">This loads recent dispatches for return entry.</p>
        </div>
      ) : null}
      {showStripQueueFollowUp ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
          <p className="font-medium">
            {firstActionableReturn?.status === "IN_QC_HOLD"
              ? "Complete QC for this return"
              : "Open the Rework queue"}
          </p>
          {firstActionableReturn ? (
            <p className="mt-0.5 text-sky-900/90">
              {firstActionableReturn.returnNo} · {returnStatusUi(firstActionableReturn).label}
            </p>
          ) : null}
          {actionableQueueHint ? (
            <div className="mt-2">
              <Button type="button" size="sm" onClick={() => navigate(actionableQueueHint.href)}>
                {actionableQueueHint.text}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {showStripSelectDispatch ? (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
          <p className="font-medium text-slate-900">Select a dispatch</p>
          <p className="mt-0.5 text-slate-600">Choose a recent dispatch to record the return.</p>
        </div>
      ) : null}
      {showStripReturnEntry ? (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
          <p className="font-medium text-slate-900">Enter return quantity and next action</p>
          <p className="mt-0.5 text-slate-600">Record the return and set the disposition.</p>
        </div>
      ) : null}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Customer</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-slate-600">Search customer</span>
            <div className="relative">
              <Input
                value={customerSearch}
                placeholder="Type customer name…"
                onChange={(e) => {
                  const next = e.target.value;
                  setCustomerSearch(next);
                  setCustomerPickerActiveIdx(0);
                  if (!next.trim() && !activeCustomer) {
                    // No selection + cleared search => empty UI (no stale dispatches).
                    clearSelectedCustomer();
                    return;
                  }
                  setCustomerPickerOpen(Boolean(next.trim()));
                }}
                onFocus={() => {
                  if (customerSearch.trim()) setCustomerPickerOpen(true);
                }}
                onBlur={() => {
                  window.setTimeout(() => setCustomerPickerOpen(false), 150);
                }}
                onKeyDown={(e) => {
                  if (!customerPickerOpen) return;
                  const opts = customerOptions.slice(0, 20);
                  if (!opts.length) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCustomerPickerActiveIdx((i) => Math.min(opts.length - 1, i + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCustomerPickerActiveIdx((i) => Math.max(0, i - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const chosen = opts[customerPickerActiveIdx] ?? opts[0];
                    if (chosen) selectCustomer(chosen);
                  } else if (e.key === "Escape") {
                    setCustomerPickerOpen(false);
                  }
                }}
              />

              {activeCustomer ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Clear selected customer"
                  title="Clear customer"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={clearSelectedCustomer}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}

              {customerPickerOpen && customerSearch.trim() ? (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                  {customerOptions.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-slate-600">No matching customers.</div>
                  ) : (
                    <ul className="max-h-64 overflow-auto py-1">
                      {customerOptions.slice(0, 20).map((c, idx) => {
                        const active = idx === customerPickerActiveIdx;
                        return (
                          <li key={c.id}>
                            <button
                              type="button"
                              className={[
                                "flex w-full items-center justify-between px-3 py-2 text-left text-sm",
                                active ? "bg-slate-100 text-slate-900" : "hover:bg-slate-50",
                              ].join(" ")}
                              onMouseEnter={() => setCustomerPickerActiveIdx(idx)}
                              onMouseDown={(e) => {
                                // Prevent input blur before click selection.
                                e.preventDefault();
                              }}
                              onClick={() => selectCustomer(c)}
                            >
                              <span className="truncate">{c.name}</span>
                              {activeCustomer?.id === c.id ? <span className="text-xs text-slate-500">Selected</span> : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
            {activeCustomer ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>
                  Selected: <span className="font-medium text-slate-700">{activeCustomer.name}</span>
                </span>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  className="text-slate-600 underline underline-offset-4 hover:text-slate-900"
                  onClick={clearSelectedCustomer}
                >
                  Clear customer
                </button>
              </div>
            ) : null}
          </label>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-12">
        <Card className="border-slate-200 shadow-sm lg:col-span-7">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent Dispatches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!customerId ? <p className="text-sm text-slate-600">Select a customer to load dispatch list.</p> : null}
            {dispatchLoading ? <p className="text-sm text-slate-600">Loading dispatches…</p> : null}
            {dispatchError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{dispatchError}</div> : null}
            {customerId && !dispatchLoading && !dispatchError && !dispatchRows.length ? (
              <p className="text-sm text-slate-600">No dispatch found for this customer.</p>
            ) : null}

            {customerId && dispatchRows.length ? (
              <div className="grid gap-2">
                {dispatchRows.map((d) => {
                  const selected = selectedDispatchId === d.dispatchId;
                  return (
                    <div
                      key={d.dispatchId}
                      className={[
                        "rounded-md border px-3 py-2",
                        selected ? "border-slate-300 bg-slate-50" : "border-slate-200 bg-white",
                      ].join(" ")}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-slate-700">{d.dispatchNo}</span>
                            <span className="text-slate-300">·</span>
                            <span className="text-xs text-slate-600">{d.date ? new Date(d.date).toLocaleDateString() : "—"}</span>
                            <span className="text-slate-300">·</span>
                            <span className="text-xs text-slate-600">{d.salesOrderNo}</span>
                          </div>
                          <div className="mt-1 min-w-0">
                            <div className="truncate text-sm font-medium text-slate-900">{d.itemName}</div>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant={selected ? "default" : "outline"}
                          size="sm"
                          onClick={() => {
                            setSelectedDispatchId(d.dispatchId);
                            setReturnedQty("");
                            setReason("");
                            setDisposition("QC_HOLD");
                            setRemarks("");
                            setMessage(null);
                            setError(null);
                          }}
                        >
                          {selected ? "Selected" : "Select"}
                        </Button>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-3">
                        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Dispatched</div>
                          <div className="mt-0.5 font-semibold tabular-nums text-slate-900">
                            {formatQty(d.dispatchedQty)} {d.unit}
                          </div>
                        </div>
                        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Returnable</div>
                          <div className="mt-0.5 font-semibold tabular-nums text-slate-900">
                            {formatQty(d.returnableBalanceQty)} {d.unit}
                          </div>
                        </div>
                        <div className="hidden rounded border border-slate-200 bg-slate-50 px-2 py-1 sm:block">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Already returned</div>
                          <div className="mt-0.5 font-semibold tabular-nums text-slate-900">
                            {formatQty(d.alreadyReturnedQty)} {d.unit}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Return Entry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!selectedDispatch ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-sm font-semibold text-slate-900">No dispatch selected</div>
                <div className="mt-1 text-sm text-slate-600">Select a dispatch from the left to record return.</div>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-600">
                  <li>Select dispatch</li>
                  <li>Enter return quantity</li>
                  <li>Choose next action</li>
                </ol>
              </div>
            ) : null}
            {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
            {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{message}</div> : null}

            {selectedDispatch ? (
              <>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-800">
                  <div className="font-semibold text-slate-900">Selected Dispatch Summary</div>
                  <div className="mt-2 grid gap-2 text-xs text-slate-700">
                    <div className="grid gap-1 sm:grid-cols-2">
                      <div>
                        <span className="text-slate-500">Dispatch No:</span>{" "}
                        <span className="font-mono font-medium text-slate-900">{selectedDispatch.dispatchNo}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Dispatch Date:</span>{" "}
                        <span className="font-medium text-slate-900">
                          {selectedDispatch.date ? new Date(selectedDispatch.date).toLocaleDateString() : "—"}
                        </span>
                      </div>
                      <div className="sm:col-span-2">
                        <span className="text-slate-500">Customer:</span>{" "}
                        <span className="font-medium text-slate-900">{selectedDispatch.customer?.name ?? "—"}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">SO Ref:</span>{" "}
                        <span className="font-medium text-slate-900">{selectedDispatch.salesOrderNo}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Item:</span>{" "}
                        <span className="font-medium text-slate-900">{selectedDispatch.itemName}</span>
                      </div>
                    </div>

                    <div className="mt-1 grid gap-2 sm:grid-cols-3">
                      <div className="rounded border border-slate-200 bg-white px-2 py-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Dispatched qty</div>
                        <div className="mt-0.5 font-semibold tabular-nums text-slate-900">
                          {formatQty(dispatchedQty)} {selectedDispatch.unit}
                        </div>
                      </div>
                      <div className="rounded border border-slate-200 bg-white px-2 py-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Returnable qty</div>
                        <div className="mt-0.5 font-semibold tabular-nums text-slate-900">
                          {formatQty(returnable)} {selectedDispatch.unit}
                        </div>
                      </div>
                      <div className="rounded border border-slate-200 bg-white px-2 py-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Already returned</div>
                        <div className="mt-0.5 font-semibold tabular-nums text-slate-900">
                          {formatQty(alreadyReturned)} {selectedDispatch.unit}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-2">
                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-700 font-semibold">Return quantity</span>
                    <Input
                      value={returnedQty}
                      onChange={(e) => {
                        setReturnedQty(e.target.value);
                        setMessage(null);
                        setError(null);
                      }}
                      placeholder="Enter returned qty"
                      inputMode="decimal"
                    />
                    <div className="text-xs text-slate-600">
                      Max returnable: <span className="font-semibold tabular-nums text-slate-900">{formatQty(returnable)}</span>{" "}
                      {selectedDispatch.unit} · Already returned:{" "}
                      <span className="font-semibold tabular-nums text-slate-900">{formatQty(alreadyReturned)}</span> {selectedDispatch.unit}
                    </div>
                    {returnedQtyTooHigh ? (
                      <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">
                        Returned Qty cannot exceed Returnable Qty ({formatQty(returnable)} {selectedDispatch.unit}).
                      </div>
                    ) : null}
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-700 font-semibold">Next action</span>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <button
                        type="button"
                        className={[
                          "rounded-md border px-3 py-2 text-left",
                          disposition === "TO_STOCK" ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50",
                        ].join(" ")}
                        onClick={() => setDisposition("TO_STOCK")}
                      >
                        <div className="text-sm font-semibold text-slate-900">Return to Stock</div>
                        <div className="mt-0.5 text-xs text-slate-600">Item is accepted back into usable stock</div>
                      </button>
                      <button
                        type="button"
                        className={[
                          "rounded-md border px-3 py-2 text-left",
                          disposition === "QC_HOLD" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white hover:bg-slate-50",
                        ].join(" ")}
                        onClick={() => setDisposition("QC_HOLD")}
                      >
                        <div className="text-sm font-semibold text-slate-900">Hold for Check</div>
                        <div className="mt-0.5 text-xs text-slate-600">Item needs inspection before decision</div>
                      </button>
                      <button
                        type="button"
                        className={[
                          "rounded-md border px-3 py-2 text-left",
                          disposition === "REWORK" ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50",
                        ].join(" ")}
                        onClick={() => setDisposition("REWORK")}
                      >
                        <div className="text-sm font-semibold text-slate-900">Send for Rework</div>
                        <div className="mt-0.5 text-xs text-slate-600">Item needs correction before reuse</div>
                      </button>
                    </div>
                    {outcomeNoteForDisposition(disposition) ? (
                      <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                        {outcomeNoteForDisposition(disposition)}
                      </div>
                    ) : null}
                  </label>
                  <div className="text-xs text-slate-500">
                    To scrap returned material, use the Hold for Checking or Rework screens.
                  </div>
                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-700 font-semibold">
                      Reason {reasonRequired ? <span className="text-red-600">*</span> : null}
                    </span>
                    <Input
                      value={reason}
                      onChange={(e) => {
                        setReason(e.target.value);
                        setMessage(null);
                        setError(null);
                      }}
                      placeholder="Why did customer reject?"
                    />
                    <div className="text-xs text-slate-600">
                      {disposition === "TO_STOCK"
                        ? "Reason helps auditability (required by current rules)."
                        : "Reason is required for hold/rework decisions."}
                    </div>
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600">Remarks (optional)</span>
                    <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any notes (optional)" />
                  </label>
                  <Button type="button" onClick={submitReturn} disabled={!canRecordReturn}>
                    {saving ? "Saving…" : "Record Return"}
                  </Button>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Return History</CardTitle>
          <Link
            to="/qc-report?sourceType=CUSTOMER_RETURN"
            className="text-xs font-medium text-sky-700 underline-offset-4 hover:underline"
          >
            View QC breakdown
          </Link>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-slate-500">
            Tip: Status shows the current stage. Use the queue links for rework and hold-for-checking returns.
          </p>
          {historyError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{historyError}</div> : null}
          {!history.length && !historyError ? <p className="text-sm text-slate-600">No returns recorded yet.</p> : null}
          {history.length ? (
            <div className="overflow-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-600">
                    <th className="py-2 pr-2">Return No</th>
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2">Customer</th>
                    <th className="py-2 pr-2">Item</th>
                    <th className="py-2 pr-2">Qty</th>
                    <th className="py-2 pr-2">Disposition</th>
                    <th className="py-2 pr-2">Linked Dispatch</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="min-w-[11rem] py-2 pr-2">QC / balance</th>
                    <th className="py-2 pr-2 text-right">Replacement</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((r) => (
                    <tr
                      key={r.id}
                      data-return-id={r.id}
                      className={cn(
                        "border-b",
                        highlightReturnValid && r.id === highlightReturnId && "bg-amber-50/90 ring-1 ring-amber-200/80",
                      )}
                    >
                      <td className="py-2 pr-2 font-mono text-xs">{r.returnNo}</td>
                      <td className="py-2 pr-2">{r.date ? new Date(r.date).toLocaleDateString() : "—"}</td>
                      <td className="py-2 pr-2">{r.customer.name}</td>
                      <td className="py-2 pr-2">{r.item.name}</td>
                      <td className="py-2 pr-2 tabular-nums">
                        {formatQty(r.qty)} {r.item.unit}
                      </td>
                      <td className="py-2 pr-2">{dispositionLabel(r.disposition)}</td>
                      <td className="py-2 pr-2 font-mono text-xs">{r.dispatchNo}</td>
                      <td className="py-2 pr-2">
                        <div className="flex flex-col gap-1">
                          <div>
                            <Badge variant={returnStatusUi(r).variant}>{returnStatusUi(r).label}</Badge>
                          </div>
                          {approvedDispatchHint(r) ? (
                            <div className="text-xs text-slate-600">{approvedDispatchHint(r)}</div>
                          ) : null}
                          {queueHint(r) ? (
                            <a href={queueHint(r)!.href} className="text-xs text-sky-700 hover:underline">
                              {queueHint(r)!.text}
                            </a>
                          ) : null}
                        </div>
                      </td>
                      <td className="align-top py-2 pr-2">{returnBalanceBlock(r, r.item.unit)}</td>
                      <td className="py-2 pr-2 text-right">
                        {r.reversedAt || r.status !== "APPROVED_TO_STOCK" ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <div className="text-[11px] text-slate-600">
                              Replacement line reserved:{" "}
                              <span className="tabular-nums font-medium">{formatQty(Number(r.alreadyUsedInReplacementQty ?? 0))}</span>{" "}
                              {r.item.unit}
                              <span className="mx-1">·</span>
                              Headroom vs QC:{" "}
                              <span className="tabular-nums font-semibold text-slate-900">{formatQty(remainingReplacementQty(r))}</span>{" "}
                              {r.item.unit}
                            </div>
                            {remainingReplacementQty(r) > 1e-9 ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={creatingReplacementId === r.id}
                                onClick={async () => {
                                  setCreatingReplacementId(r.id);
                                  setError(null);
                                  setMessage(null);
                                  try {
                                    const res = await apiFetch<{ salesOrderId: number }>(
                                      `/api/customer-returns/${r.id}/replacement-order`,
                                      { method: "POST", body: JSON.stringify({}) },
                                    );
                                    window.location.href = salesOrdersFocusHref(res.salesOrderId);
                                  } catch (e) {
                                    setError(e instanceof Error ? e.message : "Could not create replacement order.");
                                  } finally {
                                    setCreatingReplacementId(null);
                                  }
                                }}
                              >
                                {creatingReplacementId === r.id ? "Creating…" : "Create Replacement Order"}
                              </Button>
                            ) : (
                              <p className="max-w-[14rem] text-right text-[11px] leading-snug text-slate-600">
                                Replacement completed. All QC-cleared quantity is already used for this return.
                              </p>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

