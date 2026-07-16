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

/** Dispatch workspace: sales-order boot fetch must settle before completion messaging. */
export function isDispatchSalesOrdersBootPending(salesOrdersBootDone: boolean): boolean {
  return !salesOrdersBootDone;
}

/** Commit async fetch results only when the request generation is still current. */
export function shouldCommitAsyncFetchResult(requestGeneration: number, activeGeneration: number): boolean {
  return requestGeneration === activeGeneration;
}

/** Background refresh should not replace the whole page with an initial skeleton. */
export function shouldReplacePageWithInitialLoader(input: PageLoadSnapshot): boolean {
  return shouldShowInitialPageSkeleton(input);
}

/** Report table body: initial loader vs keep-stale refresh vs empty-after-boot. */
export function resolveReportTableLoadUi(input: PageLoadSnapshot & { isEmpty: boolean }) {
  const showInitialLoader = shouldShowInitialPageSkeleton(input);
  const showRefreshing = isPageRefreshing(input);
  const showEmpty = shouldShowEmptyState({ firstLoadDone: input.firstLoadDone, isEmpty: input.isEmpty });
  return {
    showInitialLoader,
    showRefreshing,
    showEmpty,
    /** Keep prior rows mounted whenever we are not on the initial empty boot path. */
    showTable: !showInitialLoader && !showEmpty,
  };
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
