import * as React from "react";
import { apiFetch } from "../../services/api";
import { displaySalesOrderNo } from "../../lib/docNoDisplay";
import { PROCUREMENT_TERMS } from "../../lib/procurementTerminology";

type MrSummary = {
  materialRequirementId: number;
  docNo: string | null;
  salesOrderId: number | null;
  salesOrderDocNo: string | null;
  primaryFgName: string | null;
  customerCommittedQty?: number | null;
  productionBufferPercent?: number | null;
  plannedProductionQty?: number | null;
  rmPlanningQty?: number | null;
  shortageRmLineCount: number;
  lines?: { itemName: string; shortageQty: number }[];
};

type WorkspaceResponse = {
  sections: { pendingMaterialRequirements: MrSummary[] };
};

type Props = {
  salesOrderId?: number;
  materialRequirementId?: number;
};

export function ProcurementQueueContextBanner({ salesOrderId, materialRequirementId }: Props) {
  const [loading, setLoading] = React.useState(false);
  const [mr, setMr] = React.useState<MrSummary | null>(null);

  React.useEffect(() => {
    if (!salesOrderId && !materialRequirementId) {
      setMr(null);
      return;
    }
    setLoading(true);
    const qs =
      salesOrderId && salesOrderId > 0
        ? `salesOrderId=${encodeURIComponent(String(salesOrderId))}`
        : "";
    apiFetch<WorkspaceResponse>(`/api/procurement-planning/workspace${qs ? `?${qs}` : ""}`)
      .then((data) => {
        const rows = data.sections?.pendingMaterialRequirements ?? [];
        const match =
          materialRequirementId && materialRequirementId > 0
            ? rows.find((r) => r.materialRequirementId === materialRequirementId)
            : rows[0];
        setMr(match ?? rows[0] ?? null);
      })
      .catch(() => setMr(null))
      .finally(() => setLoading(false));
  }, [salesOrderId, materialRequirementId]);

  if (!salesOrderId && !materialRequirementId) return null;

  const soLabel =
    mr?.salesOrderId && mr.salesOrderId > 0
      ? displaySalesOrderNo(mr.salesOrderId, mr.salesOrderDocNo)
      : salesOrderId && salesOrderId > 0
        ? displaySalesOrderNo(salesOrderId, null)
        : null;

  const rmWaiting =
    mr?.lines?.filter((l) => l.shortageQty > 0).map((l) => l.itemName).slice(0, 8) ?? [];

  return (
    <section className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2.5 shadow-sm">
      <p className="text-[15px] font-bold uppercase tracking-wide text-slate-950">
        🟠 {PROCUREMENT_TERMS.PROCUREMENT_REQUIRED_HEADLINE}
      </p>
      {loading ? (
        <p className="mt-1 text-xs text-slate-600">Loading procurement context…</p>
      ) : (
        <div className="mt-2 space-y-1 text-sm text-slate-800">
          {soLabel ? (
            <p className="font-semibold text-slate-950">
              {soLabel}
              {mr?.primaryFgName ? <span className="font-medium text-slate-700"> · {mr.primaryFgName}</span> : null}
            </p>
          ) : null}
          {mr?.customerCommittedQty != null && Number.isFinite(Number(mr.customerCommittedQty)) ? (
            <div className="grid gap-x-4 gap-y-0.5 text-[13px] sm:grid-cols-2">
              <p>
                <span className="text-slate-600">Customer Qty:</span>{" "}
                <span className="tabular-nums font-semibold text-slate-950">{mr.customerCommittedQty}</span>
              </p>
              {mr.productionBufferPercent != null ? (
                <p>
                  <span className="text-slate-600">FG Buffer:</span>{" "}
                  <span className="tabular-nums font-semibold text-slate-950">{mr.productionBufferPercent}%</span>
                </p>
              ) : null}
              {mr.plannedProductionQty != null ? (
                <p>
                  <span className="text-slate-600">Planned Qty:</span>{" "}
                  <span className="tabular-nums font-semibold text-slate-950">{mr.plannedProductionQty}</span>
                </p>
              ) : null}
              {mr.rmPlanningQty != null ? (
                <p className="sm:col-span-2">
                  <span className="text-slate-600">RM Planning Qty:</span>{" "}
                  <span className="tabular-nums font-semibold text-slate-950">{mr.rmPlanningQty}</span>
                </p>
              ) : null}
            </div>
          ) : null}
          {mr?.docNo ? (
            <p>
              <span className="font-semibold tabular-nums">{mr.docNo}</span>
              {mr.shortageRmLineCount > 0 ? (
                <span className="text-slate-700">
                  {" "}
                  · {mr.shortageRmLineCount} RM item{mr.shortageRmLineCount === 1 ? "" : "s"} pending
                </span>
              ) : null}
            </p>
          ) : null}
          {rmWaiting.length > 0 ? (
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">RM waiting</span>
              <ul className="mt-0.5 list-inside list-disc text-[13px]">
                {rmWaiting.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="grid gap-1 pt-1 sm:grid-cols-[auto_1fr] sm:gap-x-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Next owner</span>
            <span className="font-semibold text-slate-950">Purchase Department</span>
          </div>
        </div>
      )}
    </section>
  );
}
