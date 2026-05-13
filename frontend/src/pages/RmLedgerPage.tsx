import * as React from "react";
import { Link } from "react-router-dom";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { apiFetch } from "../services/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { ReportPageHeader } from "../components/PageHeader";

type Item = { id: number; itemName: string; itemType: string; unit: string };

type RmLedgerRow = {
  id: number;
  date: string;
  itemId: number;
  itemName: string;
  unit: string;
  activity: string;
  inwardQty: number;
  outwardQty: number;
  runningBalanceAfter: number | null;
  refType: string;
  refNo: number;
  notes: string | null;
  transactionType: string;
  source?: { type: string; id: number | null; route: string | null; label: string | null } | null;
};

type RmLedgerResponse = {
  items: RmLedgerRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: "asc" | "desc";
  movement: string;
  summary: {
    totalInward: number;
    totalOutward: number;
    currentBalance: number | null;
    runningBalanceNote: string | null;
    runningBalanceActive: boolean;
  };
  openingBalanceUsable: number | null;
};

const MOVEMENT_VALUES = [
  "ALL",
  "GRN",
  "PRODUCTION_CONSUMPTION",
  "PRODUCTION_RETURN",
  "RM_WASTAGE",
  "STOCK_INCREASE",
  "STOCK_DECREASE",
  "REVERSAL",
  "CUSTOMER_RETURN",
] as const;

type MovementValue = (typeof MOVEMENT_VALUES)[number];

const MOVEMENT_LABELS: Record<MovementValue, string> = {
  ALL: "All movements",
  GRN: "Purchase Receipt",
  PRODUCTION_CONSUMPTION: "Production Consumption",
  PRODUCTION_RETURN: "Production Return",
  RM_WASTAGE: "RM wastage",
  STOCK_INCREASE: "Adjustment In",
  STOCK_DECREASE: "Adjustment Out",
  REVERSAL: "Reverse Entry",
  CUSTOMER_RETURN: "Customer return",
};

const URL_OMIT: Record<string, string> = {
  movement: "ALL",
  sort: "asc",
  page: "1",
  pageSize: "50",
};

function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(3);
}

function refNoCell(refNo: number, refType: string): string {
  if (refNo === 0 && refType === "Adjustment") return "—";
  return String(refNo);
}

function movementTypeDisplay(row: Pick<RmLedgerRow, "activity" | "transactionType">): string {
  const raw = (row.activity || "").trim();
  const t = (row.transactionType || "").trim();

  // UI-only, keep stored values as-is.
  const base = raw || t || "—";
  const lc = base.toLowerCase();

  if (lc.includes("grn")) return "Purchase Receipt";
  if (lc.includes("production") && (lc.includes("consumption") || lc.includes("issue"))) return "Production Consumption";
  if (lc.includes("production") && lc.includes("return")) return "Production Return";
  if (lc.includes("adjust") && (lc.includes("increase") || lc.includes("in"))) return "Adjustment In";
  if (lc.includes("adjust") && (lc.includes("decrease") || lc.includes("out"))) return "Adjustment Out";
  if (lc.includes("reversal") || lc.includes("reverse")) return "Reverse Entry";

  return base;
}

function sourceUsePrimary(row: Pick<RmLedgerRow, "activity" | "transactionType" | "refType">): string {
  const mt = movementTypeDisplay(row);
  const ref = (row.refType || "").trim();
  const lc = `${mt} ${ref}`.toLowerCase();

  if (lc.includes("grn")) return "Purchase entry";
  if (lc.includes("production") && (lc.includes("issue") || lc.includes("consumption"))) return "Production use";
  if (lc.includes("production") && lc.includes("return")) return "Production return";
  if (lc.includes("adjustment") || lc.includes("adjust")) return "Stock adjustment";
  if (lc.includes("reverse")) return "Reverse entry";
  if (lc.includes("return")) return "Return entry";
  if (lc.includes("wastage")) return "Wastage entry";

  // Fallback: still user-facing, but avoid internal codes.
  return ref || mt || "—";
}

function sourceUseSecondary(row: Pick<RmLedgerRow, "refType" | "refNo" | "notes">): string {
  const refNo = refNoCell(row.refNo, row.refType);
  const parts: string[] = [];
  if (row.refType?.trim()) parts.push(`${row.refType}${refNo !== "—" ? ` #${refNo}` : ""}`);
  const note = (row.notes || "").trim();
  if (note) parts.push(note);
  return parts.join("\n");
}

export function RmLedgerPage() {
  const { patch, read } = useUrlQueryState(URL_OMIT);

  const itemId = read.int("itemId", 0);
  const dateFrom = read.string("dateFrom");
  const dateTo = read.string("dateTo");
  const movement = read.enum("movement", MOVEMENT_VALUES, "ALL");
  const page = Math.max(1, read.int("page", 1));
  const pageSize = Math.max(1, Math.min(200, read.int("pageSize", 50)));
  const sort = read.enum("sort", ["asc", "desc"] as const, "asc");

  const qFromUrl = read.string("q");
  const [qDraft, setQDraft] = useDebouncedUrlStringParam({ urlValue: qFromUrl, patch, paramKey: "q" });

  const [items, setItems] = React.useState<Item[]>([]);
  const [itemsError, setItemsError] = React.useState<string | null>(null);

  const [rows, setRows] = React.useState<RmLedgerRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [total, setTotal] = React.useState(0);
  const [summary, setSummary] = React.useState<RmLedgerResponse["summary"] | null>(null);
  const [openingBal, setOpeningBal] = React.useState<number | null>(null);

  React.useEffect(() => {
    apiFetch<Item[]>("/api/items?type=RM")
      .then((list) => setItems(Array.isArray(list) ? list : []))
      .catch((e) => setItemsError(e instanceof Error ? e.message : "Failed to load RM items"));
  }, []);

  const displayRows = React.useMemo(() => {
    const list = Array.isArray(rows) ? [...rows] : [];
    list.sort((a, b) => {
      const ta = new Date(a.date).getTime();
      const tb = new Date(b.date).getTime();
      if (ta !== tb) return ta - tb;
      return Number(a.id) - Number(b.id);
    });
    if (itemId <= 0) return list;
    // Compute running balance in UI so it never depends on sort or server-side row order.
    let bal = openingBal != null && Number.isFinite(openingBal) ? Number(openingBal) : 0;
    const withBal = list.map((r) => {
      const inw = Number(r.inwardQty) || 0;
      const out = Number(r.outwardQty) || 0;
      bal += inw - out;
      return { ...r, runningBalanceAfter: bal };
    });
    // Display newest first without recomputing balance in reverse.
    return withBal.slice().reverse();
  }, [rows, itemId, openingBal]);

  const loadLedger = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      params.set("sort", sort);
      if (movement !== "ALL") params.set("movement", movement);
      if (itemId > 0) params.set("itemId", String(itemId));
      if (dateFrom.trim()) params.set("dateFrom", dateFrom.trim());
      if (dateTo.trim()) params.set("dateTo", dateTo.trim());
      const q = qFromUrl.trim();
      if (q && itemId <= 0) params.set("q", q);

      const data = await apiFetch<RmLedgerResponse>(`/api/stock/rm-ledger?${params.toString()}`);
      setRows(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total) || 0);
      setSummary(data.summary ?? null);
      setOpeningBal(
        data.openingBalanceUsable != null && Number.isFinite(Number(data.openingBalanceUsable))
          ? Number(data.openingBalanceUsable)
          : null,
      );
    } catch (e) {
      setRows([]);
      setTotal(0);
      setSummary(null);
      setOpeningBal(null);
      setError(e instanceof Error ? e.message : "Could not load RM ledger.");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, sort, movement, itemId, dateFrom, dateTo, qFromUrl]);

  React.useEffect(() => {
    void loadLedger();
  }, [loadLedger]);

  // UX: running balance is shown oldest→newest and should not depend on manual sorting.
  React.useEffect(() => {
    if (sort !== "asc") patch({ sort: "asc" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);

  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, maxPage);

  React.useEffect(() => {
    if (page !== safePage) patch({ page: safePage === 1 ? null : String(safePage) });
  }, [page, safePage, patch]);

  function clearFilters() {
    setQDraft("");
    patch({
      itemId: null,
      dateFrom: null,
      dateTo: null,
      movement: null,
      q: null,
      page: null,
      pageSize: null,
      sort: null,
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4">
      <ReportPageHeader
        className="mb-0"
        title="RM Movement"
        purpose="Track inward, consumption, adjustments, and running balance item-wise for raw materials."
      />
      <p className="text-xs text-slate-500">
        Use{" "}
        <Link to="/rm-po-grn" className="font-medium text-primary underline">
          Material Planning
        </Link>{" "}
        to post GRN. This page is read-only history.{" "}
        <Link to="/stock" className="font-medium text-primary underline">
          Stock Summary
        </Link>
      </p>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {itemsError ? <p className="text-sm text-amber-800">{itemsError}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              RM item
              <select
                className="h-[38px] w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                value={itemId > 0 ? String(itemId) : ""}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const nextId = Number.isFinite(v) && v > 0 ? v : 0;
                  patch({
                    itemId: nextId > 0 ? String(nextId) : null,
                    sort: nextId > 0 ? "asc" : null,
                    page: null,
                  });
                }}
              >
                <option value="">All RM items</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.itemName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              From date
              <Input
                className="h-[38px] px-2 text-sm"
                type="date"
                value={dateFrom}
                onChange={(e) => patch({ dateFrom: e.target.value || null, page: null })}
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              To date
              <Input
                className="h-[38px] px-2 text-sm"
                type="date"
                value={dateTo}
                onChange={(e) => patch({ dateTo: e.target.value || null, page: null })}
              />
            </label>
            <div className="flex items-end justify-end gap-2 xl:col-span-2">
              <Button
                type="button"
                variant="outline"
                className="h-[38px]"
                onClick={() => {
                  void loadLedger();
                }}
              >
                Refresh
              </Button>
              <Button type="button" variant="outline" className="h-[38px]" onClick={clearFilters}>
                Clear
              </Button>
            </div>
          </div>

          <details className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2">
            <summary className="cursor-pointer select-none text-sm font-medium text-slate-700">
              More filters
              <span className="ml-2 text-xs font-normal text-slate-500">(movement, search, rows)</span>
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Movement type
                <select
                  className="h-[38px] w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                  value={movement}
                  onChange={(e) =>
                    patch({
                      movement: e.target.value === "ALL" ? null : (e.target.value as MovementValue),
                      page: null,
                    })
                  }
                >
                  {MOVEMENT_VALUES.map((v) => (
                    <option key={v} value={v}>
                      {MOVEMENT_LABELS[v]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Search (item name)
                <Input
                  className="h-[38px] px-2 text-sm"
                  placeholder="When no item selected"
                  value={qDraft}
                  onChange={(e) => setQDraft(e.target.value)}
                  disabled={itemId > 0}
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Rows per page
                <select
                  className="h-[38px] w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                  value={String(pageSize)}
                  onChange={(e) => patch({ pageSize: e.target.value, page: null })}
                >
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                </select>
              </label>
            </div>
            {itemId > 0 ? <p className="mt-2 text-xs text-slate-500">Search is disabled while a specific RM item is selected.</p> : null}
          </details>
        </CardContent>
      </Card>

      {summary != null ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Opening balance</div>
              {itemId > 0 ? (
                <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{openingBal != null ? fmtQty(openingBal) : "0.000"}</div>
              ) : (
                <div className="mt-1 text-sm font-medium text-slate-700">Select an RM item to view opening and closing balance.</div>
              )}
              <p className="mt-1 text-[11px] text-slate-500">{itemId > 0 ? "Shown for one RM item." : "Opening/closing are item-wise."}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total inward</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-900">{fmtQty(summary.totalInward)}</div>
              <p className="mt-1 text-[11px] text-slate-500">All pages.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total outward</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-red-900">{fmtQty(summary.totalOutward)}</div>
              <p className="mt-1 text-[11px] text-slate-500">All pages.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Closing balance</div>
              {itemId > 0 ? (
                <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                  {summary.currentBalance != null && Number.isFinite(summary.currentBalance) ? fmtQty(summary.currentBalance) : "0.000"}
                </div>
              ) : (
                <div className="mt-1 text-sm font-medium text-slate-700">Select an RM item to view opening and closing balance.</div>
              )}
              <p className="mt-1 text-[11px] text-slate-500">{itemId > 0 ? "Shown for one RM item." : "Opening/closing are item-wise."}</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {summary?.runningBalanceNote ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {summary.runningBalanceNote}
        </p>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Movement register</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? <p className="mb-2 text-sm text-red-700">{error}</p> : null}
          {loading ? <p className="text-sm text-slate-600">Loading…</p> : null}
          {itemId <= 0 ? <p className="mb-2 text-sm text-slate-600">Select an RM item to view running balance after each transaction.</p> : null}
          {!loading && rows.length === 0 ? (
            <p className="text-sm text-slate-600">No movement records found for the selected filters.</p>
          ) : null}
          {summary?.runningBalanceActive && openingBal != null ? (
            <p className="mb-2 text-xs text-slate-500">
              Balance before this page (usable, filtered):{" "}
              <span className="font-semibold tabular-nums text-slate-800">{fmtQty(openingBal)}</span>
            </p>
          ) : null}
          {displayRows.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-700">
                    <th className="px-3 py-2.5 font-semibold">Date</th>
                    <th className="px-3 py-2.5 font-semibold">Movement type</th>
                    <th className="px-3 py-2.5 font-semibold">Ref no</th>
                    <th className="px-3 py-2.5 font-semibold">Source / use</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Inward</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Outward</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Balance (after txn)</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-800">
                        {r.date ? new Date(r.date).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-slate-800">
                        <span className="font-medium">{movementTypeDisplay(r)}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-800">
                        {r.source?.route ? (
                          <Link
                            to={r.source.route}
                            className="rounded bg-slate-100 px-2 py-0.5 text-sky-700 underline-offset-4 hover:underline"
                            title="Open source transaction"
                          >
                            {refNoCell(r.refNo, r.refType)}
                          </Link>
                        ) : (
                          <span
                            className="rounded bg-slate-100 px-2 py-0.5"
                            title={r.source && r.source.route == null ? "Source record not available" : undefined}
                          >
                            {refNoCell(r.refNo, r.refType)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        <div className="space-y-0.5 leading-snug">
                          {r.source?.route ? (
                            <Link
                              to={r.source.route}
                              className="font-medium text-slate-900 underline-offset-4 hover:underline"
                              title="Open source transaction"
                            >
                              {sourceUsePrimary(r)}
                            </Link>
                          ) : (
                            <div className="font-medium text-slate-900">{sourceUsePrimary(r)}</div>
                          )}
                          <div className="whitespace-pre-line text-[12px] text-slate-500">
                            {itemId <= 0 ? <span className="font-medium text-slate-700">{r.itemName}</span> : null}
                            {itemId <= 0 ? <span className="text-slate-400"> · </span> : null}
                            <span>{sourceUseSecondary(r) || "—"}</span>
                          </div>
                        </div>
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right tabular-nums",
                          r.inwardQty > 0 ? "font-semibold text-emerald-800" : "text-slate-400",
                        )}
                      >
                        {r.inwardQty > 0 ? fmtQty(r.inwardQty) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right tabular-nums",
                          r.outwardQty > 0 ? "font-semibold text-red-800" : "text-slate-400",
                        )}
                      >
                        {r.outwardQty > 0 ? fmtQty(r.outwardQty) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-extrabold tabular-nums text-slate-900">
                        {r.runningBalanceAfter != null && Number.isFinite(r.runningBalanceAfter)
                          ? fmtQty(r.runningBalanceAfter)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {total > 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
              <span>
                {total} row{total === 1 ? "" : "s"} · page {safePage} of {maxPage}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage <= 1}
                  onClick={() => patch({ page: safePage <= 2 ? null : String(safePage - 1) })}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage >= maxPage}
                  onClick={() => patch({ page: String(safePage + 1) })}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
