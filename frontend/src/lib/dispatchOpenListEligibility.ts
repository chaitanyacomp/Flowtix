/** Mirrors backend `dispatchOpenListEligibility.js` for defensive UI filtering. */
export const DISPATCH_OPEN_LIST_EPS = 1e-6;

export type DispatchOpenLineFields = {
  pendingDispatchQty?: number | null;
  dispatchPendingLock?: number | null;
  dispatchable?: number | null;
  dispatchableQty?: number | null;
  orderQty?: number | null;
  dispatched?: number | null;
};

export function isDispatchOpenListLineCandidate(
  lineStat: DispatchOpenLineFields,
  orderType: string | null | undefined,
): boolean {
  const pend = Number(lineStat.pendingDispatchQty ?? 0);
  const lock = Number(lineStat.dispatchPendingLock ?? 0);
  const dbl = Number(lineStat.dispatchable ?? lineStat.dispatchableQty ?? 0);

  if (orderType === "NO_QTY") {
    return (
      pend > DISPATCH_OPEN_LIST_EPS ||
      dbl > DISPATCH_OPEN_LIST_EPS ||
      lock > DISPATCH_OPEN_LIST_EPS
    );
  }

  const ordered = Number(lineStat.orderQty ?? 0);
  const dispatched = Number(lineStat.dispatched ?? 0);
  if (ordered > DISPATCH_OPEN_LIST_EPS && dispatched + DISPATCH_OPEN_LIST_EPS >= ordered) {
    return lock > DISPATCH_OPEN_LIST_EPS;
  }

  if (lock > DISPATCH_OPEN_LIST_EPS) return true;
  if (pend > DISPATCH_OPEN_LIST_EPS && dbl > DISPATCH_OPEN_LIST_EPS) return true;
  return false;
}
