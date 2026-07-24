export function displayedEffectiveItemType(mapped: Record<string, unknown> | null | undefined): string {
  const value = String(mapped?.itemType ?? "").trim().toUpperCase();
  return ["RM", "FG", "SFG", "CONSUMABLE"].includes(value) ? value : "—";
}

export function tallyConfirmIsDisabled(input: {
  busy: boolean;
  hasPreviewToken: boolean;
  confirmBlockingCount: number;
  mappingsDirty: boolean;
  stage2Editable: boolean;
}): boolean {
  return (
    input.busy ||
    !input.hasPreviewToken ||
    input.confirmBlockingCount > 0 ||
    input.mappingsDirty ||
    !input.stage2Editable
  );
}
