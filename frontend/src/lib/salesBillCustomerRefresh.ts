export type SalesBillApiFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/** Mutate the draft, then reload its canonical representation for immediate display. */
export async function refreshSalesBillCustomerDetails<T>(
  billId: number,
  fetcher: SalesBillApiFetch,
): Promise<T> {
  await fetcher<T>(`/api/sales-bills/${billId}/refresh-customer-details`, { method: "POST" });
  return fetcher<T>(`/api/sales-bills/${billId}`);
}
