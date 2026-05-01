import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { apiFetch } from "../services/api";
import { PageContainer } from "../components/PageHeader";
import { ArrowLeft } from "lucide-react";
import { displayRequirementSheetNo, displaySalesOrderNo } from "../lib/docNoDisplay";

type WoPrefill = {
  salesOrderId: number;
  lines: { fgItemId: number; qty: number }[];
};

type SheetLine = {
  itemId: number;
  itemName: string;
  requirementQty: string;
  availableStockQty?: number | null;
  gapPercent?: number | null;
  suggestedWoQty?: number | null;
  totalWoQty?: number | null;
  productionRequiredQty?: number | null;
};

type SheetDetail = {
  id: number;
  docNo?: string | null;
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  status: "DRAFT" | "LOCKED";
  periodKey?: string | null;
  version?: number | null;
  customerName?: string | null;
  lines: SheetLine[];
};

type SheetListRow = {
  id: number;
  periodKey?: string | null;
  version?: number | null;
  status: "DRAFT" | "LOCKED";
};

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function sheetVersionNum(v: number | null | undefined): number {
  const n = Number(v ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function WoPlanningFromRequirementPage() {
  const { id: sheetIdParam } = useParams<{ id: string }>();
  const sheetId = Number(sheetIdParam);
  const nav = useNavigate();

  const [sheet, setSheet] = React.useState<SheetDetail | null>(null);
  const [latestAllowed, setLatestAllowed] = React.useState<boolean | null>(null);
  const [plannerQtyByItemId, setPlannerQtyByItemId] = React.useState<Record<number, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!Number.isFinite(sheetId) || sheetId <= 0) {
      setError("Invalid requirement sheet.");
      return;
    }
    setError(null);
    apiFetch<SheetDetail>(`/api/requirement-sheets/${sheetId}`)
      .then((s) => {
        setSheet(s);
        const next: Record<number, string> = {};
        for (const l of s.lines || []) {
          const woQty = Number(l.totalWoQty ?? l.productionRequiredQty ?? l.suggestedWoQty ?? 0);
          if (Number.isFinite(woQty) && woQty > 0) next[l.itemId] = String(woQty);
        }
        setPlannerQtyByItemId(next);
        // Latest-version guard: allow WO planning only from latest version for same SO+period.
        void apiFetch<SheetListRow[]>(`/api/sales-orders/${s.salesOrderId}/requirement-sheets`)
          .then((list) => {
            const period = s.periodKey ?? null;
            const v = sheetVersionNum(s.version);
            const versions = (Array.isArray(list) ? list : [])
              .filter((x) => (x.periodKey ?? null) === period)
              .map((x) => sheetVersionNum(x.version));
            const maxV = versions.length ? Math.max(...versions) : v;
            setLatestAllowed(v >= maxV);
          })
          .catch(() => setLatestAllowed(null));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load."));
  }, [sheetId]);

  const positiveLines = (sheet?.lines || []).filter((l) => Number(l.totalWoQty ?? l.productionRequiredQty ?? l.suggestedWoQty ?? 0) > 0);
  const excessCount = (sheet?.lines || []).filter((l) => Number(l.gapPercent ?? 0) < 0).length;
  const canPlan = latestAllowed !== false;

  async function createWorkOrderPrefill() {
    if (!sheet) return;
    if (latestAllowed === false) {
      setError("Work Order planning is allowed only from the latest version for this period.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const prefill = await apiFetch<WoPrefill>(`/api/requirement-sheets/${sheet.id}/wo-prefill`);
      // Override quantities with planner edits (still keep only positive)
      const edited = prefill.lines
        .map((l) => {
          const raw = plannerQtyByItemId[l.fgItemId];
          const q = raw != null ? Number(raw) : l.qty;
          return { fgItemId: l.fgItemId, qty: q };
        })
        .filter((l) => Number.isFinite(l.qty) && l.qty > 0);
      nav("/work-orders", {
        state: {
          salesOrderId: prefill.salesOrderId,
          woLines: edited,
          fromRequirementSheet: true,
          requirementSheetId: sheet.id,
          // Backward/other banner flag (WorkOrdersPage supports both).
          source: "requirementSheet",
        },
        replace: false,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create WO plan.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageContainer>
      <div className="min-w-0 space-y-1">
        <Button type="button" variant="ghost" size="sm" className="mb-1 gap-1 px-0 text-slate-600" onClick={() => nav(-1)}>
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Back
        </Button>
        <h1 className="text-lg font-semibold leading-snug text-slate-900">WO planning</h1>
        <p className="text-sm leading-relaxed text-slate-600">
          Requirement sheet {sheet ? displayRequirementSheetNo(sheet.id, sheet.docNo) : `#${sheetId}`}
          {sheet?.periodKey ? ` · ${sheet.periodKey}` : ""} {sheet ? `· v${String(sheet.version ?? 1)}` : ""}
        </p>
      </div>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
      {latestAllowed === false ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Older version (view only). Work Order planning is allowed only from the latest version for this period.
        </div>
      ) : null}

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Review & create work order</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sheet ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={sheet.status === "LOCKED" ? "success" : "warning"}>{sheet.status === "LOCKED" ? "Locked" : "Draft"}</Badge>
              <span className="inline-flex items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-600">SO No</span>
                <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-sky-900">
                  {displaySalesOrderNo(sheet.salesOrderId, sheet.salesOrderDocNo)}
                </span>
              </span>
            </div>
          ) : null}
          {excessCount > 0 ? (
            <div className="text-xs text-slate-600">
              Items with <span className="font-medium text-sky-800">excess stock</span> are excluded from work order planning.
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[920px] border-collapse text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr className="text-left text-xs font-medium uppercase text-slate-500">
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2 text-right">Requirement</th>
                  <th className="px-4 py-2 text-right">Stock</th>
                  <th className="px-4 py-2 text-right">Gap %</th>
                  <th className="px-4 py-2 text-right">Suggested WO</th>
                  <th className="px-4 py-2 text-right">Planner qty</th>
                </tr>
              </thead>
              <tbody>
                {positiveLines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-600">
                      No positive WO suggestion lines available.
                    </td>
                  </tr>
                ) : (
                  positiveLines.map((l) => (
                    <tr key={l.itemId} className="border-b border-slate-100">
                      <td className="px-4 py-2 font-medium text-slate-900">{l.itemName}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{l.requirementQty}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{l.availableStockQty ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtPct(l.gapPercent)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{l.suggestedWoQty ?? "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <Input
                          className="h-9 w-28 text-right tabular-nums"
                          value={
                            plannerQtyByItemId[l.itemId] ??
                            String(l.totalWoQty ?? l.productionRequiredQty ?? l.suggestedWoQty ?? "")
                          }
                          onChange={(e) => setPlannerQtyByItemId((p) => ({ ...p, [l.itemId]: e.target.value }))}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => nav(-1)} disabled={busy}>
              Back
            </Button>
            <Button
              type="button"
              onClick={() => void createWorkOrderPrefill()}
              disabled={!sheet || busy || positiveLines.length === 0 || !canPlan}
            >
              {busy ? "Working…" : "Create WO plan"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

