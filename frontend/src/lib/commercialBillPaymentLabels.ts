/** Commercial payment follow-up display (not statutory accounting). */

import { hasEffectiveCommercialDueDate } from "./commercialDueDateDisplay";

const EPS = 1e-6;

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function isBillAmountOverdue(
  dueDateIso: string | null | undefined,
  pendingAmount: number,
  status: string,
  cancelledAt?: string | null,
): boolean {
  if (status !== "FINALIZED" || cancelledAt) return false;
  if (!(pendingAmount > EPS)) return false;
  if (!hasEffectiveCommercialDueDate(dueDateIso)) return false;
  const due = new Date(dueDateIso as string);
  return startOfLocalDay(due) < startOfLocalDay(new Date());
}

function n(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Core receivable/payable status from amounts (before overdue badge). */
export function commercialPaymentStatusLabel(
  kind: "sales" | "purchase",
  row: {
    status: string;
    cancelledAt?: string | null;
    pendingAmount?: string | number | null;
    receivedAmount?: string | number | null;
    paidAmount?: string | number | null;
    paymentStatus?: string | null;
  },
): "PAID" | "PARTIAL" | "PENDING" | "—" {
  if (row.status !== "FINALIZED") return "—";
  if (row.cancelledAt) return "—";
  const pending = n(row.pendingAmount);
  if (pending <= EPS) return "PAID";
  if (kind === "sales") {
    const rec = n(row.receivedAmount);
    if (rec > EPS && pending > EPS) return "PARTIAL";
    return "PENDING";
  }
  const paid = n(row.paidAmount);
  if (paid > EPS && pending > EPS) return "PARTIAL";
  return "PENDING";
}
