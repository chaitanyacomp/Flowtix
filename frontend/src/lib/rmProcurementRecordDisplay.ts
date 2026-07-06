import type { RmPoTracePayload } from "./rmPoDocumentTrace";
import { resolveRmPoFlowLinks, type ProcurementFlowLink } from "./procurementRelatedDocuments";
import { formatGrnNo, formatRmPoNo, poStatusLabel, type GrnRow, type RmPoRow } from "../pages/rmPurchase/rmPurchaseShared";

export { formatGrnNo };

export type ProcurementRecordFlowStep = {
  key: string;
  title: string;
  detail: string;
  complete: boolean;
  href?: string;
  links?: ProcurementFlowLink[];
};

export type ProcurementRecordSummary = {
  poNo: string;
  grnNos: string;
  grnDate: string;
  grnStatus: string;
  supplierName: string;
  stockPostedLabel: string;
  flowSteps: ProcurementRecordFlowStep[];
  grnLinks: ProcurementFlowLink[];
};

function activeGrns(po: RmPoRow): GrnRow[] {
  return po.grns.filter((g) => !g.reversedAt);
}

function formatProcurementRecordDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(d.getDate()).padStart(2, "0");
  return `${day}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function resolveGrnDate(po: RmPoRow, trace: RmPoTracePayload | null): string {
  const activeIds = new Set(activeGrns(po).map((g) => g.id));
  const traceDates =
    trace?.grns
      ?.filter((g) => !g.reversedAt && activeIds.has(g.id))
      .map((g) => g.date)
      .filter(Boolean) ?? [];
  if (traceDates.length) {
    return formatProcurementRecordDate(traceDates[traceDates.length - 1]!);
  }
  const grnWithDate = activeGrns(po).find((g) => (g as GrnRow & { date?: string }).date);
  const raw = grnWithDate ? (grnWithDate as GrnRow & { date?: string }).date : null;
  return raw ? formatProcurementRecordDate(raw) : "—";
}

function resolveGrnNos(po: RmPoRow, trace: RmPoTracePayload | null): string {
  const active = activeGrns(po);
  if (!active.length) return "—";
  const labels = active.map((g) => {
    const fromTrace = trace?.grns?.find((tg) => tg.id === g.id)?.displayNo?.trim();
    return fromTrace || formatGrnNo(g.id);
  });
  return [...new Set(labels)].join(", ");
}

/** Display summary for a completed / received RM procurement record (UX only). */
export function resolveProcurementRecordSummary(
  po: RmPoRow,
  trace: RmPoTracePayload | null,
  stockStatusLabel: string,
): ProcurementRecordSummary {
  const poNo = formatRmPoNo(po.id);
  const grnNos = resolveGrnNos(po, trace);
  const grnDate = resolveGrnDate(po, trace);
  const grnStatus = stockStatusLabel || poStatusLabel(po.status);
  const supplierName = (trace?.supplier?.name ?? po.supplier?.name ?? "—").trim() || "—";
  const stockPosted = po.status === "COMPLETED";
  const flowLinks = resolveRmPoFlowLinks(po, trace);

  return {
    poNo,
    grnNos,
    grnDate,
    grnStatus,
    supplierName,
    stockPostedLabel: stockPosted ? "Stock Posted" : "Stock Pending",
    grnLinks: flowLinks.grns,
    flowSteps: [
      { key: "po", title: "Purchase Order", detail: poNo, complete: true },
      {
        key: "grn",
        title: "Goods Receipt",
        detail: grnNos,
        complete: activeGrns(po).length > 0,
        links: flowLinks.grns,
      },
      { key: "stock", title: stockPosted ? "Stock Posted" : "Stock Pending", detail: "", complete: stockPosted },
    ],
  };
}
