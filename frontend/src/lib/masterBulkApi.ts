import { apiFetch } from "../services/api";

export type MasterBulkRowResult = { id: number; reason: string };

export type MasterBulkMutationResult = {
  requested: number;
  changed: number[];
  skipped: MasterBulkRowResult[];
  blocked: MasterBulkRowResult[];
  failed: MasterBulkRowResult[];
};

export type MasterBulkEntity = "customers" | "suppliers" | "items";
export type MasterBulkAction = "activate" | "deactivate" | "delete";

export async function postMasterBulkMutation(
  entity: MasterBulkEntity,
  action: MasterBulkAction,
  ids: number[],
): Promise<MasterBulkMutationResult> {
  return apiFetch<MasterBulkMutationResult>(`/api/${entity}/bulk-${action}`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

/** Concise toast copy from a bulk mutation result. */
export function summarizeMasterBulkResult(
  result: MasterBulkMutationResult,
  verbPast: string,
): { tone: "success" | "info" | "error"; message: string } {
  const changed = result.changed?.length ?? 0;
  const blocked = result.blocked?.length ?? 0;
  const failed = result.failed?.length ?? 0;
  const skipped = result.skipped?.length ?? 0;
  if (changed > 0 && blocked === 0 && failed === 0) {
    return { tone: "success", message: `${changed} record${changed === 1 ? "" : "s"} ${verbPast}.` };
  }
  if (changed > 0) {
    const parts = [`${changed} ${verbPast}`];
    if (blocked) parts.push(`${blocked} blocked`);
    if (failed) parts.push(`${failed} failed`);
    if (skipped) parts.push(`${skipped} skipped`);
    return { tone: "info", message: parts.join("; ") + "." };
  }
  if (blocked > 0 && failed === 0) {
    return {
      tone: "info",
      message: `No records ${verbPast}. ${blocked} blocked (in use or protected).`,
    };
  }
  return {
    tone: "error",
    message: `Bulk action failed. ${failed || blocked || skipped} record(s) could not be updated.`,
  };
}
