import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch } from "../services/api";
import { PageContainer, PageSmartBackLink, StickyWorkspaceHead } from "../components/PageHeader";
import { withReportsReturnContextIfPresent } from "../lib/drillDownRoutes";

type Supplier = { id: number; name: string };
type EligibleLine = {
  grnLineId: number;
  rmPoLineId: number;
  itemId: number;
  itemName: string;
  receivedQty: number;
  alreadyBilledQty: number;
  remainingQty: number;
  rateSnapshot: string | number;
};
type EligibleGrn = { id: number; date: string; rmPoId: number | null; lines: EligibleLine[] };
type DraftResp = { bill: { id: number }; warnings?: string[] };

type PurchaseMeta = { testingModeRelaxedTaxFields: boolean };

function formatIsoDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

export function PurchaseBillNewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = React.useState<string>("");
  const [billNo, setBillNo] = React.useState("");
  const [billDate, setBillDate] = React.useState("");
  const [remarks, setRemarks] = React.useState("");
  const [eligible, setEligible] = React.useState<EligibleGrn[]>([]);
  const [qtyByGrnLineId, setQtyByGrnLineId] = React.useState<Record<number, number>>({});
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [purchaseMeta, setPurchaseMeta] = React.useState<PurchaseMeta | null>(null);
  const relaxedTax = Boolean(purchaseMeta?.testingModeRelaxedTaxFields);
  const qtyRefs = React.useRef<Array<HTMLInputElement | null>>([]);
  const didFocusFirstQty = React.useRef(false);

  React.useEffect(() => {
    apiFetch<Supplier[]>("/api/suppliers").then(setSuppliers).catch(() => {});
    apiFetch<PurchaseMeta>("/api/purchase/meta").then(setPurchaseMeta).catch(() => setPurchaseMeta({ testingModeRelaxedTaxFields: false }));
  }, []);

  React.useEffect(() => {
    if (!supplierId) {
      setEligible([]);
      setQtyByGrnLineId({});
      didFocusFirstQty.current = false;
      return;
    }
    setLoadError(null);
    apiFetch<EligibleGrn[]>(`/api/purchase-bills/eligible-grn-lines?supplierId=${encodeURIComponent(supplierId)}`)
      .then((rows) => {
        setEligible(Array.isArray(rows) ? rows : []);
        const next: Record<number, number> = {};
        for (const g of rows || []) for (const ln of g.lines || []) next[ln.grnLineId] = Number(ln.remainingQty);
        setQtyByGrnLineId(next);
        didFocusFirstQty.current = false;
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load eligible GRN lines."));
  }, [supplierId]);

  const selectedLines = React.useMemo(() => {
    const out: { grnLineId: number; qty: number }[] = [];
    for (const [k, v] of Object.entries(qtyByGrnLineId)) {
      const id = Number(k);
      const qty = Number(v);
      if (Number.isFinite(id) && Number.isFinite(qty) && qty > 0) out.push({ grnLineId: id, qty });
    }
    return out;
  }, [qtyByGrnLineId]);

  const flatEligibleLines = React.useMemo(() => {
    const out: Array<
      EligibleLine & { grnId: number; grnDate: string; rmPoId: number | null }
    > = [];
    for (const g of eligible || []) {
      for (const ln of g.lines || []) {
        out.push({ ...ln, grnId: g.id, grnDate: g.date, rmPoId: g.rmPoId ?? null });
      }
    }
    return out;
  }, [eligible]);

  React.useEffect(() => {
    qtyRefs.current = qtyRefs.current.slice(0, flatEligibleLines.length);
    if (didFocusFirstQty.current) return;
    if (!supplierId) return;
    if (flatEligibleLines.length === 0) return;
    const t = window.setTimeout(() => {
      qtyRefs.current[0]?.focus();
      didFocusFirstQty.current = true;
    }, 50);
    return () => window.clearTimeout(t);
  }, [flatEligibleLines.length, supplierId]);

  function onQtyKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    const next = e.shiftKey ? Math.max(0, i - 1) : Math.min(flatEligibleLines.length - 1, i + 1);
    qtyRefs.current[next]?.focus();
  }

  async function onCreateDraft() {
    if (!supplierId || selectedLines.length === 0) return;
    setBusy(true);
    setLoadError(null);
    try {
      const out = await apiFetch<DraftResp>("/api/purchase-bills/draft-from-selection", {
        method: "POST",
        body: JSON.stringify({
          supplierId: Number(supplierId),
          billNo: billNo.trim() || null,
          billDate: billDate.trim() || null,
          remarks: remarks.trim() || null,
          selections: selectedLines,
        }),
      });
      navigate(withReportsReturnContextIfPresent(`/purchase-bills/${out.bill.id}`, location.search), {
        replace: true,
        state: { pbWarnings: out.warnings ?? [] },
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not start the bill.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageContainer>
      <StickyWorkspaceHead lead={<PageSmartBackLink defaultTo="/purchase-bills" defaultLabel="Back to purchase bills" />}>
        <div className="min-w-0 space-y-1">
          <h1 className="text-lg font-semibold leading-snug text-slate-900">New purchase bill</h1>
          <p className="text-sm leading-relaxed text-slate-600">Create supplier invoice from eligible GRN quantities (unbilled remaining).</p>
        </div>
      </StickyWorkspaceHead>

      {relaxedTax ? (
        <div className="rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-950">
          Testing mode (TESTING_MODE_RELAXED_TAX_FIELDS): missing HSN/GST/unit may use temporary fallbacks with warnings.
        </div>
      ) : null}

      {loadError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div>
      ) : null}

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Bill details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-slate-600">Supplier</span>
            <select
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">Select supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-slate-600">Supplier bill no</span>
            <Input className="h-10" value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="Required to finalize later" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-slate-600">Supplier bill date</span>
            <Input className="h-10" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="text-slate-600">Remarks</span>
            <Input className="h-10" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
          </label>
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Eligible GRN lines</CardTitle>
          <p className="text-xs text-slate-600">Enter quantity to bill per line (max = remaining).</p>
        </CardHeader>
        <CardContent className="min-w-0 space-y-3">
          {!supplierId ? <p className="text-sm text-slate-600">Select a supplier to see what can be billed.</p> : null}
          {supplierId && eligible.length === 0 ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3">
              <div className="text-base font-semibold text-emerald-950">✔ All received quantities are already billed</div>
              <div className="mt-1 text-sm text-emerald-900">No pending items available for billing.</div>
            </div>
          ) : null}
          {supplierId && flatEligibleLines.length > 0 ? (
            <div className="space-y-2">
              {flatEligibleLines.map((ln, i) => (
                <div key={ln.grnLineId} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px] sm:items-start">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900">{ln.itemName}</div>
                      <div className="mt-1 text-xs text-slate-600">
                        GRN: <span className="font-medium">GRN-{ln.grnId}</span>{" "}
                        <span className="text-slate-400">|</span> Date: {formatIsoDate(ln.grnDate)}
                        {ln.rmPoId != null ? (
                          <>
                            {" "}
                            <span className="text-slate-400">|</span> RMPO-{ln.rmPoId}
                          </>
                        ) : null}{" "}
                        <span className="text-slate-400">|</span> Rate: <span className="tabular-nums">{String(ln.rateSnapshot ?? "—")}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        Received: <span className="tabular-nums">{ln.receivedQty}</span> <span className="text-slate-400">|</span> Billed:{" "}
                        <span className="tabular-nums">{ln.alreadyBilledQty}</span> <span className="text-slate-400">|</span> Remaining:{" "}
                        <span className="tabular-nums font-medium text-amber-800">{ln.remainingQty}</span>{" "}
                        <span className="text-slate-500">
                          (Received {ln.receivedQty} − Finalized billed {ln.alreadyBilledQty})
                        </span>
                      </div>
                    </div>

                    <label className="grid gap-1 text-xs font-medium text-slate-600">
                      Bill qty
                      <Input
                        ref={(el) => {
                          qtyRefs.current[i] = el;
                        }}
                        type="number"
                        className="h-9 w-full"
                        min={0}
                        step="any"
                        value={Number.isFinite(qtyByGrnLineId[ln.grnLineId]) ? String(qtyByGrnLineId[ln.grnLineId]) : ""}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => onQtyKeyDown(i, e)}
                        onChange={(e) => {
                          const raw = (e.target as HTMLInputElement).value;
                          const v = raw.trim() === "" ? Number.NaN : Number(raw);
                          const safe = Number.isFinite(v) ? Math.max(0, Math.min(ln.remainingQty, v)) : Number.NaN;
                          setQtyByGrnLineId((prev) => ({ ...prev, [ln.grnLineId]: safe }));
                        }}
                      />
                      <div className="text-[11px] font-normal text-slate-500">Enter bill quantity</div>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={!supplierId || selectedLines.length === 0 || busy} onClick={() => void onCreateDraft()}>
              {busy ? "Working…" : "Create draft bill"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
