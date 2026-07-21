/** Pending PR lines from GET /api/purchase/purchase-requests/pending */

import { demandPoolLabelFromRemarks, demandPoolLabelForKey } from "./procurementTraceTerminology";
import type { ProcurementDemandPoolKey } from "./procurementWorkspaceQueues";

export type PendingPurchaseRequestSource = {
  materialRequirementLineId: number;
  requirementDocNo: string | null;
  sourceType?: string | null;
  demandPool?: string | null;
  sourceRef: string;
  allocatedQty: number;
};

export type PendingPurchaseRequestLine = {
  id: number;
  purchaseRequestId: number;
  rmItemId: number;
  itemName: string;
  unit: string;
  requiredQty: number;
  availableQty: number;
  netRequiredQty: number;
  orderedQty: number;
  pendingQty: number;
  /** Qty ordered above net requirement (pack/MOQ excess → stock). */
  excessOrderedQty: number;
  canOrder: boolean;
  orderBlockReason?: string | null;
  demandPool?: string | null;
  demandPoolLabel?: string | null;
  referenceLabel?: string | null;
  sourceTypes?: string[];
  sources?: PendingPurchaseRequestSource[];
};

export type PendingPurchaseRequest = {
  id: number;
  docNo: string | null;
  status: string;
  statusLabel: string;
  remarks: string | null;
  lines: PendingPurchaseRequestLine[];
};

export type PendingPurchaseRequestLineRow = PendingPurchaseRequestLine & {
  requestDocNo: string;
  requestStatus: string;
  requestStatusLabel: string;
};

/** Compact badge labels for Prepare RM PO (RS / Monthly Plan / Replenishment). */
export function requirementSourceBadgeLabel(
  line: Pick<PendingPurchaseRequestLine, "demandPool" | "demandPoolLabel" | "sourceTypes">,
  remarks?: string | null,
): string {
  const pool = (line.demandPool || null) as ProcurementDemandPoolKey | null;
  if (pool === "MPRS") return "Monthly Plan";
  if (pool === "STOCK_REPLENISHMENT") return "Replenishment";
  if (pool === "REGULAR_SO") return "Sales Orders";
  if (line.demandPoolLabel) return line.demandPoolLabel;
  const fromRemarks = demandPoolLabelFromRemarks(remarks);
  if (fromRemarks) {
    if (fromRemarks.toLowerCase().includes("replenish")) return "Replenishment";
    if (fromRemarks.toLowerCase().includes("monthly") || fromRemarks.toLowerCase().includes("mprs")) {
      return "Monthly Plan";
    }
    return fromRemarks;
  }
  const st = line.sourceTypes?.[0];
  if (st === "MONTHLY_PLAN") return "Monthly Plan";
  if (st === "STOCK_REPLENISHMENT") return "Replenishment";
  if (st === "SALES_ORDER") return "Sales Orders";
  return "—";
}

export function flattenOrderablePurchaseRequestLines(
  requests: PendingPurchaseRequest[],
): PendingPurchaseRequestLineRow[] {
  const out: PendingPurchaseRequestLineRow[] = [];
  for (const pr of requests) {
    const doc = pr.docNo || `PR-${pr.id}`;
    for (const ln of pr.lines) {
      if (!ln.canOrder) continue;
      const poolLabel =
        ln.demandPoolLabel ||
        demandPoolLabelForKey((ln.demandPool as ProcurementDemandPoolKey) || null) ||
        demandPoolLabelFromRemarks(pr.remarks);
      out.push({
        ...ln,
        requestDocNo: doc,
        requestStatus: pr.status,
        requestStatusLabel: pr.statusLabel,
        demandPoolLabel: poolLabel,
      });
    }
  }
  return out;
}

/** Excess from this PO line qty above net requirement (informational in create-PO modal). */
export function purchaseRequestPoExcessToStock(
  line: Pick<PendingPurchaseRequestLine, "netRequiredQty" | "orderedQty">,
  orderQty: number,
): number {
  const net = Number(line.netRequiredQty) || 0;
  const ordered = Number(line.orderedQty) || 0;
  const order = Number(orderQty) || 0;
  if (!Number.isFinite(order) || order <= 0) return 0;
  return Math.max(0, ordered + order - net);
}

export type RmPoCreateLinePayload = {
  purchaseRequestLineId: number;
  qty: number;
  rate: number;
};

/** Build create-po payload lines; qty 0 excluded. */
export function buildRmPoCreatePayloadLines(
  lines: PendingPurchaseRequestLineRow[],
  poQty: Record<number, string>,
  rates: Record<number, string>,
): RmPoCreateLinePayload[] {
  const out: RmPoCreateLinePayload[] = [];
  for (const ln of lines) {
    const qty = Number(poQty[ln.id]);
    const rate = Number(rates[ln.id]);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new Error(`Enter a valid order qty for ${ln.itemName}`);
    }
    if (qty === 0) continue;
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Enter rate for ${ln.itemName}`);
    }
    out.push({ purchaseRequestLineId: ln.id, qty, rate });
  }
  return out;
}

export type ConsolidatedPoPreviewLine = {
  rmItemId: number;
  itemName: string;
  unit: string;
  orderQty: number;
  rate: number;
  amount: number;
  allocationCount: number;
  prDocNos: string[];
};

/** Preview commercial consolidation (same RM + same rate → one PO item). */
export function previewConsolidatedRmPoLines(
  lines: PendingPurchaseRequestLineRow[],
  poQty: Record<number, string>,
  rates: Record<number, string>,
): { allocationsSelected: number; consolidated: ConsolidatedPoPreviewLine[]; totalAmount: number } {
  /** @type {Map<string, ConsolidatedPoPreviewLine>} */
  const byKey = new Map<string, ConsolidatedPoPreviewLine>();
  let allocationsSelected = 0;

  for (const ln of lines) {
    const qty = Number(poQty[ln.id]);
    const rate = Number(rates[ln.id]);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!Number.isFinite(rate) || rate <= 0) continue;
    allocationsSelected += 1;
    const rateKey = (Math.round(rate * 100) / 100).toFixed(2);
    const key = `${ln.rmItemId}:${rateKey}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.orderQty = Math.round((existing.orderQty + qty) * 1000) / 1000;
      existing.amount = Math.round(existing.orderQty * existing.rate * 100) / 100;
      existing.allocationCount += 1;
      if (!existing.prDocNos.includes(ln.requestDocNo)) existing.prDocNos.push(ln.requestDocNo);
    } else {
      byKey.set(key, {
        rmItemId: ln.rmItemId,
        itemName: ln.itemName,
        unit: ln.unit,
        orderQty: qty,
        rate,
        amount: Math.round(qty * rate * 100) / 100,
        allocationCount: 1,
        prDocNos: [ln.requestDocNo],
      });
    }
  }

  const consolidated = [...byKey.values()];
  const totalAmount = Math.round(consolidated.reduce((s, c) => s + c.amount, 0) * 100) / 100;
  return { allocationsSelected, consolidated, totalAmount };
}

/** User-facing message for create-po failures (uses backend code when present). */
export function formatPurchaseRequestPoError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const e = err as { message: string; code?: string; body?: { error?: { details?: unknown } } };
    if (e.code === "PR_ALREADY_ORDERED") {
      return e.message || "PO already created for this purchase request. Refresh the list.";
    }
    if (e.code === "PR_LINE_ALREADY_ORDERED") {
      return e.message || "PO already created for the selected line. Refresh the list.";
    }
    if (e.code === "PR_NOT_OPEN_FOR_ORDERING" || e.code === "PR_CANCELLED") {
      return e.message;
    }
    if (e.code === "RM_PO_RATE_MISMATCH") {
      return e.message;
    }
    if (e.code === "RM_PO_NO_ELIGIBLE_LINES") {
      return e.message || "Select at least one line with order quantity greater than zero.";
    }
    if (e.code === "MIXED_PROCUREMENT_DEMAND_POOL") {
      return e.message;
    }
    if (e.message.includes("not open for ordering")) {
      return "This purchase request is no longer open for ordering. Refresh pending requests — the PO may already exist.";
    }
    return e.message;
  }
  return "Failed to create RM PO";
}
