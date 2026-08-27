/**
 * Production dashboard declutter when an Active Production Run exists.
 */

export function extractWorkOrderIdFromPendingHrefOrId(action: {
  href?: string | null;
  id?: string | null;
}): number | null {
  const href = String(action?.href ?? "");
  const fromHref = href.match(/[?&]workOrderId=(\d+)/);
  if (fromHref) return Number(fromHref[1]);
  const fromId = String(action?.id ?? "").match(/(?:^|:)wo:(\d+)/);
  if (fromId) return Number(fromId[1]);
  return null;
}

/** Pending Actions that are not for an already-active shift run WO. */
export function filterPendingActionsUnrelatedToActiveRuns<
  T extends { href?: string | null; id?: string | null },
>(actions: T[], activeWorkOrderIds: Iterable<number>): T[] {
  const active = new Set(
    [...activeWorkOrderIds].map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0),
  );
  if (!active.size) return actions;
  return actions.filter((a) => {
    const woId = extractWorkOrderIdFromPendingHrefOrId(a);
    if (woId == null || !(woId > 0)) return true;
    return !active.has(woId);
  });
}

export function shouldHideProductionDashboardDuplicates(activeRunCount: number): boolean {
  return Number(activeRunCount) > 0;
}

/** Hide Current Production Monitor rows already covered by Active Production Run. */
export function filterProdQueueExcludingActiveRunWos<T extends { workOrderId?: number | null }>(
  rows: T[] | null | undefined,
  activeWorkOrderIds: Iterable<number>,
): T[] | null {
  if (rows == null) return null;
  const active = new Set(
    [...activeWorkOrderIds].map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0),
  );
  if (!active.size) return rows;
  return rows.filter((r) => !active.has(Number(r.workOrderId ?? 0)));
}
