/**
 * Keep Production Workbench tab selection and productionBucket in sync.
 *
 * Fault class this prevents: pwSection cleared for Continue while
 * productionBucket=readyToStart remains → parseWorkspaceSection snaps back to Ready.
 */

import type { ProductionWorkspaceSectionId } from "./productionWorkspaceSections";

export type ApplyProductionWorkspaceSectionOpts = {
  /** Highlight a card after Resume / deep-link without scoping the process screen. */
  pwFocus?: number | null;
  clearNotice?: boolean;
};

/**
 * Mutates a copy of search params so Ready/Continue always use the canonical pair:
 * - Ready → pwSection=ready + productionBucket=readyToStart
 * - Continue → pwSection=active + productionBucket=inProgress
 * - Other tabs → explicit pwSection and productionBucket removed (avoids stale Ready/Continue lock)
 */
export function applyProductionWorkspaceSectionToSearchParams(
  searchParams: URLSearchParams,
  next: ProductionWorkspaceSectionId,
  opts?: ApplyProductionWorkspaceSectionOpts,
): URLSearchParams {
  const nextParams = new URLSearchParams(searchParams);

  if (next === "ready") {
    nextParams.set("pwSection", "ready");
    nextParams.set("productionBucket", "readyToStart");
  } else if (next === "active") {
    nextParams.set("pwSection", "active");
    nextParams.set("productionBucket", "inProgress");
  } else {
    nextParams.set("pwSection", next);
    nextParams.delete("productionBucket");
  }

  if (opts?.clearNotice !== false) {
    nextParams.delete("pwNotice");
  }

  const focus = opts?.pwFocus != null ? Number(opts.pwFocus) : NaN;
  if (Number.isFinite(focus) && focus > 0) {
    nextParams.set("pwFocus", String(focus));
  }

  return nextParams;
}

/** Resolve selected section from URL — productionBucket must not override an explicit pwSection. */
export function resolveProductionWorkspaceSectionFromSearch(
  pwSectionRaw: string | null | undefined,
  productionBucketRaw: string | null | undefined,
): ProductionWorkspaceSectionId {
  const raw = String(pwSectionRaw ?? "").trim();
  if (
    raw === "ready" ||
    raw === "active" ||
    raw === "paused" ||
    raw === "reportPending" ||
    raw === "pendingQa" ||
    raw === "awaitingStore" ||
    raw === "recent"
  ) {
    return raw;
  }
  const bucket = String(productionBucketRaw ?? "").trim();
  if (bucket === "readyToStart") return "ready";
  if (bucket === "inProgress") return "active";
  // Default overview opens Continue (active executable work), not Ready.
  return "active";
}
