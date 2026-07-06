import { buildGrnDetailHref } from "./grnDocumentActions";
import type { GrnDocumentPayload } from "./grnDocument";
import type { RmPoTracePayload } from "./rmPoDocumentTrace";
import { buildPurchaseBillDetailHref } from "./procurementNavigation";
import { buildRmPoDetailHref } from "./rmPurchaseWoContinuity";
import { formatGrnNo, formatRmPoNo, type GrnRow, type RmPoRow } from "../pages/rmPurchase/rmPurchaseShared";

/** Extensible document kinds for procurement cross-navigation. */
export type ProcurementRelatedDocumentKind =
  | "PURCHASE_ORDER"
  | "GOODS_RECEIPT"
  | "PURCHASE_BILL"
  | "STOCK_POSTING";

export type ProcurementRelatedDocumentStatus = "current" | "available" | "pending";

export type ProcurementRelatedDocumentEntry = {
  kind: ProcurementRelatedDocumentKind;
  label: string;
  displayNo: string;
  href?: string;
  status: ProcurementRelatedDocumentStatus;
  entityId?: number;
};

function activeGrns(po: RmPoRow): GrnRow[] {
  return po.grns.filter((g) => !g.reversedAt);
}

function grnDisplayNo(grn: GrnRow, trace: RmPoTracePayload | null): string {
  return trace?.grns?.find((tg) => tg.id === grn.id)?.displayNo?.trim() || formatGrnNo(grn.id);
}

export function buildRmPoPageReturnHref(poId: number): string {
  return buildRmPoDetailHref(poId, { from: "procurement-nav" });
}

/** Related documents panel for RM Purchase Order detail. */
export function buildRmPoRelatedDocuments(
  po: RmPoRow,
  trace: RmPoTracePayload | null,
): ProcurementRelatedDocumentEntry[] {
  const poReturnHref = buildRmPoPageReturnHref(po.id);
  const documents: ProcurementRelatedDocumentEntry[] = [
    {
      kind: "PURCHASE_ORDER",
      label: "Purchase Order",
      displayNo: formatRmPoNo(po.id),
      status: "current",
      entityId: po.id,
    },
  ];

  const grns = activeGrns(po);
  if (!grns.length) {
    documents.push({
      kind: "GOODS_RECEIPT",
      label: "Goods Receipt",
      displayNo: "—",
      status: "pending",
    });
    return documents;
  }

  for (const grn of grns) {
    documents.push({
      kind: "GOODS_RECEIPT",
      label: "Goods Receipt",
      displayNo: grnDisplayNo(grn, trace),
      href: buildGrnDetailHref(grn.id, poReturnHref),
      status: "available",
      entityId: grn.id,
    });
  }

  return documents;
}

/** Related documents panel for Goods Receipt Note detail. */
export function buildGrnRelatedDocuments(
  detail: GrnDocumentPayload,
  poHref: string,
): ProcurementRelatedDocumentEntry[] {
  const documents: ProcurementRelatedDocumentEntry[] = [
    {
      kind: "PURCHASE_ORDER",
      label: "Purchase Order",
      displayNo: detail.po.displayNo,
      href: poHref,
      status: "available",
      entityId: detail.po.id,
    },
    {
      kind: "GOODS_RECEIPT",
      label: "Goods Receipt",
      displayNo: detail.grn.displayNo,
      status: "current",
      entityId: detail.grn.id,
    },
  ];

  const bills = detail.purchaseBillSummary?.bills ?? [];
  for (const bill of bills) {
    documents.push({
      kind: "PURCHASE_BILL",
      label: "Purchase Bill",
      displayNo: bill.billNo?.trim() || `PB-${bill.id}`,
      href: buildPurchaseBillDetailHref(bill.id),
      status: "available",
      entityId: bill.id,
    });
  }

  return documents;
}

export type ProcurementFlowLink = {
  displayNo: string;
  href?: string;
};

export function resolveRmPoFlowLinks(
  po: RmPoRow,
  trace: RmPoTracePayload | null,
): { po: ProcurementFlowLink; grns: ProcurementFlowLink[] } {
  const poReturnHref = buildRmPoPageReturnHref(po.id);
  return {
    po: { displayNo: formatRmPoNo(po.id) },
    grns: activeGrns(po).map((grn) => ({
      displayNo: grnDisplayNo(grn, trace),
      href: buildGrnDetailHref(grn.id, poReturnHref),
    })),
  };
}
