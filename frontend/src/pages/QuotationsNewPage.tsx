import * as React from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, X } from "lucide-react";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import {
  CommercialWorkflowStrip,
  commercialWorkflowStripDenseFramedClassName,
} from "../components/erp/CommercialWorkflowStrip";
import { NO_QTY_TERMS } from "../lib/flowTerminology";
import { cn } from "../lib/utils";
import { useToast } from "../contexts/ToastContext";
import {
  type QuoteLineDraft,
  defaultQuoteLineDraft,
  draftLinesToApiPayload,
  lineTotalFromDraft,
  previewNum,
  validateQuoteLinesForSave,
} from "../lib/quotationLineDraft";

type NoQtyCommercialDraft = {
  paymentTerms: string;
  deliveryNotes: string;
  quotationValidity: string;
  commercialConditions: string;
  remarks: string;
};

function emptyNoQtyCommercial(): NoQtyCommercialDraft {
  return {
    paymentTerms: "",
    deliveryNotes: "",
    quotationValidity: "",
    commercialConditions: "",
    remarks: "",
  };
}

/** Single `terms` field on quotation — grouped labels for NO_QTY commercial UX only. */
function buildNoQtyTermsPayload(c: NoQtyCommercialDraft): string | undefined {
  const blocks: string[] = [];
  const push = (heading: string, body: string) => {
    const t = body.trim();
    if (t) blocks.push(`${heading}\n${t}`);
  };
  push("Payment terms", c.paymentTerms);
  push("Delivery", c.deliveryNotes);
  push("Quotation validity", c.quotationValidity);
  push("Commercial conditions", c.commercialConditions);
  push("Remarks", c.remarks);
  const s = blocks.join("\n\n").trim();
  return s || undefined;
}

const noQtyCommercialTextareaShort =
  "h-[3.25rem] w-full resize-none overflow-y-auto rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[12.5px] leading-snug text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30";

const noQtyCommercialTextareaMedium =
  "h-[4.5rem] w-full resize-none overflow-y-auto rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[12.5px] leading-snug text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30";

function contractStatusLabel(raw: string): string {
  const s = raw.trim();
  if (!s) return "—";
  return s
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

function formatInrAmount(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Item = { id: number; itemName: string };
type Customer = { id: number; name: string };

type EnquiryOpt = {
  id: number;
  status: string;
  flowType?: "REGULAR" | "NO_QTY";
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

type RateContractRow = {
  id: number;
  customerId: number;
  itemId: number;
  rate: string;
  gstRate: string;
  effectiveFrom: string;
  status: string;
};

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
  const [noQtyCommercial, setNoQtyCommercial] = React.useState(emptyNoQtyCommercial());
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [missingRateIdx, setMissingRateIdx] = React.useState<Record<number, boolean>>({});
  const [noQtyRcStatusByLine, setNoQtyRcStatusByLine] = React.useState<Record<number, string>>({});
  const [noQtyRatesLoading, setNoQtyRatesLoading] = React.useState(false);

  const selectedEnquiry = feasibleEnquiries.find((e) => e.id === createEnquiryId) ?? null;
  const flowTypeSnapshot = (selectedEnquiry?.flowType ?? "REGULAR") === "NO_QTY" ? "NO_QTY" : "REGULAR";
  const quotationDate = React.useMemo(() => new Date(), []);

  const sumPreview = quoteLines.reduce((s, l) => s + lineTotalFromDraft(l, lineTotal), 0);

  const isNoQty = flowTypeSnapshot === "NO_QTY";

  const noQtyHasEnquiryLines = Boolean(selectedEnquiry?.lines?.length);
  const noQtyRatesIncomplete = Object.keys(missingRateIdx).length > 0;
  const noQtySaveBlocked = isNoQty && (!noQtyHasEnquiryLines || noQtyRatesIncomplete || noQtyRatesLoading);

  async function resolveApplicableRate(
    customerId: number,
    itemId: number,
  ): Promise<{ rate: string; gstPct: string; contractStatus: string } | null> {
    try {
      const rows = await apiFetch<RateContractRow[]>(
        `/api/rate-contracts?customerId=${customerId}&itemId=${itemId}`,
      );
      const asOf = quotationDate.getTime();
      const applicable =
        rows
          .map((r) => ({ ...r, eff: new Date(r.effectiveFrom).getTime() }))
          .filter((r) => Number.isFinite(r.eff) && r.eff <= asOf)
          .sort((a, b) => (b.eff !== a.eff ? b.eff - a.eff : b.id - a.id))[0] ?? null;
      if (!applicable) return null;
      return {
        rate: String(applicable.rate),
        gstPct: String(applicable.gstRate),
        contractStatus: applicable.status ?? "",
      };
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Could not load rate contract.");
    }
  }

  async function ensureNoQtyRates(lines: QuoteLineDraft[], customerId: number) {
    if (!customerId) return;
    setNoQtyRatesLoading(true);
    try {
      const next = [...lines];
      const missing: Record<number, boolean> = {};
      const statusMap: Record<number, string> = {};
      for (let i = 0; i < next.length; i++) {
        const ln = next[i];
        if (!ln?.itemId) continue;
        const rc = await resolveApplicableRate(customerId, ln.itemId);
        if (!rc) {
          missing[i] = true;
          continue;
        }
        next[i] = { ...ln, rate: rc.rate, gstPct: rc.gstPct, discountPct: "0", qty: "0", isFree: false };
        statusMap[i] = contractStatusLabel(rc.contractStatus);
      }
      setQuoteLines(next);
      setMissingRateIdx(missing);
      setNoQtyRcStatusByLine(statusMap);
    } finally {
      setNoQtyRatesLoading(false);
    }
  }

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
          const nextLines = sel.lines.map((l) => ({
            itemId: l.itemId,
            qty: String(l.qty),
            rate: "",
            discountPct: "0",
            gstPct: "18",
            isFree: false,
          }));
          setQuoteLines(nextLines);
          if ((sel.flowType ?? "REGULAR") === "NO_QTY") void ensureNoQtyRates(nextLines, sel.customer.id);
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
      const nextLines = sel.lines.map((l) => ({
        itemId: l.itemId,
        qty: String(l.qty),
        rate: "",
        discountPct: "0",
        gstPct: "18",
        isFree: false,
      }));
      setQuoteLines(nextLines);
      if ((sel.flowType ?? "REGULAR") === "NO_QTY") void ensureNoQtyRates(nextLines, sel.customer.id);
    }
  }, [createEnquiryId, feasibleEnquiries]);

  const gstSummary = React.useMemo(() => {
    const pcts = new Set<string>();
    for (const l of quoteLines) {
      const n = previewNum(l.gstPct);
      if (Number.isFinite(n)) pcts.add(String(n));
    }
    if (pcts.size === 0) return "—";
    if (pcts.size === 1) return `${[...pcts][0]}%`;
    return "Mixed";
  }, [quoteLines]);

  async function onCreateQuotation() {
    if (!createEnquiryId) return;
    setError(null);
    try {
      if (isNoQty) {
        const custId = selectedEnquiry?.customer?.id ?? 0;
        if (!custId) {
          const msg = "Customer is required to resolve Rate Contract for NO_QTY quotation.";
          setError(msg);
          toast.showError(msg);
          return;
        }

        const next = [...quoteLines];
        const missing: Record<number, boolean> = {};
        for (let i = 0; i < next.length; i++) {
          const ln = next[i];
          const rc = await resolveApplicableRate(custId, ln.itemId);
          if (!rc) {
            missing[i] = true;
            continue;
          }
          next[i] = { ...ln, rate: rc.rate, gstPct: rc.gstPct, discountPct: "0", qty: "0", isFree: false };
        }
        setMissingRateIdx(missing);
        setQuoteLines(next);

        if (Object.keys(missing).length) {
          const msg = "No approved rate contract found for selected customer/item as of quotation date.";
          setError(msg);
          toast.showError(msg);
          return;
        }
      }

      if (!isNoQty) {
        const v = validateQuoteLinesForSave(quoteLines);
        if (v) {
          setError(v);
          toast.showError(v);
          return;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not validate quotation";
      setError(msg);
      toast.showError(msg);
      return;
    }
    setCreating(true);
    try {
      await apiFetch("/api/quotations", {
        method: "POST",
        body: JSON.stringify({
          enquiryId: createEnquiryId,
          terms: isNoQty ? buildNoQtyTermsPayload(noQtyCommercial) : terms.trim() || undefined,
          lines: draftLinesToApiPayload(
            isNoQty
              ? quoteLines.map((l) => ({ ...l, qty: "0", discountPct: "0", isFree: false }))
              : quoteLines,
          ),
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
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {loadError}
        </div>
        <Link to="/quotations" className="erp-back-nav-chip">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to Quotations
        </Link>
      </div>
    );
  }

  if (!feasibleEnquiries.length) {
    return (
      <div className="flex flex-col gap-4 p-1">
        <Link to="/quotations" className="erp-back-nav-chip">
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

  const itemCount = selectedEnquiry?.lines?.length ?? quoteLines.length;
  const validationMessage = error
    ? error
    : isNoQty && !noQtyHasEnquiryLines
      ? "No enquiry lines — update the enquiry first."
      : isNoQty && noQtyRatesIncomplete
        ? "Complete rate contracts for every item before saving."
        : isNoQty && noQtyRatesLoading
          ? "Resolving rate contracts…"
          : null;
  const saveDisabled = creating || !createEnquiryId || noQtySaveBlocked;

  const rcLinked = isNoQty && noQtyHasEnquiryLines && !noQtyRatesIncomplete && !noQtyRatesLoading;

  return (
    <div className="flex min-h-[calc(100vh-8.5rem)] flex-col gap-2.5">
      {/* COMPACT TRANSACTION RIBBON */}
      <header className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to="/quotations" className="erp-back-nav-chip py-0.5 text-[12px]">
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Quotations
            </Link>
            <h1 className="text-base font-semibold tracking-tight text-slate-900">New Quotation</h1>
            <Badge
              variant={isNoQty ? "warning" : "info"}
              className="text-[10px] font-semibold uppercase tracking-wide"
            >
              {isNoQty ? NO_QTY_TERMS.AGREEMENT_LABEL : "REGULAR"}
            </Badge>
          </div>
          <CommercialWorkflowStrip
            active="quotation"
            className={commercialWorkflowStripDenseFramedClassName}
          />
        </div>

        {/* Transaction strip: scan-first context line */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 bg-slate-50/70 px-3 py-1.5 text-[12px] text-slate-700">
          <span>
            <span className="text-slate-500">Customer </span>
            <span className="font-semibold text-slate-900">
              {selectedEnquiry?.customer.name ?? "—"}
            </span>
          </span>
          <span className="text-slate-300">|</span>
          <span>
            <span className="text-slate-500">Enquiry </span>
            <span className="font-mono font-semibold text-slate-800">
              #{selectedEnquiry?.id ?? "—"}
            </span>
          </span>
          <span className="text-slate-300">|</span>
          <span>
            <span className="text-slate-500">Items </span>
            <span className="font-semibold text-slate-800">{itemCount}</span>
          </span>
          {isNoQty ? (
            <>
              <span className="text-slate-300">|</span>
              {noQtyRatesLoading ? (
                <span className="text-slate-500" aria-live="polite">
                  Resolving rates…
                </span>
              ) : noQtyRatesIncomplete ? (
                <Badge variant="warning" className="text-[10px]">
                  RC missing
                </Badge>
              ) : (
                <Badge variant="info" className="text-[10px]">
                  RC linked
                </Badge>
              )}
            </>
          ) : null}
          {feasibleEnquiries.length > 1 ? (
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-600">
              <span className="hidden sm:inline">Switch enquiry</span>
              <select
                className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[12px] text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
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
          ) : (
            <select
              className="hidden"
              data-testid="quotation-enquiry-select"
              value={createEnquiryId}
              onChange={(e) => setCreateEnquiryId(Number(e.target.value))}
              aria-hidden="true"
              tabIndex={-1}
            >
              {feasibleEnquiries.map((e) => (
                <option key={e.id} value={e.id}>
                  #{e.id} — {e.customer.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      {/* TWO-COLUMN WORKSPACE */}
      <div className="erp-workspace-2col min-h-0 flex-1">
        {/* LEFT: Items & rates workspace */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-3 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              Items &amp; rates
            </span>
            <span className="text-[11px] text-slate-500">
              {isNoQty ? "From enquiry · contract-linked · read-only" : `${quoteLines.length} line${quoteLines.length === 1 ? "" : "s"}`}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {isNoQty ? (
              <NoQtyItemsView
                lines={selectedEnquiry?.lines ?? []}
                drafts={quoteLines}
                missingRateIdx={missingRateIdx}
                statusByLine={noQtyRcStatusByLine}
                loading={noQtyRatesLoading}
              />
            ) : (
              <RegularItemsTable
                items={items}
                lines={quoteLines}
                setLines={setQuoteLines}
              />
            )}
          </div>

          <QuotationDraftSummaryCards
            isNoQty={isNoQty}
            itemCount={itemCount}
            rcLinked={rcLinked}
            rcLoading={noQtyRatesLoading}
            gstLabel={gstSummary}
          />

          {isNoQty ? (
            <div className="border-t border-amber-200/80 bg-amber-50/50 px-3 py-2 text-[11px] leading-snug text-amber-950">
              Quotation locks commercial framework. Quantities are planned later in Requirement Sheet cycles.
            </div>
          ) : null}

          {!isNoQty ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/80 px-3 py-1.5">
              <button
                type="button"
                className="text-[12px] font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-800"
                onClick={() => {
                  const firstItemId = items[0]?.id ?? 0;
                  setQuoteLines((p) => [...p, defaultQuoteLineDraft(firstItemId)]);
                }}
              >
                + Add item
              </button>
              <div className="text-[12px] font-semibold text-slate-800">
                Grand total{" "}
                <span className="ml-1 tabular-nums text-slate-900">
                  ₹{formatInrAmount(sumPreview)}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* RIGHT: Commercial terms + workflow + remarks + next action */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white px-3 py-1.5">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Operator Action
              </span>
              <span className="text-[12px] font-semibold text-slate-900">
                {isNoQty ? "Commercial framework" : "Commercial terms"}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-600">
              {isNoQty
                ? "Rate contract-linked · qty managed later"
                : "Set payment / delivery and review totals"}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3 space-y-3">
            {/* Workflow state */}
            <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[12px] text-slate-700">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Workflow status
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <Badge variant="warning" className="text-[10px]">
                  NEW
                </Badge>
                <span className="text-[11px] text-slate-600">
                  Will save as Draft. Approval happens on the Quotations workspace.
                </span>
              </div>
            </div>

            {/* Next action hero */}
            <div className="rounded-md border border-blue-200 bg-gradient-to-br from-blue-50 to-white px-3 py-2 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Next action
              </div>
              <div className="mt-0.5 text-[14px] font-semibold leading-snug text-blue-900">
                {isNoQty ? "Save quotation" : "Save quotation"}
              </div>
              <div className="text-[11px] leading-snug text-slate-600">
                {isNoQty
                  ? noQtyRatesIncomplete
                    ? "Complete rate contracts to enable save."
                    : "Quotation locks commercial framework. Quantities are planned later in Requirement Sheet cycles."
                  : "Save creates a Draft quotation, ready for approval and PDF."}
              </div>
            </div>

            {/* Commercial terms */}
            {isNoQty ? (
              <div className="rounded-md border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Commercial terms
                </div>
                <div className="grid gap-2 px-2.5 py-2 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Payment terms
                    </span>
                    <textarea
                      className={noQtyCommercialTextareaShort}
                      value={noQtyCommercial.paymentTerms}
                      onChange={(e) =>
                        setNoQtyCommercial((p) => ({ ...p, paymentTerms: e.target.value }))
                      }
                      placeholder="e.g. Net 30 days"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Delivery
                    </span>
                    <textarea
                      className={noQtyCommercialTextareaShort}
                      value={noQtyCommercial.deliveryNotes}
                      onChange={(e) =>
                        setNoQtyCommercial((p) => ({ ...p, deliveryNotes: e.target.value }))
                      }
                      placeholder="Delivery notes"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Quotation validity
                    </span>
                    <textarea
                      className={noQtyCommercialTextareaShort}
                      value={noQtyCommercial.quotationValidity}
                      onChange={(e) =>
                        setNoQtyCommercial((p) => ({ ...p, quotationValidity: e.target.value }))
                      }
                      placeholder="e.g. Valid 30 days"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Remarks
                    </span>
                    <textarea
                      className={noQtyCommercialTextareaShort}
                      value={noQtyCommercial.remarks}
                      onChange={(e) =>
                        setNoQtyCommercial((p) => ({ ...p, remarks: e.target.value }))
                      }
                      placeholder="Notes"
                    />
                  </label>
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Commercial conditions
                    </span>
                    <textarea
                      className={noQtyCommercialTextareaMedium}
                      value={noQtyCommercial.commercialConditions}
                      onChange={(e) =>
                        setNoQtyCommercial((p) => ({
                          ...p,
                          commercialConditions: e.target.value,
                        }))
                      }
                      placeholder="Incoterms, price basis, escalation…"
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Terms
                </div>
                <div className="px-2.5 py-2">
                  <Input
                    className="h-8 text-[13px]"
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    placeholder="Payment / delivery terms (optional)"
                  />
                  <p className="mt-1 text-[11px] leading-snug text-slate-500">
                    Stored on the quotation document. Detailed NO_QTY commercial terms appear automatically when applicable.
                  </p>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* STICKY ACTION FOOTER */}
      <footer className="sticky bottom-0 z-30 rounded-md border border-slate-200 bg-white shadow-lg">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {validationMessage ? (
              <span
                className={[
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px]",
                  error
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-amber-200 bg-amber-50 text-amber-900",
                ].join(" ")}
                role={error ? "alert" : undefined}
              >
                {error ? <X className="h-3.5 w-3.5" aria-hidden /> : null}
                <span className="truncate">{validationMessage}</span>
              </span>
            ) : (
              <span className="text-[12px] text-slate-500">
                {isNoQty
                  ? "Ready to save commercial framework"
                  : `Grand total ₹${formatInrAmount(sumPreview)}`}
              </span>
            )}
          </div>
          <Link
            to="/quotations"
            className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Cancel
          </Link>
          <Button
            type="button"
            data-testid="create-quotation-btn"
            size="sm"
            className="h-8 min-w-[8rem] text-[12px] font-semibold shadow-sm"
            onClick={() => void onCreateQuotation()}
            disabled={saveDisabled}
          >
            {creating ? "Saving…" : "Save quotation →"}
          </Button>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents (UI-only; no business-logic changes)
// ---------------------------------------------------------------------------

function NoQtyItemsView(props: {
  lines: { itemId: number; item: Item; qty: string }[];
  drafts: QuoteLineDraft[];
  missingRateIdx: Record<number, boolean>;
  statusByLine: Record<number, string>;
  loading: boolean;
}) {
  const { lines, drafts, missingRateIdx, statusByLine, loading } = props;
  if (!lines.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 py-10 text-center">
        <p className="text-[13px] text-amber-900">No enquiry lines — update the enquiry first.</p>
      </div>
    );
  }
  return (
    <table className="erp-table erp-table-dense w-full">
      <thead className="sticky top-0 z-10">
        <tr>
          <th>Item</th>
          <th className="w-[6rem] text-right">Rate</th>
          <th className="w-[4.5rem] text-right">GST</th>
          <th className="w-[7rem] text-right">RC status</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((ln, i) => {
          const draft = drafts[i];
          const missing = Boolean(missingRateIdx[i]);
          const rateOk = draft?.rate?.trim() !== "" && !missing;
          const gstTxt = draft?.gstPct?.trim() ?? "";
          const statusDisp = missing
            ? null
            : loading && !rateOk
              ? null
              : (statusByLine[i] ?? "—");
          return (
            <tr key={`${ln.itemId}-${i}`}>
              <td className="max-w-[14rem] truncate font-medium">{ln.item.itemName}</td>
              <td className="text-right tabular-nums">
                {missing ? (
                  <span className="text-amber-800">—</span>
                ) : loading && !rateOk ? (
                  <span className="text-slate-400">…</span>
                ) : (
                  <>₹{formatInrAmount(previewNum(draft?.rate ?? "0"))}</>
                )}
              </td>
              <td className="text-right tabular-nums">
                {missing ? "—" : loading && gstTxt === "" ? "…" : `${previewNum(gstTxt || "0")}%`}
              </td>
              <td className="text-right">
                {missing ? (
                  <span className="inline-flex rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                    Missing
                  </span>
                ) : loading && !rateOk ? (
                  <span className="text-slate-400">…</span>
                ) : (
                  <span className="text-[11px] font-medium text-slate-800">{statusDisp}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function QuotationDraftSummaryCards(props: {
  isNoQty: boolean;
  itemCount: number;
  rcLinked: boolean;
  rcLoading: boolean;
  gstLabel: string;
}) {
  const { isNoQty, itemCount, rcLinked, rcLoading, gstLabel } = props;
  return (
    <div className="erp-kpi-strip erp-kpi-strip--compact grid grid-cols-2 gap-px border-t border-slate-200 bg-slate-50/90 sm:grid-cols-4">
      <div className="erp-kpi-segment !border-0 !bg-transparent px-2.5 py-1.5">
        <span className="erp-kpi-label">Rate contract</span>
        <span className={cn("erp-kpi-value text-[12px]", rcLinked ? "text-emerald-800" : "text-amber-800")}>
          {isNoQty ? (rcLoading ? "…" : rcLinked ? "Linked" : "Missing") : "N/A"}
        </span>
      </div>
      <div className="erp-kpi-segment !border-0 !bg-transparent px-2.5 py-1.5">
        <span className="erp-kpi-label">Items</span>
        <span className="erp-kpi-value text-[12px]">{itemCount}</span>
      </div>
      <div className="erp-kpi-segment !border-0 !bg-transparent px-2.5 py-1.5">
        <span className="erp-kpi-label">GST</span>
        <span className="erp-kpi-value text-[12px]">{gstLabel}</span>
      </div>
      <div className="erp-kpi-segment !border-0 !bg-transparent px-2.5 py-1.5">
        <span className="erp-kpi-label">Rate source</span>
        <span className="erp-kpi-value text-[12px]">Approved Rate Contract</span>
      </div>
      {isNoQty ? (
        <div className="erp-kpi-segment col-span-2 !border-0 !bg-transparent px-2.5 py-1.5 sm:col-span-4">
          <span className="erp-kpi-label">Qty rule</span>
          <span className="erp-kpi-value-muted text-[11px] leading-snug">
            Managed later in Requirement Sheets
          </span>
        </div>
      ) : null}
    </div>
  );
}

function RegularItemsTable(props: {
  items: Item[];
  lines: QuoteLineDraft[];
  setLines: React.Dispatch<React.SetStateAction<QuoteLineDraft[]>>;
}) {
  const { items, lines, setLines } = props;
  return (
    <table className="erp-table erp-table-dense w-full table-fixed">
      <colgroup>
        <col style={{ width: "36%" }} />
        <col style={{ width: "13%" }} />
        <col style={{ width: "15%" }} />
        <col style={{ width: "11%" }} />
        <col style={{ width: "16%" }} />
        <col style={{ width: "9%" }} />
      </colgroup>
      <thead className="sticky top-0 z-10">
        <tr>
          <th>Item</th>
          <th className="text-right">Qty</th>
          <th className="text-right">Rate</th>
          <th className="text-right">GST</th>
          <th className="text-right">Amount</th>
          <th className="text-right">&nbsp;</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={`ql-${i}`} className="align-top">
            <td className="min-w-0">
              <select
                className="mb-1 h-8 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                value={l.itemId}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setLines((p) => p.map((x, j) => (j === i ? { ...x, itemId: v } : x)));
                }}
              >
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.itemName}
                  </option>
                ))}
              </select>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 shrink-0 rounded border-slate-300"
                  checked={l.isFree}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setLines((p) =>
                      p.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              isFree: checked,
                              rate: checked
                                ? "0"
                                : previewNum(x.rate) > 0
                                  ? x.rate
                                  : "1",
                            }
                          : x,
                      ),
                    );
                  }}
                />
                Free item
              </label>
            </td>
            <td>
              <Input
                className="h-8 w-full min-w-0 text-right tabular-nums text-[13px]"
                type="number"
                step="any"
                min={0}
                inputMode="decimal"
                value={l.qty}
                onChange={(e) => {
                  setLines((p) => p.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)));
                }}
              />
            </td>
            <td>
              <Input
                className="h-8 w-full min-w-0 text-right tabular-nums text-[13px]"
                type="number"
                step="any"
                min={0}
                inputMode="decimal"
                value={l.isFree ? "0" : l.rate}
                disabled={l.isFree}
                onChange={(e) => {
                  setLines((p) => p.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)));
                }}
              />
            </td>
            <td>
              <Input
                className="h-8 w-full min-w-0 text-right tabular-nums text-[13px]"
                type="number"
                step="any"
                inputMode="decimal"
                value={l.gstPct}
                onChange={(e) => {
                  setLines((p) => p.map((x, j) => (j === i ? { ...x, gstPct: e.target.value } : x)));
                }}
              />
            </td>
            <td className="text-right text-[13px] font-semibold tabular-nums text-slate-900">
              {lineTotalFromDraft(l, lineTotal).toFixed(2)}
            </td>
            <td className="text-right">
              {lines.length > 1 ? (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  aria-label="Remove line"
                  onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
