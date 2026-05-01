export type NumberDraft = number | "";

export function toNumberDraft(raw: string): NumberDraft {
  const s = String(raw ?? "");
  if (s === "") return "";
  const n = Number(s);
  return Number.isFinite(n) ? n : "";
}

export function numberDraftToNumber(draft: NumberDraft): number {
  return draft === "" ? NaN : draft;
}

export function isValidNumberDraft(draft: NumberDraft): draft is number {
  return draft !== "" && Number.isFinite(draft);
}

