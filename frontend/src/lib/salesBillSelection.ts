export type BillableDispatch = { dispatchId: number; availableQty?: string | number };

export const isDispatchSelectable = (row: BillableDispatch): boolean => Number(row.availableQty || 0) > 0;

export function defaultBillNow(rows: BillableDispatch[]): Record<number, string> {
  return Object.fromEntries(rows.filter(isDispatchSelectable).map((row) => [row.dispatchId, String(row.availableQty)]));
}

export function selectAllEligible(rows: BillableDispatch[], checked: boolean): Record<number, boolean> {
  return checked ? Object.fromEntries(rows.filter(isDispatchSelectable).map((row) => [row.dispatchId, true])) : {};
}

export function selectAllState(rows: BillableDispatch[], selected: Record<number, boolean>) {
  const eligible = rows.filter(isDispatchSelectable);
  const selectedCount = eligible.filter((row) => selected[row.dispatchId]).length;
  return { checked: eligible.length > 0 && selectedCount === eligible.length, indeterminate: selectedCount > 0 && selectedCount < eligible.length };
}

export function blockNumericStepperKey(key: string): boolean {
  return key === "ArrowUp" || key === "ArrowDown";
}
