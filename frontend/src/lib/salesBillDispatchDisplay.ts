export type SalesBillDispatchSource = {
  dispatchId: number;
  allocatedQty: string | number;
  dispatch?: { docNo?: string | null } | null;
};

export function salesBillDispatchLabel(sources: SalesBillDispatchSource[]): string {
  if (sources.length === 1) return sources[0].dispatch?.docNo?.trim() || `D-${sources[0].dispatchId}`;
  return `${sources.length} Dispatches`;
}

export function salesBillDispatchDetails(sources: SalesBillDispatchSource[]): string[] {
  return sources.map((source) => `${source.dispatch?.docNo?.trim() || `D-${source.dispatchId}`} (${Number(source.allocatedQty)} allocated)`);
}
