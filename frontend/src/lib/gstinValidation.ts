/** Client-side GSTIN helpers — mirrors backend `gstinNormalize.js`. */

export const GSTIN_FORMAT_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function normalizeGstinInput(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function validateGstinFormatMessage(gstin: string): string | null {
  const g = normalizeGstinInput(gstin);
  if (!g) return null;
  if (g.length !== 15) return "GSTIN must be exactly 15 characters.";
  if (!GSTIN_FORMAT_REGEX.test(g)) return "Enter a valid GSTIN format (15 characters).";
  return null;
}

export function gstStateCodeFromGstin(gstin: string): string | null {
  const g = normalizeGstinInput(gstin);
  if (g.length < 2) return null;
  const code = g.slice(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}

export function gstinMatchesStateCode(gstin: string, stateCode: string | null | undefined): boolean {
  const prefix = gstStateCodeFromGstin(gstin);
  const code = stateCode != null ? String(stateCode).trim().padStart(2, "0") : null;
  if (!prefix || !code) return true;
  return prefix === code;
}

export type StateRow = { id: number; stateName: string; stateCode: string };

export function resolveStateIdFromGstin(gstin: string, states: StateRow[]): number | "" {
  const code = gstStateCodeFromGstin(gstin);
  if (!code) return "";
  const match = states.find((s) => String(s.stateCode).padStart(2, "0") === code);
  return match?.id ?? "";
}

export function validateGstinAgainstState(
  gstin: string,
  stateId: number | "",
  states: StateRow[],
): string | null {
  const formatMsg = validateGstinFormatMessage(gstin);
  if (formatMsg) return formatMsg;
  const g = normalizeGstinInput(gstin);
  if (!g) return null;
  if (stateId === "") return null;
  const state = states.find((s) => s.id === stateId);
  if (!state) return null;
  if (!gstinMatchesStateCode(g, state.stateCode)) {
    return "Selected state does not match the GSTIN state code.";
  }
  return null;
}
