/** Shared ERP page load UX — initial skeleton vs refresh-with-stale-data. */

export type PageLoadSnapshot = {
  firstLoadDone: boolean;
  loading: boolean;
  hasDisplayData: boolean;
};

/** True while the first successful/failed fetch has not yet produced displayable content. */
export function shouldShowInitialPageSkeleton(input: PageLoadSnapshot): boolean {
  return !input.firstLoadDone && !input.hasDisplayData;
}

/** True only after the first load cycle completes and the dataset is empty. */
export function shouldShowEmptyState(input: { firstLoadDone: boolean; isEmpty: boolean }): boolean {
  return input.firstLoadDone && input.isEmpty;
}

/** Keep previous rows visible during background refresh. */
export function isPageRefreshing(input: PageLoadSnapshot): boolean {
  return input.firstLoadDone && input.loading && input.hasDisplayData;
}

/** Dedupe concurrent fetch calls for the same mount generation. */
export function createInFlightFetchDeduper() {
  let inFlight: Promise<unknown> | null = null;
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      if (inFlight) return inFlight as Promise<T>;
      const p = task().finally(() => {
        if (inFlight === p) inFlight = null;
      });
      inFlight = p;
      return p;
    },
    clear() {
      inFlight = null;
    },
  };
}
