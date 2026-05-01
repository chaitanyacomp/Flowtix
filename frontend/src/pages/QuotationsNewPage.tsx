import * as React from "react";
import { Link, NavLink, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "../lib/utils";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useToast } from "../contexts/ToastContext";
import {
  type QuoteLineDraft,
  defaultQuoteLineDraft,
  draftLinesToApiPayload,
  lineTotalFromDraft,
  previewNum,
  validateQuoteLinesForSave,
} from "../lib/quotationLineDraft";

type Item = { id: number; itemName: string };
type Customer = { id: number; name: string };

type EnquiryOpt = {
  id: number;
  status: string;
  customer: Customer;
  lines: { itemId: number; item: Item; qty: string }[];
};

type QRow = { id: number; enquiryId: number };

function lineTotal(qty: number, rate: number, discountPct: number, gstPct: number, isFree?: boolean) {
  const r = isFree ? 0 : rate;
  const base = qty * r * (1 - discountPct / 100);
  const gst = base * (gstPct / 100);
  return Math.round((base + gst) * 100) / 100;
}

const flowSteps = [
  { n: 1, label: "Quotation", to: "/quotations", end: false as const },
  { n: 2, label: "Sales Order", to: "/sales-orders" },
  { n: 3, label: "Dispatch", to: "/dispatch" },
  { n: 4, label: "Sales Bill", to: "/sales-bills" },
];

export function QuotationsNewPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const enquiryFromUrl = Number(searchParams.get("enquiryId")) || 0;

  const [items, setItems] = React.useState<Item[]>([]);
  const [feasibleEnquiries, setFeasibleEnquiries] = React.useState<EnquiryOpt[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [createEnquiryId, setCreateEnquiryId] = React.useState(0);
  const [quoteLines, setQuoteLines] = React.useState<QuoteLineDraft[]>([defaultQuoteLineDraft(0)]);
  const [terms, setTerms] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const sumPreview = quoteLines.reduce((s, l) => s + lineTotalFromDraft(l, lineTotal), 0);

  async function load() {
    setLoadError(null);
    setLoading(true);
    try {
      const [i, q, enq] = await Promise.all([
        apiFetch<Item[]>("/api/items?type=FG"),
        apiFetch<QRow[]>("/api/quotations"),
        apiFetch<EnquiryOpt[]>("/api/enquiries"),
      ]);
      setItems(i);
      const feas = enq.filter((e) => e.status === "FEASIBLE" && !q.some((x) => x.enquiryId === e.id));
      setFeasibleEnquiries(feas);

      if (enquiryFromUrl && feas.some((x) => x.id === enquiryFromUrl)) {
        setCreateEnquiryId(enquiryFromUrl);
        const sel = enq.find((e) => e.id === enquiryFromUrl);
        if (sel?.lines.length) {
          setQuoteLines(
            sel.lines.map((l) => ({
              itemId: l.itemId,
              qty: String(l.qty),
              rate: "",
              discountPct: "0",
              gstPct: "18",
              isFree: false,
            })),
          );
        } else if (i.length) {
          setQuoteLines([defaultQuoteLineDraft(i[0].id)]);
        }
        setSearchParams({}, { replace: true });
      } else if (feas.length) {
        setCreateEnquiryId(feas[0].id);
        if (i.length) {
          setQuoteLines([defaultQuoteLineDraft(i[0].id)]);
        }
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!createEnquiryId || !feasibleEnquiries.length) return;
    const sel = feasibleEnquiries.find((e) => e.id === createEnquiryId);
    if (sel?.lines.length) {
      setQuoteLines(
        sel.lines.map((l) => ({
          itemId: l.itemId,
          qty: String(l.qty),
          rate: "",
          discountPct: "0",
          gstPct: "18",
          isFree: false,
        })),
      );
    }
  }, [createEnquiryId, feasibleEnquiries]);

  async function onCreateQuotation() {
    if (!createEnquiryId) return;
    setError(null);
    const v = validateQuoteLinesForSave(quoteLines);
    if (v) {
      setError(v);
      toast.showError(v);
      return;
    }
    setCreating(true);
    try {
      await apiFetch("/api/quotations", {
        method: "POST",
        body: JSON.stringify({
          enquiryId: createEnquiryId,
          terms: terms.trim() || undefined,
          lines: draftLinesToApiPayload(quoteLines),
        }),
      });
      toast.showSuccess("Quotation created");
      navigate("/quotations");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-1 text-sm text-slate-600" aria-busy="true">
        Loading…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-3 p-1">
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div>
        <Link to="/quotations" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to Quotations
        </Link>
      </div>
    );
  }

  if (!feasibleEnquiries.length) {
    return (
      <div className="flex flex-col gap-4 p-1">
        <Link
          to="/quotations"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          Back to Quotations
        </Link>
        <p className="text-sm text-slate-600">
          No feasible enquiries without a quotation. Complete feasibility on the Enquiries page first.
        </p>
      </div>
    );
  }

  if (enquiryFromUrl > 0 && !feasibleEnquiries.some((e) => e.id === enquiryFromUrl)) {
    return <Navigate to="/quotations" replace />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <aside className="shrink-0 md:w-44" aria-label="Sales process steps">
          <nav className="rounded-lg border border-slate-200 bg-white p-1.5 text-[13px] shadow-sm">
            <ol className="flex flex-wrap gap-1 md:flex-col md:gap-0.5">
              {flowSteps.map((s) => (
                <li key={s.to}>
                  <NavLink
                    to={s.to}
                    end={s.end}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-slate-700 hover:bg-slate-50",
                        isActive && "bg-blue-50 font-medium text-blue-900",
                      )
                    }
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[11px] font-semibold tabular-nums text-slate-600">
                      {s.n}
                    </span>
                    <span className="whitespace-nowrap">{s.label}</span>
                  </NavLink>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <div className="min-w-0 flex-1 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="flex min-w-0 flex-col gap-2">
              <Link
                to="/quotations"
                className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900"
              >
                <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
                Back to Quotations
              </Link>
              <h1 className="text-xl font-semibold text-slate-900">New Quotation</h1>
            </div>
            <Button
              type="button"
              data-testid="create-quotation-btn"
              onClick={() => void onCreateQuotation()}
              disabled={creating || !createEnquiryId}
            >
              {creating ? "Saving…" : "Save"}
            </Button>
          </div>

          {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Basic info</h2>
            <div className="grid max-w-3xl gap-4">
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                Feasible enquiry
                <select
                  className="h-10 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm"
                  data-testid="quotation-enquiry-select"
                  value={createEnquiryId}
                  onChange={(e) => setCreateEnquiryId(Number(e.target.value))}
                >
                  {feasibleEnquiries.map((e) => (
                    <option key={e.id} value={e.id}>
                      #{e.id} — {e.customer.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                Terms <span className="font-normal text-slate-500">(optional)</span>
                <Input
                  className="h-10 w-full min-w-0"
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="Payment / delivery terms"
                />
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Items</h2>
            <div className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col style={{ width: "38%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "14%" }} />
                </colgroup>
                <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2.5">Item</th>
                    <th className="px-3 py-2.5 text-right">Qty</th>
                    <th className="px-3 py-2.5 text-right">Rate</th>
                    <th className="px-3 py-2.5 text-right">GST</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {quoteLines.map((l, i) => (
                    <tr key={`ql-${i}`} className="align-top">
                      <td className="min-w-0 px-3 py-2.5">
                        <select
                          className="mb-2 h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900"
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
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 rounded border-slate-300"
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
                          Free item
                        </label>
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          className="h-9 w-full min-w-0 text-right tabular-nums"
                          type="number"
                          step="any"
                          min={0}
                          inputMode="decimal"
                          value={l.qty}
                          onChange={(e) => {
                            setQuoteLines((p) => p.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)));
                          }}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          className="h-9 w-full min-w-0 text-right tabular-nums"
                          type="number"
                          step="any"
                          min={0}
                          inputMode="decimal"
                          value={l.isFree ? "0" : l.rate}
                          disabled={l.isFree}
                          onChange={(e) => {
                            setQuoteLines((p) => p.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)));
                          }}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          className="h-9 w-full min-w-0 text-right tabular-nums"
                          type="number"
                          step="any"
                          inputMode="decimal"
                          value={l.gstPct}
                          onChange={(e) => {
                            setQuoteLines((p) => p.map((x, j) => (j === i ? { ...x, gstPct: e.target.value } : x)));
                          }}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                        {lineTotalFromDraft(l, lineTotal).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              className="text-sm font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-800"
              onClick={() => {
                const firstItemId = items[0]?.id ?? 0;
                setQuoteLines((p) => [...p, defaultQuoteLineDraft(firstItemId)]);
              }}
            >
              + Add item
            </button>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm font-medium text-slate-800">
              <span>
                Grand total <span className="tabular-nums text-slate-900">{sumPreview.toFixed(2)}</span>
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
