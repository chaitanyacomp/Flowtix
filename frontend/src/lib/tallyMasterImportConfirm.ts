/**
 * Slim Confirm Import payload helpers (no preview rows / XML / diagnostics).
 */

export type TallyConfirmImportBodyArgs = {
  previewToken: string;
  clientOperationId: string;
  groupTypeOverrides: Record<string, string>;
  unitMapOverrides: Record<string, string>;
  confirmConflicts?: boolean;
  duplicateAction?: "SKIP" | "UPDATE_EMPTY_FIELDS_ONLY";
};

/** Build the Confirm Import JSON body — token + mapping decisions only. */
export function buildTallyConfirmImportBody(args: TallyConfirmImportBodyArgs): Record<string, unknown> {
  const body: Record<string, unknown> = {
    previewToken: args.previewToken,
    confirm: true,
    clientOperationId: args.clientOperationId,
    groupTypeOverrides: args.groupTypeOverrides,
    unitMapOverrides: args.unitMapOverrides,
  };
  if (args.confirmConflicts) body.confirmConflicts = true;
  if (args.duplicateAction) body.duplicateAction = args.duplicateAction;
  return body;
}

/** Byte size of a Confirm body (UTF-8). */
export function tallyConfirmBodyByteLength(body: Record<string, unknown>): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

/** True when the body looks like a legacy oversized confirm (per-item map for all stock rows). */
export function isOversizedLegacyConfirmBody(body: Record<string, unknown>): boolean {
  const overrides = body.itemTypeOverrides;
  if (!overrides || typeof overrides !== "object") return false;
  return Object.keys(overrides as object).length > 500;
}

export function formatTallyConfirm413Message(): string {
  return "The import confirmation request was too large. No stock items were imported.";
}
