import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { cn } from "../lib/utils";

type SoRow = {
  id: number;
  docNo?: string | null;
  poId: number | null;
  orderType?: "NORMAL" | "REPLACEMENT" | "NO_QTY";
  lines: { id: number; itemId: number; qty: string; item: { itemName: string; itemType: string } }[];
};

type SoDetailLine = {
  id: number;
  itemId: number;
  qty: string;
  isFree?: boolean;
  quotationLine?: { rate: string; isFree: boolean } | null;
  item: { itemName: string };
};

type SoDetail = {
  id: number;
  docNo?: string | null;
  customerPoReference?: string | null;
  quotation?: { id: number; quotationNo: string | null } | null;
  lines: SoDetailLine[];
};

type RmRow = {
  rmItemId: number;
  itemName: string;
  requiredQty: number;
  availableQty: number;
  shortage: number;
  enough: boolean;
};

type FgRow = {
  lineId: number;
  fgItemId: number;
  fgName: string;
  orderQty: number;
  fgStock: number;
  toProduce: number;
  note?: string;
};

type RmCheckResponse = {
  fgLines: FgRow[];
  rmSummary: RmRow[];
  allRmEnough: boolean;
  allFgEnough: boolean;
  strictInventoryControl?: boolean;
  proceedAllowed?: boolean;
  blockMessage?: string | null;
};

type BomRowLite = { id: number; fgItemId: number };

function fgRowTone(f: FgRow): string {
  if (f.note) return "bg-slate-50";
  if (f.toProduce <= 0) return "bg-emerald-50/80";
  return "bg-amber-50/80";
}

const RM_CHECK_STRICT_STOCK_MSG =
  "Strict Inventory Control is ON. Resolve shortage through proper stock process (RM Purchase: PO → goods receipt).";

export function RmCheckPage() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const isAdmin = useIsAdmin();
  const focusedSoIdFromUrl = Number(searchParams.get("soId")) || 0;
  const [orders, setOrders] = React.useState<SoRow[]>([]);
  const [soId, setSoId] = React.useState(0);
  const [data, setData] = React.useState<RmCheckResponse | null>(null);
  const [soDetail, setSoDetail] = React.useState<SoDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [strictInventory, setStrictInventory] = React.useState(false);
  const [bomFgIds, setBomFgIds] = React.useState<Set<number>>(() => new Set());
  const [planQtyByLineId, setPlanQtyByLineId] = React.useState<Record<number, string>>({});
  const didAutoRunRef = React.useRef(false);
  const [allowSoChange, setAllowSoChange] = React.useState(false);

  React.useEffect(() => {
    const fromUrl = Number(searchParams.get("soId"));
    apiFetch<SoRow[]>("/api/sales-orders")
      .then((r) => {
        // CRITICAL: this page is for Regular SO production planning only.
        // Keep NO_QTY flow completely isolated by hiding NO_QTY orders in this selector.
        const regularOnly = (Array.isArray(r) ? r : []).filter((o) => (o.orderType ?? "NORMAL") === "NORMAL");
        setOrders(regularOnly);
        setSoId((cur) => {
          if (fromUrl && regularOnly.some((o) => o.id === fromUrl)) return fromUrl;
          return cur === 0 && regularOnly.length ? regularOnly[0].id : cur;
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [searchParams]);

  React.useEffect(() => {
    // Reset focus-lock when navigation context changes.
    setAllowSoChange(false);
  }, [focusedSoIdFromUrl]);

  React.useEffect(() => {
    apiFetch<{ strictInventoryControl: boolean }>("/api/settings/inventory-mode")
      .then((r) => setStrictInventory(!!r.strictInventoryControl))
      .catch(() => setStrictInventory(false));
  }, []);

  async function runCheck() {
    if (!soId) return;
    setError(null);
    setLoading(true);
    try {
      const [res, so] = await Promise.all([
        apiFetch<RmCheckResponse>(`/api/sales-orders/${soId}/rm-check`),
        apiFetch<SoDetail>(`/api/sales-orders/${soId}`),
      ]);
      setData(res);
      setSoDetail(so);

      // BOM presence is checked via existing BOM list API (UI-only; RM calc stays backend-owned).
      const boms = await apiFetch<BomRowLite[]>("/api/boms");
      const fgWithBom = new Set((Array.isArray(boms) ? boms : []).map((b) => Number(b.fgItemId)).filter((n) => Number.isFinite(n)));
      setBomFgIds(fgWithBom);

      // Initialize plan qty defaults from recommended production (toProduce).
      const defaults: Record<number, string> = {};
      for (const f of res.fgLines || []) {
        defaults[f.lineId] = String(Math.max(0, Number(f.toProduce) || 0));
      }
      setPlanQtyByLineId(defaults);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setData(null);
      setSoDetail(null);
      setBomFgIds(new Set());
      setPlanQtyByLineId({});
    } finally {
      setLoading(false);
    }
  }

  // Auto-load when navigated with a selected Regular SO (soId in URL).
  React.useEffect(() => {
    const fromUrl = Number(searchParams.get("soId"));
    if (!fromUrl || !soId) return;
    if (Number(fromUrl) !== Number(soId)) return;
    if (didAutoRunRef.current) return;
    // Only auto-run for Regular SOs (selector is already filtered, but keep this guard explicit).
    const sel = orders.find((o) => Number(o.id) === Number(soId));
    if (!sel || (sel.orderType ?? "NORMAL") !== "NORMAL") return;
    didAutoRunRef.current = true;
    runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, soId, searchParams]);

  const strict = Boolean(data?.strictInventoryControl);
  const blockMsg = data?.blockMessage;

  const bomMissingExists = React.useMemo(() => {
    if (!data) return false;
    return (data.fgLines || []).some((f) => !f.note && f.toProduce > 0 && !bomFgIds.has(f.fgItemId));
  }, [data, bomFgIds]);

  function createWorkOrder() {
    if (!data || !soId) return;
    const lines = data.fgLines
      .filter((f) => f.toProduce > 0 && !f.note)
      .map((f) => {
        const raw = planQtyByLineId[f.lineId];
        const qty = Math.max(0, Number(raw));
        return { fgItemId: f.fgItemId, qty: Number.isFinite(qty) ? qty : 0 };
      })
      .filter((x) => x.qty > 0);
    if (!lines.length) {
      setError("Nothing to manufacture (FG stock covers order or missing BOM).");
      return;
    }
    nav("/work-orders", { state: { source: "rmCheck", salesOrderId: soId, woLines: lines } });
  }

  function createRmPo() {
    if (!soId) {
      nav("/rm-po-grn");
      return;
    }
    const so = orders.find((o) => Number(o.id) === Number(soId));
    const q = new URLSearchParams();
    q.set("source", "wo_rm_shortage");
    q.set("salesOrderId", String(soId));
    if (so?.docNo) q.set("salesOrderDocNo", String(so.docNo));
    // Preserve guided continuation after GRN: return to rm-check with nextStep hint.
    q.set("returnTo", `/rm-check?soId=${encodeURIComponent(String(soId))}&nextStep=resume-work-order`);
    q.set("nextStep", "resume-work-order");
    nav(`/rm-po-grn?${q.toString()}`);
  }

  function adjustStock() {
    if (strictInventory) return;
    nav("/stock/adjustment");
  }

  const hasRmDemand = Boolean(data && data.rmSummary && data.rmSummary.length > 0);
  const hasRmShortage = Boolean(data && (data.rmSummary || []).some((rm) => Number(rm.shortage) > 0));
  const nextStepHint = (searchParams.get("nextStep") ?? "").trim();
  const canStartWo =
    data &&
    data.fgLines.some((f) => {
      if (!(f.toProduce > 0 && !f.note)) return false;
      const qty = Math.max(0, Number(planQtyByLineId[f.lineId]));
      return Number.isFinite(qty) && qty > 0;
    });

  const autoLoadSelected = Boolean(Number(searchParams.get("soId")) && soId);
  const selectionMissing = !soId;
  const woCreateDisabled = !canStartWo || loading || Boolean(blockMsg && strict) || Boolean(data && !data.allRmEnough);

  const rateByFgItemId = React.useMemo(() => {
    const m = new Map<number, number>();
    for (const ln of soDetail?.lines ?? []) {
      const itemId = Number(ln.itemId);
      if (!Number.isFinite(itemId) || itemId <= 0) continue;
      const ql = ln.quotationLine ?? null;
      const isFree = Boolean(ql?.isFree ?? ln.isFree);
      const rate = isFree ? 0 : Number(ql?.rate ?? 0);
      if (!Number.isFinite(rate) || rate < 0) continue;
      // Prefer first match; quotation-based SOs should be 1:1 with FG items.
      if (!m.has(itemId)) m.set(itemId, rate);
    }
    return m;
  }, [soDetail]);

  return (
    <div className="grid gap-2">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-1 pt-3">
          <CardTitle className="text-base">Production planning</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 pt-0">
          <p className="text-sm text-slate-600">Select a sales order, load planning, then use the sections below.</p>
          {error ? <div className="text-sm text-red-700">{error}</div> : null}
          {bomMissingExists ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Some items do not have BOM. RM requirement may be incomplete.
            </div>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm">
              <span className="text-slate-600">Sales order</span>
              {focusedSoIdFromUrl > 0 && !allowSoChange ? (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex h-10 min-w-[200px] items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-900">
                    SO #{soId}
                  </div>
                  <button
                    type="button"
                    className="text-sm font-medium text-primary underline underline-offset-2"
                    onClick={() => setAllowSoChange(true)}
                    title="Change sales order"
                  >
                    Change SO
                  </button>
                </div>
              ) : (
                <select
                  className="h-10 min-w-[200px] rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={soId || ""}
                  onChange={(e) => {
                    didAutoRunRef.current = false;
                    setSoId(Number(e.target.value));
                    setData(null);
                  }}
                >
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      SO #{o.id}
                      {o.poId != null ? ` (PO #${o.poId})` : ""}
                    </option>
                  ))}
                </select>
              )}
            </label>
            {selectionMissing ? (
              <div className="text-sm text-slate-600">Select a sales order to view production planning.</div>
            ) : !autoLoadSelected ? (
              <Button type="button" onClick={runCheck} disabled={loading || !soId}>
                {loading ? "Loading…" : "Load planning"}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {data ? (
        <Card>
          <CardHeader className="py-2 pb-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Production requirement
              {data.allFgEnough ? (
                <Badge variant="success">FG OK</Badge>
              ) : (
                <Badge variant="warning">FG gap</Badge>
              )}
            </CardTitle>
            <p className="text-xs text-slate-500">Finished goods — order qty, stock, and quantity to manufacture.</p>
          </CardHeader>
          <CardContent className="pt-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-600">
                  <th className="py-1.5">FG</th>
                  <th className="py-1.5">Order qty</th>
                  <th className="py-1.5">Rate</th>
                  <th className="py-1.5">Order value</th>
                  <th className="py-1.5">FG stock</th>
                  <th className="py-1.5">To produce</th>
                  <th className="py-1.5">Recommended production</th>
                  <th className="py-1.5">Plan qty</th>
                </tr>
              </thead>
              <tbody>
                {data.fgLines.map((f) => (
                  <tr
                    key={f.lineId}
                    className={cn(
                      "border-b",
                      fgRowTone(f),
                      !f.note && f.toProduce > 0 && !bomFgIds.has(f.fgItemId) ? "bg-red-50/60" : "",
                    )}
                  >
                    <td className="py-1.5">{f.fgName}</td>
                    <td className="py-1.5">{f.orderQty}</td>
                    <td className="py-1.5 tabular-nums">{(rateByFgItemId.get(f.fgItemId) ?? 0).toFixed(2)}</td>
                    <td className="py-1.5 tabular-nums">
                      {((rateByFgItemId.get(f.fgItemId) ?? 0) * (Number(f.orderQty) || 0)).toFixed(2)}
                    </td>
                    <td className="py-1.5">{f.fgStock}</td>
                    <td className="py-1.5">
                      {f.note ? (
                        <span className="text-amber-700">{f.note}</span>
                      ) : f.toProduce <= 0 ? (
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums text-slate-700">0</span>
                          <span className="text-xs font-medium text-emerald-700">Stock available</span>
                        </div>
                      ) : (
                        <span className="tabular-nums">{f.toProduce}</span>
                      )}
                    </td>
                    <td className="py-1.5">
                      {f.note ? (
                        <span className="text-slate-500">—</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{f.toProduce}</span>
                          {!bomFgIds.has(f.fgItemId) && f.toProduce > 0 ? (
                            <Badge variant="warning">BOM missing</Badge>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5">
                      {f.note ? (
                        <span className="text-slate-500">—</span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          step="1"
                          className="h-9 w-[120px] rounded-md border border-slate-200 bg-white px-2 text-sm tabular-nums"
                          value={planQtyByLineId[f.lineId] ?? ""}
                          onChange={(e) =>
                            setPlanQtyByLineId((prev) => ({ ...prev, [f.lineId]: e.target.value }))
                          }
                          disabled={f.toProduce <= 0}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!canStartWo ? (
              <p className="mt-1.5 text-xs text-slate-500">Enter Plan qty for at least one FG line to enable “Create work order”.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {data ? (
        <Card>
          <CardHeader className="py-2 pb-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Raw material status
              {data.allRmEnough ? (
                <Badge variant="success">RM OK</Badge>
              ) : (
                <Badge variant="rejected">Shortage</Badge>
              )}
            </CardTitle>
            <p className="text-xs text-slate-500">Raw materials required for the planned FG production.</p>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {bomMissingExists ? (
              <p className="text-sm text-slate-600">RM requirement excludes items without BOM.</p>
            ) : null}

            {!hasRmDemand ? (
              <p className="text-sm text-slate-600">No RM demand (no manufacturing gap or no BOM on FG lines).</p>
            ) : !data.allRmEnough ? (
              <div className="space-y-2">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">
                  RM shortage — create an RM Purchase or add stock, then refresh planning.
                </div>
                {strict && blockMsg && !data.allRmEnough ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{blockMsg}</div>
                ) : !strict ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    RM shortage — review quantities. Strict inventory is off; resolve stock or continue after review.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-950">
                RM OK — required quantities are covered for listed materials.
              </div>
            )}

            {hasRmDemand ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-600">
                    <th className="py-1.5">RM</th>
                    <th className="py-1.5">Required</th>
                    <th className="py-1.5">Available</th>
                    <th className="py-1.5">Shortage</th>
                    <th className="py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rmSummary.map((r) => (
                    <tr key={r.rmItemId} className="border-b">
                      <td className="py-1.5 font-medium">{r.itemName}</td>
                      <td className="py-1.5">{r.requiredQty}</td>
                      <td className="py-1.5">{r.availableQty}</td>
                      <td className="py-1.5">{r.shortage}</td>
                      <td className="py-1.5">
                        {r.enough ? (
                          <span className="text-emerald-700">OK</span>
                        ) : (
                          <span className="text-red-700">Issue</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {isAdmin && hasRmDemand ? (
              <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <summary className="cursor-pointer text-sm font-semibold text-slate-800">Admin debug (RM calc)</summary>
                <div className="mt-2 text-xs text-slate-700">
                  <div className="font-medium">Source: Usable stock balance</div>
                  <div className="mt-1 overflow-x-auto">
                    <table className="min-w-[520px] text-xs">
                      <thead>
                        <tr className="border-b text-left text-slate-600">
                          <th className="py-1 pr-3">RM</th>
                          <th className="py-1 pr-3">requiredQty</th>
                          <th className="py-1 pr-3">availableFromStockTransactions</th>
                          <th className="py-1 pr-3">shortageQty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.rmSummary || []).map((r) => (
                          <tr key={`dbg-${r.rmItemId}`} className="border-b">
                            <td className="py-1 pr-3 font-medium">{r.itemName}</td>
                            <td className="py-1 pr-3 tabular-nums">{r.requiredQty}</td>
                            <td className="py-1 pr-3 tabular-nums">{r.availableQty}</td>
                            <td className="py-1 pr-3 tabular-nums">{r.shortage}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            ) : null}
            {!data.allRmEnough ? (
              <p className="text-xs text-amber-800">
                {strictInventory
                  ? "Create an RM PO and post the goods receipt in RM Purchase, then refresh this view before opening a work order."
                  : "Create an RM PO or adjust stock, then refresh this view before opening a work order."}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {data ? (
        <Card className="border-sky-200/90 bg-gradient-to-b from-sky-50/50 to-white shadow-md ring-1 ring-sky-100/80">
          <CardHeader className="py-2 pb-1">
            <CardTitle className="text-base">Next step</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {blockMsg && strict ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{blockMsg}</div>
            ) : null}

            {!data.allRmEnough ? (
              <>
                <p className="text-lg font-bold tracking-tight text-slate-900">Next Step: Resolve RM shortage</p>
                <p className="text-sm text-slate-600">Resolve RM shortage first, then refresh planning to continue.</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="next-resolve-rm-btn"
                    onClick={createRmPo}
                    disabled={!hasRmDemand || !hasRmShortage}
                  >
                    Create RM PO
                  </Button>
                  {isAdmin ? (
                    strictInventory ? (
                      <p className="max-w-xl self-center text-sm text-slate-700">
                        {RM_CHECK_STRICT_STOCK_MSG}{" "}
                        <Link to="/rm-po-grn" className="font-medium text-primary underline">
                          Open RM Purchase
                        </Link>
                      </p>
                    ) : (
                      <Button type="button" variant="ghost" data-testid="next-resolve-rm-btn" onClick={adjustStock} className="text-slate-700">
                        Admin: Stock Adjustment
                      </Button>
                    )
                  ) : null}
                </div>
              </>
            ) : nextStepHint === "resume-work-order" && !data.allFgEnough && data.allRmEnough ? (
              <>
                <p className="text-lg font-bold tracking-tight text-slate-900">Next Step: Resume Work Order</p>
                <p className="text-sm text-slate-600">RM is now sufficient. Continue Work Order planning.</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    size="lg"
                    className="h-11 min-w-[12rem] px-6 text-base font-semibold shadow-sm"
                    data-testid="next-resume-wo-btn"
                    onClick={() => nav(`/work-orders?salesOrderId=${encodeURIComponent(String(soId))}`)}
                    disabled={!canStartWo || loading}
                    title={!canStartWo ? "Enter Plan qty for at least one FG line" : undefined}
                  >
                    Continue Work Order
                  </Button>
                </div>
              </>
            ) : !data.allFgEnough && data.allRmEnough ? (
              <>
                <p className="text-lg font-bold tracking-tight text-slate-900">Next Step: Create Work Order</p>
                <p className="text-sm text-slate-600">RM is sufficient for planned quantities. Create the Work Order.</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    type="button"
                    size="lg"
                    className="h-11 min-w-[12rem] px-6 text-base font-semibold shadow-sm"
                    onClick={createWorkOrder}
                    data-testid="next-create-wo-btn"
                    disabled={woCreateDisabled}
                    title={!data.allRmEnough ? "Resolve RM shortage first" : !canStartWo ? "Enter Plan qty for at least one FG line" : undefined}
                  >
                    Create Work Order
                  </Button>
                  {!canStartWo ? (
                    <p className="text-xs text-slate-500">Enter Plan qty for at least one FG line with production required.</p>
                  ) : null}
                </div>
              </>
            ) : data.allFgEnough && data.allRmEnough ? (
              <>
                <p className="text-lg font-bold tracking-tight text-slate-900">No Work Order needed</p>
                <p className="text-sm text-slate-600">FG stock covers the order — no manufacturing gap on this plan.</p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold tracking-tight text-slate-900">Next Step: Review planning</p>
                <p className="text-sm text-slate-600">Confirm FG and RM sections above.</p>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
