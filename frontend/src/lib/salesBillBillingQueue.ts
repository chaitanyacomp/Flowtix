export type EligibleDispatchRow = {
  dispatchId: number;
  dispatchNo?: string;
  dispatchDate: string;
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName?: string | null;
  itemName?: string | null;
  dispatchedQty?: string;
  workflowStatus?: string;
  draftBillId?: number | null;
  hasDraftBill?: boolean;
};

function dispatchDateMs(iso: string): number {
  const d = new Date(iso);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

export function sortEligibleDispatches(rows: EligibleDispatchRow[]): EligibleDispatchRow[] {
  return [...rows].sort(
    (a, b) =>
      dispatchDateMs(b.dispatchDate) - dispatchDateMs(a.dispatchDate) ||
      Number(b.dispatchId) - Number(a.dispatchId),
  );
}

export function pickNextEligibleDispatch(
  rows: EligibleDispatchRow[],
  opts: { excludeDispatchId?: number | null } = {},
): EligibleDispatchRow | null {
  const exclude = Number(opts.excludeDispatchId ?? 0);
  const sorted = sortEligibleDispatches(rows);
  return sorted.find((row) => !(exclude > 0 && Number(row.dispatchId) === exclude)) ?? null;
}

export function hrefForEligibleDispatch(row: EligibleDispatchRow): string {
  if (row.hasDraftBill && row.draftBillId) {
    return `/sales-bills/${row.draftBillId}?from=billing-queue`;
  }
  return `/sales-bills/new?dispatchId=${row.dispatchId}&from=billing-queue`;
}
