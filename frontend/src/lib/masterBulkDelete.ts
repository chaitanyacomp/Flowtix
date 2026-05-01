import { ApiRequestError } from "../services/api";

/** Shown when at least one selected record was blocked (in use / FK), including mixed results. */
export const BULK_DELETE_IN_USE_TOAST = "Some records could not be deleted because they are already in use.";

/**
 * True when a delete failed because the record is referenced or otherwise protected
 * (matches common backend + Prisma errors and known user-facing messages).
 */
export function isMasterDeleteBlockedError(err: unknown): boolean {
  if (err instanceof ApiRequestError) {
    if (err.status === 409) return true;
  }
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const m = raw.toLowerCase();
  if (
    m.includes("foreign key") ||
    m.includes("p2003") ||
    m.includes("constraint failed") ||
    m.includes("cannot delete or update a parent row")
  ) {
    return true;
  }
  if (
    m.includes("used in transactions") ||
    m.includes("is used in transactions") ||
    m.includes("used in transaction") ||
    m.includes("cannot be deleted because it is used") ||
    m.includes("item is used in transactions") ||
    m.includes("supplier is used") ||
    m.includes("unit is in use") ||
    (m.includes("cannot be deleted") && m.includes("used"))
  ) {
    return true;
  }
  return false;
}

export type BulkDeleteResult = {
  attempted: number;
  failed: number;
  blockedFailures: number;
  otherFailures: number;
};

export async function bulkDeleteByIds(ids: number[], deleteOne: (id: number) => Promise<void>): Promise<BulkDeleteResult> {
  const attempted = ids.length;
  let blockedFailures = 0;
  let otherFailures = 0;

  const results = await Promise.allSettled(ids.map((id) => deleteOne(id)));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== "rejected") continue;
    const reason = r.reason;
    if (isMasterDeleteBlockedError(reason)) blockedFailures += 1;
    else otherFailures += 1;
  }

  const failed = blockedFailures + otherFailures;
  return { attempted, failed, blockedFailures, otherFailures };
}
